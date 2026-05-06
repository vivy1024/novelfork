import { getAgentSystemPrompt } from "@vivy1024/novelfork-core";

import type { CanvasContext, SessionToolExecutionResult } from "../../shared/agent-native-workspace.js";
import {
  DEFAULT_SESSION_CONFIG,
  type CreateNarratorSessionInput,
  type NarratorSessionChatMessage,
  type NarratorSessionRecord,
  type SessionConfig,
  type SessionCumulativeUsage,
  type TokenUsage,
  type SessionPermissionMode,
  type ToolCall,
} from "../../shared/session-types.js";
import { buildAgentContext } from "./agent-context.js";
import { runAgentTurn, type AgentGenerateResult, type AgentTurnEvent, type AgentTurnItem } from "./agent-turn-runtime.js";
import { generateSessionReply } from "./llm-runtime-service.js";
import { appendSessionChatHistory, loadSessionChatHistory } from "./session-history-store.js";
import { createSession, getSessionById, updateSession } from "./session-service.js";
import { createSessionToolExecutor } from "./session-tool-executor.js";
import { getEnabledSessionTools } from "./session-tool-registry.js";

const HEADLESS_CHAT_INSTRUCTIONS = `

## Headless stream-json 模式
- 你正在非交互 headless chat 模式下运行。
- 直接推进当前请求；需要用户批准的工具会由系统暂停为 permission_request。
- AI 生成正文只能进入候选稿/草稿/预览边界，不得静默覆盖正式章节。`;

const DEFAULT_MAX_STEPS = 6;
const RECENT_MESSAGE_LIMIT = 80;

export type HeadlessChatInputFormat = "text" | "stream-json";
export type HeadlessChatOutputFormat = "json" | "stream-json";
export type HeadlessChatStopReason = "completed" | "pending_confirmation" | "failed" | "max_turns" | "max_budget";

export type HeadlessChatInputEvent = {
  readonly type: string;
  readonly content?: unknown;
  readonly message?: { readonly content?: unknown };
};

export interface HeadlessChatInput {
  readonly prompt?: string;
  readonly inputFormat?: HeadlessChatInputFormat;
  readonly outputFormat?: HeadlessChatOutputFormat;
  readonly events?: readonly HeadlessChatInputEvent[];
  readonly sessionId?: string;
  readonly agentId?: string;
  readonly projectId?: string;
  readonly sessionConfig?: Partial<SessionConfig>;
  readonly stdinContext?: string;
  readonly noSessionPersistence?: boolean;
  readonly maxSteps?: number;
  readonly maxTurns?: number;
  readonly maxBudgetUsd?: number;
  readonly canvasContext?: CanvasContext;
}

export interface HeadlessUsageTokens {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly totalTokens: number;
}

export type HeadlessCumulativeUsage = SessionCumulativeUsage & { readonly totalTokens: number };

export interface HeadlessChatUsageEnvelope {
  readonly currentTurn: HeadlessUsageTokens;
  readonly cumulative: HeadlessCumulativeUsage;
}

export interface HeadlessChatCostEnvelope {
  readonly status: "unknown";
  readonly currency: "USD";
  readonly amount: null;
}

export interface HeadlessPermissionDenial {
  readonly toolName: string;
  readonly reason: string;
  readonly summary: string;
}

export type HeadlessChatStreamEvent =
  | { readonly type: "user_message"; readonly session_id: string; readonly content: string; readonly ephemeral: boolean }
  | { readonly type: "assistant_delta"; readonly session_id: string; readonly delta: string; readonly ephemeral: boolean }
  | { readonly type: "assistant_message"; readonly session_id: string; readonly content: string; readonly runtime?: unknown; readonly ephemeral: boolean }
  | { readonly type: "tool_use"; readonly session_id: string; readonly tool_use_id: string; readonly tool_name: string; readonly input: Record<string, unknown>; readonly runtime?: unknown; readonly ephemeral: boolean }
  | { readonly type: "tool_result"; readonly session_id: string; readonly tool_use_id: string; readonly tool_name: string; readonly result: SessionToolExecutionResult; readonly runtime?: unknown; readonly ephemeral: boolean }
  | { readonly type: "permission_request"; readonly session_id: string; readonly confirmation_id: string; readonly tool_name: string; readonly confirmation?: unknown; readonly result: SessionToolExecutionResult; readonly ephemeral: boolean }
  | { readonly type: "error"; readonly session_id: string; readonly code: string; readonly message: string; readonly data?: unknown; readonly ephemeral: boolean }
  | { readonly type: "result"; readonly session_id: string; readonly success: boolean; readonly stop_reason: HeadlessChatStopReason; readonly exit_code: number; readonly final_message?: string; readonly error?: string; readonly pending_confirmation?: { readonly toolName: string; readonly id: string }; readonly ephemeral: boolean; readonly duration_ms: number; readonly usage: HeadlessChatUsageEnvelope; readonly cost: HeadlessChatCostEnvelope; readonly permission_denials: readonly HeadlessPermissionDenial[] };

export interface HeadlessChatResult {
  readonly sessionId: string;
  readonly ephemeral: boolean;
  readonly events: readonly HeadlessChatStreamEvent[];
  readonly runtimeEvents: readonly AgentTurnEvent[];
  readonly finalMessage?: string;
  readonly toolResults: ReadonlyArray<{ readonly toolName: string; readonly result: SessionToolExecutionResult }>;
  readonly pendingConfirmation?: { readonly toolName: string; readonly id: string };
  readonly success: boolean;
  readonly stopReason: HeadlessChatStopReason;
  readonly exitCode: number;
  readonly error?: string;
  readonly durationMs: number;
  readonly usage: HeadlessChatUsageEnvelope;
  readonly cost: HeadlessChatCostEnvelope;
  readonly permissionDenials: readonly HeadlessPermissionDenial[];
}

function mergeSessionConfig(overrides: Partial<SessionConfig> | undefined): SessionConfig {
  return {
    ...DEFAULT_SESSION_CONFIG,
    ...overrides,
    permissionMode: overrides?.permissionMode ?? DEFAULT_SESSION_CONFIG.permissionMode,
    reasoningEffort: overrides?.reasoningEffort ?? DEFAULT_SESSION_CONFIG.reasoningEffort,
  };
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function promptFromStreamEvents(events: readonly HeadlessChatInputEvent[] | undefined): string | undefined {
  if (!Array.isArray(events)) return undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || (event.type !== "user_message" && event.type !== "user")) continue;
    const directContent = normalizeText(event.content);
    if (directContent) return directContent;
    const messageContent = normalizeText(event.message?.content);
    if (messageContent) return messageContent;
  }
  return undefined;
}

function resolvePrompt(input: HeadlessChatInput): string | undefined {
  return normalizeText(input.prompt) ?? (input.inputFormat === "stream-json" ? promptFromStreamEvents(input.events) : undefined);
}

function lastSeq(messages: readonly NarratorSessionChatMessage[]): number {
  return messages.reduce((max, message) => Math.max(max, message.seq ?? 0), 0);
}

function withSeq(message: Omit<NarratorSessionChatMessage, "seq">, seq: number): NarratorSessionChatMessage {
  return { ...message, seq };
}

function toolCallStatus(result: SessionToolExecutionResult): ToolCall["status"] {
  if (result.ok && (result.confirmation || (typeof result.data === "object" && result.data !== null && (result.data as { status?: unknown }).status === "pending-confirmation"))) {
    return "pending";
  }
  return result.ok ? "success" : "error";
}

function toolCallFromResult(event: Extract<AgentTurnEvent, { type: "tool_result" }>, input: Record<string, unknown>): ToolCall {
  return {
    id: event.id,
    toolName: event.toolName,
    status: toolCallStatus(event.result),
    summary: event.result.summary,
    input,
    result: event.result,
    ...(event.result.durationMs ? { duration: event.result.durationMs } : {}),
    ...(event.result.renderer ? { renderer: event.result.renderer } : {}),
    ...(event.result.artifact ? { artifact: event.result.artifact } : {}),
    ...(event.result.confirmation ? { confirmation: event.result.confirmation } : {}),
    ...(event.result.error ? { error: event.result.error } : {}),
  };
}

function buildMessagesToPersist(input: {
  readonly sessionId: string;
  readonly prompt: string;
  readonly runtimeEvents: readonly AgentTurnEvent[];
  readonly startSeq: number;
  readonly timestamp: number;
}): NarratorSessionChatMessage[] {
  const messages: NarratorSessionChatMessage[] = [];
  const toolInputsById = new Map<string, Record<string, unknown>>();
  let seq = input.startSeq;
  let timestampOffset = 0;
  const nextTimestamp = () => input.timestamp + timestampOffset++;

  messages.push(withSeq({
    id: `headless-user-${input.timestamp}`,
    role: "user",
    content: input.prompt,
    timestamp: nextTimestamp(),
  }, ++seq));

  let assistantIndex = 0;
  for (const event of input.runtimeEvents) {
    if (event.type === "assistant_message") {
      messages.push(withSeq({
        id: assistantIndex === 0 ? `headless-assistant-${input.timestamp}` : `headless-assistant-${input.timestamp}-${assistantIndex + 1}`,
        role: "assistant",
        content: event.content,
        timestamp: nextTimestamp(),
        runtime: event.runtime,
      }, ++seq));
      assistantIndex += 1;
      continue;
    }

    if (event.type === "tool_call") {
      toolInputsById.set(event.id, event.input);
      messages.push(withSeq({
        id: `headless-tool-use-${event.id}-${input.timestamp}`,
        role: "assistant",
        content: `请求调用工具 ${event.toolName}。`,
        timestamp: nextTimestamp(),
        runtime: event.runtime,
        toolCalls: [{ id: event.id, toolName: event.toolName, input: event.input }],
      }, ++seq));
      continue;
    }

    if (event.type === "tool_result") {
      const toolInput = toolInputsById.get(event.id) ?? {};
      messages.push(withSeq({
        id: `headless-tool-result-${event.id}-${input.timestamp}`,
        role: "assistant",
        content: event.result.summary,
        timestamp: nextTimestamp(),
        ...(event.runtime ? { runtime: event.runtime } : {}),
        toolCalls: [toolCallFromResult(event, toolInput)],
        metadata: {
          toolResult: event.result,
          ...(event.result.confirmation ? { confirmation: event.result.confirmation } : {}),
        },
      }, ++seq));
      continue;
    }

    if (event.type === "turn_failed") {
      messages.push(withSeq({
        id: `headless-error-${input.timestamp}`,
        role: "assistant",
        content: event.message,
        timestamp: nextTimestamp(),
        metadata: { headlessFailure: { reason: event.reason, ...(event.data ? { data: event.data } : {}) } },
      }, ++seq));
    }
  }

  return messages;
}

const UNKNOWN_COST: HeadlessChatCostEnvelope = { status: "unknown", currency: "USD", amount: null };

function zeroUsageTokens(): HeadlessUsageTokens {
  return { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, totalTokens: 0 };
}

function usageTokensFrom(metadataUsage: TokenUsage | undefined): HeadlessUsageTokens {
  if (!metadataUsage) return zeroUsageTokens();
  const inputTokens = metadataUsage.input_tokens ?? 0;
  const outputTokens = metadataUsage.output_tokens ?? 0;
  const cacheCreationInputTokens = metadataUsage.cache_creation_input_tokens ?? 0;
  const cacheReadInputTokens = metadataUsage.cache_read_input_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
  };
}

function addUsage(left: HeadlessUsageTokens, right: HeadlessUsageTokens): HeadlessUsageTokens {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheCreationInputTokens: left.cacheCreationInputTokens + right.cacheCreationInputTokens,
    cacheReadInputTokens: left.cacheReadInputTokens + right.cacheReadInputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function collectTurnUsage(events: readonly AgentTurnEvent[]): HeadlessUsageTokens {
  return events.reduce((usage, event) => {
    if (event.type !== "assistant_message" && event.type !== "tool_call") return usage;
    return addUsage(usage, usageTokensFrom(event.runtime.usage));
  }, zeroUsageTokens());
}

function cumulativeWithTotal(cumulative: SessionCumulativeUsage | undefined, currentTurn: HeadlessUsageTokens): HeadlessCumulativeUsage {
  const totalInputTokens = (cumulative?.totalInputTokens ?? 0) + currentTurn.inputTokens;
  const totalOutputTokens = (cumulative?.totalOutputTokens ?? 0) + currentTurn.outputTokens;
  const totalCacheCreationInputTokens = (cumulative?.totalCacheCreationInputTokens ?? 0) + currentTurn.cacheCreationInputTokens;
  const totalCacheReadInputTokens = (cumulative?.totalCacheReadInputTokens ?? 0) + currentTurn.cacheReadInputTokens;
  return {
    totalInputTokens,
    totalOutputTokens,
    totalCacheCreationInputTokens,
    totalCacheReadInputTokens,
    turnCount: (cumulative?.turnCount ?? 0) + (currentTurn.totalTokens > 0 ? 1 : 0),
    totalTokens: totalInputTokens + totalOutputTokens + totalCacheCreationInputTokens + totalCacheReadInputTokens,
  };
}

function buildUsageEnvelope(session: NarratorSessionRecord | undefined, currentTurn: HeadlessUsageTokens): HeadlessChatUsageEnvelope {
  return { currentTurn, cumulative: cumulativeWithTotal(session?.cumulativeUsage, currentTurn) };
}

function collectPermissionDenials(events: readonly AgentTurnEvent[]): readonly HeadlessPermissionDenial[] {
  const denials: HeadlessPermissionDenial[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.type !== "tool_result") continue;
    if (event.result.ok || event.result.error !== "policy-denied") continue;
    const key = `${event.toolName}:${event.result.error}:${event.result.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    denials.push({ toolName: event.toolName, reason: event.result.error, summary: event.result.summary });
  }
  return denials;
}

function collectRuntimeSummary(events: readonly AgentTurnEvent[]): {
  readonly finalMessage?: string;
  readonly toolResults: ReadonlyArray<{ readonly toolName: string; readonly result: SessionToolExecutionResult }>;
  readonly pendingConfirmation?: { readonly toolName: string; readonly id: string };
  readonly success: boolean;
  readonly stopReason: HeadlessChatStopReason;
  readonly exitCode: number;
  readonly error?: string;
} {
  let finalMessage: string | undefined;
  const toolResults: Array<{ toolName: string; result: SessionToolExecutionResult }> = [];
  let pendingConfirmation: { toolName: string; id: string } | undefined;
  let success = true;
  let stopReason: HeadlessChatStopReason = "completed";
  let exitCode = 0;
  let error: string | undefined;

  for (const event of events) {
    if (event.type === "assistant_message") finalMessage = event.content;
    if (event.type === "tool_result") toolResults.push({ toolName: event.toolName, result: event.result });
    if (event.type === "confirmation_required") {
      pendingConfirmation = { toolName: event.toolName, id: event.id };
      success = false;
      stopReason = "pending_confirmation";
      exitCode = 2;
    }
    if (event.type === "turn_failed") {
      success = false;
      stopReason = "failed";
      exitCode = 1;
      error = event.reason;
    }
  }

  return {
    finalMessage,
    toolResults,
    pendingConfirmation,
    success,
    stopReason,
    exitCode,
    error,
  };
}

function runtimeEventToStreamEvent(
  sessionId: string,
  ephemeral: boolean,
  event: AgentTurnEvent,
): HeadlessChatStreamEvent[] {
  switch (event.type) {
    case "streaming_chunk":
      return [{ type: "assistant_delta", session_id: sessionId, delta: event.content, ephemeral }];
    case "assistant_message":
      return [{ type: "assistant_message", session_id: sessionId, content: event.content, runtime: event.runtime, ephemeral }];
    case "tool_call":
      return [{ type: "tool_use", session_id: sessionId, tool_use_id: event.id, tool_name: event.toolName, input: event.input, runtime: event.runtime, ephemeral }];
    case "tool_result":
      return [{ type: "tool_result", session_id: sessionId, tool_use_id: event.id, tool_name: event.toolName, result: event.result, ...(event.runtime ? { runtime: event.runtime } : {}), ephemeral }];
    case "confirmation_required":
      return [{
        type: "permission_request",
        session_id: sessionId,
        confirmation_id: event.result.confirmation?.id ?? event.id,
        tool_name: event.toolName,
        ...(event.result.confirmation ? { confirmation: event.result.confirmation } : {}),
        result: event.result,
        ephemeral,
      }];
    case "turn_failed":
      return [{ type: "error", session_id: sessionId, code: event.reason, message: event.message, ...(event.data ? { data: event.data } : {}), ephemeral }];
    case "turn_completed":
      return [];
  }
}

function buildStreamEvents(input: {
  readonly sessionId: string;
  readonly prompt: string;
  readonly ephemeral: boolean;
  readonly runtimeEvents: readonly AgentTurnEvent[];
  readonly durationMs: number;
  readonly summary: ReturnType<typeof collectRuntimeSummary>;
  readonly usage: HeadlessChatUsageEnvelope;
  readonly cost: HeadlessChatCostEnvelope;
  readonly permissionDenials: readonly HeadlessPermissionDenial[];
}): HeadlessChatStreamEvent[] {
  const events: HeadlessChatStreamEvent[] = [
    { type: "user_message", session_id: input.sessionId, content: input.prompt, ephemeral: input.ephemeral },
  ];
  for (const event of input.runtimeEvents) {
    events.push(...runtimeEventToStreamEvent(input.sessionId, input.ephemeral, event));
  }
  events.push({
    type: "result",
    session_id: input.sessionId,
    success: input.summary.success,
    stop_reason: input.summary.stopReason,
    exit_code: input.summary.exitCode,
    ...(input.summary.finalMessage ? { final_message: input.summary.finalMessage } : {}),
    ...(input.summary.error ? { error: input.summary.error } : {}),
    ...(input.summary.pendingConfirmation ? { pending_confirmation: input.summary.pendingConfirmation } : {}),
    ephemeral: input.ephemeral,
    duration_ms: input.durationMs,
    usage: input.usage,
    cost: input.cost,
    permission_denials: input.permissionDenials,
  });
  return events;
}

async function resolveSession(input: HeadlessChatInput, prompt: string): Promise<{ readonly session: NarratorSessionRecord; readonly ephemeral: false } | { readonly session: NarratorSessionRecord; readonly ephemeral: true }> {
  if (input.noSessionPersistence) {
    const now = new Date().toISOString();
    return {
      ephemeral: true,
      session: {
        id: `ephemeral:${crypto.randomUUID()}`,
        title: `Headless Chat: ${prompt.slice(0, 40)}`,
        agentId: input.agentId ?? "writer",
        kind: "standalone",
        sessionMode: "chat",
        status: "active",
        createdAt: now,
        lastModified: now,
        messageCount: 0,
        sortOrder: 0,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        sessionConfig: mergeSessionConfig(input.sessionConfig),
        recentMessages: [],
      },
    };
  }

  if (input.sessionId) {
    const session = await getSessionById(input.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${input.sessionId}`);
    }
    return { session, ephemeral: false };
  }

  const createInput: CreateNarratorSessionInput = {
    title: `Headless Chat: ${prompt.slice(0, 40)}`,
    agentId: input.agentId ?? "writer",
    kind: "standalone",
    sessionMode: "chat",
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.sessionConfig ? { sessionConfig: input.sessionConfig } : {}),
  };
  return { session: await createSession(createInput), ephemeral: false };
}

async function persistHeadlessTurn(session: NarratorSessionRecord, prompt: string, runtimeEvents: readonly AgentTurnEvent[], timestamp: number, cumulativeUsage: HeadlessCumulativeUsage): Promise<void> {
  const existingHistory = await loadSessionChatHistory(session.id);
  const startSeq = Math.max(session.messageCount, lastSeq(existingHistory), lastSeq(session.recentMessages ?? []));
  const messagesToPersist = buildMessagesToPersist({ sessionId: session.id, prompt, runtimeEvents, startSeq, timestamp });
  if (messagesToPersist.length === 0) return;
  const persisted = await appendSessionChatHistory(session.id, messagesToPersist, existingHistory);
  const nextRecent = persisted.length > 0 ? persisted.slice(-RECENT_MESSAGE_LIMIT) : messagesToPersist.slice(-RECENT_MESSAGE_LIMIT);
  const messageCount = Math.max(startSeq, lastSeq(persisted), lastSeq(messagesToPersist));
  await updateSession(session.id, {
    messageCount,
    recentMessages: nextRecent,
    cumulativeUsage,
  });
}

function createLimitStoppedResult(
  sessionId: string,
  ephemeral: boolean,
  prompt: string,
  stopReason: "max_turns" | "max_budget",
  error: string,
  startedAt: number,
): HeadlessChatResult {
  const durationMs = Date.now() - startedAt;
  const usage = buildUsageEnvelope(undefined, zeroUsageTokens());
  const permissionDenials: readonly HeadlessPermissionDenial[] = [];
  const events: HeadlessChatStreamEvent[] = [
    { type: "user_message", session_id: sessionId, content: prompt, ephemeral },
    { type: "result", session_id: sessionId, success: false, stop_reason: stopReason, exit_code: 1, error, ephemeral, duration_ms: durationMs, usage, cost: UNKNOWN_COST, permission_denials: permissionDenials },
  ];
  return {
    sessionId,
    ephemeral,
    events,
    runtimeEvents: [],
    toolResults: [],
    success: false,
    stopReason,
    exitCode: 1,
    error,
    durationMs,
    usage,
    cost: UNKNOWN_COST,
    permissionDenials,
  };
}

function failureResult(sessionId: string, ephemeral: boolean, prompt: string, error: string, startedAt: number): HeadlessChatResult {
  const durationMs = Date.now() - startedAt;
  const usage = buildUsageEnvelope(undefined, zeroUsageTokens());
  const permissionDenials: readonly HeadlessPermissionDenial[] = [];
  const resultEvent: HeadlessChatStreamEvent = {
    type: "result",
    session_id: sessionId,
    success: false,
    stop_reason: "failed",
    exit_code: 1,
    error,
    ephemeral,
    duration_ms: durationMs,
    usage,
    cost: UNKNOWN_COST,
    permission_denials: permissionDenials,
  };
  return {
    sessionId,
    ephemeral,
    events: [
      { type: "user_message", session_id: sessionId, content: prompt, ephemeral },
      { type: "error", session_id: sessionId, code: "invalid-headless-input", message: error, ephemeral },
      resultEvent,
    ],
    runtimeEvents: [],
    toolResults: [],
    success: false,
    stopReason: "failed",
    exitCode: 1,
    error,
    durationMs,
    usage,
    cost: UNKNOWN_COST,
    permissionDenials,
  };
}

export async function executeHeadlessChat(input: HeadlessChatInput): Promise<HeadlessChatResult> {
  const startedAt = Date.now();
  const prompt = resolvePrompt(input);
  if (!prompt) {
    return failureResult(input.sessionId ?? "ephemeral:invalid", Boolean(input.noSessionPersistence), "", "prompt is required", startedAt);
  }

  let resolved: Awaited<ReturnType<typeof resolveSession>>;
  try {
    resolved = await resolveSession(input, prompt);
  } catch (error) {
    return failureResult(input.sessionId ?? "ephemeral:missing-session", false, prompt, error instanceof Error ? error.message : String(error), startedAt);
  }

  const { session, ephemeral } = resolved;
  if (input.maxTurns !== undefined && input.maxTurns <= 0) {
    return createLimitStoppedResult(session.id, ephemeral, prompt, "max_turns", "max-turns", startedAt);
  }

  if (input.maxBudgetUsd !== undefined && input.maxBudgetUsd <= 0) {
    return createLimitStoppedResult(session.id, ephemeral, prompt, "max_budget", "max-budget", startedAt);
  }

  const projectId = input.projectId ?? session.projectId;
  let context = "";
  if (projectId) {
    try {
      context = await buildAgentContext({ bookId: projectId });
    } catch { /* context build failure is non-fatal */ }
  }
  if (input.stdinContext?.trim()) {
    const stdinContext = `\n\n## 附加上下文（stdin）\n\n${input.stdinContext.trim()}`;
    context = context ? `${context}${stdinContext}` : stdinContext;
  }

  const userMessage: AgentTurnItem = {
    type: "message",
    role: "user",
    content: prompt,
    id: `headless-chat-${startedAt}`,
  };
  const permissionMode: SessionPermissionMode = session.sessionConfig.permissionMode;
  const toolExecutor = createSessionToolExecutor();
  const runtimeEvents = await runAgentTurn({
    sessionId: session.id,
    sessionConfig: session.sessionConfig,
    messages: [userMessage],
    systemPrompt: `${getAgentSystemPrompt(session.agentId)}${HEADLESS_CHAT_INSTRUCTIONS}`,
    context,
    tools: getEnabledSessionTools(permissionMode),
    permissionMode,
    ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
    maxSteps: input.maxSteps ?? DEFAULT_MAX_STEPS,
    shouldContinueAfterToolResult: ({ result }) => result.ok || result.error === "confirmation-rejected",
    onStreamChunk: () => undefined,
    generate: async (generateInput): Promise<AgentGenerateResult> => {
      const result = await generateSessionReply({
        sessionConfig: generateInput.sessionConfig,
        messages: generateInput.messages,
        tools: generateInput.tools,
        onStreamChunk: generateInput.onStreamChunk,
        signal: generateInput.signal,
      });
      return result as AgentGenerateResult;
    },
    executeTool: (toolInput) => toolExecutor.execute(toolInput),
  });

  const currentTurnUsage = collectTurnUsage(runtimeEvents);
  const usage = buildUsageEnvelope(session, currentTurnUsage);
  const permissionDenials = collectPermissionDenials(runtimeEvents);

  if (!ephemeral) {
    await persistHeadlessTurn(session, prompt, runtimeEvents, startedAt, usage.cumulative);
  }

  const durationMs = Date.now() - startedAt;
  const summary = collectRuntimeSummary(runtimeEvents);
  const events = buildStreamEvents({ sessionId: session.id, prompt, ephemeral, runtimeEvents, durationMs, summary, usage, cost: UNKNOWN_COST, permissionDenials });
  return {
    sessionId: session.id,
    ephemeral,
    events,
    runtimeEvents,
    finalMessage: summary.finalMessage,
    toolResults: summary.toolResults,
    pendingConfirmation: summary.pendingConfirmation,
    success: summary.success,
    stopReason: summary.stopReason,
    exitCode: summary.exitCode,
    error: summary.error,
    durationMs,
    usage,
    cost: UNKNOWN_COST,
    permissionDenials,
  };
}

export function encodeHeadlessChatEventsAsNdjson(events: readonly HeadlessChatStreamEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n");
}
