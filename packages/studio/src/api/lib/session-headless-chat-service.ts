import { getAgentSystemPrompt } from "@vivy1024/novelfork-core";
import { executeRuntimeCommandInput, type RuntimeCommandEvent } from "@vivy1024/novelfork-core/registry/command-executor";

import type { CanvasContext, SessionToolExecutionResult } from "../../shared/agent-native-workspace.js";
import { getCodexRuntimeCapabilityStatuses } from "../../shared/codex-runtime-status.js";
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
import type { AgentGenerateResult, AgentTurnEvent, AgentTurnItem } from "./agent-turn-runtime.js";
import { executeRuntimeTurn } from "./runtime-turn-service.js";
import { createRuntimeResultEvent, type RuntimeEvent } from "./runtime-events.js";
import { attachRuntimeTranscriptToMessages } from "./runtime-transcript.js";
import { encodeRuntimeStreamJsonEventsAsNdjson, runtimeEventsToStreamJsonEvents, type RuntimeStreamJsonEvent } from "./runtime-stream-json.js";
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

export type HeadlessChatStreamEvent = RuntimeStreamJsonEvent;

export interface HeadlessChatResult {
  readonly sessionId: string;
  readonly ephemeral: boolean;
  readonly events: readonly HeadlessChatStreamEvent[];
  readonly runtimeEvents: readonly AgentTurnEvent[];
  readonly canonicalEvents: readonly RuntimeEvent[];
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

function buildStreamEvents(input: {
  readonly sessionId: string;
  readonly prompt: string;
  readonly ephemeral: boolean;
  readonly canonicalEvents: readonly RuntimeEvent[];
  readonly durationMs: number;
  readonly summary: ReturnType<typeof collectRuntimeSummary>;
  readonly usage: HeadlessChatUsageEnvelope;
  readonly cost: HeadlessChatCostEnvelope;
  readonly permissionDenials: readonly HeadlessPermissionDenial[];
}): HeadlessChatStreamEvent[] {
  return runtimeEventsToStreamJsonEvents([
    { type: "message", session_id: input.sessionId, role: "user", content: input.prompt, ephemeral: input.ephemeral },
    ...input.canonicalEvents.filter((event) => event.type !== "result"),
    createRuntimeResultEvent({
      sessionId: input.sessionId,
      success: input.summary.success,
      stopReason: input.summary.stopReason,
      exitCode: input.summary.exitCode,
      ...(input.summary.finalMessage ? { finalMessage: input.summary.finalMessage } : {}),
      ...(input.summary.error ? { error: input.summary.error } : {}),
      ...(input.summary.pendingConfirmation ? { pendingConfirmation: input.summary.pendingConfirmation } : {}),
      durationMs: input.durationMs,
      usage: input.usage,
      cost: input.cost,
      permissionDenials: input.permissionDenials,
      runtimeCapabilities: getCodexRuntimeCapabilityStatuses(),
      ephemeral: input.ephemeral,
    }),
  ], { ephemeral: input.ephemeral });
}

function isSlashCommandPrompt(prompt: string): boolean {
  return prompt.trim().startsWith("/");
}

function runtimeEventsFromCommandEvents(events: readonly RuntimeCommandEvent[], sessionId: string, ephemeral: boolean): RuntimeEvent[] {
  return events.map((event) => {
    const base = { session_id: sessionId, ephemeral };
    switch (event.type) {
      case "command_started":
        return { type: "command_started", ...base, command_id: event.command_id, command_name: event.command_name, raw: event.raw, args: event.args } satisfies RuntimeEvent;
      case "command_completed":
        return { type: "command_completed", ...base, command_id: event.command_id, command_name: event.command_name, raw: event.raw, args: event.args, result: event.result } satisfies RuntimeEvent;
      case "command_error":
        return { type: "command_error", ...base, ...(event.command_id ? { command_id: event.command_id } : {}), ...(event.command_name ? { command_name: event.command_name } : {}), raw: event.raw, ...(event.args ? { args: event.args } : {}), code: event.code, message: event.message } satisfies RuntimeEvent;
    }
  });
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

async function persistHeadlessTurn(session: NarratorSessionRecord, prompt: string, runtimeEvents: readonly AgentTurnEvent[], canonicalEvents: readonly RuntimeEvent[], timestamp: number, cumulativeUsage: HeadlessCumulativeUsage): Promise<void> {
  const existingHistory = await loadSessionChatHistory(session.id);
  const startSeq = Math.max(session.messageCount, lastSeq(existingHistory), lastSeq(session.recentMessages ?? []));
  const messagesToPersist = attachRuntimeTranscriptToMessages(
    buildMessagesToPersist({ sessionId: session.id, prompt, runtimeEvents, startSeq, timestamp }),
    canonicalEvents,
  );
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

async function persistHeadlessCommand(session: NarratorSessionRecord, prompt: string, message: string, canonicalEvents: readonly RuntimeEvent[], timestamp: number, cumulativeUsage: HeadlessCumulativeUsage): Promise<void> {
  const existingHistory = await loadSessionChatHistory(session.id);
  const startSeq = Math.max(session.messageCount, lastSeq(existingHistory), lastSeq(session.recentMessages ?? []));
  const messagesToPersist = attachRuntimeTranscriptToMessages([
    withSeq({ id: `headless-command-user-${timestamp}`, role: "user", content: prompt, timestamp }, startSeq + 1),
    withSeq({ id: `headless-command-result-${timestamp}`, role: "assistant", content: message, timestamp: timestamp + 1 }, startSeq + 2),
  ], canonicalEvents);
  const persisted = await appendSessionChatHistory(session.id, messagesToPersist, existingHistory);
  const nextRecent = persisted.length > 0 ? persisted.slice(-RECENT_MESSAGE_LIMIT) : messagesToPersist.slice(-RECENT_MESSAGE_LIMIT);
  const messageCount = Math.max(startSeq, lastSeq(persisted), lastSeq(messagesToPersist));
  await updateSession(session.id, { messageCount, recentMessages: nextRecent, cumulativeUsage });
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
    canonicalEvents: [],
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
    canonicalEvents: [],
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

async function executeHeadlessRuntimeCommand(input: {
  readonly session: NarratorSessionRecord;
  readonly ephemeral: boolean;
  readonly prompt: string;
  readonly startedAt: number;
}): Promise<HeadlessChatResult> {
  const currentTurnUsage = zeroUsageTokens();
  const usage = buildUsageEnvelope(input.session, currentTurnUsage);
  const permissionDenials: readonly HeadlessPermissionDenial[] = [];
  const commandExecution = await executeRuntimeCommandInput(input.prompt, {
    sessionId: input.session.id,
    status: {
      sessionId: input.session.id,
      modelLabel: [input.session.sessionConfig.providerId, input.session.sessionConfig.modelId].filter(Boolean).join(":"),
      permissionMode: input.session.sessionConfig.permissionMode,
    },
    handlers: {
      updateSessionConfig: async (patch) => {
        if (!input.ephemeral) {
          await updateSession(input.session.id, { sessionConfig: { ...input.session.sessionConfig, ...patch } });
        }
      },
    },
  });
  const canonicalEvents = runtimeEventsFromCommandEvents(commandExecution.events, input.session.id, input.ephemeral);
  const durationMs = Date.now() - input.startedAt;
  const success = commandExecution.result.ok;
  const exitCode = success ? 0 : 1;
  const stopReason: HeadlessChatStopReason = success ? "completed" : "failed";
  const error = success ? undefined : commandExecution.result.code;
  const events = runtimeEventsToStreamJsonEvents([
    { type: "message", session_id: input.session.id, role: "user", content: input.prompt, ephemeral: input.ephemeral },
    ...canonicalEvents,
    createRuntimeResultEvent({
      sessionId: input.session.id,
      success,
      stopReason,
      exitCode,
      finalMessage: commandExecution.result.message,
      ...(error ? { error } : {}),
      durationMs,
      usage,
      cost: UNKNOWN_COST,
      permissionDenials,
      ephemeral: input.ephemeral,
    }),
  ], { ephemeral: input.ephemeral });

  if (!input.ephemeral) {
    await persistHeadlessCommand(input.session, input.prompt, commandExecution.result.message, canonicalEvents, input.startedAt, usage.cumulative);
  }

  return {
    sessionId: input.session.id,
    ephemeral: input.ephemeral,
    events,
    runtimeEvents: [],
    canonicalEvents,
    finalMessage: success ? commandExecution.result.message : undefined,
    toolResults: [],
    success,
    stopReason,
    exitCode,
    ...(error ? { error } : {}),
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

  if (isSlashCommandPrompt(prompt)) {
    return executeHeadlessRuntimeCommand({ session, ephemeral, prompt, startedAt });
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
  const runtimeTurn = await executeRuntimeTurn({
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
  }, { ephemeral });
  const runtimeEvents = runtimeTurn.agentEvents;
  const canonicalEvents = runtimeTurn.runtimeEvents;

  const currentTurnUsage = collectTurnUsage(runtimeEvents);
  const usage = buildUsageEnvelope(session, currentTurnUsage);
  const permissionDenials = collectPermissionDenials(runtimeEvents);

  if (!ephemeral) {
    await persistHeadlessTurn(session, prompt, runtimeEvents, canonicalEvents, startedAt, usage.cumulative);
  }

  const durationMs = Date.now() - startedAt;
  const summary = collectRuntimeSummary(runtimeEvents);
  const events = buildStreamEvents({ sessionId: session.id, prompt, ephemeral, canonicalEvents, durationMs, summary, usage, cost: UNKNOWN_COST, permissionDenials });
  return {
    sessionId: session.id,
    ephemeral,
    events,
    runtimeEvents,
    canonicalEvents,
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
  return encodeRuntimeStreamJsonEventsAsNdjson(events);
}
