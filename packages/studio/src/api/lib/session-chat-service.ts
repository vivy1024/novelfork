import type { Server as NodeHttpServer } from "node:http";
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { WebSocketServer, type RawData, type WebSocket as NodeWebSocket } from "ws";

import type {
  BunWebSocketConnection,
  BunWebSocketRegistrar,
  StartedHttpServer,
} from "../start-http-server.js";

import { normalizeToolConfirmationRequest, type CanvasContext, type OpenResourceTab, type SessionToolDefinition, type SessionToolExecutionResult, type ToolConfirmationAudit, type ToolConfirmationDecision, type ToolConfirmationRequest, type WorkspaceResourceRef } from "../../shared/agent-native-workspace.js";
import type {
  MessageImageAttachment,
  NarratorSessionChatErrorEnvelope,
  NarratorSessionChatHistory,
  NarratorSessionChatMessage,
  NarratorSessionChatMessageEnvelope,
  NarratorSessionChatServerEnvelope,
  NarratorSessionChatSnapshot,
  NarratorSessionChatStateEnvelope,
  NarratorSessionCompactProgressEnvelope,
  NarratorSessionRecord,
  NarratorSessionRecoveryEnvelope,
  NarratorSessionRecoveryMetadata,
  SessionCumulativeUsage,
  TokenUsage,
  ToolCall,
} from "../../shared/session-types.js";
import {
  appendSessionChatHistory,
  getSessionChatCursor,
  loadSessionChatHistory,
  saveSessionChatHistory,
  updateSessionChatAckedSeq,
  updateSessionChatRecoveryJson,
  upgradeMessage,
} from "./session-history-store.js";
import {
  normalizeSessionTransportPayload as normalizeMessageText,
  parseSessionClientMessage as parseClientMessage,
  sendSessionEnvelope as sendEnvelope,
  serializeSessionEnvelope as serializeEnvelope,
  type SessionChatTransport,
} from "./session-runtime/transport.js";
import {
  buildSessionRecoveryMetadata as buildRecoveryMetadata,
  createSessionChatCursor as createCursor,
  getLastSessionSeq as getLastSeq,
  normalizeSessionMessages,
  sanitizeSeq,
  serializeSessionRecoveryMetadata as serializeRecoveryMetadata,
} from "./session-runtime/recovery.js";
import { generateSessionReply, type LlmRuntimeMetadata } from "./llm-runtime-service.js";
import type { RuntimeToolStreamEvent } from "./provider-adapters/index.js";
import { getSessionById, updateSession } from "./session-service.js";
import { buildAgentContext, buildProjectExplorationContext } from "./agent-context.js";
import { getAgentSystemPrompt, buildAvailableToolsSection } from "@vivy1024/novelfork-novel-plugin/engine";
import { createSessionToolExecutor, type SessionToolExecutorOptions } from "./session-tool-executor.js";
import { getEnabledSessionTools } from "./session-tool-registry.js";
import { annotateSessionToolsWithPolicy } from "./session-tool-policy.js";
import type { AgentTurnItem, AgentGenerateResult } from "./agent-turn-runtime.js";
import { executeRuntimeTurn } from "./runtime-turn-service.js";
import type { RuntimeEvent } from "./runtime-events.js";
import { attachRuntimeTranscriptToMessages } from "./runtime-transcript.js";
import { ProviderRuntimeStore } from "./provider-runtime-store.js";
import type { ProviderReasoningPolicy } from "../../shared/provider-catalog.js";
import { loadUserConfig } from "./user-config-service.js";
import { loadGlobalRoutines } from "./routines-service.js";
import { generateSessionTitle } from "./session-auto-title.js";
import { microCompact } from "./compact/micro-compact.js";
import { translateThinkingBlocks } from "./thinking-translator.js";
import { autoCompact, detectCompactionAction, selectThresholds, estimateTokenCount, COMPACT_SYSTEM_PROMPT, buildCompactPrompt, type CompactMessage } from "./context-compaction.js";
import { getUnfinishedCheckpoints, clearSessionCheckpoints } from "./turn-checkpoint.js";
import { ProviderHealthManager, classifyError } from "./provider-health-manager.js";
import { createContextBudgetManager } from "./context-budget-manager.js";

const MAX_SESSION_MESSAGES = 500;
const MAX_SESSION_TOOL_LOOP_STEPS = 200;
/** 对标 Claude: 默认模型上下文窗口 200k tokens */

// --- Shared runtime managers (singleton per process) ---
const providerHealth = new ProviderHealthManager();
const contextBudget = createContextBudgetManager();
const DEFAULT_MODEL_CONTEXT_WINDOW = 200_000;

async function resolveMaxTurnSteps(): Promise<number> {
  try {
    const config = await loadUserConfig();
    const steps = config.runtimeControls?.maxTurnSteps;
    return typeof steps === "number" && steps > 0 ? steps : MAX_SESSION_TOOL_LOOP_STEPS;
  } catch {
    return MAX_SESSION_TOOL_LOOP_STEPS;
  }
}

/**
 * 对标 Claude Code + NarraFork: 双档阈值自动压缩。
 * 根据模型上下文窗口大小选择标准/大窗口档位，先尝试裁剪，再尝试压缩。
 */
async function maybeAutoCompact(
  messages: readonly NarratorSessionChatMessage[],
  state: SessionChatRuntimeState,
  sessionId: string,
): Promise<{ items: AgentTurnItem[]; compacted: boolean }> {
  const config = await loadUserConfig().catch(() => null);
  const rc = config?.runtimeControls;

  // 从 session 的 provider/model 配置读取实际上下文窗口大小
  let maxContextTokens = DEFAULT_MODEL_CONTEXT_WINDOW;
  try {
    const session = await getSessionById(sessionId);
    if (session?.sessionConfig?.providerId) {
      const provider = await providerRuntimeStore.getProvider(session.sessionConfig.providerId);
      if (provider?.models?.length) {
        const modelId = session.sessionConfig.modelId;
        const model = provider.models.find((m) => m.id === modelId) ?? provider.models[0];
        if (model?.contextWindow && model.contextWindow > 0) {
          maxContextTokens = model.contextWindow;
        }
      }
    }
  } catch { /* fallback to default */ }

  const thresholds = selectThresholds(maxContextTokens, {
    contextCompressionThresholdPercent: rc?.contextCompressionThresholdPercent ?? 80,
    contextTruncateTargetPercent: rc?.contextTruncateTargetPercent ?? 70,
    largeWindowCompressionThresholdPercent: rc?.largeWindowCompressionThresholdPercent ?? 60,
    largeWindowTruncateTargetPercent: rc?.largeWindowTruncateTargetPercent ?? 50,
    compressionKeepTurns: rc?.compressionKeepTurns ?? 4,
    maxTruncateRatio: rc?.maxTruncateRatio ?? 80,
  });

  // Resolve summary model context window for cascade compact
  let summaryModelContextWindow: number | undefined;
  const summaryModelRef = config?.modelDefaults?.summaryModel;
  if (summaryModelRef) {
    try {
      const smProviderId = summaryModelRef.split(":")[0] ?? "";
      const smModelId = summaryModelRef.split(":").slice(1).join(":") || summaryModelRef;
      const smProvider = await providerRuntimeStore.getProvider(smProviderId);
      const smModel = smProvider?.models?.find((m) => m.id === smModelId);
      if (smModel?.contextWindow && smModel.contextWindow > 0) {
        summaryModelContextWindow = smModel.contextWindow;
      }
    } catch { /* fallback: no cascade */ }
  }

  const compactMessages: CompactMessage[] = messages
    .filter((m) => !(m.metadata as any)?.collapsed)
    .map((m) => ({
    id: m.id,
    role: m.role as "system" | "user" | "assistant",
    content: m.content,
    ...(m.toolCalls?.length ? { toolCalls: m.toolCalls.filter((tc) => tc.id).map((tc) => ({ id: tc.id!, toolName: tc.toolName })) } : {}),
  }));

  const action = detectCompactionAction(compactMessages, maxContextTokens, thresholds);
  if (action === "none") {
    return { items: microCompact(sessionMessagesToTurnItems(messages)), compacted: false };
  }

  try {
    await broadcastCompactProgress(sessionId, "cascade", 10, "开始级联压缩…");
    const result = await autoCompact({
      messages: compactMessages,
      maxContextTokens,
      thresholds,
      summaryModelContextWindow,
      generateSummary: summaryModelRef ? async (prompt: string) => {
        const smProviderId = summaryModelRef.split(":")[0] ?? "";
        const smModelId = summaryModelRef.split(":").slice(1).join(":") || summaryModelRef;
        const summaryResult = await generateSessionReply({
          sessionConfig: {
            providerId: smProviderId,
            modelId: smModelId,
            permissionMode: "read",
            reasoningEffort: "low",
          },
          messages: [
            { type: "message", role: "system", content: COMPACT_SYSTEM_PROMPT },
            { type: "message", role: "user", content: prompt },
          ],
          tools: [],
        });
        if (summaryResult.success && summaryResult.type === "message") {
          return summaryResult.content;
        }
        throw new Error("Summary model returned non-message result");
      } : undefined,
      summarize: async (olderMessages, customInstructions) => {
        // 调用摘要模型：把完整旧消息作为 API messages 发送
        try {
          const summaryModel = config?.modelDefaults?.summaryModel;
          if (summaryModel) {
            // 构建摘要请求：旧消息作为 context + 结构化 prompt 作为 user message
            const contextMessages: AgentTurnItem[] = olderMessages.map(m => ({
              type: "message" as const,
              role: m.role === "tool_result" ? "assistant" as const : m.role as "system" | "user" | "assistant",
              content: m.content,
            }));

            const summaryResult = await generateSessionReply({
              sessionConfig: {
                providerId: summaryModel.split(":")[0] ?? "",
                modelId: summaryModel.split(":").slice(1).join(":") || summaryModel,
                permissionMode: "read",
                reasoningEffort: "low",
              },
              messages: [
                { type: "message", role: "system", content: COMPACT_SYSTEM_PROMPT },
                ...contextMessages,
                { type: "message", role: "user", content: buildCompactPrompt(customInstructions) },
              ],
              tools: [],
            });
            if (summaryResult.success && summaryResult.type === "message") {
              return summaryResult.content;
            }
          }
        } catch {
          // LLM 摘要失败，fallback
        }

        // Fallback: 文本拼接摘要（保留更多内容）
        const text = olderMessages.map((m) => `[${m.role}] ${m.content}`).join("\n");
        const maxChars = 4000;
        if (text.length <= maxChars) return text;
        // 保留头尾各一半
        const half = Math.floor(maxChars / 2);
        return `${text.slice(0, half)}\n\n[... 中间 ${olderMessages.length} 条消息已省略 ...]\n\n${text.slice(-half)}`;
      },
      onProgress: (progress) => {
        broadcastCompactProgress(sessionId, "cascade", progress);
      },
    });

    if (result.compacted || result.truncated) {
      await broadcastCompactProgress(sessionId, "cascade", 100, "级联压缩完成");
      const compactedItems: AgentTurnItem[] = result.messages.map((m) => ({
        type: "message" as const,
        role: m.role === "tool_result" ? "system" as const : m.role as "system" | "user" | "assistant",
        content: m.content,
        ...(m.id ? { id: m.id } : {}),
      }));
      return { items: compactedItems, compacted: true };
    }
  } catch {
    // Compaction failure is non-fatal
  }

  return { items: microCompact(sessionMessagesToTurnItems(messages)), compacted: false };
}

const providerRuntimeStore = new ProviderRuntimeStore();

async function resolveReasoningPolicy(providerId?: string): Promise<ProviderReasoningPolicy | undefined> {
  if (!providerId) return undefined;
  try {
    const provider = await providerRuntimeStore.getProvider(providerId);
    return provider?.reasoningPolicy;
  } catch {
    return undefined;
  }
}

function shouldContinueAfterToolResult({ result }: { readonly toolName: string; readonly result: SessionToolExecutionResult }): boolean {
  // 确认门暂停 — 不继续（由 isPendingConfirmationResult 在 agent-turn-runtime 中处理）
  if (!result.ok && result.error === "pending-confirmation") return false;
  // 成功或确认被拒绝 — 继续
  if (result.ok || result.error === "confirmation-rejected") return true;
  // 工具失败 — 继续（让模型决定下一步），agent-turn-runtime 内部已有重复检测
  return true;
}

type NormalizedRuntimeToolUse = {
  readonly id: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
};

export type PendingSessionToolConfirmation = ToolConfirmationRequest & {
  readonly sessionId: string;
  readonly messageId: string;
  readonly toolUseId?: string;
  readonly input: Record<string, unknown>;
  readonly status: "pending";
};

export type SessionToolState = {
  readonly sessionId: string;
  readonly tools: readonly SessionToolDefinition[];
  readonly policy?: NarratorSessionRecord["sessionConfig"]["toolPolicy"];
  readonly pendingConfirmations: readonly PendingSessionToolConfirmation[];
};

export type ConfirmSessionToolDecisionInput = {
  readonly confirmationId?: string;
  readonly decision?: "approve" | "approved" | "reject" | "rejected";
  readonly action?: "approve" | "reject";
  readonly reason?: string;
  readonly answers?: Record<string, unknown>;
};

export type ConfirmSessionToolDecisionResult =
  | {
    readonly ok: true;
    readonly decision: ToolConfirmationDecision;
    readonly toolResult: SessionToolExecutionResult;
    readonly snapshot: NarratorSessionChatSnapshot;
  }
  | { readonly ok: false; readonly status: 400 | 404; readonly error: string };

let sessionToolExecutorOptions: SessionToolExecutorOptions = {};
let sessionToolExecutor = createSessionToolExecutor();

export function configureSessionToolExecutor(options: SessionToolExecutorOptions): void {
  sessionToolExecutorOptions = options;
  sessionToolExecutor = createSessionToolExecutor(options);
}

/**
 * Startup recovery: mark sessions with unfinished checkpoints as interrupted.
 * Called once at server startup. Does NOT auto-resume turns — just marks sessions
 * so the frontend can show a "Continue" button.
 */
export async function recoverInterruptedSessions(): Promise<void> {
  try {
    const checkpoints = getUnfinishedCheckpoints();
    if (checkpoints.length === 0) return;

    const sessionIds = [...new Set(checkpoints.map(cp => cp.sessionId))];
    console.log(JSON.stringify({
      component: "session.startup-recovery",
      msg: `Found ${checkpoints.length} unfinished checkpoint(s) across ${sessionIds.length} session(s)`,
      sessionIds,
    }));

    for (const sessionId of sessionIds) {
      try {
        await updateSession(sessionId, {
          recovery: {
            lastSeq: 0,
            lastAckedSeq: 0,
            availableFromSeq: 0,
            pendingMessageCount: 0,
            pendingToolCallCount: 0,
            lastFailure: {
              reason: "interrupted",
              message: "服务器重启，上一轮任务被中断。可点击「继续」恢复执行。",
              at: new Date().toISOString(),
            },
            updatedAt: new Date().toISOString(),
          },
        });
      } catch {
        console.log(JSON.stringify({
          component: "session.startup-recovery",
          msg: `Failed to mark session as interrupted`,
          sessionId,
        }));
      }
    }
  } catch (error) {
    console.log(JSON.stringify({
      component: "session.startup-recovery",
      msg: "Startup recovery failed",
      error: error instanceof Error ? error.message : "unknown",
    }));
  }
}

interface SessionChatTransportState {
  ackedSeq: number;
}

interface SessionChatRuntimeState {
  messageCount: number;
  nextSeq: number;
  messages: NarratorSessionChatMessage[];
  transports: Map<SessionChatTransport, SessionChatTransportState>;
  persistedAckedSeq: number;
  availableFromSeq: number;
  recoveryJson: string;
  cumulativeUsage: SessionCumulativeUsage;
}

interface AttachSessionChatTransportOptions {
  resumeFromSeq?: number;
}

const runtimeStateBySessionId = new Map<string, SessionChatRuntimeState>();

function createEmptyCumulativeUsage(): SessionCumulativeUsage {
  return { totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationInputTokens: 0, totalCacheReadInputTokens: 0, turnCount: 0 };
}

function accumulateUsage(cumulative: SessionCumulativeUsage, usage: TokenUsage | undefined): void {
  if (!usage) return;
  cumulative.totalInputTokens += usage.input_tokens ?? 0;
  cumulative.totalOutputTokens += usage.output_tokens ?? 0;
  cumulative.totalCacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0;
  cumulative.totalCacheReadInputTokens += usage.cache_read_input_tokens ?? 0;
  cumulative.turnCount += 1;
  // 记录最后一次请求的 input tokens（代表当前上下文窗口占用）
  // Include cache_read tokens because providers with KV cache (DeepSeek) report
  // cached tokens separately — the actual context size is input + cache_read.
  if (usage.input_tokens != null) {
    cumulative.lastInputTokens = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  }
}
const abortControllerBySessionId = new Map<string, AbortController>();

// ─── Buffered Message Queue ───────────────────────────────────────────────────
// Spec §1.3 mentions SQLite persistence for the queue. Current implementation is
// in-memory only because: (1) queued messages have a very short lifespan (seconds
// to minutes while agent is working), (2) on restart the agent turn itself is lost
// so replaying queued messages would produce confusing results, (3) the background
// task store already handles long-lived task persistence. If persistence becomes
// needed, add a `queued_messages` table and drain on startup.
interface QueuedMessage {
  readonly content: string;
  readonly messageId: string;
  readonly canvasContext?: CanvasContext;
  readonly transport: SessionChatTransport;
  readonly queuedAt: number;
}

const sessionMessageQueue = new Map<string, QueuedMessage[]>();
const sessionBusy = new Set<string>();
const MAX_QUEUE_SIZE = 10;
// ──────────────────────────────────────────────────────────────────────────────

function abortSession(sessionId: string): void {
  const controller = abortControllerBySessionId.get(sessionId);
  if (controller) {
    console.log(JSON.stringify({ component: "session-chat", event: "abort", sessionId }));
    controller.abort();
    abortControllerBySessionId.delete(sessionId);
  }
}

function createSessionAbortController(sessionId: string): AbortController {
  abortSession(sessionId);
  const controller = new AbortController();
  abortControllerBySessionId.set(sessionId, controller);
  return controller;
}

function clearSessionAbortController(sessionId: string): void {
  abortControllerBySessionId.delete(sessionId);
}

function broadcastStreamChunk(sessionId: string, state: SessionChatRuntimeState, content: string): void {
  const transportCount = state.transports.size;
  if (transportCount === 0) {
    return;
  }
  const envelope: NarratorSessionChatServerEnvelope = {
    type: "session:stream",
    sessionId,
    content,
  };
  const payload = serializeEnvelope(envelope);
  for (const transport of state.transports.keys()) {
    try {
      transport.send(payload);
    } catch {
      state.transports.delete(transport);
    }
  }
}

function broadcastToAll(state: SessionChatRuntimeState, payload: string): void {
  for (const transport of state.transports.keys()) {
    try {
      transport.send(payload);
    } catch {
      state.transports.delete(transport);
    }
  }
}

function createRuntimeState(
  initialMessageCount = 0,
  initialMessages: NarratorSessionChatMessage[] = [],
  initialAckedSeq = 0,
  initialAvailableFromSeq = 0,
  initialRecoveryJson = "{}",
  initialCumulativeUsage?: SessionCumulativeUsage,
): SessionChatRuntimeState {
  const normalizedMessages = normalizeSessionMessages(initialMessages, initialMessageCount);
  const lastSeq = getLastSeq(normalizedMessages);
  const messageCount = Math.max(initialMessageCount, lastSeq, normalizedMessages.length);

  return {
    messageCount,
    nextSeq: Math.max(messageCount, lastSeq) + 1,
    messages: normalizedMessages.slice(-MAX_SESSION_MESSAGES),
    transports: new Map(),
    persistedAckedSeq: Math.max(0, Math.min(initialAckedSeq, Math.max(messageCount, lastSeq))),
    availableFromSeq: initialAvailableFromSeq,
    recoveryJson: initialRecoveryJson || "{}",
    cumulativeUsage: initialCumulativeUsage ?? createEmptyCumulativeUsage(),
  };
}

function getRuntimeState(
  sessionId: string,
  initialMessageCount = 0,
  initialMessages: NarratorSessionChatMessage[] = [],
  initialAckedSeq = 0,
  initialAvailableFromSeq = 0,
  initialRecoveryJson = "{}",
  initialCumulativeUsage?: SessionCumulativeUsage,
): SessionChatRuntimeState {
  const existing = runtimeStateBySessionId.get(sessionId);
  if (existing) {
    if (existing.messages.length === 0 && initialMessages.length > 0) {
      existing.messages = normalizeSessionMessages(initialMessages, initialMessageCount).slice(-MAX_SESSION_MESSAGES);
    }
    existing.messageCount = Math.max(existing.messageCount, initialMessageCount, getLastSeq(existing.messages));
    existing.nextSeq = Math.max(existing.nextSeq, existing.messageCount + 1, getLastSeq(existing.messages) + 1);
    existing.persistedAckedSeq = Math.max(existing.persistedAckedSeq, Math.min(initialAckedSeq, existing.messageCount));
    existing.availableFromSeq = initialAvailableFromSeq || existing.availableFromSeq;
    existing.recoveryJson = initialRecoveryJson || existing.recoveryJson;
    return existing;
  }

  const state = createRuntimeState(initialMessageCount, initialMessages, initialAckedSeq, initialAvailableFromSeq, initialRecoveryJson, initialCumulativeUsage);
  runtimeStateBySessionId.set(sessionId, state);
  return state;
}

function trimSessionMessages(state: SessionChatRuntimeState): void {
  if (state.messages.length <= MAX_SESSION_MESSAGES) {
    return;
  }

  state.messages = state.messages.slice(-MAX_SESSION_MESSAGES);
}

function buildServerFirstSession(session: NarratorSessionRecord, state: SessionChatRuntimeState): NarratorSessionRecord {
  const recentMessages = state.messages.length > 0 ? [...state.messages] : [...(session.recentMessages ?? [])];
  const messageCount = Math.max(session.messageCount, state.messageCount, getLastSeq(recentMessages), recentMessages.length);
  const recovery = buildRecoveryMetadata(state, recentMessages, session.recovery?.lastFailure);

  return {
    ...session,
    messageCount,
    recentMessages,
    recovery,
    cumulativeUsage: state.cumulativeUsage,
  };
}

function createSessionChatStateEnvelope(
  session: NarratorSessionRecord,
  state: SessionChatRuntimeState,
  ackedSeq?: number,
  recovery?: NarratorSessionRecoveryEnvelope,
): NarratorSessionChatStateEnvelope {
  return {
    type: "session:state",
    session,
    cursor: createCursor(state, ackedSeq),
    ...(recovery ? { recovery } : {}),
  };
}

function createSessionChatMessageEnvelope(
  sessionId: string,
  state: SessionChatRuntimeState,
  message: NarratorSessionChatMessage,
): NarratorSessionChatMessageEnvelope {
  return {
    type: "session:message",
    sessionId,
    message,
    cursor: createCursor(state),
  };
}

function broadcastMessageEnvelope(
  sessionId: string,
  state: SessionChatRuntimeState,
  message: NarratorSessionChatMessage,
  except?: SessionChatTransport,
): void {
  const envelope = createSessionChatMessageEnvelope(sessionId, state, message);
  const payload = serializeEnvelope(envelope);

  for (const transport of state.transports.keys()) {
    if (transport === except) {
      continue;
    }

    try {
      transport.send(payload);
    } catch {
      state.transports.delete(transport);
    }
  }
}

function broadcastStateEnvelope(
  session: NarratorSessionRecord,
  state: SessionChatRuntimeState,
  recovery?: NarratorSessionRecoveryEnvelope,
): void {
  for (const [transport, transportState] of state.transports.entries()) {
    const delivered = sendEnvelope(transport, createSessionChatStateEnvelope(session, state, transportState.ackedSeq, recovery));
    if (!delivered) {
      state.transports.delete(transport);
    }
  }
}

async function loadSessionState(sessionId: string): Promise<{ session: NarratorSessionRecord; state: SessionChatRuntimeState } | null> {
  const session = await getSessionById(sessionId);
  if (!session) {
    return null;
  }

  const persistedCursor = await getSessionChatCursor(sessionId);
  const persistedHistory = await loadSessionChatHistory(sessionId);
  const sourceMessages = persistedHistory.length > 0 ? persistedHistory : (session.recentMessages ?? []).map(upgradeMessage);
  const normalizedRecentMessages = normalizeSessionMessages(sourceMessages, Math.max(session.messageCount, persistedCursor.lastSeq));
  const normalizedMessageCount = Math.max(session.messageCount, persistedCursor.lastSeq, getLastSeq(normalizedRecentMessages), normalizedRecentMessages.length);
  const state = getRuntimeState(
    sessionId,
    normalizedMessageCount,
    normalizedRecentMessages,
    persistedCursor.ackedSeq,
    persistedCursor.availableFromSeq,
    persistedCursor.recoveryJson,
    session.cumulativeUsage,
  );

  if (state.messages.length === 0 && normalizedRecentMessages.length > 0) {
    state.messages = [...normalizedRecentMessages];
  }

  trimSessionMessages(state);
  state.messageCount = Math.max(state.messageCount, normalizedMessageCount, getLastSeq(state.messages));
  state.nextSeq = Math.max(state.nextSeq, state.messageCount + 1, getLastSeq(state.messages) + 1);

  return { session, state };
}

function sanitizeCanvasContext(value: unknown): CanvasContext | undefined {
  if (!isRecord(value)) return undefined;
  const activeTabId = sanitizeOptionalString(value.activeTabId);
  const activeResource = sanitizeWorkspaceResourceRef(value.activeResource);
  const selection = sanitizeCanvasSelection(value.selection);
  const dirty = typeof value.dirty === "boolean" ? value.dirty : undefined;
  const openTabs = Array.isArray(value.openTabs)
    ? value.openTabs.map(sanitizeOpenResourceTab).filter((tab): tab is OpenResourceTab => Boolean(tab))
    : undefined;

  if (!activeTabId && !activeResource && !selection && dirty === undefined && !openTabs?.length) return undefined;
  return {
    ...(activeTabId ? { activeTabId } : {}),
    ...(activeResource ? { activeResource } : {}),
    ...(selection ? { selection } : {}),
    ...(dirty !== undefined ? { dirty } : {}),
    ...(openTabs?.length ? { openTabs } : {}),
  };
}

function sanitizeWorkspaceResourceRef(value: unknown): WorkspaceResourceRef | undefined {
  if (!isRecord(value)) return undefined;
  const kind = sanitizeOptionalString(value.kind);
  const id = sanitizeOptionalString(value.id);
  if (!kind || !id) return undefined;
  const bookId = sanitizeOptionalString(value.bookId);
  const title = sanitizeOptionalString(value.title);
  const path = sanitizeOptionalString(value.path);
  return {
    kind,
    id,
    ...(bookId ? { bookId } : {}),
    ...(title ? { title } : {}),
    ...(path ? { path } : {}),
  };
}

function sanitizeCanvasSelection(value: unknown): CanvasContext["selection"] | undefined {
  if (!isRecord(value)) return undefined;
  const text = sanitizeOptionalString(value.text);
  const start = sanitizeOptionalNumber(value.start);
  const end = sanitizeOptionalNumber(value.end);
  if (!text && start === undefined && end === undefined) return undefined;
  return {
    ...(text ? { text } : {}),
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
  };
}

function sanitizeOpenResourceTab(value: unknown): OpenResourceTab | undefined {
  if (!isRecord(value)) return undefined;
  const id = sanitizeOptionalString(value.id);
  const nodeId = sanitizeOptionalString(value.nodeId);
  const kind = sanitizeOptionalString(value.kind);
  const title = sanitizeOptionalString(value.title);
  if (!id || !nodeId || !kind || !title) return undefined;
  const dirty = typeof value.dirty === "boolean" ? value.dirty : false;
  const source = value.source === "agent" ? "agent" : "user";
  const payloadRef = sanitizeOptionalString(value.payloadRef);
  return {
    id,
    nodeId,
    kind: kind as OpenResourceTab["kind"],
    title,
    dirty,
    source,
    ...(payloadRef ? { payloadRef } : {}),
  };
}

function sanitizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function sanitizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createSessionChatError(
  sessionId: string,
  error: string,
  details: Partial<Omit<NarratorSessionChatErrorEnvelope, "type" | "sessionId" | "error">> = {},
): NarratorSessionChatErrorEnvelope {
  return {
    type: "session:error",
    sessionId,
    error,
    ...details,
  };
}

// ─── Image Attachment Persistence ─────────────────────────────────────────────

const UPLOADS_DIR = join(homedir(), ".novelfork", "uploads");

function ensureUploadsDir(): void {
  if (!existsSync(UPLOADS_DIR)) {
    mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

function saveAttachmentsToDisk(
  attachments: Array<{ type: "image"; mimeType: string; data: string; fileName?: string }>,
): MessageImageAttachment[] {
  ensureUploadsDir();
  const result: MessageImageAttachment[] = [];
  for (const att of attachments) {
    if (att.type !== "image" || !att.data) continue;
    const ext = att.mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
    const fileName = att.fileName || `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = join(UPLOADS_DIR, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${fileName}`);
    try {
      writeFileSync(filePath, new Uint8Array(Buffer.from(att.data, "base64")));
      result.push({ type: "image", mimeType: att.mimeType, filePath, fileName });
    } catch (e) {
      console.error("Failed to save attachment:", e);
    }
  }
  return result;
}

function appendMessageToState(
  state: SessionChatRuntimeState,
  message: Omit<NarratorSessionChatMessage, "seq">,
): NarratorSessionChatMessage {
  const nextMessage: NarratorSessionChatMessage = {
    ...message,
    seq: state.nextSeq,
  };

  state.nextSeq += 1;
  state.messages.push(nextMessage);
  state.messageCount = Math.max(state.messageCount, nextMessage.seq ?? 0);
  trimSessionMessages(state);
  return nextMessage;
}

function updateTransportAck(
  state: SessionChatRuntimeState,
  transport: SessionChatTransport,
  ackCandidate: number,
): SessionChatTransportState | null {
  const transportState = state.transports.get(transport);
  if (!transportState) {
    return null;
  }

  transportState.ackedSeq = Math.max(transportState.ackedSeq, Math.min(sanitizeSeq(ackCandidate), createCursor(state).lastSeq));
  return transportState;
}

async function persistSessionChatProgress(
  sessionId: string,
  session: NarratorSessionRecord,
  state: SessionChatRuntimeState,
  messages: NarratorSessionChatMessage[],
  failure?: NarratorSessionRecoveryMetadata["lastFailure"],
): Promise<NarratorSessionRecord | null> {
  const persistedHistory = await appendSessionChatHistory(
    sessionId,
    messages,
    session.recentMessages ?? state.messages,
  );

  if (persistedHistory.length > 0) {
    state.messageCount = Math.max(state.messageCount, getLastSeq(persistedHistory));
    state.nextSeq = Math.max(state.nextSeq, state.messageCount + 1);
    state.availableFromSeq = persistedHistory[0]?.seq ?? state.availableFromSeq;
  }

  const recovery = buildRecoveryMetadata(state, state.messages, failure);
  state.recoveryJson = serializeRecoveryMetadata(recovery);
  await updateSessionChatRecoveryJson(sessionId, state.recoveryJson);
  return updateSession(sessionId, {
    messageCount: state.messageCount,
    recentMessages: [...state.messages],
    recovery,
    cumulativeUsage: state.cumulativeUsage,
  });
}

function normalizeRuntimeToolInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { rawInput: value };
    }
  }

  return {};
}

function isPendingConfirmationResult(result: SessionToolExecutionResult): boolean {
  return result.ok && (
    Boolean(result.confirmation)
    || (
      result.data !== null
      && typeof result.data === "object"
      && (result.data as { status?: unknown }).status === "pending-confirmation"
    )
  );
}

function buildToolResultStatus(result: SessionToolExecutionResult): ToolCall["status"] {
  if (isPendingConfirmationResult(result)) {
    return "pending";
  }
  return result.ok ? "success" : "error";
}

function buildToolResultMetadata(result: SessionToolExecutionResult): NarratorSessionChatMessage["metadata"] {
  return {
    ...(result.renderer ? { renderer: result.renderer } : {}),
    ...(result.artifact ? { artifact: result.artifact } : {}),
    ...(result.confirmation ? { confirmation: result.confirmation } : {}),
    ...(result.confirmationAudit ? { confirmationAudit: result.confirmationAudit } : {}),
    ...(result.guided ? { guided: result.guided } : {}),
    ...(result.pgi ? { pgi: result.pgi } : {}),
    ...(result.narrative ? { narrative: result.narrative } : {}),
    toolResult: result,
  };
}

function normalizeToolResultConfirmation(
  result: SessionToolExecutionResult,
  context: { readonly sessionId: string; readonly messageId?: string; readonly toolUseId?: string; readonly input?: Record<string, unknown> },
): SessionToolExecutionResult {
  if (!result.confirmation) return result;
  return {
    ...result,
    confirmation: normalizeToolConfirmationRequest(result.confirmation, context),
  };
}

function buildToolResultCall(
  toolUse: NormalizedRuntimeToolUse,
  result: SessionToolExecutionResult,
): ToolCall {
  const status = buildToolResultStatus(result);
  // Extract exitCode from result.data for Bash-style tools
  const exitCode = result.data != null && typeof result.data === "object" && "exitCode" in result.data
    ? (result.data as { exitCode?: number }).exitCode
    : undefined;
  return {
    id: toolUse.id,
    toolName: toolUse.toolName,
    status,
    summary: result.summary,
    input: toolUse.input,
    output: typeof result.data === "string" ? result.data : undefined,
    duration: result.durationMs,
    result,
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(result.renderer ? { renderer: result.renderer } : {}),
    ...(result.artifact ? { artifact: result.artifact } : {}),
    ...(result.confirmation ? { confirmation: result.confirmation } : {}),
    ...(result.guided ? { guided: result.guided } : {}),
    ...(result.pgi ? { pgi: result.pgi } : {}),
    ...(result.narrative ? { narrative: result.narrative } : {}),
    ...(!result.ok && result.error ? { error: result.error } : {}),
  };
}

function extractPendingToolConfirmations(sessionId: string, messages: readonly NarratorSessionChatMessage[]): PendingSessionToolConfirmation[] {
  return messages.flatMap((message) => (message.toolCalls ?? []).flatMap((toolCall) => {
    const confirmation = toolCall.confirmation ?? message.metadata?.confirmation;
    if (!confirmation || toolCall.status !== "pending") {
      return [];
    }

    const input = normalizeRuntimeToolInput(toolCall.input);
    return [{
      ...normalizeToolConfirmationRequest({ ...confirmation, toolName: confirmation.toolName || toolCall.toolName }, {
        sessionId,
        messageId: message.id,
        ...(toolCall.id ? { toolUseId: toolCall.id } : {}),
        input,
      }),
      sessionId,
      messageId: message.id,
      ...(toolCall.id ? { toolUseId: toolCall.id } : {}),
      input,
      status: "pending" as const,
    }];
  }));
}

type PendingConfirmationMatch = {
  readonly message: NarratorSessionChatMessage;
  readonly toolCall: ToolCall;
  readonly confirmation: PendingSessionToolConfirmation;
};

function findPendingToolConfirmation(
  sessionId: string,
  messages: NarratorSessionChatMessage[],
  toolName: string,
  confirmationId?: string,
): PendingConfirmationMatch | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]!;
    for (const toolCall of message.toolCalls ?? []) {
      const confirmation = toolCall.confirmation ?? message.metadata?.confirmation;
      if (!confirmation || toolCall.status !== "pending") {
        continue;
      }
      if ((confirmation.toolName || toolCall.toolName) !== toolName) {
        continue;
      }
      if (confirmationId && confirmation.id !== confirmationId) {
        continue;
      }

      const input = normalizeRuntimeToolInput(toolCall.input);
      return {
        message,
        toolCall,
        confirmation: {
          ...normalizeToolConfirmationRequest({ ...confirmation, toolName: confirmation.toolName || toolCall.toolName }, {
            sessionId,
            messageId: message.id,
            ...(toolCall.id ? { toolUseId: toolCall.id } : {}),
            input,
          }),
          sessionId,
          messageId: message.id,
          ...(toolCall.id ? { toolUseId: toolCall.id } : {}),
          input,
          status: "pending",
        },
      };
    }
  }

  return null;
}

function normalizeConfirmationDecision(input: ConfirmSessionToolDecisionInput): "approved" | "rejected" | null {
  const rawDecision = input.decision ?? input.action;
  if (rawDecision === "approve" || rawDecision === "approved") {
    return "approved";
  }
  if (rawDecision === "reject" || rawDecision === "rejected") {
    return "rejected";
  }
  return null;
}

function buildSessionConfirmationAudit(
  confirmation: PendingSessionToolConfirmation,
  decision: ToolConfirmationDecision,
  summary: string,
): ToolConfirmationAudit {
  return {
    confirmationId: confirmation.id,
    sessionId: decision.sessionId,
    toolName: confirmation.toolName,
    targetResources: confirmation.targetResources ?? (confirmation.targetResource ? [confirmation.targetResource] : [{ kind: confirmation.toolName, id: confirmation.target, ...(typeof confirmation.target === "string" ? { bookId: confirmation.target } : {}) }]),
    summary,
    risk: confirmation.risk,
    ...(confirmation.source ? { source: confirmation.source } : {}),
    ...(confirmation.checkpoint ? { checkpoint: confirmation.checkpoint } : {}),
    decision: decision.decision,
    decidedAt: decision.decidedAt,
    ...(decision.reason ? { reason: decision.reason } : {}),
  };
}

function withSessionConfirmationAudit(
  result: SessionToolExecutionResult,
  confirmation: PendingSessionToolConfirmation,
  decision: ToolConfirmationDecision,
): SessionToolExecutionResult {
  return {
    ...result,
    confirmationAudit: buildSessionConfirmationAudit(confirmation, decision, result.summary),
  };
}

function createRejectedToolResult(
  toolName: string,
  confirmation: PendingSessionToolConfirmation,
  decision: ToolConfirmationDecision,
): SessionToolExecutionResult {
  const reasonSuffix = decision.reason ? `：${decision.reason}` : "";
  const result: SessionToolExecutionResult = {
    ok: false,
    error: "confirmation-rejected",
    summary: `用户已拒绝执行 ${toolName}${reasonSuffix}`,
    data: { status: "rejected", decision },
    confirmation,
  };
  return withSessionConfirmationAudit(result, confirmation, decision);
}

function resolvePendingToolCall(
  match: PendingConfirmationMatch,
  result: SessionToolExecutionResult,
): void {
  const nextCall = buildToolResultCall({
    id: match.toolCall.id ?? match.confirmation.id,
    toolName: match.confirmation.toolName,
    input: match.confirmation.input,
  }, result);
  match.message.toolCalls = (match.message.toolCalls ?? []).map((toolCall) => (
    toolCall === match.toolCall || (toolCall.id && toolCall.id === match.toolCall.id)
      ? { ...toolCall, ...nextCall, confirmation: match.confirmation }
      : toolCall
  ));
}

async function appendModelContinuationAfterToolDecision(
  loaded: { session: NarratorSessionRecord; state: SessionChatRuntimeState },
  timestamp: number,
): Promise<NarratorSessionRecoveryMetadata["lastFailure"] | undefined> {
  try {
    const agentSystemPrompt = getAgentSystemPrompt(loaded.session.agentId);
    const projectId = (loaded.session as { projectId?: string }).projectId;
    let bookContext = "";
    if (projectId) {
      try {
        // 从最近用户消息提取 sceneText 用于 tracked 条目匹配
        const recentUserMsg = [...loaded.state.messages].reverse().find(m => m.role === "user");
        const sceneText = recentUserMsg?.content ?? "";
        bookContext = await buildAgentContext({ bookId: projectId, sceneText });
      } catch { /* context build failure is non-fatal */ }
    }
    const continuationWorkDir = loaded.session.worktree?.trim() || process.cwd();
    let continuationProjectContext = "";
    try {
      continuationProjectContext = await buildProjectExplorationContext(continuationWorkDir);
    } catch { /* non-fatal */ }
    const canvasContext = latestCanvasContextFromMessages(loaded.state.messages);
    const maxSteps = await resolveMaxTurnSteps();
    // Apply context cutoff: exclude messages at or before the cutoff seq from model context
    const contextCutoffSeq = loaded.session.sessionConfig.contextCutoffSeq ?? 0;
    const contextMessages = contextCutoffSeq > 0
      ? loaded.state.messages.filter((m) => (m.seq ?? 0) > contextCutoffSeq)
      : loaded.state.messages;
    const { items: compactedMessages } = await maybeAutoCompact(contextMessages, loaded.state, loaded.session.id);
    const continuationRoutinePrompts = await loadRoutineGlobalPrompts();
    const runtimeTurn = await executeRuntimeTurn({
      sessionId: loaded.session.id,
      sessionConfig: loaded.session.sessionConfig,
      messages: compactedMessages,
      systemPrompt: `${agentSystemPrompt}${AGENT_NATIVE_WRITE_NEXT_INSTRUCTIONS}${buildGoalsPromptSection(loaded.session.goals)}${continuationRoutinePrompts}${buildAvailableToolsSection(getEnabledSessionTools(loaded.session.sessionConfig.permissionMode, loaded.session.agentId, { disabledTools: loaded.session.sessionConfig.toolPolicy?.deny }).map(t => t.name))}`,
      context: createRuntimeContext(bookContext, canvasContext, loaded.session.worktree, continuationProjectContext),
      tools: getEnabledSessionTools(loaded.session.sessionConfig.permissionMode, loaded.session.agentId, { disabledTools: loaded.session.sessionConfig.toolPolicy?.deny }),
      permissionMode: loaded.session.sessionConfig.permissionMode,
      ...(canvasContext ? { canvasContext } : {}),
      maxSteps,
      shouldContinueAfterToolResult,
      onStreamChunk: (chunk: string) => {
        broadcastStreamChunk(loaded.session.id, loaded.state, chunk);
      },
      onToolEvent: (event: RuntimeToolStreamEvent) => {
        if (event.type === "tool_input_chunk") {
          const envelope = { type: "session:tool-input-chunk" as const, sessionId: loaded.session.id, toolCallId: event.id, partialInput: event.partialInput };
          broadcastToAll(loaded.state, serializeEnvelope(envelope as any));
        }
        // tool_started is handled via onEvent tool_call broadcast
      },
      generate: async (generateInput): Promise<AgentGenerateResult> => {
        const result = await generateSessionReply({
          sessionConfig: generateInput.sessionConfig,
          messages: generateInput.messages,
          tools: generateInput.tools,
          onStreamChunk: generateInput.onStreamChunk,
          onToolEvent: generateInput.onToolEvent,
          onRetry: () => {
            const retrySession = { ...buildServerFirstSession(loaded.session, loaded.state), narratorState: "working" as const, substatus: "retrying" as const };
            broadcastToAll(loaded.state, serializeEnvelope({ type: "session:state", session: retrySession, cursor: createCursor(loaded.state) }));
          },
          signal: generateInput.signal,
        });
        // Record provider health
        const providerId = (result as any).metadata?.providerId ?? generateInput.sessionConfig.providerId ?? "unknown";
        const modelId = (result as any).metadata?.modelId ?? generateInput.sessionConfig.modelId ?? "unknown";
        if ((result as any).success) {
          providerHealth.recordSuccess(providerId, modelId);
        } else {
          const errorCode = classifyError((result as any).error);
          providerHealth.recordFailure(providerId, modelId, errorCode);
        }
        return result as AgentGenerateResult;
      },
      executeTool: (toolInput) => {
        const onToolOutputStream = toolInput.toolCallId
          ? (chunk: string) => {
              const envelope = { type: "session:tool-stream" as const, sessionId: loaded.session.id, toolCallId: toolInput.toolCallId!, content: chunk };
              broadcastToAll(loaded.state, serializeEnvelope(envelope as any));
            }
          : undefined;
        const enrichedInput = { ...toolInput, onToolOutputStream };
        const sessionWorkDir = loaded.session.worktree?.trim() || undefined;
        const sessionProjectId = (loaded.session as { projectId?: string }).projectId || undefined;
        const onSubstatus = (substatus: string) => {
          const statusSession = { ...buildServerFirstSession(loaded.session, loaded.state), narratorState: "working" as const, substatus: substatus as "reflecting" };
          broadcastToAll(loaded.state, serializeEnvelope({ type: "session:state", session: statusSession, cursor: createCursor(loaded.state) }));
        };
        return createSessionToolExecutor({ ...sessionToolExecutorOptions, workDir: sessionWorkDir, projectId: sessionProjectId, onSubstatus }).execute(enrichedInput);
      },
    });
    const runtimeEvents = runtimeTurn.agentEvents;

    const toolInputsById = new Map<string, Record<string, unknown>>();
    let nextTimestamp = timestamp;
    let assistantIndex = 0;
    for (const event of runtimeEvents) {
      if (event.type === "assistant_message") {
        accumulateUsage(loaded.state.cumulativeUsage, event.runtime?.usage);
        const assistantMessage = appendMessageToState(loaded.state, {
          id: assistantIndex === 0 ? `confirmation-continuation-${timestamp}` : `confirmation-continuation-${timestamp}-${assistantIndex + 1}`,
          role: "assistant",
          content: event.content,
          reasoning_content: event.reasoningContent,
          timestamp: nextTimestamp,
          runtime: event.runtime,
          ...(event.runtime?.usage ? { metadata: { usage: event.runtime.usage } } : {}),
        });
        assistantIndex += 1;
        nextTimestamp += 1;
        broadcastMessageEnvelope(loaded.session.id, loaded.state, assistantMessage);
        continue;
      }

      if (event.type === "tool_call") {
        toolInputsById.set(event.id, event.input);
        const toolUseMessage = appendMessageToState(loaded.state, {
          id: `confirmation-tool-use-${event.id}-${nextTimestamp}`,
          role: "assistant",
          content: `请求调用工具 ${event.toolName}。`,
          timestamp: nextTimestamp,
          runtime: event.runtime,
          toolCalls: [{ id: event.id, toolName: event.toolName, input: event.input }],
        });
        nextTimestamp += 1;
        broadcastMessageEnvelope(loaded.session.id, loaded.state, toolUseMessage);
        continue;
      }

      if (event.type === "tool_result") {
        // 回写原始 tool_call 消息的 status
        const completedStatus = buildToolResultStatus(event.result);
        for (const msg of loaded.state.messages) {
          if (msg.toolCalls?.some((tc) => tc.id === event.id && tc.status === "running")) {
            msg.toolCalls = msg.toolCalls.map((tc) =>
              tc.id === event.id ? { ...tc, status: completedStatus, duration: event.result.durationMs } : tc,
            );
            break;
          }
        }

        const toolUse = {
          id: event.id,
          toolName: event.toolName,
          input: toolInputsById.get(event.id) ?? {},
        };
        const messageId = `confirmation-tool-result-${event.id}-${nextTimestamp}`;
        const toolResult = normalizeToolResultConfirmation(event.result, {
          sessionId: loaded.session.id,
          messageId,
          toolUseId: event.id,
          input: toolUse.input,
        });
        const toolResultMessage = appendMessageToState(loaded.state, {
          id: messageId,
          role: "assistant",
          content: toolResult.summary,
          timestamp: nextTimestamp,
          runtime: event.runtime,
          toolCalls: [buildToolResultCall(toolUse, toolResult)],
          metadata: buildToolResultMetadata(toolResult),
        });
        nextTimestamp += 1;
        broadcastMessageEnvelope(loaded.session.id, loaded.state, toolResultMessage);
        continue;
      }

      if (event.type === "confirmation_required" || event.type === "turn_completed" || event.type === "streaming_chunk") {
        continue;
      }

      if (event.type === "turn_failed") {
        return { reason: event.reason, message: event.message, at: new Date().toISOString() };
      }
    }
    return undefined;
  } catch (error) {
    return {
      reason: "provider-unavailable",
      message: error instanceof Error ? error.message : "LLM runtime request failed",
      at: new Date().toISOString(),
    };
  }
}

async function persistMergedSessionChatProgress(
  sessionId: string,
  session: NarratorSessionRecord,
  state: SessionChatRuntimeState,
  failure?: NarratorSessionRecoveryMetadata["lastFailure"],
): Promise<NarratorSessionRecord | null> {
  trimSessionMessages(state);
  const persistedHistory = await loadSessionChatHistory(sessionId);
  const recentById = new Map(state.messages.map((message) => [message.id, message]));
  const merged = persistedHistory.length > 0
    ? persistedHistory.map((message) => recentById.get(message.id) ?? message)
    : [];
  const mergedIds = new Set(merged.map((message) => message.id));
  for (const message of state.messages) {
    if (!mergedIds.has(message.id)) {
      merged.push(message);
      mergedIds.add(message.id);
    }
  }
  merged.sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));

  await saveSessionChatHistory(sessionId, merged);
  state.availableFromSeq = merged[0]?.seq ?? state.messages[0]?.seq ?? state.availableFromSeq;
  const recovery = buildRecoveryMetadata(state, state.messages, failure);
  state.recoveryJson = serializeRecoveryMetadata(recovery);
  await updateSessionChatRecoveryJson(sessionId, state.recoveryJson);
  return updateSession(sessionId, {
    messageCount: state.messageCount,
    recentMessages: [...state.messages],
    recovery,
    cumulativeUsage: state.cumulativeUsage,
  });
}

export async function getSessionToolState(sessionId: string): Promise<SessionToolState | null> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    return null;
  }

  return {
    sessionId,
    tools: annotateSessionToolsWithPolicy(getEnabledSessionTools(loaded.session.sessionConfig.permissionMode, loaded.session.agentId, { disabledTools: loaded.session.sessionConfig.toolPolicy?.deny }), loaded.session.sessionConfig.toolPolicy),
    policy: loaded.session.sessionConfig.toolPolicy,
    pendingConfirmations: extractPendingToolConfirmations(sessionId, loaded.state.messages),
  };
}

export async function confirmSessionToolDecision(
  sessionId: string,
  toolName: string,
  input: ConfirmSessionToolDecisionInput,
): Promise<ConfirmSessionToolDecisionResult> {
  const normalizedDecision = normalizeConfirmationDecision(input);
  if (!normalizedDecision) {
    return { ok: false, status: 400, error: "Invalid confirmation decision" };
  }

  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    return { ok: false, status: 404, error: "Session not found" };
  }

  const match = findPendingToolConfirmation(sessionId, loaded.state.messages, toolName, input.confirmationId);
  if (!match) {
    return { ok: false, status: 404, error: "Pending confirmation not found" };
  }

  const decision: ToolConfirmationDecision = {
    confirmationId: match.confirmation.id,
    decision: normalizedDecision,
    ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
    decidedAt: new Date().toISOString(),
    sessionId,
  };

  let rawToolResult: SessionToolExecutionResult;
  if (normalizedDecision !== "approved") {
    rawToolResult = createRejectedToolResult(toolName, match.confirmation, decision);
  } else if (toolName === "AskUserQuestion" && input.answers) {
    // AskUserQuestion 特殊处理：直接返回用户的 answers 作为工具结果，不重新执行工具
    rawToolResult = {
      ok: true,
      renderer: "tool.ask-user-question",
      summary: `用户已回答 ${Object.keys(input.answers).length} 个问题。`,
      data: {
        status: "answered",
        answers: input.answers,
        // 给后续 PGI 工具一个明确字段，避免模型把回答结果漏传或误判为空。
        pgiAnswers: input.answers,
        instructions: Object.entries(input.answers)
          .map(([question, answer]) => `- ${question}: ${Array.isArray(answer) ? answer.join("、") : String(answer)}`)
          .join("\n"),
      },
    };
  } else {
    rawToolResult = await sessionToolExecutor.execute({
      sessionId,
      toolName,
      input: match.confirmation.input,
      permissionMode: loaded.session.sessionConfig.permissionMode,
      sessionConfig: loaded.session.sessionConfig,
      confirmationDecision: decision,
    });
  }
  const toolResult = normalizeToolResultConfirmation(withSessionConfirmationAudit(rawToolResult, match.confirmation, decision), {
    sessionId,
    messageId: match.message.id,
    toolUseId: match.confirmation.toolUseId,
    input: match.confirmation.input,
  });

  resolvePendingToolCall(match, toolResult);
  match.message.metadata = {
    ...match.message.metadata,
    confirmation: match.confirmation,
    confirmationDecision: decision,
    ...(toolResult.confirmationAudit ? { confirmationAudit: toolResult.confirmationAudit } : {}),
  };

  // ExitPlanMode 批准后切换 sessionMode
  if (normalizedDecision === "approved" && toolName === "ExitPlanMode") {
    await updateSession(sessionId, { sessionMode: "chat" });
  }

  const timestamp = Date.now();
  const resultMessage = appendMessageToState(loaded.state, {
    id: `confirmation-result-${match.confirmation.id}-${timestamp}`,
    role: "assistant",
    content: toolResult.summary,
    timestamp,
    runtime: match.message.runtime,
    toolCalls: [buildToolResultCall({
      id: match.confirmation.toolUseId ?? match.confirmation.id,
      toolName,
      input: match.confirmation.input,
    }, toolResult)],
    metadata: {
      ...buildToolResultMetadata(toolResult),
      confirmation: match.confirmation,
      confirmationDecision: decision,
    },
  });
  broadcastMessageEnvelope(sessionId, loaded.state, resultMessage);
  const failure = await appendModelContinuationAfterToolDecision(loaded, timestamp + 1);
  const updatedSession = await persistMergedSessionChatProgress(sessionId, loaded.session, loaded.state, failure);
  const serverFirstSession = buildServerFirstSession(updatedSession ?? loaded.session, loaded.state);
  broadcastStateEnvelope(serverFirstSession, loaded.state);

  return {
    ok: true,
    decision,
    toolResult,
    snapshot: {
      session: serverFirstSession,
      messages: [...loaded.state.messages],
      cursor: createCursor(loaded.state),
    },
  };
}

export async function getSessionChatSnapshot(sessionId: string): Promise<NarratorSessionChatSnapshot | null> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    return null;
  }

  return {
    session: buildServerFirstSession(loaded.session, loaded.state),
    messages: [...loaded.state.messages],
    cursor: createCursor(loaded.state),
  };
}

export async function getSessionChatHistory(sessionId: string, sinceSeq = 0): Promise<NarratorSessionChatHistory | null> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    return null;
  }

  const normalizedSinceSeq = Math.max(0, sanitizeSeq(sinceSeq));
  const persistedHistory = await loadSessionChatHistory(sessionId);
  const sourceMessages = persistedHistory.length > 0 ? persistedHistory : loaded.state.messages;
  const availableFromSeq = sourceMessages[0]?.seq ?? 0;
  const cursor = createCursor(loaded.state);
  const resetRequired = normalizedSinceSeq > 0 && (
    (availableFromSeq > 0 && normalizedSinceSeq < availableFromSeq - 1)
    || normalizedSinceSeq > cursor.lastSeq
  );

  return {
    sessionId,
    sinceSeq: normalizedSinceSeq,
    availableFromSeq,
    resetRequired,
    messages: resetRequired ? [] : sourceMessages.filter((message) => (message.seq ?? 0) > normalizedSinceSeq),
    cursor,
  };
}

export async function replaceSessionChatState(
  sessionId: string,
  nextMessages: NarratorSessionChatMessage[],
): Promise<NarratorSessionChatSnapshot | null> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    return null;
  }

  const normalizedMessages = normalizeSessionMessages(nextMessages, Array.isArray(nextMessages) ? nextMessages.length : 0).slice(-MAX_SESSION_MESSAGES);
  loaded.state.messages = normalizedMessages;
  loaded.state.messageCount = Math.max(normalizedMessages.length, getLastSeq(normalizedMessages));
  loaded.state.nextSeq = loaded.state.messageCount + 1;
  loaded.state.persistedAckedSeq = 0;
  loaded.state.availableFromSeq = normalizedMessages[0]?.seq ?? 0;

  for (const transportState of loaded.state.transports.values()) {
    transportState.ackedSeq = 0;
  }

  await saveSessionChatHistory(sessionId, normalizedMessages);
  const recovery = buildRecoveryMetadata(loaded.state, normalizedMessages);
  loaded.state.recoveryJson = serializeRecoveryMetadata(recovery);
  await updateSessionChatRecoveryJson(sessionId, loaded.state.recoveryJson);
  const updatedSession = await updateSession(sessionId, {
    messageCount: loaded.state.messageCount,
    recentMessages: [...normalizedMessages],
    recovery,
  });
  const serverFirstSession = buildServerFirstSession(updatedSession ?? loaded.session, loaded.state);
  const snapshot: NarratorSessionChatSnapshot = {
    session: serverFirstSession,
    messages: [...loaded.state.messages],
    cursor: createCursor(loaded.state),
  };

  for (const transport of loaded.state.transports.keys()) {
    const transportState = loaded.state.transports.get(transport);
    sendEnvelope(
      transport,
      createSessionChatStateEnvelope(serverFirstSession, loaded.state, transportState?.ackedSeq ?? 0, {
        state: "resetting",
        reason: "server-reset",
      }),
    );
    sendEnvelope(transport, {
      type: "session:snapshot",
      snapshot,
      recovery: {
        state: "idle",
        reason: "server-reset",
      },
    });
  }
  return snapshot;
}

/** 向指定 session 的所有已连接 transport 广播 session:error 事件 */
export async function broadcastSessionError(
  sessionId: string,
  error: string,
  code?: string,
): Promise<void> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) return;
  const envelope = createSessionChatError(sessionId, error, { code });
  const payload = serializeEnvelope(envelope);
  for (const transport of loaded.state.transports.keys()) {
    try {
      transport.send(payload);
    } catch {
      loaded.state.transports.delete(transport);
    }
  }
}

/** 向指定 session 的所有已连接 transport 广播 compact 进度事件 */
export async function broadcastCompactProgress(
  sessionId: string,
  stage: "cascade" | "segment",
  progress: number,
  message?: string,
): Promise<void> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) return;
  const envelope: NarratorSessionCompactProgressEnvelope = {
    type: "session:compact-progress",
    sessionId,
    stage,
    progress,
    ...(message ? { message } : {}),
  };
  const payload = serializeEnvelope(envelope);
  for (const transport of loaded.state.transports.keys()) {
    try {
      transport.send(payload);
    } catch {
      loaded.state.transports.delete(transport);
    }
  }
}

// ─── Safety Pause / Decision mechanism ──────────────────────────────────────

const pendingSafetyDecisions = new Map<string, { resolve: (decision: "approve" | "reject") => void }>();

/** Broadcast a safety-pause event and wait for the user's decision */
export function broadcastSafetyPause(sessionId: string, toolName: string, toolInput: Record<string, unknown>, reason: string): Promise<"approve" | "reject"> {
  return new Promise((resolve) => {
    pendingSafetyDecisions.set(sessionId, { resolve });

    const loaded = runtimeStateBySessionId.get(sessionId);
    if (!loaded) {
      pendingSafetyDecisions.delete(sessionId);
      resolve("reject");
      return;
    }

    const envelope = { type: "session:safety-pause" as const, sessionId, toolName, toolInput, reason };
    const payload = serializeEnvelope(envelope as any);
    for (const transport of loaded.transports.keys()) {
      try {
        transport.send(payload);
      } catch {
        loaded.transports.delete(transport);
      }
    }
  });
}

/** Resolve a pending safety decision (called when client sends session:safety-decision) */
export function resolveSafetyDecision(sessionId: string, decision: "approve" | "reject"): void {
  const pending = pendingSafetyDecisions.get(sessionId);
  if (pending) {
    pendingSafetyDecisions.delete(sessionId);
    pending.resolve(decision);
  }
}

export async function attachSessionChatTransport(
  sessionId: string,
  transport: SessionChatTransport,
  options: AttachSessionChatTransportOptions = {},
): Promise<boolean> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    sendEnvelope(transport, createSessionChatError(sessionId, "Session not found"));
    transport.close(1008, "Session not found");
    return false;
  }

  const session = buildServerFirstSession(loaded.session, loaded.state);

  // If a turn is currently running (abortController exists), reflect working state
  const isWorking = abortControllerBySessionId.has(sessionId) || sessionBusy.has(sessionId);
  const sessionWithState = isWorking
    ? { ...session, narratorState: "working" as const, substatus: "thinking" as const }
    : session;

  const hasExplicitResume = options.resumeFromSeq !== undefined;
  const requestedResumeSeq = hasExplicitResume ? sanitizeSeq(options.resumeFromSeq) : loaded.state.persistedAckedSeq;
  const cursor = createCursor(loaded.state);
  const resumeOutOfRange = requestedResumeSeq > cursor.lastSeq;
  const ackedSeq = Math.min(requestedResumeSeq, cursor.lastSeq);
  loaded.state.transports.set(transport, {
    ackedSeq,
  });

  if (!hasExplicitResume || ackedSeq === 0) {
    sendEnvelope(transport, {
      type: "session:snapshot",
      snapshot: {
        session: sessionWithState,
        messages: [...loaded.state.messages],
        cursor: createCursor(loaded.state, ackedSeq),
      },
      recovery: {
        state: hasExplicitResume && ackedSeq === 0 ? "recovering" : "idle",
        reason: hasExplicitResume ? "reconnect" : "initial-hydration",
      },
    });
  }

  console.log(JSON.stringify({
    component: "session.recovery",
    ok: true,
    sessionId,
    route: "/api/sessions/:id/chat",
    requestedResumeSeq,
    ackedSeq,
    lastSeq: cursor.lastSeq,
    pendingMessageCount: session.recovery?.pendingMessageCount ?? 0,
    recoveryState: resumeOutOfRange ? "resetting" : "idle",
  }));

  sendEnvelope(
    transport,
    createSessionChatStateEnvelope(
      sessionWithState,
      loaded.state,
      ackedSeq,
      resumeOutOfRange ? { state: "resetting", reason: "history-gap" } : undefined,
    ),
  );
  return true;
}

export function detachSessionChatTransport(sessionId: string, transport: SessionChatTransport): void {
  const state = runtimeStateBySessionId.get(sessionId);
  if (!state) {
    return;
  }

  state.transports.delete(transport);

  // Remove queued messages belonging to the disconnected transport
  const queue = sessionMessageQueue.get(sessionId);
  if (queue) {
    const filtered = queue.filter((msg) => msg.transport !== transport);
    if (filtered.length === 0) {
      sessionMessageQueue.delete(sessionId);
    } else {
      sessionMessageQueue.set(sessionId, filtered);
    }
  }

  if (state.transports.size === 0 && state.messages.length === 0 && !abortControllerBySessionId.has(sessionId)) {
    runtimeStateBySessionId.delete(sessionId);
  }
}

const SESSION_TOOL_RESULT_CONTINUATION_INSTRUCTION = "工具已完成。请先总结已经获得的信息，判断是否足够进入下一步。如果信息足够，请继续执行下一步；不要重复读取同一资源。";

function formatSessionToolResultContent(result: SessionToolExecutionResult): string {
  return result.summary ? `${result.summary}\n\n${SESSION_TOOL_RESULT_CONTINUATION_INSTRUCTION}` : SESSION_TOOL_RESULT_CONTINUATION_INSTRUCTION;
}

function extractMessageToolResult(message: NarratorSessionChatMessage): SessionToolExecutionResult | undefined {
  const toolResult = message.metadata?.toolResult;
  if (!isRecord(toolResult) || typeof toolResult.ok !== "boolean" || typeof toolResult.summary !== "string") {
    return undefined;
  }
  return toolResult as unknown as SessionToolExecutionResult;
}

function sessionMessagesToTurnItems(messages: readonly NarratorSessionChatMessage[]): AgentTurnItem[] {
  const latestResultIndexByToolCallId = new Map<string, number>();
  messages.forEach((message, index) => {
    if (!extractMessageToolResult(message)) return;
    for (const toolCall of message.toolCalls ?? []) {
      if (toolCall.id) latestResultIndexByToolCallId.set(toolCall.id, index);
    }
  });

  return messages.flatMap((message, messageIndex): AgentTurnItem[] => {
    // Skip collapsed messages (segment compact keeps them for undo but hides from LLM)
    if ((message.metadata as any)?.collapsed) {
      return [];
    }
    if (message.role !== "system" && message.role !== "user" && message.role !== "assistant") {
      return [];
    }

    const toolCalls = message.toolCalls ?? [];
    if (toolCalls.length > 0) {
      const toolResult = extractMessageToolResult(message);
      if (toolResult) {
        return toolCalls.flatMap((toolCall): AgentTurnItem[] => {
          if (!toolCall.id || latestResultIndexByToolCallId.get(toolCall.id) !== messageIndex) return [];
          return [{
            type: "tool_result",
            toolCallId: toolCall.id,
            name: toolCall.toolName,
            content: formatSessionToolResultContent(toolResult),
            ...(toolResult.data !== undefined ? { data: toolResult.data } : {}),
            metadata: { toolResult },
          }];
        });
      }

      return toolCalls.flatMap((toolCall): AgentTurnItem[] => {
        if (!toolCall.id) return [];
        return [{
          type: "tool_call",
          id: toolCall.id,
          name: toolCall.toolName,
          input: normalizeRuntimeToolInput(toolCall.input),
        }];
      });
    }

    if (!message.content.trim()) return [];
    return [{
      type: "message",
      id: message.id,
      role: message.role,
      content: message.content,
      ...(message.metadata ? { metadata: message.metadata } : {}),
      ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    }];
  });
}

const PROJECT_RULES_TOKEN_BUDGET = 20000;
const CHARS_PER_TOKEN = 4;
const MAX_RULES_CHARS = PROJECT_RULES_TOKEN_BUDGET * CHARS_PER_TOKEN;

function safeReadFile(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, "utf-8").trim();
    return content || null;
  } catch {
    return null;
  }
}

/**
 * 从套路系统加载已启用的全局提示词，拼接为 system prompt 附加段。
 * 非阻塞：加载失败时返回空字符串。
 */
async function loadRoutineGlobalPrompts(): Promise<string> {
  try {
    const routines = await loadGlobalRoutines();
    const parts: string[] = [];

    // System prompts (highest priority — injected first)
    const enabledSystem = routines.systemPrompts.filter(p => p.enabled && p.content.trim());
    for (const p of enabledSystem) {
      parts.push(p.content.trim());
    }

    // Global skills (writing presets / instructions)
    const enabledSkills = routines.globalSkills.filter(s => s.enabled && s.instructions.trim());
    for (const s of enabledSkills) {
      parts.push(`[技能: ${s.name}]\n${s.instructions.trim()}`);
    }

    // Project skills
    const enabledProjectSkills = routines.projectSkills.filter(s => s.enabled && s.instructions.trim());
    for (const s of enabledProjectSkills) {
      parts.push(`[项目技能: ${s.name}]\n${s.instructions.trim()}`);
    }

    // Global prompts (general-purpose prompt assets)
    const enabledPrompts = routines.globalPrompts.filter(p => p.enabled && p.content.trim());
    for (const p of enabledPrompts) {
      parts.push(p.content.trim());
    }

    if (parts.length === 0) return "";
    return "\n\n" + parts.join("\n\n");
  } catch {
    return "";
  }
}

function loadProjectRules(workDir: string): string {
  const sections: string[] = [];
  let totalChars = 0;

  // 1. User-level global rules: ~/.novelfork/CLAUDE.md
  const globalRulesPath = join(homedir(), ".novelfork", "CLAUDE.md");
  const globalContent = safeReadFile(globalRulesPath);
  if (globalContent) {
    sections.push(`## 全局规则\n\n${globalContent}`);
    totalChars += globalContent.length;
  }

  // 2. Project-level rules: {workDir}/CLAUDE.md
  const projectRulesPath = join(workDir, "CLAUDE.md");
  const projectContent = safeReadFile(projectRulesPath);
  if (projectContent) {
    sections.push(`## 项目规则\n\n${projectContent}`);
    totalChars += projectContent.length;
  }

  // 3. Directory rules: {workDir}/.claude/rules/*.md
  const rulesDir = join(workDir, ".claude", "rules");
  if (existsSync(rulesDir)) {
    try {
      const files = readdirSync(rulesDir).filter(f => f.endsWith(".md")).sort();
      for (const file of files) {
        if (totalChars >= MAX_RULES_CHARS) break;
        const content = safeReadFile(join(rulesDir, file));
        if (content) {
          sections.push(`### ${file}\n\n${content}`);
          totalChars += content.length;
        }
      }
    } catch { /* directory read failure — skip */ }
  }

  if (sections.length === 0) return "";

  let combined = sections.join("\n\n");
  if (combined.length > MAX_RULES_CHARS) {
    combined = combined.slice(0, MAX_RULES_CHARS) + "\n\n[... 项目规则已截断，超出 20K token 预算]";
  }

  return combined;
}

function createRuntimeContext(bookContext: string, canvasContext?: CanvasContext, workDir?: string, projectExplorationContext?: string): string {
  const parts = [
    workDir ? `## 当前工作目录\n\n${workDir}\n\n所有文件操作（Read/Write/Edit/Glob/Grep）的根目录。` : "",
    workDir ? loadProjectRules(workDir) : "",
    projectExplorationContext?.trim() ?? "",
    bookContext.trim(),
    canvasContext ? formatCanvasContextForPrompt(canvasContext) : "",
  ].filter(Boolean);
  return parts.join("\n\n");
}

export async function handleSessionChatTransportMessage(
  sessionId: string,
  transport: SessionChatTransport,
  rawMessage: RawData | string | ArrayBuffer | ArrayBufferView | Blob | unknown,
): Promise<void> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    sendEnvelope(transport, createSessionChatError(sessionId, "Session not found"));
    transport.close(1008, "Session not found");
    return;
  }

  const text = await normalizeMessageText(rawMessage);
  if (!text) {
    sendEnvelope(transport, createSessionChatError(sessionId, "Empty message payload"));
    return;
  }

  const payload = parseClientMessage(text);
  const canvasContext = sanitizeCanvasContext("canvasContext" in payload ? payload.canvasContext : undefined);
  const transportState = loaded.state.transports.get(transport);

  if ("ack" in payload && sanitizeSeq(payload.ack) > 0 && transportState) {
    const updatedTransportState = updateTransportAck(loaded.state, transport, sanitizeSeq(payload.ack));
    if (updatedTransportState) {
      loaded.state.persistedAckedSeq = Math.max(loaded.state.persistedAckedSeq, updatedTransportState.ackedSeq);
      const recovery = buildRecoveryMetadata(loaded.state, loaded.state.messages);
      loaded.state.recoveryJson = serializeRecoveryMetadata(recovery);
      await updateSessionChatAckedSeq(sessionId, loaded.state.persistedAckedSeq, loaded.state.recoveryJson);
      await updateSession(sessionId, { recovery });
    }
  }

  if (payload.type === "session:ack") {
    const session = buildServerFirstSession(loaded.session, loaded.state);
    sendEnvelope(transport, createSessionChatStateEnvelope(session, loaded.state, transportState?.ackedSeq ?? loaded.state.persistedAckedSeq));
    return;
  }

  if (payload.type === "session:abort") {
    abortSession(sessionId);
    sessionMessageQueue.delete(sessionId);
    sessionBusy.delete(sessionId);
    return;
  }

  if (payload.type === "session:continue") {
    // Clear the interrupted checkpoint and feed a continuation message into normal flow
    clearSessionCheckpoints(sessionId);
    // Clear the interrupted recovery state
    const currentRecovery = loaded.session.recovery;
    if (currentRecovery?.lastFailure?.reason === "interrupted") {
      void updateSession(sessionId, {
        recovery: { ...currentRecovery, lastFailure: undefined, updatedAt: new Date().toISOString() },
      });
    }
    console.log(JSON.stringify({ component: "session-chat", event: "session:continue", sessionId }));
    // Re-enter as a normal message with continuation instruction
    const continuePayload = JSON.stringify({
      type: "session:message",
      content: "请继续执行之前被中断的任务。",
      messageId: `continue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    await handleSessionChatTransportMessage(sessionId, transport, continuePayload);
    return;
  }

  if (payload.type === "session:safety-decision") {
    const decision = (payload as { decision?: "approve" | "reject" }).decision ?? "reject";
    resolveSafetyDecision(sessionId, decision);
    console.log(JSON.stringify({ component: "session-chat", event: "session:safety-decision", sessionId, decision }));
    return;
  }

  const content = ("content" in payload ? payload.content : "").trim();
  const effectiveContent = content || "继续";
  if (!content) {
    console.log(JSON.stringify({ component: "session-chat", event: "continue", sessionId }));
  }

  // ─── Parse and persist image attachments ────────────────────────────────────
  const rawAttachments = Array.isArray((payload as any).attachments) ? (payload as any).attachments as Array<{ type: "image"; mimeType: string; data: string; fileName?: string }> : undefined;
  const persistedAttachments = rawAttachments?.length ? saveAttachmentsToDisk(rawAttachments) : undefined;

  const messageId = ("messageId" in payload ? payload.messageId?.trim() : "") || `session-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // ─── Buffered Message Queue: check if session is busy ───────────────────────
  const isFromQueue = "_fromQueue" in payload && payload._fromQueue === true;
  if (sessionBusy.has(sessionId) && !isFromQueue) {
    const queue = sessionMessageQueue.get(sessionId) ?? [];
    if (queue.length >= MAX_QUEUE_SIZE) {
      sendEnvelope(transport, createSessionChatError(sessionId, "消息队列已满，请等待当前任务完成"));
      return;
    }
    queue.push({ content: effectiveContent, messageId, canvasContext, transport, queuedAt: Date.now() });
    sessionMessageQueue.set(sessionId, queue);
    console.log(JSON.stringify({ component: "session-chat", event: "message-queued", sessionId, queueLength: queue.length }));
    return;
  }

  if (!isFromQueue) {
    sessionBusy.add(sessionId);
  }
  // ────────────────────────────────────────────────────────────────────────────

  const timestamp = Date.now();
  const userMessage = appendMessageToState(loaded.state, {
    id: messageId,
    role: "user",
    content: effectiveContent,
    timestamp,
    ...(canvasContext ? { metadata: { canvasContext } } : {}),
    ...(persistedAttachments?.length ? { attachments: persistedAttachments } : {}),
  });
  broadcastMessageEnvelope(sessionId, loaded.state, userMessage);

  const messagesToPersist: NarratorSessionChatMessage[] = [userMessage];
  const sessionTools = getEnabledSessionTools(loaded.session.sessionConfig.permissionMode, loaded.session.agentId, { disabledTools: loaded.session.sessionConfig.toolPolicy?.deny });

  // Filter to core tools unless session has explicit allow list or is bound to a book
  const CORE_TOOL_NAMES = new Set(["Read", "Write", "Edit", "Bash", "Grep", "Glob", "Agent", "Await", "ToolSearch", "Terminal", "Browser", "WebSearch", "WebFetch", "EnterPlanMode", "ExitPlanMode", "TaskCreate", "AskUserQuestion", "Send", "Recall", "Skill"]);
  const policyAllow = loaded.session.sessionConfig.toolPolicy?.allow;
  const hasBookBinding = Boolean(loaded.session.projectId);
  const filteredTools = (policyAllow?.length || hasBookBinding)
    ? sessionTools // Book-bound sessions get all tools (including novel tools)
    : sessionTools.filter(t => CORE_TOOL_NAMES.has(t.name));

  let canonicalEvents: readonly RuntimeEvent[] = [];
  let failure: NarratorSessionRecoveryMetadata["lastFailure"] | undefined;
  let errorEnvelope: NarratorSessionChatErrorEnvelope | undefined;
  const toolInputsById = new Map<string, Record<string, unknown>>();
  const realtimeBroadcastedIds = new Set<string>();

  // 推送 working 状态给所有连接的客户端
  const turnStartedAt = Date.now();
  const turnStartedAtIso = new Date(turnStartedAt).toISOString();
  const workingSession = { ...buildServerFirstSession(loaded.session, loaded.state), narratorState: "working" as const, substatus: "thinking" as const, turnStartedAt: turnStartedAtIso };
  broadcastToAll(loaded.state, serializeEnvelope({ type: "session:state", session: workingSession, cursor: createCursor(loaded.state) }));

  try {
    const agentSystemPrompt = getAgentSystemPrompt(loaded.session.agentId);
    const projectId = (loaded.session as { projectId?: string }).projectId;
    let bookContext = "";
    if (projectId) {
      // Resolve model context window from provider config for dynamic token budget
      let modelContextWindow: number | undefined;
      try {
        const provider = await providerRuntimeStore.getProvider(loaded.session.sessionConfig.providerId);
        if (provider?.models?.length) {
          const model = provider.models.find((m) => m.id === loaded.session.sessionConfig.modelId) ?? provider.models[0];
          if (model?.contextWindow && model.contextWindow > 0) modelContextWindow = model.contextWindow;
        }
      } catch { /* fallback */ }

      try {
        bookContext = await buildAgentContext({ bookId: projectId, sceneText: effectiveContent, modelContextWindow });
      } catch { /* context build failure is non-fatal */ }

      // P2: 预设 prompt 注入 + 节拍模板注入
      try {
        const { buildPresetInjections, getPreset, getBeatTemplate } = await import("@vivy1024/novelfork-novel-plugin/engine");
        const { resolveRuntimeStoragePath } = await import("./runtime-storage-paths.js");
        const { readFile: readFileAsync } = await import("node:fs/promises");
        const { join: joinPath } = await import("node:path");
        const root = process.env.NOVELFORK_PROJECT_ROOT || resolveRuntimeStoragePath();
        const bookJsonPath = joinPath(root, "books", projectId, "book.json");
        const bookConfig = JSON.parse(await readFileAsync(bookJsonPath, "utf-8")) as { enabledPresetIds?: string[]; beatTemplateId?: string };

        // 预设注入
        if (bookConfig.enabledPresetIds?.length) {
          const enabledPresets = bookConfig.enabledPresetIds.map((id: string) => getPreset(id)).filter(Boolean);
          if (enabledPresets.length > 0) {
            const presetBlock = buildPresetInjections(enabledPresets as any);
            if (presetBlock.trim()) {
              bookContext += `\n\n### 启用的写作预设\n${presetBlock}`;
            }
          }
        }

        // 节拍模板注入
        if (bookConfig.beatTemplateId) {
          const beatTemplate = getBeatTemplate(bookConfig.beatTemplateId);
          if (beatTemplate) {
            const beatNames = beatTemplate.beats.map((b: { name: string }) => b.name).join(" → ");
            bookContext += `\n\n### 当前节拍模板：${beatTemplate.name}\n节拍序列：${beatNames}`;
          }
        }
      } catch { /* preset/beat injection failure is non-fatal */ }
    }

    // Phase 4: 项目探索上下文（规则文件 + package.json）
    const workDir = loaded.session.worktree?.trim() || process.cwd();
    let projectExplorationContext = "";
    try {
      projectExplorationContext = await buildProjectExplorationContext(workDir);
    } catch { /* project exploration failure is non-fatal */ }

    const routinePrompts = await loadRoutineGlobalPrompts();
    const sessionTools = getEnabledSessionTools(loaded.session.sessionConfig.permissionMode, loaded.session.agentId, { disabledTools: loaded.session.sessionConfig.toolPolicy?.deny });
    const fullSystemPrompt = `${agentSystemPrompt}${AGENT_NATIVE_WRITE_NEXT_INSTRUCTIONS}${buildGoalsPromptSection(loaded.session.goals)}${routinePrompts}${buildAvailableToolsSection(sessionTools.map(t => t.name))}`;
    const maxSteps = await resolveMaxTurnSteps();
    // Apply context cutoff: exclude messages at or before the cutoff seq from model context
    const contextCutoffSeq = loaded.session.sessionConfig.contextCutoffSeq ?? 0;
    const contextMessages = contextCutoffSeq > 0
      ? loaded.state.messages.filter((m) => (m.seq ?? 0) > contextCutoffSeq)
      : loaded.state.messages;
    const { items: compactedMessages } = await maybeAutoCompact(contextMessages, loaded.state, sessionId);
    const abortController = createSessionAbortController(sessionId);
    // Fix: firstTokenTimeout + silentToolCallThreshold — 从用户配置读取运行时控制
    let combinedSignal: AbortSignal = abortController.signal;
    let silentToolCallThreshold: number | undefined;
    try {
      const timeoutConfig = await loadUserConfig();
      const timeoutSeconds = timeoutConfig.runtimeControls?.firstTokenTimeout ?? 0;
      if (timeoutSeconds > 0) {
        const timeoutSignal = AbortSignal.timeout(timeoutSeconds * 1000);
        combinedSignal = AbortSignal.any([abortController.signal, timeoutSignal]);
      }
      const silentThreshold = timeoutConfig.runtimeControls?.silentToolCallThreshold;
      if (typeof silentThreshold === "number" && silentThreshold > 0) {
        silentToolCallThreshold = silentThreshold;
      }
    } catch { /* config load failure — use plain abort signal */ }
    const reasoningPolicy = await resolveReasoningPolicy(loaded.session.sessionConfig.providerId);

    // Record context breakdown at send time (for accurate Context Ring display)
    const runtimeContext = createRuntimeContext(bookContext, canvasContext, loaded.session.worktree, projectExplorationContext);
    const estimateChars = (s: string | undefined) => Math.ceil((s?.length ?? 0) * 0.6);
    const messagesChars = compactedMessages.reduce((sum, m) => sum + ("content" in m && typeof m.content === "string" ? m.content.length : 0), 0);
    loaded.state.cumulativeUsage.lastContextBreakdown = [
      { label: "系统提示词", tokens: estimateChars(fullSystemPrompt) },
      { label: "作品上下文", tokens: estimateChars(runtimeContext) },
      { label: `工具定义 (${filteredTools.length} 个)`, tokens: filteredTools.length * 380 },
      { label: `消息历史 (${compactedMessages.length} 条)`, tokens: Math.ceil(messagesChars * 0.6) },
    ];

    const runtimeTurn = await executeRuntimeTurn({
      sessionId,
      sessionConfig: loaded.session.sessionConfig,
      messages: compactedMessages,
      systemPrompt: fullSystemPrompt,
      context: runtimeContext,
      tools: filteredTools,
      permissionMode: loaded.session.sessionConfig.permissionMode,
      ...(canvasContext ? { canvasContext } : {}),
      maxSteps,
      shouldContinueAfterToolResult,
      reasoningPolicy,
      ...(silentToolCallThreshold ? { silentToolCallThreshold } : {}),
      onStreamChunk: (chunk: string) => {
        broadcastStreamChunk(sessionId, loaded.state, chunk);
      },
      onToolEvent: (event: RuntimeToolStreamEvent) => {
        if (event.type === "tool_input_chunk") {
          const envelope = { type: "session:tool-input-chunk" as const, sessionId, toolCallId: event.id, partialInput: event.partialInput };
          broadcastToAll(loaded.state, serializeEnvelope(envelope as any));
        }
      },
      onEvent: (event) => {
        if (event.type === "tool_call") {
          const statusSession = { ...buildServerFirstSession(loaded.session, loaded.state), narratorState: "working" as const, substatus: "tool_calling" as const, toolName: event.toolName, turnStartedAt: turnStartedAtIso };
          broadcastToAll(loaded.state, serializeEnvelope({ type: "session:state", session: statusSession, cursor: createCursor(loaded.state) }));
          // 实时推送 tool_call 消息到前端（不等 turn 结束）
          const toolUseMessage = appendMessageToState(loaded.state, {
            id: `${userMessage.id}-tool-use-${event.id}`,
            role: "assistant",
            content: `请求调用工具 ${event.toolName}。`,
            timestamp: timestamp + messagesToPersist.length,
            runtime: event.runtime,
            toolCalls: [{ id: event.id, toolName: event.toolName, input: event.input, status: "running" as const }],
          });
          messagesToPersist.push(toolUseMessage);
          broadcastMessageEnvelope(sessionId, loaded.state, toolUseMessage);
          toolInputsById.set(event.id, event.input);
          realtimeBroadcastedIds.add(`tool-call-${event.id}`);
        } else if (event.type === "tool_result") {
          const statusSession = { ...buildServerFirstSession(loaded.session, loaded.state), narratorState: "working" as const, substatus: "thinking" as const, turnStartedAt: turnStartedAtIso };
          broadcastToAll(loaded.state, serializeEnvelope({ type: "session:state", session: statusSession, cursor: createCursor(loaded.state) }));

          // 回写原始 tool_call 消息的 status（解决页面刷新后残留 running 的问题）
          const completedStatus = buildToolResultStatus(event.result);
          for (const msg of loaded.state.messages) {
            if (msg.toolCalls?.some((tc) => tc.id === event.id && tc.status === "running")) {
              msg.toolCalls = msg.toolCalls.map((tc) =>
                tc.id === event.id ? { ...tc, status: completedStatus, duration: event.result.durationMs } : tc,
              );
              break;
            }
          }

          // 实时推送 tool_result 消息到前端（不等 turn 结束）
          const toolUse = { id: event.id, toolName: event.toolName, input: toolInputsById.get(event.id) ?? {} };
          const messageId = `${userMessage.id}-tool-result-${event.id}`;
          const toolResult = normalizeToolResultConfirmation(event.result, { sessionId, messageId, toolUseId: event.id, input: toolUse.input });
          const toolResultMessage = appendMessageToState(loaded.state, {
            id: messageId,
            role: "assistant",
            content: toolResult.summary,
            timestamp: timestamp + messagesToPersist.length,
            runtime: event.runtime,
            toolCalls: [buildToolResultCall(toolUse, toolResult)],
            metadata: buildToolResultMetadata(toolResult),
          });
          messagesToPersist.push(toolResultMessage);
          broadcastMessageEnvelope(sessionId, loaded.state, toolResultMessage);
          realtimeBroadcastedIds.add(`tool-result-${event.id}`);
        }
      },
      signal: combinedSignal,
      generate: async (generateInput): Promise<AgentGenerateResult> => {
        const result = await generateSessionReply({
          sessionConfig: generateInput.sessionConfig,
          messages: generateInput.messages,
          tools: generateInput.tools,
          onStreamChunk: generateInput.onStreamChunk,
          onToolEvent: generateInput.onToolEvent,
          onRetry: (_attempt, _max) => {
            const retrySession = { ...buildServerFirstSession(loaded.session, loaded.state), narratorState: "working" as const, substatus: "retrying" as const, turnStartedAt: turnStartedAtIso };
            broadcastToAll(loaded.state, serializeEnvelope({ type: "session:state", session: retrySession, cursor: createCursor(loaded.state) }));
          },
          signal: generateInput.signal,
        });
        // Record provider health
        const providerId = (result as any).metadata?.providerId ?? generateInput.sessionConfig.providerId ?? "unknown";
        const modelId = (result as any).metadata?.modelId ?? generateInput.sessionConfig.modelId ?? "unknown";
        if ((result as any).success) {
          providerHealth.recordSuccess(providerId, modelId);
        } else {
          const errorCode = classifyError((result as any).error);
          providerHealth.recordFailure(providerId, modelId, errorCode);
        }
        return result as AgentGenerateResult;
      },
      executeTool: (toolInput) => {
        const onToolOutputStream = toolInput.toolCallId
          ? (chunk: string) => {
              const envelope = { type: "session:tool-stream" as const, sessionId: loaded.session.id, toolCallId: toolInput.toolCallId!, content: chunk };
              broadcastToAll(loaded.state, serializeEnvelope(envelope as any));
            }
          : undefined;
        const enrichedInput = { ...toolInput, onToolOutputStream };
        const sessionWorkDir = loaded.session.worktree?.trim() || undefined;
        const sessionProjectId = (loaded.session as { projectId?: string }).projectId || undefined;
        const onSubstatus = (substatus: string) => {
          const statusSession = { ...buildServerFirstSession(loaded.session, loaded.state), narratorState: "working" as const, substatus: substatus as "reflecting", turnStartedAt: turnStartedAtIso };
          broadcastToAll(loaded.state, serializeEnvelope({ type: "session:state", session: statusSession, cursor: createCursor(loaded.state) }));
        };
        return createSessionToolExecutor({ ...sessionToolExecutorOptions, workDir: sessionWorkDir, projectId: sessionProjectId, onSubstatus }).execute(enrichedInput);
      },
    });
    const runtimeEvents = runtimeTurn.agentEvents;
    canonicalEvents = runtimeTurn.runtimeEvents;
    clearSessionAbortController(sessionId);

    let assistantIndex = 0;
    for (const event of runtimeEvents) {
      if (event.type === "assistant_message") {
        accumulateUsage(loaded.state.cumulativeUsage, event.runtime?.usage);
        const assistantMessage = appendMessageToState(loaded.state, {
          id: assistantIndex === 0 ? `${userMessage.id}-assistant` : `${userMessage.id}-assistant-${assistantIndex + 1}`,
          role: "assistant",
          content: event.content,
          reasoning_content: event.reasoningContent,
          timestamp: timestamp + messagesToPersist.length,
          runtime: event.runtime,
          ...(event.runtime?.usage ? { metadata: { usage: event.runtime.usage } } : {}),
        });
        assistantIndex += 1;
        messagesToPersist.push(assistantMessage);
        broadcastMessageEnvelope(sessionId, loaded.state, assistantMessage);
        continue;
      }

      if (event.type === "tool_call") {
        // 如果已在 onEvent 中实时广播，跳过
        if (realtimeBroadcastedIds.has(`tool-call-${event.id}`)) continue;
        toolInputsById.set(event.id, event.input);
        const toolUseMessage = appendMessageToState(loaded.state, {
          id: `${userMessage.id}-tool-use-${event.id}`,
          role: "assistant",
          content: `请求调用工具 ${event.toolName}。`,
          timestamp: timestamp + messagesToPersist.length,
          runtime: event.runtime,
          toolCalls: [
            {
              id: event.id,
              toolName: event.toolName,
              input: event.input,
            },
          ],
        });
        messagesToPersist.push(toolUseMessage);
        broadcastMessageEnvelope(sessionId, loaded.state, toolUseMessage);
        continue;
      }

      if (event.type === "tool_result") {
        // 如果已在 onEvent 中实时广播，跳过
        if (realtimeBroadcastedIds.has(`tool-result-${event.id}`)) continue;
        const toolUse = {
          id: event.id,
          toolName: event.toolName,
          input: toolInputsById.get(event.id) ?? {},
        };
        const messageId = `${userMessage.id}-tool-result-${event.id}`;
        const toolResult = normalizeToolResultConfirmation(event.result, {
          sessionId,
          messageId,
          toolUseId: event.id,
          input: toolUse.input,
        });
        const toolResultMessage = appendMessageToState(loaded.state, {
          id: messageId,
          role: "assistant",
          content: toolResult.summary,
          timestamp: timestamp + messagesToPersist.length,
          runtime: event.runtime,
          toolCalls: [buildToolResultCall(toolUse, toolResult)],
          metadata: buildToolResultMetadata(toolResult),
        });
        messagesToPersist.push(toolResultMessage);
        broadcastMessageEnvelope(sessionId, loaded.state, toolResultMessage);
        continue;
      }

      if (event.type === "confirmation_required") {
        continue;
      }

      if (event.type === "streaming_chunk") {
        continue;
      }

      if (event.type === "turn_failed") {
        failure = {
          reason: event.reason,
          message: event.message,
          at: new Date().toISOString(),
        };

        if (event.reason === "model-unavailable" || event.reason === "provider-unavailable" || event.reason === "unsupported-tools") {
          const metadata = event.data?.metadata as Partial<LlmRuntimeMetadata> | undefined;
          errorEnvelope = createSessionChatError(sessionId, event.message, {
            code: event.reason,
            ...(metadata ? { runtime: metadata } : {}),
          });
        } else {
          const assistantMessage = appendMessageToState(loaded.state, {
            id: `${userMessage.id}-${event.reason}`,
            role: "assistant",
            content: event.message,
            timestamp: timestamp + messagesToPersist.length,
            metadata: event.reason === "tool-loop-limit" ? {
              toolLoop: {
                error: "tool-loop-limit",
                maxSteps: event.data?.maxSteps,
              },
            } : undefined,
          });
          messagesToPersist.push(assistantMessage);
          broadcastMessageEnvelope(sessionId, loaded.state, assistantMessage);
        }
        break;
      }
    }
  } catch (error) {
    let message = error instanceof Error ? error.message : "LLM runtime request failed";
    // 区分首 token 超时和其他错误
    if (error instanceof Error && (error.name === "TimeoutError" || message.includes("timeout"))) {
      message = `API 响应超时。可在设置 → AI 代理 → 首 token 超时中调整超时时间，或检查网络连接。`;
    } else if (error instanceof Error && message.includes("aborted")) {
      message = "已中断。";
    }
    failure = {
      reason: "provider-unavailable",
      message,
      at: new Date().toISOString(),
    };
    errorEnvelope = createSessionChatError(sessionId, message, {
      code: "provider-unavailable",
      runtime: {
        providerId: loaded.session.sessionConfig.providerId,
        modelId: loaded.session.sessionConfig.modelId,
      },
    });
  }

  const transcriptMessagesToPersist = attachRuntimeTranscriptToMessages(messagesToPersist, canonicalEvents);
  const updatedSession = await persistSessionChatProgress(sessionId, loaded.session, loaded.state, transcriptMessagesToPersist, failure);
  if (errorEnvelope) {
    sendEnvelope(transport, errorEnvelope);
  }

  if (updatedSession) {
    broadcastStateEnvelope(buildServerFirstSession(updatedSession, loaded.state), loaded.state);
  }

  // 推送 idle 状态（turn 结束）
  const lastTurnDurationMs = Date.now() - turnStartedAt;
  const wasAborted = abortControllerBySessionId.get(sessionId) === undefined && failure?.reason !== "provider-unavailable";
  const idleSubstatus = (failure && !wasAborted) ? undefined : (wasAborted && !failure ? "interrupted" as const : undefined);
  const idleSession = { ...buildServerFirstSession(loaded.session, loaded.state), narratorState: "idle" as const, lastTurnDurationMs, ...(idleSubstatus ? { substatus: idleSubstatus } : {}) };
  broadcastToAll(loaded.state, serializeEnvelope({ type: "session:state", session: idleSession, cursor: createCursor(loaded.state) }));

  // --- TurnComplete hooks (fire-and-forget) ---
  void (async () => {
    try {
      const { executeHook, getMatchingHooks, convertRoutineHooks } = await import("./hook-executor.js");
      const config = await loadUserConfig();
      const routines = await loadGlobalRoutines();
      const hooks = [...(config.runtimeControls?.hooks ?? []), ...convertRoutineHooks(routines.hooks)];
      const turnHooks = getMatchingHooks(hooks, "TurnComplete", "");
      if (turnHooks.length === 0) return;
      const workDir = loaded.session.worktree?.trim() || process.cwd();
      for (const hook of turnHooks) {
        await executeHook(hook, { toolName: "", workDir });
      }
    } catch { /* TurnComplete hook failure is non-fatal */ }
  })();

  // --- Webhook notification (fire-and-forget) ---
  void (async () => {
    try {
      const config = await loadUserConfig();
      const notifications = (config.preferences as unknown as Record<string, unknown>)?.notifications as
        | { dingtalk?: { enabled?: boolean; webhookUrl?: string }; feishu?: { enabled?: boolean; webhookUrl?: string } }
        | undefined;
      if (!notifications) return;
      const urls: string[] = [];
      if (notifications.dingtalk?.enabled && notifications.dingtalk.webhookUrl) {
        urls.push(notifications.dingtalk.webhookUrl);
      }
      if (notifications.feishu?.enabled && notifications.feishu.webhookUrl) {
        urls.push(notifications.feishu.webhookUrl);
      }
      if (urls.length === 0) return;

      const body = JSON.stringify({
        msgtype: "text",
        text: { content: `[NovelFork] 叙述者已完成任务：${loaded.session.title}` },
      });

      for (const url of urls) {
        await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {});
      }
    } catch { /* webhook notification failure is non-fatal */ }
  })();

  // 翻译思考内容：异步翻译 assistant 消息中的 thinking/reasoning block
  const assistantMessages = messagesToPersist.filter((m) => m.role === "assistant");
  if (assistantMessages.length > 0) {
    void (async () => {
      try {
        const config = await loadUserConfig();
        if (!config.runtimeControls?.translateThinking) return;
        const summaryModel = config.modelDefaults?.summaryModel;
        if (!summaryModel) return;

        for (const msg of assistantMessages) {
          const result = await translateThinkingBlocks(msg.content, {
            summaryModel,
            targetLanguage: "zh",
          });
          if (result.hasThinkingBlocks && result.translatedContent !== result.originalContent) {
            msg.metadata = { ...msg.metadata, thinkingTranslation: result.translatedContent };
            broadcastMessageEnvelope(sessionId, loaded.state, msg);
          }
        }
      } catch { /* thinking translation failure is non-fatal */ }
    })();
  }

  // 自动命名：第一轮对话且标题为默认值时，异步生成标题
  const hasAssistantReply = messagesToPersist.some((m) => m.role === "assistant");
  const userMessageCount = loaded.state.messages.filter((m) => m.role === "user").length;
  const currentTitle = loaded.session.title;
  const needsAutoTitle = hasAssistantReply
    && userMessageCount <= 1
    && (currentTitle === "Untitled Session" || currentTitle.startsWith("Headless:"));
  if (needsAutoTitle) {
    void generateSessionTitle(loaded.state.messages).then((title) => {
      if (title && title !== "Untitled Session") {
        void updateSession(sessionId, { title });
      }
    }).catch(() => { /* auto-title failure is non-fatal */ });
  }

  // ─── Buffered Message Queue: drain after turn completes ─────────────────────
  void drainSessionQueue(sessionId).catch((err) => {
    console.log(JSON.stringify({ component: "session-chat", event: "drain-queue-unhandled-error", sessionId, error: err instanceof Error ? err.message : "unknown" }));
    sessionBusy.delete(sessionId);
  });
}

async function drainSessionQueue(sessionId: string): Promise<void> {
  const queue = sessionMessageQueue.get(sessionId);
  if (!queue || queue.length === 0) {
    sessionBusy.delete(sessionId);
    return;
  }

  const next = queue.shift()!;
  if (queue.length === 0) {
    sessionMessageQueue.delete(sessionId);
  }

  console.log(JSON.stringify({ component: "session-chat", event: "message-dequeued", sessionId, queueLength: queue.length }));

  // NOTE: Do NOT clear sessionBusy here — we stay busy while processing the queued message.
  // The drain will be called again at the end of handleSessionChatTransportMessage.
  // We use a special internal flag to bypass the busy check on re-entry.
  try {
    const syntheticPayload = JSON.stringify({ type: "session:message", content: next.content, messageId: next.messageId, _fromQueue: true });
    await handleSessionChatTransportMessage(sessionId, next.transport, syntheticPayload);
  } catch (error) {
    console.log(JSON.stringify({ component: "session-chat", event: "drain-queue-error", sessionId, error: error instanceof Error ? error.message : "unknown" }));
    // On error, release the busy lock so the session isn't permanently stuck
    sessionBusy.delete(sessionId);
  }
}

function buildGoalsPromptSection(goals?: Array<{ id: string; objective: string; status: string }>): string {
  const activeGoals = goals?.filter(g => g.status === "active") ?? [];
  if (activeGoals.length === 0) return "";
  return `\n\n## 当前目标\n\n${activeGoals.map((g, i) => `${i + 1}. ${g.objective}`).join("\n")}\n\n请优先推进以上目标。`;
}

const AGENT_NATIVE_WRITE_NEXT_INSTRUCTIONS = `

## Agent-native 写下一章链路
当用户请求「写下一章」「生成下一章」或 write next 时，必须按顺序推进：cockpit.get_snapshot → pgi.generate_questions → AskUserQuestion → pipeline.generate_chapter。
- PGI 无问题时也要明确说明 skippedReason=no-questions，并继续形成本章作者指示。
- 必须等待用户通过 AskUserQuestion 确认方向；用户拒绝或要求修改时不得调用 pipeline.generate_chapter。
- 批准后才允许调用 pipeline.generate_chapter，结果只进入候选稿并通过 artifact 在中间画布打开。
- candidate.create_chapter 仅用于保存已有正文为候选稿，不是写下一章主链路；不得用它替代 pipeline.generate_chapter 生成完整章节。
- 任一步失败时停止后续写入，展示失败原因，并保留已完成的只读调查结果。`;

const SESSION_CHAT_WS_PATH = "/api/sessions/:id/chat";
const SESSION_CHAT_PATHNAME_REGEX = /^\/api\/sessions\/([^/]+)\/chat$/;

function parseSessionChatUrl(url: URL): { sessionId: string; resumeFromSeq: number | undefined } | null {
  const match = url.pathname.match(SESSION_CHAT_PATHNAME_REGEX);
  if (!match) return null;
  const sessionId = decodeURIComponent(match[1]!);
  const resumeFromSeq = sanitizeSeq(url.searchParams.get("resumeFromSeq"));
  return { sessionId, resumeFromSeq };
}

function isBunWebSocketRegistrar(server: StartedHttpServer): server is BunWebSocketRegistrar {
  return typeof server === "object" && server !== null && "runtime" in server && server.runtime === "bun";
}

function latestCanvasContextFromMessages(messages: readonly NarratorSessionChatMessage[]): CanvasContext | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const canvasContext = messages[index]?.metadata?.canvasContext;
    if (canvasContext) return canvasContext;
  }
  return undefined;
}

function formatCanvasContextForPrompt(canvasContext: CanvasContext): string {
  const lines = ["## 当前画布上下文"];
  if (canvasContext.activeTabId) lines.push(`- activeTabId: ${canvasContext.activeTabId}`);
  if (canvasContext.activeResource) {
    const resourceParts = [
      `kind=${canvasContext.activeResource.kind}`,
      `id=${canvasContext.activeResource.id}`,
      canvasContext.activeResource.bookId ? `bookId=${canvasContext.activeResource.bookId}` : null,
      canvasContext.activeResource.title ? `title=${canvasContext.activeResource.title}` : null,
      canvasContext.activeResource.path ? `path=${canvasContext.activeResource.path}` : null,
    ].filter((part): part is string => Boolean(part));
    lines.push(`- activeResource: ${resourceParts.join(", ")}`);
  }
  lines.push(`- dirty: ${canvasContext.dirty === true ? "true" : "false"}`);
  if (canvasContext.selection?.text) lines.push(`- selection: ${canvasContext.selection.text}`);
  if (canvasContext.openTabs?.length) {
    lines.push(`- openTabs: ${canvasContext.openTabs.map((tab) => `${tab.title}(${tab.kind}${tab.dirty ? ", dirty" : ""})`).join("；")}`);
  }
  lines.push("- 注意：dirty=true 表示作者有未保存编辑，任何写入类工具都必须先要求作者处理该资源；当前上下文不会包含未保存正文全文。");
  return lines.join("\n");
}

export function setupSessionChatWebSocket(server: StartedHttpServer): void {
  if (isBunWebSocketRegistrar(server)) {
    const sockets = new WeakMap<BunWebSocketConnection, SessionChatTransport>();

    server.registerWebSocketRoute({
      path: SESSION_CHAT_WS_PATH,
      matchPath(pathname) {
        return SESSION_CHAT_PATHNAME_REGEX.test(pathname);
      },
      upgrade(request, bunServer) {
        const url = new URL(request.url);
        const parsed = parseSessionChatUrl(url);
        if (!parsed) return false;
        return bunServer.upgrade(request, {
          data: {
            routePath: SESSION_CHAT_WS_PATH,
            sessionId: parsed.sessionId,
            resumeFromSeq: parsed.resumeFromSeq,
          },
        });
      },
      open(socket) {
        const data = socket.data ?? {};
        const sessionId = typeof data.sessionId === "string" ? data.sessionId : null;
        if (!sessionId) {
          socket.close(4000, "missing sessionId");
          return;
        }
        const resumeFromSeq = typeof data.resumeFromSeq === "number" ? data.resumeFromSeq : undefined;
        const transport: SessionChatTransport = {
          send: (payload: string) => socket.send(payload),
          close: (code?: number, reason?: string) => socket.close(code, reason),
        };
        sockets.set(socket, transport);
        void (async () => {
          const attached = await attachSessionChatTransport(sessionId, transport, { resumeFromSeq });
          if (!attached) {
            sockets.delete(socket);
          }
        })();
      },
      message(socket, message) {
        const transport = sockets.get(socket);
        if (!transport) return;
        const sessionId = typeof socket.data?.sessionId === "string" ? socket.data.sessionId : null;
        if (!sessionId) return;
        void handleSessionChatTransportMessage(sessionId, transport, message);
      },
      close(socket) {
        const transport = sockets.get(socket);
        sockets.delete(socket);
        const sessionId = typeof socket.data?.sessionId === "string" ? socket.data.sessionId : null;
        if (transport && sessionId) {
          detachSessionChatTransport(sessionId, transport);
        }
      },
      error(socket) {
        const transport = sockets.get(socket);
        sockets.delete(socket);
        const sessionId = typeof socket.data?.sessionId === "string" ? socket.data.sessionId : null;
        if (transport && sessionId) {
          detachSessionChatTransport(sessionId, transport);
        }
      },
    });

    return;
  }

  const httpServer = server as NodeHttpServer;
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const parsed = parseSessionChatUrl(url);
    if (!parsed) {
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      void bindNodeSessionChatConnection(parsed.sessionId, ws, { resumeFromSeq: parsed.resumeFromSeq });
    });
  });
}

async function bindNodeSessionChatConnection(
  sessionId: string,
  ws: NodeWebSocket,
  options: AttachSessionChatTransportOptions,
): Promise<void> {
  const transport: SessionChatTransport = {
    send: (data: string) => ws.send(data),
    close: (code?: number, reason?: string) => ws.close(code, reason),
  };

  const attached = await attachSessionChatTransport(sessionId, transport, options);
  if (!attached) {
    return;
  }

  ws.on("message", (data) => {
    void handleSessionChatTransportMessage(sessionId, transport, data);
  });

  ws.on("close", () => {
    detachSessionChatTransport(sessionId, transport);
  });

  ws.on("error", () => {
    detachSessionChatTransport(sessionId, transport);
  });
}
