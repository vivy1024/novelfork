import type { Server as NodeHttpServer } from "node:http";
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { WebSocketServer, type RawData, type WebSocket as NodeWebSocket } from "ws";

import type {
  BunWebSocketConnection,
  BunWebSocketRegistrar,
  BunWebSocketRoute,
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
  NarratorSessionTodosUpdatedEnvelope,
  SessionCumulativeUsage,
  SessionTodoItem,
  TokenUsage,
  ToolCall,
} from "../../shared/session-types.js";
import { log } from "./logger.js";
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
import {
  SessionTurnGate,
  SessionTurnGateDisposedError,
  type TurnLease,
} from "./session-runtime/turn-gate.js";
import { getRuntimeSettlement } from "./session-runtime/runtime-settlement.js";
import { trackSessionRuntimeFollowUp } from "./session-runtime/follow-up-tracker.js";
import { isServerDraining } from "./session-runtime/shutdown-coordinator.js";
import { generateSessionReply, type LlmRuntimeMetadata } from "./llm-runtime-service.js";
import type { RuntimeToolStreamEvent } from "./provider-adapters/index.js";
import { getSessionById, updateSession } from "./session-service.js";
import { buildAgentContext, buildProjectExplorationContext } from "./agent-context.js";
import {
  buildSystemPrompt,
  getIdentitySection,
  renderSectionsToString,
} from "./system-prompt-builder.js";
import { createSessionToolExecutor, type SessionToolExecutorOptions } from "./session-tool-executor.js";
import { getEnabledSessionTools, NOVEL_CORE_TOOLS } from "./session-tool-registry.js";
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
import { microCompact, type MicroCompactResult } from "./compact/micro-compact.js";
import { translateThinkingBlocks } from "./thinking-translator.js";
import { autoCompact, detectCompactionAction, selectThresholds, COMPACT_SYSTEM_PROMPT, buildCompactPrompt, type CompactMessage } from "./context-compaction.js";
import { estimateTokenCount, getContextTokensFromUsage } from "./token-utils.js";
import { getUnfinishedCheckpoints, clearSessionCheckpoints } from "./turn-checkpoint.js";
import { ProviderHealthManager, classifyError } from "./provider-health-manager.js";
import { createContextBudgetManager } from "./context-budget-manager.js";
import { getGlobalSearchIndex } from "./search-index.js";
import { destroySessionHub } from "./peer-messaging.js";

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
    .map((m) => {
      let extraTokens = 0;
      if (m.toolCalls?.length) {
        for (const tc of m.toolCalls) {
          if (tc.input) extraTokens += estimateTokenCount(JSON.stringify(tc.input));
          if (tc.result) extraTokens += estimateTokenCount(JSON.stringify(tc.result));
        }
      }
      return {
        id: m.id,
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
        ...(extraTokens > 0 ? { extraTokens } : {}),
        ...(m.toolCalls?.length ? { toolCalls: m.toolCalls.filter((tc) => tc.id).map((tc) => ({ id: tc.id!, toolName: tc.toolName })) } : {}),
      };
    });

  // Prefer API-reported lastInputTokens (precise) over character-based estimation.
  // Use the HIGHER of the two to be conservative and avoid 413 errors.
  const apiReportedTokens = state.cumulativeUsage?.lastInputTokens;
  const estimatedTokens = estimateTokenCount(compactMessages.map(m => m.content).join("")) + compactMessages.reduce((s, m) => s + (m.extraTokens ?? 0), 0);
  const effectiveTokens = apiReportedTokens && apiReportedTokens > 0
    ? Math.max(apiReportedTokens, estimatedTokens)
    : undefined;

  const action = detectCompactionAction(compactMessages, maxContextTokens, thresholds, effectiveTokens);
  if (action === "none") {
    // Only run microCompact if context usage exceeds 40% — for large windows (1M+),
    // premature folding destroys valuable conversation history that the model can still use.
    const currentUsageRatio = (effectiveTokens ?? estimatedTokens) / maxContextTokens;
    if (currentUsageRatio >= 0.40) {
      const lastAssistantTs = findLastAssistantTimestamp(messages);
      const mcResult = microCompact(sessionMessagesToTurnItems(messages), { lastAssistantTimestamp: lastAssistantTs });
      const items = mcResult.items;
      if (mcResult.foldedCount > 0) {
        items.unshift({
          type: "message",
          role: "system",
          content: `[上下文提醒] 本次对话有 ${mcResult.foldedCount} 条旧工具结果已折叠以节约空间。如需查阅历史设定/章节内容，请主动调用 jingwei.read 或 chapter.read 重新获取。`,
        });
      }
      return { items, compacted: false };
    }
    // Between 20% and 40%: apply context collapse (selective segment folding)
    // This preserves recent history while freeing space from stale old segments
    if (currentUsageRatio >= 0.20 && messages.length > 30) {
      const { collapseStaleSegments } = await import("./compact/context-collapse.js");
      const items = sessionMessagesToTurnItems(messages);
      const collapseResult = collapseStaleSegments(items);
      if (collapseResult.collapsedSegments > 0) {
        log.info("Context collapse", { segments: collapseResult.collapsedSegments, freed: collapseResult.freedMessages, usageRatio: Math.round(currentUsageRatio * 100) });
      }
      return { items: collapseResult.items, compacted: false };
    }
    // Under 20% usage: pass messages through completely unmodified
    return { items: sessionMessagesToTurnItems(messages), compacted: false };
  }

  try {
    await broadcastCompactProgress(sessionId, "cascade", 10, "开始级联压缩…");
    const result = await autoCompact({
      messages: compactMessages,
      maxContextTokens,
      thresholds,
      sessionId,
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

      // Post-compact 状态恢复：Todos + Goals
      const session = await getSessionById(sessionId);
      if (session) {
        const restoreParts: string[] = [];
        // 恢复未完成 Todos
        const pendingTodos = (session.todos ?? []).filter((t: { status: string }) => t.status !== "completed");
        if (pendingTodos.length > 0) {
          restoreParts.push("待办事项:\n" + pendingTodos.map((t: { status: string; content: string }) =>
            `- [${t.status === "in_progress" ? "→" : "○"}] ${t.content}`
          ).join("\n"));
        }
        // 恢复活跃 Goals
        const activeGoals = (session.goals ?? []).filter((g: { status: string }) => g.status === "active");
        if (activeGoals.length > 0) {
          restoreParts.push("当前目标:\n" + activeGoals.map((g: { objective: string }) => `- ${g.objective}`).join("\n"));
        }
        if (restoreParts.length > 0) {
          compactedItems.push({
            type: "message",
            role: "system",
            content: `[上下文压缩后状态恢复]\n${restoreParts.join("\n\n")}`,
          });
        }
      }

      // Task 13: 压缩成功后抑制下一轮的压缩警告，并广播压缩完成事件
      compactWarningSuppressed.add(sessionId);
      broadcastToAll(sessionId, state, serializeEnvelope({
        type: "session:compacted",
        sessionId,
        data: { postCompactTokens: result.postCompactTokens },
      } as any));

      return { items: compactedItems, compacted: true };
    }
  } catch {
    // Compaction failure is non-fatal — circuit breaker counter is managed
    // inside autoCompact itself (per-session), so nothing to do here.
  }

  const mcFallback = microCompact(sessionMessagesToTurnItems(messages), { lastAssistantTimestamp: findLastAssistantTimestamp(messages) });
  const fallbackItems = mcFallback.items;
  if (mcFallback.foldedCount > 0) {
    fallbackItems.unshift({
      type: "message",
      role: "system",
      content: `[上下文提醒] 本次对话有 ${mcFallback.foldedCount} 条旧工具结果已折叠以节约空间。如需查阅历史设定/章节内容，请主动调用 jingwei.read 或 chapter.read 重新获取。`,
    });
  }
  return { items: fallbackItems, compacted: false };
}

const providerRuntimeStore = new ProviderRuntimeStore();

/**
 * 从 session 的 provider/model 配置解析上下文窗口大小（tokens）。
 * 用于 Budget Pressure 等需要 context window 的场景。失败回退默认值。
 */
async function resolveModelContextWindow(sessionConfig?: { providerId?: string; modelId?: string }): Promise<number> {
  try {
    if (sessionConfig?.providerId) {
      const provider = await providerRuntimeStore.getProvider(sessionConfig.providerId);
      if (provider?.models?.length) {
        const model = provider.models.find((m) => m.id === sessionConfig.modelId) ?? provider.models[0];
        if (model?.contextWindow && model.contextWindow > 0) return model.contextWindow;
      }
    }
  } catch { /* fallback */ }
  return DEFAULT_MODEL_CONTEXT_WINDOW;
}


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
  // 这些结果没有可安全继续的运行时：异常执行是失败终态，停止超时仍有真实资源在 stopping。
  if (result.error === "tool-execution-error" || result.error === "stop-timeout") return false;
  // 成功或确认被拒绝 — 继续
  if (result.ok || result.error === "confirmation-rejected") return true;
  // 普通业务工具失败仍交给模型决定下一步，agent-turn-runtime 内部已有重复检测。
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
    log.info("Startup recovery: found unfinished checkpoints", {
      msg: `Found ${checkpoints.length} unfinished checkpoint(s) across ${sessionIds.length} session(s)`,
      sessionIds,
    });

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
        log.warn("Startup recovery: failed to mark session as interrupted", {
          sessionId,
        });
      }
    }
  } catch (error) {
    log.error("Startup recovery failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
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
  // 记录最后一次请求的上下文占用 = 四字段全算（input + cache_creation + cache_read + output）。
  // 对齐 Claude-Code / Codex / LegnaCLI：上一轮 output 会成为下一轮 input 的一部分，
  // 必须计入才能正确预判占用，否则压缩判断严重低估（该压缩时不压缩 → 撞 413）。
  if (usage.input_tokens != null) {
    cumulative.lastInputTokens = getContextTokensFromUsage(usage);
    cumulative.lastOutputTokens = (usage.output_tokens ?? 0); // 写入但当前无消费方（前端/逻辑均未读取），保留供后续指标统计用
  }
}
interface SessionTurnMessageData {
  readonly content: string;
  readonly messageId: string;
  readonly canvasContext?: CanvasContext;
  readonly attachments?: Array<{ type: "image"; mimeType: string; data: string; fileName?: string }>;
}

interface SessionTurnItem {
  readonly transport: SessionChatTransport;
  readonly message: SessionTurnMessageData;
}

type TurnCompletionReason = "completed" | "aborted" | "failed" | "stopping";

interface SessionTurnOutcome {
  readonly completionReason: TurnCompletionReason;
  readonly failure?: NarratorSessionRecoveryMetadata["lastFailure"];
}

function resolveTurnCompletionReason(
  signal: AbortSignal,
  failure: NarratorSessionRecoveryMetadata["lastFailure"] | undefined,
): TurnCompletionReason {
  if (failure?.reason === "stop-timeout") return "stopping";
  if (failure?.reason === "timeout") return "failed";
  if (signal.aborted) return "aborted";
  if (failure) return "failed";
  return "completed";
}

const sessionTurnGate = new SessionTurnGate<SessionTurnItem>({
  onRunError: ({ sessionId, error }) => {
    // Runners own user-visible terminal envelopes. The gate observer is only a
    // diagnostic fallback for a failure that escaped that terminal boundary.
    const message = error instanceof Error ? error.message : "Session turn failed";
    log.error("Session turn runner escaped terminal handling", { sessionId, error: message });
  },
});
const compactWarningSuppressed = new Set<string>();

export function isCompactWarningSuppressed(sessionId: string): boolean {
  return compactWarningSuppressed.has(sessionId);
}

function abortSession(sessionId: string): void {
  if (sessionTurnGate.requestAbort(sessionId)) {
    log.info("Session abort", { sessionId });
  }
}

/**
 * Removes one disconnected transport and only its queued server-owned turns.
 * The active lease is intentionally left to settle through the gate lifecycle.
 */
function dropSessionTransport(
  sessionId: string,
  state: SessionChatRuntimeState,
  transport: SessionChatTransport,
): void {
  state.transports.delete(transport);
  const cancellations = sessionTurnGate.cancelQueued(
    sessionId,
    (item) => item.transport === transport,
    "transport-disconnected",
  );

  if (cancellations.length > 0) {
    log.info("Disconnected transport queue cancelled", { sessionId, cancelledCount: cancellations.length });
  }

  if (state.transports.size === 0 && state.messages.length === 0 && !sessionTurnGate.hasActive(sessionId)) {
    runtimeStateBySessionId.delete(sessionId);
    destroySessionHub(sessionId);
  }
}

function sendSessionEnvelopeToTransport(
  sessionId: string,
  state: SessionChatRuntimeState,
  transport: SessionChatTransport,
  envelope: NarratorSessionChatServerEnvelope,
): boolean {
  const delivered = sendEnvelope(transport, envelope);
  if (!delivered) {
    dropSessionTransport(sessionId, state, transport);
  }
  return delivered;
}

function sendRuntimeSessionEnvelope(
  sessionId: string,
  transport: SessionChatTransport,
  envelope: NarratorSessionChatServerEnvelope,
): boolean {
  const state = runtimeStateBySessionId.get(sessionId);
  return state
    ? sendSessionEnvelopeToTransport(sessionId, state, transport, envelope)
    : sendEnvelope(transport, envelope);
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
      dropSessionTransport(sessionId, state, transport);
    }
  }
}

function broadcastToAll(sessionId: string, state: SessionChatRuntimeState, payload: string): void {
  for (const transport of state.transports.keys()) {
    try {
      transport.send(payload);
    } catch {
      dropSessionTransport(sessionId, state, transport);
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
      dropSessionTransport(sessionId, state, transport);
    }
  }
}

function broadcastStateEnvelope(
  session: NarratorSessionRecord,
  state: SessionChatRuntimeState,
  recovery?: NarratorSessionRecoveryEnvelope,
): void {
  for (const [transport, transportState] of state.transports.entries()) {
    sendSessionEnvelopeToTransport(
      session.id,
      state,
      transport,
      createSessionChatStateEnvelope(session, state, transportState.ackedSeq, recovery),
    );
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
      log.error("Failed to save attachment", { error: e instanceof Error ? e.message : String(e) });
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

/**
 * Index a persisted message into the global search index (non-blocking).
 * Only indexes user/assistant messages with non-empty content.
 */
function indexMessageToSearch(sessionId: string, message: NarratorSessionChatMessage): void {
  try {
    if (message.role !== "user" && message.role !== "assistant") return;
    if (!message.content || !message.content.trim()) return;
    getGlobalSearchIndex().index({
      id: `msg:${sessionId}:${message.id}`,
      type: "message",
      title: `${message.role} message`,
      content: message.content,
      bookId: "",
      timestamp: message.timestamp ?? Date.now(),
      metadata: { sessionId, role: message.role, seq: message.seq },
    });
  } catch {
    // Indexing failure must not affect message persistence
  }
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

  // Index persisted messages into search index (fire-and-forget)
  for (const msg of messages) {
    indexMessageToSearch(sessionId, msg);
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
    let contextMessages = contextCutoffSeq > 0
      ? loaded.state.messages.filter((m) => (m.seq ?? 0) > contextCutoffSeq)
      : [...loaded.state.messages];
    // Skip orphaned tool_result messages at the start (no preceding tool_call after cutoff)
    while (contextMessages.length > 0) {
      const first = contextMessages[0];
      if (first.role === "assistant" && first.toolCalls?.length && (first.metadata as any)?.toolResult) {
        contextMessages = contextMessages.slice(1);
      } else {
        break;
      }
    }
    const { items: compactedMessages } = await maybeAutoCompact(contextMessages, loaded.state, loaded.session.id);
    const continuationRoutinePrompts = await loadRoutineGlobalPrompts();
    const continuationToolNames = getEnabledSessionTools(loaded.session.sessionConfig.permissionMode, loaded.session.agentId, { disabledTools: loaded.session.sessionConfig.toolPolicy?.deny }).map(t => t.name);
    const continuationLangConfig = await loadUserConfig();
    const continuationLanguage = continuationLangConfig.runtimeControls?.forceUserLanguage !== false ? (continuationLangConfig.preferences?.language || "zh") : undefined;
    const continuationSections = buildSystemPrompt({
      agentId: loaded.session.agentId ?? "default",
      toolNames: continuationToolNames,
      identitySection: getIdentitySection(loaded.session.agentId),
      writeNextInstructions: AGENT_NATIVE_WRITE_NEXT_INSTRUCTIONS.trim(),
      goals: loaded.session.goals,
      routinePrompts: continuationRoutinePrompts,
      language: continuationLanguage,
    });
    const continuationContextWindow = await resolveModelContextWindow(loaded.session.sessionConfig);
    const runtimeTurn = await executeRuntimeTurn({
      sessionId: loaded.session.id,
      sessionConfig: loaded.session.sessionConfig,
      messages: compactedMessages,
      systemPrompt: renderSectionsToString(continuationSections),
      appendSystemPrompt: buildAppendSystemPrompt(loaded.session),
      context: createRuntimeContext(bookContext, canvasContext, loaded.session.worktree, continuationProjectContext),
      contextWindowTokens: continuationContextWindow,
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
          broadcastToAll(loaded.session.id, loaded.state, serializeEnvelope(envelope as any));
        }
        // tool_started is handled via onEvent tool_call broadcast
      },
      generate: async (generateInput): Promise<AgentGenerateResult> => {
        // 解析推理强度优先级所需的供应商/全局默认值
        const [provider, userConfig] = await Promise.all([
          providerRuntimeStore.getProvider(generateInput.sessionConfig.providerId),
          loadUserConfig(),
        ]);
        const result = await generateSessionReply({
          sessionConfig: generateInput.sessionConfig,
          messages: generateInput.messages,
          tools: generateInput.tools,
          onStreamChunk: generateInput.onStreamChunk,
          onToolEvent: generateInput.onToolEvent,
          onRetry: () => {
            const retrySession = { ...buildServerFirstSession(loaded.session, loaded.state), narratorState: "working" as const, substatus: "retrying" as const };
            broadcastToAll(loaded.session.id, loaded.state, serializeEnvelope({ type: "session:state", session: retrySession, cursor: createCursor(loaded.state) }));
          },
          signal: generateInput.signal,
          ...(generateInput.maxOutputTokensOverride ? { maxOutputTokensOverride: generateInput.maxOutputTokensOverride } : {}),
          // 推理强度三级优先级：叙述者会话 > 供应商默认 > 全局默认
          providerDefaultReasoningEffort: provider?.defaultReasoningEffort,
          globalDefaultReasoningEffort: userConfig.runtimeControls.defaultReasoningEffort,
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
              broadcastToAll(loaded.session.id, loaded.state, serializeEnvelope(envelope as any));
            }
          : undefined;
        const enrichedInput = { ...toolInput, onToolOutputStream };
        const sessionWorkDir = loaded.session.worktree?.trim() || undefined;
        const sessionProjectId = (loaded.session as { projectId?: string }).projectId || undefined;
        const onSubstatus = (substatus: string) => {
          const statusSession = { ...buildServerFirstSession(loaded.session, loaded.state), narratorState: "working" as const, substatus: substatus as "reflecting" };
          broadcastToAll(loaded.session.id, loaded.state, serializeEnvelope({ type: "session:state", session: statusSession, cursor: createCursor(loaded.state) }));
        };
        return createSessionToolExecutor({
          ...sessionToolExecutorOptions,
          workDir: sessionWorkDir,
          projectId: sessionProjectId,
          sessionId: loaded.session.id,
          executionSessionId: loaded.session.id,
          onSubstatus,
        }).execute(enrichedInput);
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
        accumulateUsage(loaded.state.cumulativeUsage, event.runtime?.usage);
        toolInputsById.set(event.id, event.input);
        const toolUseMessage = appendMessageToState(loaded.state, {
          id: `confirmation-tool-use-${event.id}-${nextTimestamp}`,
          role: "assistant",
          content: "",
          reasoning_content: event.reasoningContent,
          reasoning_signature: event.reasoningSignature,
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
          content: buildFullToolResultContent(toolResult, event.toolName),
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
    content: buildFullToolResultContent(toolResult, toolName),
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

  // Wrap continuation in try/catch to guarantee idle broadcast even on unexpected errors
  let serverFirstSession: NarratorSessionRecord;
  try {
    const failure = await appendModelContinuationAfterToolDecision(loaded, timestamp + 1);
    const updatedSession = await persistMergedSessionChatProgress(sessionId, loaded.session, loaded.state, failure);
    serverFirstSession = buildServerFirstSession(updatedSession ?? loaded.session, loaded.state);
  } catch (error) {
    log.error("confirmSessionToolDecision continuation failed", { sessionId, error: error instanceof Error ? error.message : String(error) });
    serverFirstSession = buildServerFirstSession(loaded.session, loaded.state);
  }
  // Always broadcast idle state after confirmation continuation completes (success or failure)
  // Without this, if the continuation fails or ends without an explicit idle broadcast,
  // the frontend stays stuck on "仍在执行中"
  const idleSession = { ...serverFirstSession, narratorState: "idle" as const };
  broadcastStateEnvelope(idleSession, loaded.state);

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

  // Re-index all messages into search index after state replacement
  for (const msg of normalizedMessages) {
    indexMessageToSearch(sessionId, msg);
  }

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
    sendSessionEnvelopeToTransport(
      sessionId,
      loaded.state,
      transport,
      createSessionChatStateEnvelope(serverFirstSession, loaded.state, transportState?.ackedSeq ?? 0, {
        state: "resetting",
        reason: "server-reset",
      }),
    );
    sendSessionEnvelopeToTransport(sessionId, loaded.state, transport, {
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
      dropSessionTransport(sessionId, loaded.state, transport);
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
      dropSessionTransport(sessionId, loaded.state, transport);
    }
  }
}

/** 向指定 session 的所有已连接 transport 广播 todos 更新事件 */
export async function broadcastTodosUpdated(
  sessionId: string,
  todos: SessionTodoItem[],
): Promise<void> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) return;
  const envelope: NarratorSessionTodosUpdatedEnvelope = {
    type: "session:todos-updated",
    sessionId,
    todos,
  };
  const payload = serializeEnvelope(envelope);
  for (const transport of loaded.state.transports.keys()) {
    try {
      transport.send(payload);
    } catch {
      dropSessionTransport(sessionId, loaded.state, transport);
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
        dropSessionTransport(sessionId, loaded, transport);
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

  // Gate ownership is authoritative while the active runner has not settled.
  const isWorking = sessionTurnGate.hasActive(sessionId);
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
    sendSessionEnvelopeToTransport(sessionId, loaded.state, transport, {
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

  log.info("Session recovery", {
    sessionId,
    route: "/api/sessions/:id/chat",
    requestedResumeSeq,
    ackedSeq,
    lastSeq: cursor.lastSeq,
    pendingMessageCount: session.recovery?.pendingMessageCount ?? 0,
    recoveryState: resumeOutOfRange ? "resetting" : "idle",
  });

  sendSessionEnvelopeToTransport(
    sessionId,
    loaded.state,
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

  dropSessionTransport(sessionId, state, transport);
}

/**
 * Task 16's session-disposal path can call this seam to await active-turn
 * settlement. Queued clients are notified without broadcasting their payload.
 */
export function awaitSessionTurnsSettled(sessionId: string): Promise<void> {
  return sessionTurnGate.waitForIdle(sessionId);
}

export async function disposeSessionTurnGate(
  sessionId: string,
): Promise<Array<{ readonly reason: "session-disposed"; readonly sequence: number }>> {
  const cancellations = await sessionTurnGate.dispose(sessionId, (cancelled) => {
    const state = runtimeStateBySessionId.get(sessionId);
    for (const cancellation of cancelled) {
      const envelope = createSessionChatError(sessionId, "会话已释放，排队消息未执行。", { code: cancellation.reason });
      if (state) {
        sendSessionEnvelopeToTransport(sessionId, state, cancellation.item.transport, envelope);
      } else {
        sendEnvelope(cancellation.item.transport, envelope);
      }
    }
  });
  if (cancellations.length > 0) {
    log.info("Session turn queue disposed", { sessionId, cancelledCount: cancellations.length });
  }
  return cancellations.map(({ reason, sequence }) => ({ reason: "session-disposed" as const, sequence }));
}

/** Final session-runtime cleanup, intentionally called after turn and resource settlement. */
export async function cleanupDisposedSessionRuntime(sessionId: string): Promise<void> {
  const errors: string[] = [];
  const pendingDecision = pendingSafetyDecisions.get(sessionId);
  if (pendingDecision) {
    pendingSafetyDecisions.delete(sessionId);
    try {
      pendingDecision.resolve("reject");
    } catch (error) {
      errors.push(`decision: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const state = runtimeStateBySessionId.get(sessionId);
  if (state) {
    for (const transport of [...state.transports.keys()]) {
      try {
        transport.close(1001, "Session disposed");
      } catch (error) {
        errors.push(`transport: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    state.transports.clear();
    runtimeStateBySessionId.delete(sessionId);
  }
  compactWarningSuppressed.delete(sessionId);
  clearSessionCheckpoints(sessionId);
  destroySessionHub(sessionId);

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

export function listLiveSessionRuntimeIds(): string[] {
  return [...new Set([...runtimeStateBySessionId.keys(), ...pendingSafetyDecisions.keys()])];
}

const SESSION_TOOL_RESULT_CONTINUATION_INSTRUCTION = "工具已完成。请先总结已经获得的信息，判断是否足够进入下一步。如果信息足够，请继续执行下一步；不要重复读取同一资源。";

function findLastAssistantTimestamp(messages: readonly NarratorSessionChatMessage[]): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant" && messages[i]!.timestamp) {
      return messages[i]!.timestamp;
    }
  }
  return undefined;
}

/**
 * 构建末尾追加的系统指令。
 * 利用 recency bias 让模型更强地记住当前目标和待办。
 */
function buildAppendSystemPrompt(session: NarratorSessionRecord): string | undefined {
  const parts: string[] = [];

  // 活跃 Goals
  const activeGoals = (session.goals ?? []).filter((g: { status: string }) => g.status === "active");
  if (activeGoals.length > 0) {
    parts.push("当前目标（请优先推进）:\n" + activeGoals.map((g: { objective: string }) => `- ${g.objective}`).join("\n"));
  }

  // 进行中的 Todos
  const inProgressTodos = (session.todos ?? []).filter((t: { status: string }) => t.status === "in_progress");
  if (inProgressTodos.length > 0) {
    parts.push("进行中的任务:\n" + inProgressTodos.map((t: { content: string }) => `→ ${t.content}`).join("\n"));
  }

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}


/**
 * Build full tool result content for message persistence.
 * Extracts complete data from result (not just summary).
 * This is what the model will see in subsequent turns.
 */
function buildFullToolResultContent(result: SessionToolExecutionResult, _toolName?: string): string {
  let content = result.summary ?? "";

  if (result.data && typeof result.data === "object") {
    const data = result.data as Record<string, unknown>;
    // File content (Read, jingwei.read, chapter.read)
    if (typeof data.content === "string" && data.content.trim()) {
      content += "\n\n" + data.content;
    }
    // Command output (Bash)
    if (typeof data.output === "string" && data.output.trim()) {
      content += "\n\n" + data.output;
    }
    // Search results (Grep)
    if (Array.isArray(data.results) && data.results.length > 0) {
      const first = data.results[0];
      if (typeof first === "object" && first !== null && "name" in first) {
        content += "\n\n" + (data.results as Array<{ name: string; description?: string }>)
          .map(t => `- ${t.name}: ${t.description ?? ""}`)
          .join("\n");
      } else if (typeof first === "string") {
        content += "\n\n" + (data.results as string[]).join("\n");
      }
    }
    // Glob matches
    if (Array.isArray(data.matches) && data.matches.length > 0) {
      content += "\n\n" + (data.matches as string[]).join("\n");
    }
    // Browser text
    if (typeof data.text === "string" && data.text.trim()) {
      content += "\n\n" + data.text;
    }
    // HTML content
    if (typeof data.html === "string" && data.html.trim()) {
      content += "\n\n" + data.html;
    }
    // Generic result
    if (typeof data.result === "string" && data.result.trim() && !data.text && !data.html) {
      content += "\n\n" + data.result;
    }
    // Hooks list (hooks.manage)
    if (Array.isArray(data.hooks) && data.hooks.length > 0 && !data.matches && !data.results) {
      content += "\n\n" + (data.hooks as Array<{ description?: string; done?: boolean }>).map((h, i) => `${i + 1}. ${h.done ? "[已兑现]" : "[待兑现]"} ${h.description ?? ""}`).join("\n");
    }
    // Learning docs list (LearningGuide)
    if (Array.isArray(data.docs) && data.docs.length > 0) {
      content += "\n\n" + (data.docs as Array<{ id?: string; title?: string }>).map(d => `- ${d.title ?? d.id ?? ""}`).join("\n");
    }
    // Recall/search sessions
    if (Array.isArray(data.sessions) && data.sessions.length > 0 && !data.docs) {
      content += "\n\n" + (data.sessions as Array<{ id?: string; title?: string }>).map(s => `- ${s.title ?? s.id ?? ""}`).join("\n");
    }
    // Terminal list
    if (data.terminals && typeof data.terminals === "object" && !Array.isArray(data.terminals)) {
      const terms = data.terminals as { running?: Array<{ id: string; name: string }> };
      if (terms.running?.length) content += "\n\n运行中终端: " + terms.running.map(t => `${t.name}(${t.id})`).join(", ");
    }
  }

  return content || (result.summary ?? "ok");
}

function formatSessionToolResultContent(result: SessionToolExecutionResult): string {
  // Content is now stored fully in message.content at persistence time.
  // This function is only called as fallback for legacy messages without full content.
  return buildFullToolResultContent(result);
}

function extractMessageToolResult(message: NarratorSessionChatMessage): SessionToolExecutionResult | undefined {
  const toolResult = message.metadata?.toolResult;
  if (!isRecord(toolResult) || typeof toolResult.ok !== "boolean" || typeof toolResult.summary !== "string") {
    return undefined;
  }
  return toolResult as unknown as SessionToolExecutionResult;
}

export function sessionMessagesToTurnItems(messages: readonly NarratorSessionChatMessage[]): AgentTurnItem[] {
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
          // Prefer message.content if it contains full data (new format)
          // Fall back to formatSessionToolResultContent for legacy messages
          const fullContent = message.content.length > 100
            ? message.content
            : formatSessionToolResultContent(toolResult);
          return [{
            type: "tool_result",
            toolCallId: toolCall.id,
            name: toolCall.toolName,
            content: fullContent,
            ...(toolResult.data !== undefined ? { data: toolResult.data } : {}),
            metadata: { toolResult },
          }];
        });
      }

      const toolCallItems = toolCalls.flatMap((toolCall): AgentTurnItem[] => {
        if (!toolCall.id) return [];
        return [{
          type: "tool_call",
          id: toolCall.id,
          name: toolCall.toolName,
          input: normalizeRuntimeToolInput(toolCall.input),
        }];
      });

      if (message.reasoning_content) {
        return [
          {
            type: "message",
            id: `${message.id}-reasoning`,
            role: "assistant",
            content: "",
            reasoning_content: message.reasoning_content,
            ...(message.reasoning_signature ? { reasoning_signature: message.reasoning_signature } : {}),
          },
          ...toolCallItems,
        ];
      }

      return toolCallItems;
    }

    if (!message.content.trim() && !message.reasoning_content) return [];
    return [{
      type: "message",
      id: message.id,
      role: message.role,
      content: message.content,
      ...(message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}),
      ...(message.reasoning_signature ? { reasoning_signature: message.reasoning_signature } : {}),
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

async function enqueueSessionTurn(
  sessionId: string,
  transport: SessionChatTransport,
  message: SessionTurnMessageData,
): Promise<void> {
  if (isServerDraining()) {
    sendRuntimeSessionEnvelope(sessionId, transport, createSessionChatError(
      sessionId,
      "服务器正在关闭，暂不接受新的会话任务。",
      { code: "server-draining" },
    ));
    return;
  }

  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });

  try {
    const result = await sessionTurnGate.enqueue(sessionId, { transport, message }, async (lease, item) => {
      try {
        await runSessionChatTurn(sessionId, item.transport, item.message, lease);
      } finally {
        resolveCompletion();
      }
    });

    if (result === "queue-full") {
      sendRuntimeSessionEnvelope(sessionId, transport, createSessionChatError(sessionId, "消息队列已满，请等待当前任务完成", { code: "queue-full" }));
      return;
    }
    if (result === "queued") {
      log.info("Message queued", { sessionId });
      return;
    }

    // Preserve the public active-turn behavior: callers awaiting the first
    // accepted message observe its terminal envelopes, while queued callers return.
    await completion;
  } catch (error) {
    if (error instanceof SessionTurnGateDisposedError) {
      sendRuntimeSessionEnvelope(sessionId, transport, createSessionChatError(sessionId, "会话已释放，消息未执行。", { code: "session-disposed" }));
      return;
    }
    throw error;
  }
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
    sendSessionEnvelopeToTransport(sessionId, loaded.state, transport, createSessionChatError(sessionId, "Empty message payload"));
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
    sendSessionEnvelopeToTransport(sessionId, loaded.state, transport, createSessionChatStateEnvelope(session, loaded.state, transportState?.ackedSeq ?? loaded.state.persistedAckedSeq));
    return;
  }

  if (payload.type === "session:abort") {
    // Do not release the gate or discard queued work here. The active lease owns
    // cleanup until its runner actually settles.
    abortSession(sessionId);
    return;
  }

  if (payload.type === "session:continue") {
    clearSessionCheckpoints(sessionId);
    const currentRecovery = loaded.session.recovery;
    if (currentRecovery?.lastFailure?.reason === "interrupted") {
      void updateSession(sessionId, {
        recovery: { ...currentRecovery, lastFailure: undefined, updatedAt: new Date().toISOString() },
      });
    }
    log.info("Session continue", { sessionId });
    await enqueueSessionTurn(sessionId, transport, {
      content: "请继续执行之前被中断的任务。",
      messageId: `continue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    return;
  }

  if (payload.type === "session:safety-decision") {
    const decision = (payload as { decision?: "approve" | "reject" }).decision ?? "reject";
    resolveSafetyDecision(sessionId, decision);
    log.info("Session safety decision", { sessionId, decision });
    return;
  }

  const content = ("content" in payload ? payload.content : "").trim();
  const effectiveContent = content || "继续";
  if (!content) {
    log.info("Session continue (empty content)", { sessionId });
  }
  const messageId = ("messageId" in payload ? payload.messageId?.trim() : "") || `session-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const attachments = "attachments" in payload ? payload.attachments : undefined;

  await enqueueSessionTurn(sessionId, transport, {
    content: effectiveContent,
    messageId,
    ...(canvasContext ? { canvasContext } : {}),
    ...(attachments?.length ? { attachments } : {}),
  });
}

async function persistSessionTurnFailureSafely(
  sessionId: string,
  session: NarratorSessionRecord,
  state: SessionChatRuntimeState,
  failure: NonNullable<NarratorSessionRecoveryMetadata["lastFailure"]>,
): Promise<void> {
  try {
    // This deliberately does not call persistSessionChatProgress again: its
    // primary transcript write just failed, so one bounded metadata attempt is
    // safer than retrying the same failure path indefinitely.
    const recovery = buildRecoveryMetadata(state, state.messages, failure);
    state.recoveryJson = serializeRecoveryMetadata(recovery);
    await updateSessionChatRecoveryJson(sessionId, state.recoveryJson);
    await updateSession(sessionId, {
      messageCount: state.messageCount,
      recentMessages: [...state.messages],
      recovery,
      cumulativeUsage: state.cumulativeUsage,
    });
  } catch (error) {
    log.error("Failed to persist session turn failure metadata", {
      sessionId,
      error: error instanceof Error ? error.message : "unknown",
      sessionTitle: session.title,
    });
  }
}

async function runSessionChatTurn(
  sessionId: string,
  transport: SessionChatTransport,
  message: SessionTurnMessageData,
  lease: TurnLease,
): Promise<void> {
  const turnStartedAt = Date.now();
  let loaded: Awaited<ReturnType<typeof loadSessionState>> = null;
  let completionReason: TurnCompletionReason = "failed";
  let terminalFailure: NarratorSessionRecoveryMetadata["lastFailure"] | undefined;
  let turnEnteredRuntime = false;

  try {
    loaded = await loadSessionState(sessionId);
    if (!loaded) {
      sendEnvelope(transport, createSessionChatError(sessionId, "Session not found"));
      return;
    }

    // A transport can disconnect after enqueue but before this queued runner
    // reloads state. Never append its user message or invoke the runtime.
    if (!loaded.state.transports.has(transport)) {
      log.info("Skipping disconnected queued session turn", { sessionId });
      return;
    }

    turnEnteredRuntime = true;
    const outcome = await runLoadedSessionChatTurn(sessionId, transport, message, lease, loaded, turnStartedAt);
    completionReason = outcome.completionReason;
    terminalFailure = outcome.failure;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Session turn failed";
    terminalFailure = {
      reason: "persistence-failed",
      message: "会话状态保存失败；本轮结果仅保留在当前连接中。",
      at: new Date().toISOString(),
    };
    log.error("Session turn terminal handling failed", { sessionId, error: errorMessage });

    if (loaded) {
      await persistSessionTurnFailureSafely(sessionId, loaded.session, loaded.state, terminalFailure);
      sendSessionEnvelopeToTransport(
        sessionId,
        loaded.state,
        transport,
        createSessionChatError(sessionId, terminalFailure.message, { code: "session-persist-failed" }),
      );
    } else {
      sendEnvelope(transport, createSessionChatError(sessionId, "会话运行失败。", { code: "turn-failed" }));
    }
  } finally {
    if (loaded && turnEnteredRuntime) {
      const lastTurnDurationMs = Date.now() - turnStartedAt;
      const recovery = buildRecoveryMetadata(loaded.state, loaded.state.messages, terminalFailure);
      const terminalSession = {
        ...buildServerFirstSession(loaded.session, loaded.state),
        recovery,
        narratorState: completionReason === "stopping" ? "working" as const : "idle" as const,
        completionReason,
        lastTurnDurationMs,
        ...(completionReason === "aborted" ? { substatus: "interrupted" as const } : {}),
        ...(completionReason === "stopping" ? { substatus: "stopping" as const } : {}),
        ...(terminalFailure ? { failureReason: terminalFailure.reason } : {}),
      };
      broadcastToAll(loaded.session.id, loaded.state, serializeEnvelope({ type: "session:state", session: terminalSession, cursor: createCursor(loaded.state) }));
      log.info("Session turn settled", { sessionId, completionReason, ...(terminalFailure ? { failureReason: terminalFailure.reason } : {}) });
    }
  }
}

async function runLoadedSessionChatTurn(
  sessionId: string,
  transport: SessionChatTransport,
  message: SessionTurnMessageData,
  lease: TurnLease,
  loaded: NonNullable<Awaited<ReturnType<typeof loadSessionState>>>,
  turnStartedAt: number,
): Promise<SessionTurnOutcome> {
  const { content: effectiveContent, messageId, canvasContext, attachments } = message;
  const persistedAttachments = attachments?.length ? saveAttachmentsToDisk(attachments) : undefined;
  // New user messages clear compaction-warning suppression only when their turn
  // begins, so cancelled queued items have no state side effects.
  compactWarningSuppressed.delete(sessionId);

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
  // 工具分层：
  // - 显式 allow 清单 → 尊重用户配置，返回全部启用工具
  // - 书绑定 session → 通用核心工具 + 网文核心工具 + ToolSearch（其余小说工具靠 ToolSearch 按需发现）
  // - 普通 session → 仅通用核心工具
  const filteredTools = policyAllow?.length
    ? sessionTools
    : sessionTools.filter(t =>
        CORE_TOOL_NAMES.has(t.name) ||
        (hasBookBinding && NOVEL_CORE_TOOLS.has(t.name))
      );

  let canonicalEvents: readonly RuntimeEvent[] = [];
  let failure: NarratorSessionRecoveryMetadata["lastFailure"] | undefined;
  let errorEnvelope: NarratorSessionChatErrorEnvelope | undefined;
  const toolInputsById = new Map<string, Record<string, unknown>>();
  const realtimeBroadcastedIds = new Set<string>();
  let firstTokenTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let firstTokenTimedOut = false;
  let removeFirstTokenAbortListener = () => {};
  const clearFirstTokenDeadline = () => {
    if (firstTokenTimeoutHandle !== undefined) {
      clearTimeout(firstTokenTimeoutHandle);
      firstTokenTimeoutHandle = undefined;
    }
    removeFirstTokenAbortListener();
    removeFirstTokenAbortListener = () => {};
  };

  // 推送 working 状态给所有连接的客户端
  const turnStartedAtIso = new Date(turnStartedAt).toISOString();
  const workingSession = { ...buildServerFirstSession(loaded.session, loaded.state), narratorState: "working" as const, substatus: "thinking" as const, turnStartedAt: turnStartedAtIso };
  broadcastToAll(loaded.session.id, loaded.state, serializeEnvelope({ type: "session:state", session: workingSession, cursor: createCursor(loaded.state) }));

  try {
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

      // 预设与节拍不得在会话 system/runtime context 中直拼；写作链路必须通过 Narrative Memory style channel 注入。
    }

    // Phase 4: 项目探索上下文（规则文件 + package.json）
    const workDir = loaded.session.worktree?.trim() || process.cwd();
    let projectExplorationContext = "";
    try {
      projectExplorationContext = await buildProjectExplorationContext(workDir);
    } catch { /* project exploration failure is non-fatal */ }

    const routinePrompts = await loadRoutineGlobalPrompts();
    const langConfig = await loadUserConfig();
    const sessionLanguage = langConfig.runtimeControls?.forceUserLanguage !== false ? (langConfig.preferences?.language || "zh") : undefined;
    const systemPromptSections = buildSystemPrompt({
      agentId: loaded.session.agentId ?? "default",
      toolNames: filteredTools.map(t => t.name),
      identitySection: getIdentitySection(loaded.session.agentId),
      writeNextInstructions: AGENT_NATIVE_WRITE_NEXT_INSTRUCTIONS.trim(),
      goals: loaded.session.goals,
      routinePrompts,
      language: sessionLanguage,
    });
    const fullSystemPrompt = renderSectionsToString(systemPromptSections);
    const maxSteps = await resolveMaxTurnSteps();
    // Apply context cutoff: exclude messages at or before the cutoff seq from model context
    const contextCutoffSeq = loaded.session.sessionConfig.contextCutoffSeq ?? 0;
    let contextMessages = contextCutoffSeq > 0
      ? loaded.state.messages.filter((m) => (m.seq ?? 0) > contextCutoffSeq)
      : [...loaded.state.messages];
    // Skip orphaned tool_result messages at the start (no preceding tool_call after cutoff)
    while (contextMessages.length > 0) {
      const first = contextMessages[0];
      if (first.role === "assistant" && first.toolCalls?.length && (first.metadata as any)?.toolResult) {
        contextMessages = contextMessages.slice(1);
      } else {
        break;
      }
    }
    const { items: compactedMessages } = await maybeAutoCompact(contextMessages, loaded.state, sessionId);
    // The gate creates the root controller. Its lease remains active until this
    // runner settles, including after a client has requested abort.
    let combinedSignal: AbortSignal = lease.signal;
    let silentToolCallThreshold: number | undefined;
    try {
      const timeoutConfig = await loadUserConfig();
      const timeoutSeconds = timeoutConfig.runtimeControls?.firstTokenTimeout ?? 0;
      if (timeoutSeconds > 0) {
        const timeoutController = new AbortController();
        const onLeaseAbort = () => clearFirstTokenDeadline();
        lease.signal.addEventListener("abort", onLeaseAbort, { once: true });
        removeFirstTokenAbortListener = () => lease.signal.removeEventListener("abort", onLeaseAbort);
        firstTokenTimeoutHandle = setTimeout(() => {
          if (lease.signal.aborted) {
            clearFirstTokenDeadline();
            return;
          }
          firstTokenTimedOut = true;
          clearFirstTokenDeadline();
          timeoutController.abort(new DOMException("First token deadline reached", "TimeoutError"));
        }, timeoutSeconds * 1000);
        combinedSignal = AbortSignal.any([lease.signal, timeoutController.signal]);
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

    const mainContextWindow = await resolveModelContextWindow(loaded.session.sessionConfig);
    const runtimeTurn = await executeRuntimeTurn({
      sessionId,
      sessionConfig: loaded.session.sessionConfig,
      messages: compactedMessages,
      systemPrompt: fullSystemPrompt,
      appendSystemPrompt: buildAppendSystemPrompt(loaded.session),
      context: runtimeContext,
      contextWindowTokens: mainContextWindow,
      tools: filteredTools,
      permissionMode: loaded.session.sessionConfig.permissionMode,
      ...(canvasContext ? { canvasContext } : {}),
      maxSteps,
      shouldContinueAfterToolResult,
      reasoningPolicy,
      ...(silentToolCallThreshold ? { silentToolCallThreshold } : {}),
      onStreamChunk: (chunk: string) => {
        if (firstTokenTimedOut) return;
        clearFirstTokenDeadline();
        broadcastStreamChunk(sessionId, loaded.state, chunk);
      },
      onToolEvent: (event: RuntimeToolStreamEvent) => {
        if (firstTokenTimedOut) return;
        clearFirstTokenDeadline();
        if (event.type === "tool_input_chunk") {
          const envelope = { type: "session:tool-input-chunk" as const, sessionId, toolCallId: event.id, partialInput: event.partialInput };
          broadcastToAll(loaded.session.id, loaded.state, serializeEnvelope(envelope as any));
        }
      },
      onEvent: (event) => {
        if (firstTokenTimedOut) return;
        if (event.type === "assistant_message") {
          // 实时推送工具链中间的 assistant 文字到前端（防止切换页面后丢失）
          const midTurnAssistantMessage = appendMessageToState(loaded.state, {
            id: `${userMessage.id}-mid-turn-${Date.now()}`,
            role: "assistant",
            content: event.content,
            reasoning_content: event.reasoningContent,
            timestamp: timestamp + messagesToPersist.length,
            runtime: event.runtime,
            ...(event.runtime?.usage ? { metadata: { usage: event.runtime.usage } } : {}),
          });
          messagesToPersist.push(midTurnAssistantMessage);
          broadcastMessageEnvelope(sessionId, loaded.state, midTurnAssistantMessage);
          realtimeBroadcastedIds.add(`assistant-${midTurnAssistantMessage.id}`);
        } else if (event.type === "tool_call") {
          const statusSession = { ...buildServerFirstSession(loaded.session, loaded.state), narratorState: "working" as const, substatus: "tool_calling" as const, toolName: event.toolName, turnStartedAt: turnStartedAtIso };
          broadcastToAll(loaded.session.id, loaded.state, serializeEnvelope({ type: "session:state", session: statusSession, cursor: createCursor(loaded.state) }));
          // 实时推送 tool_call 消息到前端（不等 turn 结束）
          const toolUseMessage = appendMessageToState(loaded.state, {
            id: `${userMessage.id}-tool-use-${event.id}`,
            role: "assistant",
            content: "",
            reasoning_content: event.reasoningContent,
            reasoning_signature: event.reasoningSignature,
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
          broadcastToAll(loaded.session.id, loaded.state, serializeEnvelope({ type: "session:state", session: statusSession, cursor: createCursor(loaded.state) }));

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
            content: buildFullToolResultContent(toolResult, event.toolName),
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
        // 解析推理强度优先级所需的供应商/全局默认值
        const [provider, userConfig] = await Promise.all([
          providerRuntimeStore.getProvider(generateInput.sessionConfig.providerId),
          loadUserConfig(),
        ]);
        const result = await generateSessionReply({
          sessionConfig: generateInput.sessionConfig,
          messages: generateInput.messages,
          tools: generateInput.tools,
          onStreamChunk: generateInput.onStreamChunk,
          onToolEvent: generateInput.onToolEvent,
          onRetry: (_attempt, _max) => {
            const retrySession = { ...buildServerFirstSession(loaded.session, loaded.state), narratorState: "working" as const, substatus: "retrying" as const, turnStartedAt: turnStartedAtIso };
            broadcastToAll(loaded.session.id, loaded.state, serializeEnvelope({ type: "session:state", session: retrySession, cursor: createCursor(loaded.state) }));
          },
          signal: generateInput.signal,
          ...(generateInput.maxOutputTokensOverride ? { maxOutputTokensOverride: generateInput.maxOutputTokensOverride } : {}),
          // 推理强度三级优先级：叙述者会话 > 供应商默认 > 全局默认
          providerDefaultReasoningEffort: provider?.defaultReasoningEffort,
          globalDefaultReasoningEffort: userConfig.runtimeControls.defaultReasoningEffort,
        });
        clearFirstTokenDeadline();
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
              broadcastToAll(loaded.session.id, loaded.state, serializeEnvelope(envelope as any));
            }
          : undefined;
        const enrichedInput = { ...toolInput, onToolOutputStream };
        const sessionWorkDir = loaded.session.worktree?.trim() || undefined;
        const sessionProjectId = (loaded.session as { projectId?: string }).projectId || undefined;
        const onSubstatus = (substatus: string) => {
          const statusSession = { ...buildServerFirstSession(loaded.session, loaded.state), narratorState: "working" as const, substatus: substatus as "reflecting", turnStartedAt: turnStartedAtIso };
          broadcastToAll(loaded.session.id, loaded.state, serializeEnvelope({ type: "session:state", session: statusSession, cursor: createCursor(loaded.state) }));
        };
        return createSessionToolExecutor({
          ...sessionToolExecutorOptions,
          workDir: sessionWorkDir,
          projectId: sessionProjectId,
          sessionId: loaded.session.id,
          executionSessionId: loaded.session.id,
          onSubstatus,
        }).execute(enrichedInput);
      },
    });
    clearFirstTokenDeadline();
    const runtimeEvents = firstTokenTimedOut ? [] : runtimeTurn.agentEvents;
    canonicalEvents = firstTokenTimedOut ? [] : runtimeTurn.runtimeEvents;
    if (firstTokenTimedOut) {
      const timeoutMessage = "API 响应超时。可在设置 → AI 代理 → 首 token 超时中调整超时时间，或检查网络连接。";
      failure = {
        reason: "timeout",
        message: timeoutMessage,
        at: new Date().toISOString(),
      };
      errorEnvelope = createSessionChatError(sessionId, timeoutMessage, {
        code: "timeout",
        runtime: {
          providerId: loaded.session.sessionConfig.providerId,
          modelId: loaded.session.sessionConfig.modelId,
        },
      });
    }
    for (const event of runtimeEvents) {
      if (event.type !== "tool_result" || event.result.error !== "stop-timeout") continue;
      // A stop-timeout is not terminal proof. Unknown handlers are retained
      // indefinitely rather than allowing an unsafe overlapping turn.
      lease.retainUntil(getRuntimeSettlement(event.result) ?? new Promise<never>(() => undefined));
    }

    let assistantIndex = 0;
    // Count how many assistant_messages were already broadcast via onEvent (mid-turn)
    const alreadyBroadcastedAssistantCount = [...realtimeBroadcastedIds].filter(id => id.startsWith("assistant-")).length;
    let skippedAssistantCount = 0;
    for (const event of runtimeEvents) {
      if (event.type === "assistant_message") {
        accumulateUsage(loaded.state.cumulativeUsage, event.runtime?.usage);
        // Skip assistant messages already broadcast in real-time during onEvent
        if (skippedAssistantCount < alreadyBroadcastedAssistantCount) {
          skippedAssistantCount++;
          continue;
        }
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
        // Update context usage from tool_call's generate result (each generate reports input_tokens)
        accumulateUsage(loaded.state.cumulativeUsage, event.runtime?.usage);
        // 如果已在 onEvent 中实时广播，跳过
        if (realtimeBroadcastedIds.has(`tool-call-${event.id}`)) continue;
        toolInputsById.set(event.id, event.input);
        const toolUseMessage = appendMessageToState(loaded.state, {
          id: `${userMessage.id}-tool-use-${event.id}`,
          role: "assistant",
          content: "",
          reasoning_content: event.reasoningContent,
          reasoning_signature: event.reasoningSignature,
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
          content: buildFullToolResultContent(toolResult, event.toolName),
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
    const isTimeout = firstTokenTimedOut
      || (error instanceof Error && (error.name === "TimeoutError" || message.includes("timeout")));

    if (isTimeout) {
      message = "API 响应超时。可在设置 → AI 代理 → 首 token 超时中调整超时时间，或检查网络连接。";
    } else if (error instanceof Error && message.includes("aborted")) {
      message = "已中断。";
    }
    const failureReason = isTimeout ? "timeout" : "provider-unavailable";
    failure = {
      reason: failureReason,
      message,
      at: new Date().toISOString(),
    };
    errorEnvelope = createSessionChatError(sessionId, message, {
      code: failureReason,
      runtime: {
        providerId: loaded.session.sessionConfig.providerId,
        modelId: loaded.session.sessionConfig.modelId,
      },
    });
  } finally {
    clearFirstTokenDeadline();
    // Per-turn streaming/tool correlation state must never survive terminal handling.
    toolInputsById.clear();
    realtimeBroadcastedIds.clear();
  }

  const transcriptMessagesToPersist = attachRuntimeTranscriptToMessages(messagesToPersist, canonicalEvents);
  const updatedSession = await persistSessionChatProgress(sessionId, loaded.session, loaded.state, transcriptMessagesToPersist, failure);
  if (errorEnvelope) {
    sendSessionEnvelopeToTransport(sessionId, loaded.state, transport, errorEnvelope);
  }

  if (updatedSession) {
    broadcastStateEnvelope(buildServerFirstSession(updatedSession, loaded.state), loaded.state);
  }


  // --- TurnComplete hooks (owner-scoped follow-up) ---
  trackSessionRuntimeFollowUp(sessionId, "turn-complete-hooks", (async () => {
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
  })());

  // --- Turn Memory Extraction (owner-scoped follow-up) ---
  trackSessionRuntimeFollowUp(sessionId, "turn-memory-extraction", (async () => {
    try {
      const { extractAndPersistTurnMemories } = await import("./turn-memory-extractor.js");
      const lastAssistant = loaded.state.messages
        ?.filter((m: any) => m.role === "assistant")
        ?.at(-1);
      const content = typeof lastAssistant?.content === "string" ? lastAssistant.content : "";
      if (content.length > 50) {
        const workDir = loaded.session.worktree?.trim() || process.cwd();
        await extractAndPersistTurnMemories(content, { workDir });
      }
    } catch { /* memory extraction failure is non-fatal */ }
  })());

  // --- Auto-update context.md (owner-scoped follow-up) ---
  trackSessionRuntimeFollowUp(sessionId, "context-memory-update", (async () => {
    try {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const { existsSync } = await import("node:fs");
      
      const workDir = loaded.session.worktree?.trim() || process.cwd();
      const memDir = join(workDir, ".narrafork", "memory");
      if (!existsSync(memDir)) {
        await mkdir(memDir, { recursive: true });
      }
      
      // Extract recent activity from messages
      const recentMessages = (loaded.state.messages ?? []).slice(-20);
      const userRequests = recentMessages
        .filter((m: any) => m.role === "user" && typeof m.content === "string")
        .map((m: any) => (m.content as string).slice(0, 100))
        .slice(-5);
      const toolsUsed = recentMessages
        .filter((m: any) => m.role === "tool_call" || m.type === "tool_call")
        .map((m: any) => m.name || m.toolName || "unknown")
        .filter(Boolean);
      const uniqueTools = [...new Set(toolsUsed)].slice(0, 10);
      
      const lastAssistant = [...recentMessages]
        .reverse()
        .find((m: any) => m.role === "assistant" && typeof m.content === "string");
      const lastAssistantPreview = lastAssistant
        ? (lastAssistant.content as string).slice(0, 200)
        : "";

      const now = new Date().toISOString().slice(0, 10);
      const contextContent = [
        `# 上次进度 — ${now}`,
        "",
        "## 正在做",
        "",
        userRequests.length > 0
          ? userRequests.map(r => `- ${r}`).join("\n")
          : "（无最近请求）",
        "",
        "## 最近使用工具",
        "",
        uniqueTools.length > 0
          ? uniqueTools.join(", ")
          : "（无）",
        "",
        "## 最后助手输出（预览）",
        "",
        lastAssistantPreview || "（空）",
        "",
      ].join("\n");

      await writeFile(join(memDir, "context.md"), contextContent, "utf-8");
    } catch { /* context.md update failure is non-fatal */ }
  })());

  // --- Webhook notification (owner-scoped follow-up) ---
  trackSessionRuntimeFollowUp(sessionId, "webhook-notification", (async () => {
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
  })());

  // 翻译思考内容：异步翻译 assistant 消息中的 thinking/reasoning block
  const assistantMessages = messagesToPersist.filter((m) => m.role === "assistant");
  if (assistantMessages.length > 0) {
    trackSessionRuntimeFollowUp(sessionId, "thinking-translation", (async () => {
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
    })());
  }

  // 自动命名：第一轮对话且标题为默认值时，异步生成标题
  const hasAssistantReply = messagesToPersist.some((m) => m.role === "assistant");
  const userMessageCount = loaded.state.messages.filter((m) => m.role === "user").length;
  const currentTitle = loaded.session.title;
  const needsAutoTitle = hasAssistantReply
    && userMessageCount <= 1
    && (currentTitle === "Untitled Session" || currentTitle.startsWith("Headless:"));
  if (needsAutoTitle) {
    trackSessionRuntimeFollowUp(sessionId, "auto-title", generateSessionTitle(loaded.state.messages).then(async (title) => {
      if (title && title !== "Untitled Session") {
        await updateSession(sessionId, { title });
      }
    }).catch(() => { /* auto-title failure is non-fatal */ }));
  }

  return {
    completionReason: resolveTurnCompletionReason(lease.signal, failure),
    ...(failure ? { failure } : {}),
  };
}

const AGENT_NATIVE_WRITE_NEXT_INSTRUCTIONS = `

## Agent-native 写下一章链路
当用户请求「写下一章」「生成下一章」或 write next 时，必须按顺序推进：cockpit.snapshot → lore.read → memory.read → pgi.ask → AskUserQuestion → scene.spec → pipeline.write → memory.events 后置确认。
- pgi.ask 无问题时也要明确说明 skippedReason=no-questions，并继续形成本章作者指示。
- 必须等待用户通过 AskUserQuestion 确认方向；用户拒绝或要求修改时不得调用 scene.spec / pipeline.write。
- 批准后先用 scene.spec 生成结构化写作蓝图，再将其作为 sceneSpec 传给 pipeline.write；结果写入正式章节并通过 artifact 在中间画布打开。
- 不得创建 candidate/draft 主对象；写作结果以正式章节或后续版本结算流程承载。
- 任一步失败时停止后续写入，展示失败原因，并保留已完成的只读调查结果。

## 后置更新（每章写完后必须执行）
pipeline.write 成功后，**必须**把章节摘要、角色状态变化、关系变化、伏笔埋设/触发/兑现整理为 Pending NarrativeEvents / memory.events；不得直接写入 Lore canon。
1. 静态设定变更（作者明确确认的世界规则、人物固定设定、平台规则）才使用 lore.write，并且 canon/rules 必须带 reason + source/evidence。
2. 动态事实、章节后抽取事实、伏笔推进、时间线推进默认进入 Narrative Memory 待确认事件。
3. 以上完成后才回复用户"本章已完成"

## 连续写章模式
当用户说「连续写N章」「自动写到第X章」时：
- 每章按上述完整流程执行（包括后置更新）
- 每章之间用 lore.read(scope=brief) + memory.read(purpose=write) 刷新静态设定与动态上下文
- 不需要每章都 AskUserQuestion——首章确认方向后，后续章按大纲自动推进
- 遇到审计严重问题（critical）时暂停并报告，不继续`;

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

interface BunSessionChatRouteBindings {
  readonly attach: (
    sessionId: string,
    transport: SessionChatTransport,
    options: AttachSessionChatTransportOptions,
  ) => Promise<boolean>;
  readonly handle: (
    sessionId: string,
    transport: SessionChatTransport,
    message: string | Uint8Array,
  ) => Promise<void>;
  readonly detach: (sessionId: string, transport: SessionChatTransport) => void;
}

interface BunSessionChatSocketBinding {
  readonly sessionId: string;
  readonly transport: SessionChatTransport;
  readonly attachPromise: Promise<boolean>;
  closed: boolean;
}

/**
 * Bun may emit a message before asynchronous session attachment completes.
 * Keep the binding private to the socket and await its attachment so that the
 * message reaches the same live transport registered in runtime state.
 */
export function createBunSessionChatWebSocketRoute(
  bindings: BunSessionChatRouteBindings = {
    attach: attachSessionChatTransport,
    handle: handleSessionChatTransportMessage,
    detach: detachSessionChatTransport,
  },
): BunWebSocketRoute {
  const sockets = new WeakMap<BunWebSocketConnection, BunSessionChatSocketBinding>();

  const closeBinding = (socket: BunWebSocketConnection): void => {
    const binding = sockets.get(socket);
    if (!binding) return;

    binding.closed = true;
    sockets.delete(socket);
    void binding.attachPromise.then((attached) => {
      if (attached) {
        bindings.detach(binding.sessionId, binding.transport);
      }
    });
  };

  return {
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
      let resolveAttach!: (attached: boolean) => void;
      const attachPromise = new Promise<boolean>((resolve) => { resolveAttach = resolve; });
      const binding: BunSessionChatSocketBinding = {
        sessionId,
        transport,
        attachPromise,
        closed: false,
      };
      sockets.set(socket, binding);

      void (async () => {
        let attached = false;
        try {
          attached = await bindings.attach(sessionId, transport, { resumeFromSeq });
        } catch (error) {
          log.warn("Bun session transport attachment failed", {
            sessionId,
            error: error instanceof Error ? error.message : "unknown",
          });
        } finally {
          if (!attached && sockets.get(socket) === binding) {
            sockets.delete(socket);
          }
          resolveAttach(attached);
        }
      })();
    },
    message(socket, message) {
      const binding = sockets.get(socket);
      if (!binding) return;

      void (async () => {
        const attached = await binding.attachPromise;
        if (!attached || binding.closed || sockets.get(socket) !== binding) return;
        await bindings.handle(binding.sessionId, binding.transport, message);
      })().catch((error) => {
        log.error("Bun session transport message handling failed", {
          sessionId: binding.sessionId,
          error: error instanceof Error ? error.message : "unknown",
        });
      });
    },
    close(socket) {
      closeBinding(socket);
    },
    error(socket) {
      closeBinding(socket);
    },
  };
}

export function setupSessionChatWebSocket(server: StartedHttpServer): void {
  if (isBunWebSocketRegistrar(server)) {
    server.registerWebSocketRoute(createBunSessionChatWebSocketRoute());
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
