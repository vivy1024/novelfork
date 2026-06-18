import type {
  CanvasContext,
  SessionToolDefinition,
  SessionToolExecutionInput,
  SessionToolExecutionResult,
} from "../../shared/agent-native-workspace.js";
import type {
  NarratorSessionRuntimeMetadata,
  SessionConfig,
  SessionPermissionMode,
} from "../../shared/session-types.js";
import type { ProviderReasoningPolicy } from "../../shared/provider-catalog.js";
import type { LlmRuntimeFailureCode } from "./llm-runtime-service.js";
import type { RuntimeToolUse, RuntimeToolStreamEvent } from "./provider-adapters/index.js";
import { log } from "./logger.js";
import { filterSessionToolsForProvider } from "./session-tool-policy.js";
import { logRequest, normalizeTokenUsage } from "./request-observability.js";
import { saveTurnCheckpoint, clearTurnCheckpoint, type ToolExecutionRecord } from "./turn-checkpoint.js";
import { TurnHealthMonitor, type ToolCallRecord, type TurnHealthConfig } from "./turn-health-monitor.js";
import { classifyError, getErrorUserMessage, type GenerateErrorCode } from "./provider-health-manager.js";
import { pruneToolOutput } from "./compact/tool-output-pruner.js";
import { createContentReplacementState, applyContentReplacement } from "./content-replacement.js";

export type AgentTurnItem =
  | { readonly type: "message"; readonly role: "system" | "user" | "assistant"; readonly content: string; readonly reasoning_content?: string; readonly reasoning_signature?: string; readonly id?: string; readonly metadata?: Record<string, unknown>; readonly attachments?: Array<{ type: "image"; mimeType: string; filePath: string; fileName?: string }> }
  | { readonly type: "tool_call"; readonly id: string; readonly name: string; readonly input: Record<string, unknown> }
  | { readonly type: "tool_result"; readonly toolCallId: string; readonly name: string; readonly content: string; readonly data?: unknown; readonly metadata?: Record<string, unknown> };

export interface AgentGenerateInput {
  readonly sessionConfig: SessionConfig;
  readonly messages: readonly AgentTurnItem[];
  readonly tools: readonly SessionToolDefinition[];
  readonly permissionMode: SessionPermissionMode;
  readonly canvasContext?: CanvasContext;
  readonly onStreamChunk?: (chunk: string) => void;
  readonly onToolEvent?: (event: RuntimeToolStreamEvent) => void;
  readonly signal?: AbortSignal;
  /** P2.1: 覆盖 max_output_tokens（用于 escalation 恢复） */
  readonly maxOutputTokensOverride?: number;
}

export type AgentGenerateResult =
  | { readonly success: true; readonly type?: "message"; readonly content: string; readonly reasoningContent?: string; readonly reasoningSignature?: string; readonly metadata: NarratorSessionRuntimeMetadata }
  | { readonly success: true; readonly type: "tool_use"; readonly toolUses: readonly RuntimeToolUse[]; readonly reasoningContent?: string; readonly reasoningSignature?: string; readonly metadata: NarratorSessionRuntimeMetadata }
  | { readonly success: false; readonly code: LlmRuntimeFailureCode | string; readonly error: string; readonly metadata?: Partial<NarratorSessionRuntimeMetadata> };

export type AgentToolExecutionInput = Omit<SessionToolExecutionInput, "sessionConfig"> & {
  readonly sessionConfig: SessionConfig;
};

export type AgentTurnEvent =
  | { readonly type: "assistant_message"; readonly content: string; readonly reasoningContent?: string; readonly runtime: NarratorSessionRuntimeMetadata }
  | { readonly type: "streaming_chunk"; readonly content: string }
  | { readonly type: "reasoning_chunk"; readonly content: string }
  | { readonly type: "tool_call"; readonly id: string; readonly toolName: string; readonly input: Record<string, unknown>; readonly runtime: NarratorSessionRuntimeMetadata }
  | { readonly type: "tool_result"; readonly id: string; readonly toolName: string; readonly result: SessionToolExecutionResult; readonly runtime?: NarratorSessionRuntimeMetadata }
  | { readonly type: "confirmation_required"; readonly id: string; readonly toolName: string; readonly result: SessionToolExecutionResult; readonly sourceToolUseId?: string }
  | { readonly type: "turn_completed" }
  | { readonly type: "turn_failed"; readonly reason: string; readonly message: string; readonly data?: Record<string, unknown> };

export interface AgentTurnRuntimeInput {
  readonly sessionId: string;
  readonly sessionConfig: SessionConfig;
  readonly messages: readonly AgentTurnItem[];
  readonly systemPrompt: string;
  readonly context?: string;
  /** 末尾追加系统指令（recency bias 使其比开头 system prompt 更有影响力） */
  readonly appendSystemPrompt?: string;
  readonly tools: readonly SessionToolDefinition[];
  readonly permissionMode: SessionPermissionMode;
  readonly canvasContext?: CanvasContext;
  readonly generate: (input: AgentGenerateInput) => Promise<AgentGenerateResult>;
  readonly executeTool: (input: AgentToolExecutionInput) => Promise<SessionToolExecutionResult>;
  readonly shouldContinueAfterToolResult?: (input: { readonly toolName: string; readonly result: SessionToolExecutionResult }) => boolean;
  readonly maxSteps?: number;
  readonly onStreamChunk?: (chunk: string) => void;
  readonly onToolEvent?: (event: RuntimeToolStreamEvent) => void;
  readonly onEvent?: (event: AgentTurnEvent) => void;
  readonly reasoningPolicy?: ProviderReasoningPolicy;
  readonly signal?: AbortSignal;
  /** Fix: silentToolCallThreshold — 连续无文本输出的工具调用次数阈值，超过后注入提示 */
  readonly silentToolCallThreshold?: number;
  /** 工具执行超时（毫秒），默认 120000 */
  readonly toolTimeoutMs?: number;
  /** 模型上下文窗口大小（tokens），用于 Budget Pressure 计算上下文使用率 */
  readonly contextWindowTokens?: number;
  /** P2.1: 覆盖 max_output_tokens（用于 escalation 恢复） */
  readonly maxOutputTokensOverride?: number;
  /** P2.2: 备用模型 ID — 当主模型不可用时自动切换 */
  readonly fallbackModel?: string;
  /** P4: TurnComplete hooks — called when agent is about to finish. Return messages to inject for self-correction. */
  readonly onTurnComplete?: (context: { lastAssistantContent: string; toolsUsed: string[] }) => Promise<string[] | null>;
}

function buildSystemContent(systemPrompt: string, context?: string): string {
  const trimmedPrompt = systemPrompt.trim();
  const trimmedContext = context?.trim();
  if (!trimmedContext) return trimmedPrompt;
  if (!trimmedPrompt) return trimmedContext;
  return `${trimmedPrompt}\n\n${trimmedContext}`;
}

function buildInitialMessages(input: AgentTurnRuntimeInput): AgentTurnItem[] {
  const systemContent = buildSystemContent(input.systemPrompt, input.context);
  if (!systemContent) {
    return [...input.messages];
  }

  const [firstMessage, ...restMessages] = input.messages;
  if (firstMessage?.type === "message" && firstMessage.role === "system") {
    return [{ ...firstMessage, content: systemContent }, ...restMessages];
  }

  return [{ type: "message", role: "system", content: systemContent }, ...input.messages];
}

function buildFailureEvent(reply: Extract<AgentGenerateResult, { success: false }>): AgentTurnEvent {
  const errorCode = classifyError(reply.code || reply.error);
  const classifiedMessage = getErrorUserMessage(errorCode);
  // 透传原始错误信息，分类信息作为补充
  const message = reply.error || classifiedMessage;
  return {
    type: "turn_failed",
    reason: reply.code,
    message,
    data: { errorCode, classifiedMessage, originalError: reply.error, ...(reply.metadata ? { metadata: reply.metadata } : {}) },
  };
}

function isContextOverflowError(code: string, errorMessage: string): boolean {
  const combined = `${code} ${errorMessage}`.toLowerCase();

  // Direct status code match (413 = Payload Too Large)
  if (/\b413\b/.test(combined)) return true;

  // Known error patterns from various providers
  const overflowIndicators = [
    "context_length_exceeded",
    "maximum context length",
    "token limit",
    "context window",
    "prompt_too_long",
    "prompt is too long",
    "request_too_large",
    "too many tokens",
    "max_tokens",
    "input is too long",
  ];
  return overflowIndicators.some(indicator => combined.includes(indicator));
}

function emergencyTruncateMessages(messages: AgentTurnItem[], keepRecent: number = 10): AgentTurnItem[] {
  if (messages.length <= keepRecent + 2) return messages;

  const firstSystem = messages.find(m => m.type === "message" && m.role === "system");
  // Keep at most 1/3 of messages — aggressive truncation to ensure the retry
  // fits within context limits even if individual messages are large.
  const actualKeep = Math.min(keepRecent, Math.floor(messages.length / 3));
  let recentMessages = messages.slice(-actualKeep);

  // Ensure we don't start with an orphaned tool_result (models reject this)
  while (recentMessages.length > 0 && recentMessages[0]!.type === "tool_result") {
    recentMessages = recentMessages.slice(1);
  }

  // 生成丢弃部分的快速摘要（不调 LLM，纯文本提取）
  const droppedStart = firstSystem ? 1 : 0;
  const droppedEnd = messages.length - actualKeep;
  const dropped = messages.slice(droppedStart, droppedEnd);
  const droppedCount = dropped.length;

  // 提取用户最近请求作为摘要线索
  const userRequests = dropped
    .filter(m => m.type === "message" && m.role === "user")
    .map(m => ("content" in m && typeof m.content === "string") ? m.content.slice(0, 60) : "")
    .filter(Boolean)
    .slice(-5);

  // 提取工具调用摘要
  const toolCalls = dropped
    .filter(m => m.type === "tool_call")
    .map(m => ("name" in m) ? m.name : "")
    .filter(Boolean);
  const toolSummary = toolCalls.length > 0
    ? `工具调用: ${[...new Set(toolCalls)].slice(0, 8).join(", ")} (共${toolCalls.length}次)`
    : "";

  const summaryParts = [
    `[上下文溢出紧急压缩。已丢弃 ${droppedCount} 条较早消息。]`,
    userRequests.length > 0 ? `用户近期请求: ${userRequests.join(" | ")}` : "",
    toolSummary,
  ].filter(Boolean);

  const truncationNotice: AgentTurnItem = {
    type: "message",
    role: "system",
    content: summaryParts.join("\n"),
  };

  return firstSystem
    ? [firstSystem, truncationNotice, ...recentMessages]
    : [truncationNotice, ...recentMessages];
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function toolSignature(toolName: string, input: Record<string, unknown>): string {
  return `${toolName}:${stableJson(input)}`;
}

const TOOL_RESULT_CONTINUATION_INSTRUCTION = ""; // Removed: NarraFork parity — no instruction injection into tool results

function getContextAwareInstruction(_toolName: string, _result: SessionToolExecutionResult): string {
  return "";
}

/** 工具输出截断：不主动截断，仅对极端情况兜底防止单个工具占满上下文 */


// ---------------------------------------------------------------------------
// File Unchanged Dedup — 同一文件连续读取时返回 stub 而非完整内容
// ---------------------------------------------------------------------------

const FILE_READ_TOOLS = new Set(["Read", "jingwei.read", "chapter.read"]);

interface FileReadCacheEntry {
  contentHash: string;
  step: number;
}

/**
 * 全文 hash（djb2 over entire string）。
 * 必须哈希完整内容——只取前缀会导致长文件（章节正文、经纬数据）
 * 前缀相同但后续不同的情况被误判为"未变"，从而丢失真实数据。
 */
function quickHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  // 同时编码长度，进一步降低碰撞概率
  return `${hash >>> 0}:${str.length}`;
}

/**
 * Per-turn 文件去重器。
 * 每次 runAgentTurn 调用创建独立实例，避免模块级全局在并发 turn 间互相污染。
 */
export interface FileReadDeduplicator {
  deduplicate(toolName: string, input: Record<string, unknown>, content: string): string;
}

export function createFileReadDeduplicator(): FileReadDeduplicator {
  const cache = new Map<string, FileReadCacheEntry>();
  let step = 0;

  return {
    deduplicate(toolName, input, content) {
      if (!FILE_READ_TOOLS.has(toolName)) return content;
      if (content.length < 200) return content; // 太短不值得去重

      const path = String(input.file_path ?? input.scope ?? input.bookId ?? input.category ?? toolName);
      const key = `${toolName}:${path}`;
      const hash = quickHash(content);

      step++;
      const cached = cache.get(key);

      if (cached && cached.contentHash === hash) {
        return `[文件内容未变: ${path} — 与第 ${cached.step} 步读取相同，内容省略 (${content.length}字符)]`;
      }

      cache.set(key, { contentHash: hash, step });
      return content;
    },
  };
}


// ---------------------------------------------------------------------------
// Budget Pressure — 在 tool_result 末尾追加上下文使用率提醒（无损）
//
// 参考 LegnaCode/Claude Code：当上下文接近上限时，在工具结果末尾追加软提示，
// 引导模型尽快收尾，避免在 context 快满时写长文导致截断。
// 使用 provider 报告的真实 input_tokens（比字符估算准）。
// ---------------------------------------------------------------------------

const BUDGET_PRESSURE_INFO = 0.70;  // 70% — 信息级
const BUDGET_PRESSURE_SOFT = 0.80; // 80% — 软提示
const BUDGET_PRESSURE_HARD = 0.92; // 92% — 紧急

const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3;
const ESCALATED_MAX_TOKENS = 64000;
const BLOCKING_LIMIT_THRESHOLD = 0.97;

export function buildBudgetPressureNotice(inputTokens: number, contextWindow: number): string {
  if (!contextWindow || contextWindow <= 0 || !inputTokens || inputTokens <= 0) return "";
  const ratio = inputTokens / contextWindow;
  const pct = Math.round(ratio * 100);
  if (ratio >= BUDGET_PRESSURE_HARD) {
    return `\n\n[⚠️ 上下文已用 ${pct}%，即将溢出。请立即完成当前输出并停止扩展；若任务未完成，请提示用户保存进度后再继续。]`;
  }
  if (ratio >= BUDGET_PRESSURE_SOFT) {
    return `\n\n[提示：上下文已用 ${pct}%。请尽快收尾当前任务，避免长输出导致截断。]`;
  }
  if (ratio >= BUDGET_PRESSURE_INFO) {
    return `\n\n[信息：上下文已用 ${pct}%。当前进展顺利，建议适时向用户汇报阶段性结果。]`;
  }
  return "";
}


function truncateToolResult(content: string, toolName?: string): string {
  return pruneToolOutput(toolName ?? "unknown", content);
}

function toolResultContent(result: SessionToolExecutionResult, toolName?: string, toolInput?: Record<string, unknown>, deduplicator?: FileReadDeduplicator, contentState?: ReturnType<typeof createContentReplacementState>): string {
  const instruction = toolName ? getContextAwareInstruction(toolName, result) : TOOL_RESULT_CONTINUATION_INSTRUCTION;
  let content = result.summary ?? "";
  // 将 data 中的关键结果附加到 content（让模型能看到实际数据）
  if (result.data && typeof result.data === "object") {
    const data = result.data as Record<string, unknown>;
    // Glob: 文件列表
    if (Array.isArray(data.matches) && data.matches.length > 0) {
      content += "\n\n" + (data.matches as string[]).join("\n");
    }
    // Grep: 匹配行 / ToolSearch: 工具列表
    if (Array.isArray(data.results) && data.results.length > 0) {
      const first = data.results[0];
      if (typeof first === "object" && first !== null && "name" in first) {
        // ToolSearch 返回的对象数组 {name, description}
        content += "\n\n" + (data.results as Array<{ name: string; description?: string }>)
          .map(t => `- ${t.name}: ${t.description ?? ""}`)
          .join("\n");
      } else {
        // Grep 返回的字符串数组
        content += "\n\n" + (data.results as string[]).join("\n");
      }
    }
    // Read/LearningGuide: 文件内容
    if (typeof data.content === "string" && data.content.trim()) {
      content += "\n\n" + data.content;
    }
    // Grep fallback: output 字段
    if (typeof data.output === "string" && data.output.trim()) {
      content += "\n\n" + data.output;
    }
    // Terminal read: 终端输出
    if (typeof data.terminalId === "string" && typeof data.output === "string") {
      // already handled above
    }
    // Browser: text/html/result
    if (typeof data.text === "string" && data.text.trim()) {
      content += "\n\n" + data.text;
    }
    if (typeof data.html === "string" && data.html.trim()) {
      content += "\n\n" + data.html;
    }
    if (typeof data.result === "string" && data.result.trim() && !data.text && !data.html) {
      content += "\n\n" + data.result;
    }
    // Hooks list / generic arrays with meaningful string content
    if (Array.isArray(data.hooks) && data.hooks.length > 0 && !data.matches && !data.results) {
      content += "\n\n" + (data.hooks as Array<{ description?: string; done?: boolean }>).map((h, i) => `${i + 1}. ${h.done ? "[已兑现]" : "[待兑现]"} ${h.description ?? ""}`).join("\n");
    }
    // LearningGuide list/search: docs array
    if (Array.isArray(data.docs) && data.docs.length > 0) {
      content += "\n\n" + (data.docs as Array<{ id?: string; title?: string }>).map(d => `- ${d.title ?? d.id ?? ""}`).join("\n");
    }
    // Recall/search results
    if (Array.isArray(data.sessions) && data.sessions.length > 0 && !data.docs) {
      content += "\n\n" + (data.sessions as Array<{ id?: string; title?: string }>).map(s => `- ${s.title ?? s.id ?? ""}`).join("\n");
    }
    // Terminal list
    if (data.terminals && typeof data.terminals === "object" && !Array.isArray(data.terminals)) {
      const terms = data.terminals as { running?: Array<{ id: string; name: string }>; exited?: Array<{ id: string; name: string }> };
      if (terms.running?.length) content += "\n\n运行中: " + terms.running.map(t => `${t.name}(${t.id})`).join(", ");
    }
  }
  // Apply file dedup before truncation
  if (toolName && toolInput && deduplicator) {
    content = deduplicator.deduplicate(toolName, toolInput, content);
  }
  // Content replacement: large results get stored as references
  if (contentState && toolName && content.length > 0) {
    content = applyContentReplacement(contentState, toolName, content);
  }
  // Return content directly without instruction injection (NarraFork parity)
  return content ? truncateToolResult(content, toolName) : (result.summary ?? "ok");
}

function createDuplicateToolResult(firstResult: SessionToolExecutionResult): SessionToolExecutionResult {
  return {
    ok: true,
    summary: "已拦截重复工具调用：该工具与参数在本轮中已经执行过，请基于已有结果继续下一步。",
    data: {
      status: "duplicate-tool-call",
      firstSummary: firstResult.summary,
    },
  };
}

// ---------------------------------------------------------------------------
// P2.2 Model Fallback — eligible error detection
// ---------------------------------------------------------------------------

function isFallbackEligibleError(code: string): boolean {
  const combined = code.toLowerCase();
  const eligiblePatterns = [
    "rate_limit", "rate-limit", "ratelimit",
    "overloaded", "overload",
    "503", "529",
    "service_unavailable", "service-unavailable",
    "model_not_available", "model-not-available", "model_unavailable",
    "capacity",
  ];
  return eligiblePatterns.some(p => combined.includes(p));
}

// ---------------------------------------------------------------------------
// P2.1 max_output_tokens Recovery — truncation detection
// ---------------------------------------------------------------------------

function isMaxTokensTruncated(metadata: { stopReason?: string } | undefined): boolean {
  if (!metadata?.stopReason) return false;
  const reason = metadata.stopReason.toLowerCase();
  return reason === "max_tokens" || reason === "length";
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

export async function runAgentTurn(input: AgentTurnRuntimeInput): Promise<AgentTurnEvent[]> {
  const events: AgentTurnEvent[] = [];
  const emit = (event: AgentTurnEvent) => { events.push(event); input.onEvent?.(event); };
  const messages = buildInitialMessages(input);

  // Append system prompt: 高优先级动态指令（当前目标/进行中任务）。
  // 不能用 role:"system" 推到 messages 末尾——Anthropic API 不接受 messages 数组里的
  // system role，会被 adapter 静默丢弃。改为以 <system-reminder> 形式追加到最后一条
  // user 消息（保留 recency bias，且所有 provider 都按 user 文本正常传递）。
  if (input.appendSystemPrompt?.trim()) {
    const reminder = `\n\n<system-reminder>\n${input.appendSystemPrompt.trim()}\n</system-reminder>`;
    let attached = false;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.type === "message" && m.role === "user") {
        messages[i] = { ...m, content: m.content + reminder };
        attached = true;
        break;
      }
    }
    // 没有 user 消息时，回退到合并进开头的 system 消息
    if (!attached) {
      const firstSystemIdx = messages.findIndex(m => m.type === "message" && m.role === "system");
      if (firstSystemIdx >= 0) {
        const sys = messages[firstSystemIdx] as Extract<AgentTurnItem, { type: "message" }>;
        messages[firstSystemIdx] = { ...sys, content: sys.content + reminder };
      } else {
        messages.unshift({ type: "message", role: "system", content: input.appendSystemPrompt.trim() });
      }
    }
  }

  // Per-turn file dedup — 独立实例，避免并发 turn 间互相污染
  const fileReadDeduplicator = createFileReadDeduplicator();
  // Content Replacement: store large tool results as references to save context
  const contentReplacementState = createContentReplacementState();
  const filteredTools = filterSessionToolsForProvider(input.tools, input.sessionConfig.toolPolicy, {
    permissionMode: input.permissionMode,
    ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
  });
  if (input.tools.length > 0 && filteredTools.tools.length === 0) {
    emit({
      type: "turn_failed",
      reason: "policy-disabled",
      message: "当前 session 工具策略禁用了所有可发送给模型的工具。",
      data: { deniedTools: filteredTools.deniedTools },
    });
    return events;
  }
  const maxSteps = Math.max(0, input.maxSteps ?? 30);
  let executedToolSteps = 0;
  let hasAttemptedOverflowRecovery = false;
  const recentToolCalls: string[] = [];
  const toolResultsBySignature = new Map<string, SessionToolExecutionResult>();

  // P2.1: max_output_tokens recovery state
  let maxOutputTokensRecoveryCount = 0;
  let maxOutputTokensOverride: number | undefined = input.maxOutputTokensOverride;

  // P2.2: model fallback state
  let hasAttemptedFallback = false;
  let currentSessionConfig = input.sessionConfig;
  let hasInjectedBlockingWarning = false;

  // Budget Pressure: 跟踪 provider 报告的最近一次 input_tokens
  let lastInputTokens = 0;
  // Subtract output reserve (32K default max_output) so budget pressure thresholds
  // are relative to the USABLE input window, not the total context window.
  const contextWindowTokens = Math.max(0, (input.contextWindowTokens ?? 0) - 32768);

  // Fix: silentToolCallThreshold — 跟踪连续无文本输出的工具调用次数
  let consecutiveSilentToolCalls = 0;
  const silentThreshold = input.silentToolCallThreshold ?? -1; // -1 = disabled

  // P4: Blocking TurnComplete hook retry guard (max 2 retries)
  let turnCompleteHookRetries = 0;

  // --- Turn health monitor & checkpoint state ---
  const turnId = `${input.sessionId}:${Date.now()}`;
  const systemHints: string[] = [];
  const completedToolRecords: ToolExecutionRecord[] = [];
  const turnHealthMonitor = new TurnHealthMonitor({
    loopDetectionThreshold: input.sessionConfig?.loopDetectionThreshold ?? 0.8,
    tokenConsumptionWarnRatio: input.sessionConfig?.tokenConsumptionWarnRatio ?? 0.5,
    contextWindowTokens: 200_000,
    maxConsecutiveFailures: input.sessionConfig?.maxConsecutiveFailures ?? 5,
  });

  const emitStreamChunk = input.onStreamChunk
    ? (chunk: string) => {
        events.push({ type: "streaming_chunk", content: chunk });
        input.onStreamChunk!(chunk);
      }
    : undefined;

  const emitToolEvent = input.onToolEvent;

  for (;;) {
    if (input.signal?.aborted) {
      log.info("Agent turn aborted", { sessionId: input.sessionId, executedToolSteps });
      emit({ type: "turn_completed" });
      return events;
    }

    const generateStartedAt = Date.now();
    let firstChunkAt: number | undefined;
    const ttftStreamChunk = emitStreamChunk
      ? (chunk: string) => {
          if (!firstChunkAt) firstChunkAt = Date.now();
          emitStreamChunk(chunk);
        }
      : undefined;

    // In-flight microcompact: fold old tool results if context is growing too large
    // This prevents 413 errors during long tool-call loops (aligns with legnacode's per-iteration microcompact)
    if (contextWindowTokens > 0 && lastInputTokens > 0) {
      const usageRatio = lastInputTokens / contextWindowTokens;
      if (usageRatio >= 0.60 && messages.length > 20) {
        // Fold tool_result messages older than the last 6 (keep recent for context)
        const keepRecent = 6;
        let foldedCount = 0;
        for (let i = 0; i < messages.length - keepRecent; i++) {
          const m = messages[i];
          if (m.type === "tool_result" && m.content && m.content.length > 500) {
            messages[i] = { ...m, content: `[已折叠: ${m.name ?? "tool"} 输出 ${m.content.length} 字符]` };
            foldedCount++;
          }
        }
        if (foldedCount > 0) {
          log.info("In-flight microcompact", { foldedCount, usageRatio: Math.round(usageRatio * 100), messageCount: messages.length });
        }
      }
    }

    // P2.4: Blocking limit pre-check — proactive compact trigger at 97%+
    if (!hasInjectedBlockingWarning && contextWindowTokens > 0 && lastInputTokens > 0) {
      const ratio = lastInputTokens / contextWindowTokens;
      if (ratio >= BLOCKING_LIMIT_THRESHOLD) {
        hasInjectedBlockingWarning = true;
        messages.push({
          type: "message",
          role: "system",
          content: `[⛔ 上下文已达 ${Math.round(ratio * 100)}%，即将溢出。请立即停止工具调用，输出已完成的结果后结束本轮。]`,
        });
      }
    }

    const reply = await input.generate({
      sessionConfig: currentSessionConfig,
      messages,
      tools: filteredTools.tools,
      permissionMode: input.permissionMode,
      ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
      ...(ttftStreamChunk ? { onStreamChunk: ttftStreamChunk } : {}),
      ...(emitToolEvent ? { onToolEvent: emitToolEvent } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(maxOutputTokensOverride ? { maxOutputTokensOverride } : {}),
    });
    const generateDurationMs = Date.now() - generateStartedAt;
    const ttftMs = firstChunkAt ? firstChunkAt - generateStartedAt : undefined;

    // Log AI request for usage history
    logRequest({
      timestamp: new Date().toISOString(),
      method: "AI",
      endpoint: "agent-turn",
      status: reply.success ? 200 : 500,
      duration: generateDurationMs,
      ttftMs,
      userId: "system",
      requestKind: "agent-turn",
      narrator: input.sessionId,
      provider: reply.success ? (reply.metadata.providerName || reply.metadata.providerId) : (reply.metadata?.providerName || reply.metadata?.providerId),
      model: reply.success ? reply.metadata.modelId : reply.metadata?.modelId,
      tokens: normalizeTokenUsage(
        reply.success && reply.metadata.usage
          ? {
              input: reply.metadata.usage.input_tokens,
              output: reply.metadata.usage.output_tokens,
              total: (reply.metadata.usage.input_tokens ?? 0) + (reply.metadata.usage.output_tokens ?? 0),
            }
          : undefined,
      ),
      // 缓存信息：从 provider usage 中提取
      cache: reply.success && reply.metadata.usage?.cache_read_input_tokens
        ? { status: "hit" as const, scope: "prompt" }
        : reply.success && reply.metadata.usage?.cache_creation_input_tokens
          ? { status: "miss" as const, scope: "prompt" }
          : undefined,
      requestDomain: "ai",
      sessionId: input.sessionId,
      ...(reply.success ? {} : { aiStatus: "error", errorSummary: reply.error }),
    });

    if (!reply.success) {
      // User-aborted: silent completion (not an error)
      if (reply.code === "user-aborted") {
        log.info("Generate aborted by user", { sessionId: input.sessionId, durationMs: generateDurationMs });
        emit({ type: "turn_completed" });
        return events;
      }

      const errorCode = classifyError(reply.code || reply.error, { startedAtMs: generateStartedAt, totalDurationMs: generateDurationMs, firstTokenAtMs: firstChunkAt });
      const userMessage = getErrorUserMessage(errorCode);
      log.warn("Generate failed", { sessionId: input.sessionId, code: reply.code, error: reply.error, errorCode, userMessage, durationMs: generateDurationMs });

      // P2.2: Model fallback — switch to backup model on eligible errors
      if (input.fallbackModel && !hasAttemptedFallback && isFallbackEligibleError(reply.code || reply.error)) {
        hasAttemptedFallback = true;
        log.warn("Model fallback triggered", { sessionId: input.sessionId, from: currentSessionConfig.modelId, to: input.fallbackModel, triggerCode: reply.code });
        currentSessionConfig = { ...currentSessionConfig, modelId: input.fallbackModel };
        messages.push({
          type: "message",
          role: "system",
          content: `[系统] 模型暂时不可用，已自动切换至备用模型 ${input.fallbackModel}`,
        });
        continue;
      }

      // Attempt context overflow recovery (max 2 retries, progressively more aggressive)
      if (!hasAttemptedOverflowRecovery && isContextOverflowError(reply.code, reply.error)) {
        hasAttemptedOverflowRecovery = true;
        const originalCount = messages.length;
        const truncated = emergencyTruncateMessages(messages);

        if (truncated.length < originalCount) {
          log.warn("Context overflow detected", { sessionId: input.sessionId, originalCount, truncatedCount: truncated.length });

          // Replace messages with truncated version
          messages.length = 0;
          messages.push(...truncated);

          log.info("Context overflow retry", { sessionId: input.sessionId, messageCount: messages.length });

          // Retry generate with truncated messages
          const retryStartedAt = Date.now();
          const retryReply = await input.generate({
            sessionConfig: currentSessionConfig,
            messages,
            tools: filteredTools.tools,
            permissionMode: input.permissionMode,
            ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
            ...(emitStreamChunk ? { onStreamChunk: emitStreamChunk } : {}),
            ...(emitToolEvent ? { onToolEvent: emitToolEvent } : {}),
            ...(input.signal ? { signal: input.signal } : {}),
            ...(maxOutputTokensOverride ? { maxOutputTokensOverride } : {}),
          });
          const retryDurationMs = Date.now() - retryStartedAt;

          // Log retry AI request for usage history
          logRequest({
            timestamp: new Date().toISOString(),
            method: "AI",
            endpoint: "agent-turn",
            status: retryReply.success ? 200 : 500,
            duration: retryDurationMs,
            userId: "system",
            requestKind: "agent-turn-retry",
            narrator: input.sessionId,
            provider: retryReply.success ? (retryReply.metadata.providerName || retryReply.metadata.providerId) : (retryReply.metadata?.providerName || retryReply.metadata?.providerId),
            model: retryReply.success ? retryReply.metadata.modelId : retryReply.metadata?.modelId,
            tokens: normalizeTokenUsage(
              retryReply.success && retryReply.metadata.usage
                ? {
                    input: retryReply.metadata.usage.input_tokens,
                    output: retryReply.metadata.usage.output_tokens,
                    total: (retryReply.metadata.usage.input_tokens ?? 0) + (retryReply.metadata.usage.output_tokens ?? 0),
                  }
                : undefined,
            ),
            requestDomain: "ai",
            sessionId: input.sessionId,
            ...(retryReply.success ? {} : { aiStatus: "error", errorSummary: retryReply.error }),
          });

          if (retryReply.success) {
            log.info("Context overflow recovery success", { sessionId: input.sessionId });
            // Re-assign and continue the loop by processing retryReply below
            // We need to handle the retryReply the same way as a normal reply
            if (retryReply.type !== "tool_use") {
              const content = retryReply.content.trim();
              if (!content) {
                emit({ type: "turn_failed", reason: "empty-response", message: "Agent runtime returned an empty response after overflow recovery" });
                return events;
              }
              consecutiveSilentToolCalls = 0;
              emit({ type: "assistant_message", content, reasoningContent: retryReply.reasoningContent, runtime: retryReply.metadata });
              emit({ type: "turn_completed" });
              return events;
            }
            // For tool_use after recovery, push tool calls into messages and continue the loop
            // We'll let the next iteration handle it by injecting an assistant placeholder
            // Actually, we need to process tool_use inline here — fall through won't work cleanly.
            // Simplest: re-enter the loop by using `continue` after setting up state.
            // But we can't reassign `reply` (const). Instead, just continue — next iteration will re-generate.
            // The truncated messages are already set, so next loop iteration will call generate() again.
            // But wait — we already got a successful retryReply with tool_use. We should not re-generate.
            // Best approach: push the tool uses as messages and continue the loop to execute them.
            if (retryReply.reasoningContent) {
              const retryPolicy = input.reasoningPolicy ?? "passback-on-tool-loop";
              if (retryPolicy !== "strip") {
                messages.push({ type: "message", role: "assistant", content: "", reasoning_content: retryReply.reasoningContent });
              }
            }
            for (const toolUse of retryReply.toolUses) {
              if (executedToolSteps >= maxSteps) {
                emit({ type: "turn_failed", reason: "tool-loop-limit", message: `工具循环超过 ${maxSteps} 步，已停止本轮调用。可在设置 → AI 代理 → 每条消息最大轮次中调高此限制。`, data: { maxSteps, recentToolCalls } });
                return events;
              }
              emit({ type: "tool_call", id: toolUse.id, toolName: toolUse.name, input: toolUse.input, runtime: retryReply.metadata });
              messages.push({ type: "tool_call", id: toolUse.id, name: toolUse.name, input: toolUse.input });
              recentToolCalls.push(toolUse.name);

              const toolStartedAt = Date.now();
              const signature = toolSignature(toolUse.name, toolUse.input);
              const duplicateResult = toolResultsBySignature.get(signature);
              const toolResult = duplicateResult
                ? createDuplicateToolResult(duplicateResult)
                : await withToolTimeout(
                    input.executeTool({
                      sessionId: input.sessionId,
                      toolName: toolUse.name,
                      toolCallId: toolUse.id,
                      input: toolUse.input,
                      permissionMode: input.permissionMode,
                      sessionConfig: input.sessionConfig,
                      ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
                      ...(input.signal ? { signal: input.signal } : {}),
                    }),
                    input.toolTimeoutMs ?? 120000,
                    toolUse.name,
                    input.signal,
                  );
              const toolDurationMs = Date.now() - toolStartedAt;
              executedToolSteps += 1;
              log.info("Tool executed", { sessionId: input.sessionId, toolName: toolUse.name, ok: toolResult.ok, durationMs: toolDurationMs, duplicate: Boolean(duplicateResult), step: executedToolSteps });
              if (!duplicateResult) {
                toolResultsBySignature.set(signature, toolResult);
              }
              emit({ type: "tool_result", id: toolUse.id, toolName: toolUse.name, result: toolResult, runtime: retryReply.metadata });
              messages.push({
                type: "tool_result",
                toolCallId: toolUse.id,
                name: toolUse.name,
                content: toolResultContent(toolResult, toolUse.name, toolUse.input, fileReadDeduplicator, contentReplacementState) + buildBudgetPressureNotice(lastInputTokens, contextWindowTokens),
                ...(toolResult.data !== undefined ? { data: toolResult.data } : {}),
                metadata: { toolResult },
              });

              if (isPendingConfirmationResult(toolResult)) {
                emit({ type: "confirmation_required", id: toolResult.confirmation?.id ?? toolUse.id, toolName: toolUse.name, result: toolResult, sourceToolUseId: toolUse.id });
                return events;
              }
              if (input.shouldContinueAfterToolResult && !input.shouldContinueAfterToolResult({ toolName: toolUse.name, result: toolResult })) {
                emit({ type: "turn_failed", reason: toolResult.error ?? "tool-execution-failed", message: toolResult.summary });
                return events;
              }
              consecutiveSilentToolCalls += 1;
            }
            // After processing retry tool uses, continue the main loop for next generate
            continue;
          } else {
            log.warn("Context overflow recovery failed", { sessionId: input.sessionId, code: retryReply.code });
            // Fall through to emit failure with the retry's error
            emit(buildFailureEvent(retryReply));
            return events;
          }
        }
      }

      emit(buildFailureEvent(reply));
      return events;
    }

    const usage = reply.metadata?.usage;
    log.info("Generate OK", { sessionId: input.sessionId, type: reply.type ?? "message", durationMs: generateDurationMs, ...(usage ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } : {}) });

    // Feed token usage to health monitor
    if (usage) {
      turnHealthMonitor.addTokenUsage((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0));
      // Budget Pressure: 记录真实 input_tokens 用于上下文使用率提醒
      if (usage.input_tokens && usage.input_tokens > 0) {
        lastInputTokens = usage.input_tokens;
      }
    }

    if (reply.type !== "tool_use") {
      const content = reply.content.trim();

      // P2.1: max_output_tokens recovery — MUST check before empty-response fail
      // When stop_reason=max_tokens, content may be empty/1-char (truncated before meaningful output)
      if (isMaxTokensTruncated(reply.metadata) && maxOutputTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
        maxOutputTokensRecoveryCount++;
        log.info("Max output tokens recovery", { sessionId: input.sessionId, attempt: maxOutputTokensRecoveryCount, stopReason: reply.metadata?.stopReason, contentLength: content.length });

        // Push the truncated assistant message to context (if non-empty)
        if (content) {
          messages.push({ type: "message", role: "assistant", content });
        }

        if (maxOutputTokensRecoveryCount === 1 && !maxOutputTokensOverride) {
          // First recovery: escalate max_output_tokens
          maxOutputTokensOverride = ESCALATED_MAX_TOKENS;
        } else {
          // Subsequent recoveries: inject a recovery user message
          messages.push({
            type: "message",
            role: "user",
            content: "Output token limit hit. Resume directly — no apology, no recap. Pick up mid-thought. Break remaining work into smaller pieces.",
          });
        }
        continue;
      }

      if (!content) {
        emit({ type: "turn_failed", reason: "empty-response", message: "Agent runtime returned an empty response" });
        return events;
      }

      // Detect malformed XML tool calls in assistant text (model regression fallback)
      const xmlToolPattern = /<(?:tool_use|invoke|antml:invoke)\s+(?:id|name)=/;
      if (xmlToolPattern.test(content)) {
        log.warn("XML tool_use in text detected", { sessionId: input.sessionId, contentPreview: content.slice(0, 200) });
        emit({ type: "turn_failed", reason: "malformed-tool-call", message: "模型输出了格式异常的工具调用，请重试。" });
        return events;
      }

      consecutiveSilentToolCalls = 0;

      // P4: Blocking TurnComplete hooks — allow external validators to inject corrections
      if (input.onTurnComplete && turnCompleteHookRetries < 2) {
        const hookMessages = await input.onTurnComplete({
          lastAssistantContent: content,
          toolsUsed: recentToolCalls,
        });
        if (hookMessages && hookMessages.length > 0) {
          turnCompleteHookRetries++;
          // Inject blocking errors and continue the turn
          messages.push({ type: "message", role: "assistant", content });
          for (const msg of hookMessages) {
            messages.push({ type: "message", role: "system", content: `[TurnComplete Hook] ${msg}` });
          }
          log.info("Turn complete hook blocking", { sessionId: input.sessionId, hookCount: hookMessages.length });
          continue;
        }
      }

      emit(
        { type: "assistant_message", content, reasoningContent: reply.reasoningContent, runtime: reply.metadata },
      );
      // Clear checkpoint on successful completion
      if (input.sessionConfig?.turnCheckpointEnabled !== false) {
        clearTurnCheckpoint(input.sessionId, turnId);
      }
      emit(
        { type: "turn_completed" },
      );
      return events;
    }

    if (reply.toolUses.length === 0) {
      emit({ type: "turn_failed", reason: "empty-tool-use", message: "Agent runtime received a tool_use reply without executable tools" });
      return events;
    }

    // P4: Reset hook retry counter when tools are executed (agent is working, not repeating)
    turnCompleteHookRetries = 0;

    // Insert assistant message with reasoning_content before tool calls
    // Controlled by reasoningPolicy: strip (never), passback-on-tool-loop (default, tool loops only), always-passback (always)
    // NOTE: DeepSeek requires reasoning_content to be on the same assistant message as tool_calls.
    // We push it as a standalone message here; toOpenAiMessages will merge it with the following tool_calls.
    const policy = input.reasoningPolicy ?? "passback-on-tool-loop";
    if (reply.reasoningContent && policy !== "strip") {
      log.info("Pushing reasoning to context", { length: reply.reasoningContent.length, signatureLength: reply.reasoningSignature?.length ?? 0 });
      messages.push({ type: "message", role: "assistant", content: "", reasoning_content: reply.reasoningContent, reasoning_signature: reply.reasoningSignature });
    } else if (reply.type === "tool_use") {
      log.info("Tool use reply without reasoning", { policy, hasRC: !!reply.reasoningContent });
    }

    // Determine if all tools in this batch are read-only (parallelizable)
    const PARALLEL_SAFE_TOOLS = new Set([
      "Read", "Glob", "Grep", "WebSearch", "WebFetch",
      "GetGoals", "LearningGuide", "Recall",
    ]);

    const allParallelSafe = reply.toolUses.length > 1 && reply.toolUses.every(tu => PARALLEL_SAFE_TOOLS.has(tu.name));

    if (allParallelSafe) {
      // --- Parallel execution path ---
      // Pre-check: enough steps remaining?
      if (executedToolSteps + reply.toolUses.length > maxSteps) {
        emit({
          type: "turn_failed",
          reason: "tool-loop-limit",
          message: `工具循环超过 ${maxSteps} 步，已停止本轮调用。可在设置 → AI 代理 → 每条消息最大轮次中调高此限制。`,
          data: { maxSteps, recentToolCalls },
        });
        return events;
      }

      log.info("Parallel tool execution", { count: reply.toolUses.length, sessionId: input.sessionId });

      // Emit all tool_call events first
      for (const toolUse of reply.toolUses) {
        emit({
          type: "tool_call",
          id: toolUse.id,
          toolName: toolUse.name,
          input: toolUse.input,
          runtime: reply.metadata,
        });
        messages.push({ type: "tool_call", id: toolUse.id, name: toolUse.name, input: toolUse.input });
        recentToolCalls.push(toolUse.name);
      }

      // Execute all tools in parallel
      const parallelResults = await Promise.all(
        reply.toolUses.map(async (toolUse) => {
          const toolStartedAt = Date.now();
          const signature = toolSignature(toolUse.name, toolUse.input);
          const duplicateResult = toolResultsBySignature.get(signature);
          let toolResult: SessionToolExecutionResult;
          try {
            toolResult = duplicateResult
              ? createDuplicateToolResult(duplicateResult)
              : await withToolTimeout(
                  input.executeTool({
                    sessionId: input.sessionId,
                    toolName: toolUse.name,
                    toolCallId: toolUse.id,
                    input: toolUse.input,
                    permissionMode: input.permissionMode,
                    sessionConfig: input.sessionConfig,
                    ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
                    ...(input.signal ? { signal: input.signal } : {}),
                  }),
                  input.toolTimeoutMs ?? 120000,
                  toolUse.name,
                  input.signal,
                );
          } catch (err) {
            log.error("Tool execution error", { sessionId: input.sessionId, toolName: toolUse.name, error: err instanceof Error ? err.message : String(err) });
            toolResult = { ok: false, error: "tool-execution-error", summary: `工具 ${toolUse.name} 执行异常: ${err instanceof Error ? err.message : String(err)}` };
          }
          const toolDurationMs = Date.now() - toolStartedAt;
          return { toolUse, toolResult, toolDurationMs, signature, isDuplicate: Boolean(duplicateResult) };
        }),
      );

      // Process results sequentially to maintain event order
      for (let { toolUse, toolResult, toolDurationMs, signature, isDuplicate } of parallelResults) {
        if (input.signal?.aborted) {
          emit({ type: "turn_completed" });
          return events;
        }

        executedToolSteps += 1;
        log.info("Tool executed", { sessionId: input.sessionId, toolName: toolUse.name, ok: toolResult.ok, durationMs: toolDurationMs, duplicate: isDuplicate, step: executedToolSteps });
        if (!isDuplicate) {
          toolResultsBySignature.set(signature, toolResult);
        }

        emit({
          type: "tool_result",
          id: toolUse.id,
          toolName: toolUse.name,
          result: toolResult,
          runtime: reply.metadata,
        });
        messages.push({
          type: "tool_result",
          toolCallId: toolUse.id,
          name: toolUse.name,
          content: toolResultContent(toolResult, toolUse.name, toolUse.input, fileReadDeduplicator, contentReplacementState) + buildBudgetPressureNotice(lastInputTokens, contextWindowTokens),
          ...(toolResult.data !== undefined ? { data: toolResult.data } : {}),
          metadata: { toolResult },
        });

        if (isPendingConfirmationResult(toolResult)) {
          emit({
            type: "confirmation_required",
            id: toolResult.confirmation?.id ?? toolUse.id,
            toolName: toolUse.name,
            result: toolResult,
            sourceToolUseId: toolUse.id,
          });
          return events;
        }

        if (input.shouldContinueAfterToolResult && !input.shouldContinueAfterToolResult({ toolName: toolUse.name, result: toolResult })) {
          emit({
            type: "turn_failed",
            reason: toolResult.error ?? "tool-execution-failed",
            message: toolResult.summary,
          });
          return events;
        }

        consecutiveSilentToolCalls += 1;

        // --- Health monitor check ---
        const parallelHealthResult = turnHealthMonitor.checkHealth({
          name: toolUse.name,
          input: toolUse.input as Record<string, unknown>,
          output: toolResult.summary ?? JSON.stringify(toolResult.data ?? ""),
          success: toolResult.ok,
          timestamp: Date.now(),
        });

        if (parallelHealthResult.action === "stop") {
          emit({ type: "turn_failed", reason: "health-check", message: parallelHealthResult.message ?? "健康检查终止", data: { reason: parallelHealthResult.reason } });
          return events;
        }

        if (parallelHealthResult.action === "warn" && parallelHealthResult.message) {
          systemHints.push(parallelHealthResult.message);
        }

        // --- Checkpoint save (fire-and-forget) ---
        const parallelCheckpointRecord: ToolExecutionRecord = {
          toolUseId: toolUse.id,
          toolName: toolUse.name,
          input: toolUse.input as Record<string, unknown>,
          output: (toolResult.summary ?? JSON.stringify(toolResult.data ?? "")).slice(0, 10000),
          status: toolResult.ok ? "success" : "error",
        };
        completedToolRecords.push(parallelCheckpointRecord);
        if (input.sessionConfig?.turnCheckpointEnabled !== false) {
          saveTurnCheckpoint({
            sessionId: input.sessionId,
            turnId,
            step: executedToolSteps,
            completedToolResults: completedToolRecords,
            lastAssistantContent: undefined,
            createdAt: Date.now(),
          });
        }
      }
    } else {
      // --- Sequential execution path (existing behavior) ---
      for (const toolUse of reply.toolUses) {
        if (executedToolSteps >= maxSteps) {
          emit({
            type: "turn_failed",
            reason: "tool-loop-limit",
            message: `工具循环超过 ${maxSteps} 步，已停止本轮调用。可在设置 → AI 代理 → 每条消息最大轮次中调高此限制。`,
            data: { maxSteps, recentToolCalls },
          });
          return events;
        }

        emit({
          type: "tool_call",
          id: toolUse.id,
          toolName: toolUse.name,
          input: toolUse.input,
          runtime: reply.metadata,
        });
        messages.push({ type: "tool_call", id: toolUse.id, name: toolUse.name, input: toolUse.input });
        recentToolCalls.push(toolUse.name);

        const toolStartedAt = Date.now();
        const signature = toolSignature(toolUse.name, toolUse.input);
        const duplicateResult = toolResultsBySignature.get(signature);
        let toolResult: SessionToolExecutionResult;
        try {
          toolResult = duplicateResult
            ? createDuplicateToolResult(duplicateResult)
            : await withToolTimeout(
                input.executeTool({
                  sessionId: input.sessionId,
                  toolName: toolUse.name,
                  toolCallId: toolUse.id,
                  input: toolUse.input,
                  permissionMode: input.permissionMode,
                  sessionConfig: input.sessionConfig,
                  ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
                  ...(input.signal ? { signal: input.signal } : {}),
                }),
                input.toolTimeoutMs ?? 120000,
                toolUse.name,
                input.signal,
              );        } catch (err) {
          log.error("Tool execution error", { sessionId: input.sessionId, toolName: toolUse.name, error: err instanceof Error ? err.message : String(err) });
          toolResult = { ok: false, error: "tool-execution-error", summary: `工具 ${toolUse.name} 执行异常: ${err instanceof Error ? err.message : String(err)}` };
        }
        const toolDurationMs = Date.now() - toolStartedAt;
        executedToolSteps += 1;
        log.info("Tool executed", { sessionId: input.sessionId, toolName: toolUse.name, ok: toolResult.ok, durationMs: toolDurationMs, duplicate: Boolean(duplicateResult), step: executedToolSteps });
        if (!duplicateResult) {
          toolResultsBySignature.set(signature, toolResult);
        }

        emit({
          type: "tool_result",
          id: toolUse.id,
          toolName: toolUse.name,
          result: toolResult,
          runtime: reply.metadata,
        });
        messages.push({
          type: "tool_result",
          toolCallId: toolUse.id,
          name: toolUse.name,
          content: toolResultContent(toolResult, toolUse.name, toolUse.input, fileReadDeduplicator, contentReplacementState) + buildBudgetPressureNotice(lastInputTokens, contextWindowTokens),
          ...(toolResult.data !== undefined ? { data: toolResult.data } : {}),
          metadata: { toolResult },
        });

        if (isPendingConfirmationResult(toolResult)) {
          emit({
            type: "confirmation_required",
            id: toolResult.confirmation?.id ?? toolUse.id,
            toolName: toolUse.name,
            result: toolResult,
            sourceToolUseId: toolUse.id,
          });
          return events;
        }

        if (input.shouldContinueAfterToolResult && !input.shouldContinueAfterToolResult({ toolName: toolUse.name, result: toolResult })) {
          emit({
            type: "turn_failed",
            reason: toolResult.error ?? "tool-execution-failed",
            message: toolResult.summary,
          });
          return events;
        }

        // Fix: silentToolCallThreshold — 递增连续无文本输出计数
        consecutiveSilentToolCalls += 1;

        // --- Health monitor check ---
        const seqHealthResult = turnHealthMonitor.checkHealth({
          name: toolUse.name,
          input: toolUse.input as Record<string, unknown>,
          output: toolResult.summary ?? JSON.stringify(toolResult.data ?? ""),
          success: toolResult.ok,
          timestamp: Date.now(),
        });

        if (seqHealthResult.action === "stop") {
          emit({ type: "turn_failed", reason: "health-check", message: seqHealthResult.message ?? "健康检查终止", data: { reason: seqHealthResult.reason } });
          return events;
        }

        if (seqHealthResult.action === "warn" && seqHealthResult.message) {
          systemHints.push(seqHealthResult.message);
        }

        // --- Checkpoint save (fire-and-forget) ---
        const seqCheckpointRecord: ToolExecutionRecord = {
          toolUseId: toolUse.id,
          toolName: toolUse.name,
          input: toolUse.input as Record<string, unknown>,
          output: (toolResult.summary ?? JSON.stringify(toolResult.data ?? "")).slice(0, 10000),
          status: toolResult.ok ? "success" : "error",
        };
        completedToolRecords.push(seqCheckpointRecord);
        if (input.sessionConfig?.turnCheckpointEnabled !== false) {
          saveTurnCheckpoint({
            sessionId: input.sessionId,
            turnId,
            step: executedToolSteps,
            completedToolResults: completedToolRecords,
            lastAssistantContent: undefined,
            createdAt: Date.now(),
          });
        }
      }
    }

    // Fix: silentToolCallThreshold — 超过阈值时注入提示
    if (silentThreshold > 0 && consecutiveSilentToolCalls >= silentThreshold) {
      messages.push({
        type: "message",
        role: "system",
        content: `注意：你已经连续执行了 ${consecutiveSilentToolCalls} 次工具调用而没有向用户输出任何文字。请在下一步中向用户汇报当前进展或结果。`,
      });
    }

    // --- Inject health monitor warnings as system hints for next generate ---
    if (systemHints.length > 0) {
      const hintContent = systemHints.join("\n");
      messages.push({ type: "message", role: "system", content: `[运行时提示] ${hintContent}` });
      systemHints.length = 0;
    }
  }
}

function withToolTimeout(
  promise: Promise<SessionToolExecutionResult>,
  timeoutMs: number,
  toolName: string,
  signal?: AbortSignal,
): Promise<SessionToolExecutionResult> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (result: SessionToolExecutionResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const effectiveTimeoutMs = toolName === "candidate.create_chapter" ? Math.max(timeoutMs, 180000) : timeoutMs;
    const timer = setTimeout(() => {
      done({
        ok: false,
        error: "tool-timeout",
        summary: `工具 ${toolName} 执行超时（${Math.round(effectiveTimeoutMs / 1000)}s）。`,
      });
    }, effectiveTimeoutMs);

    const onAbort = () => {
      done({
        ok: false,
        error: "tool-aborted",
        summary: `工具 ${toolName} 已被用户中断。`,
      });
    };
    if (signal?.aborted) { done({ ok: false, error: "tool-aborted", summary: `工具 ${toolName} 已被用户中断。` }); return; }
    signal?.addEventListener("abort", onAbort, { once: true });

    promise.then((result) => {
      done(result);
    }).catch((error) => {
      done({
        ok: false,
        error: "tool-execution-error",
        summary: `工具 ${toolName} 执行异常：${error instanceof Error ? error.message : String(error)}`,
      });
    });
  });
}
