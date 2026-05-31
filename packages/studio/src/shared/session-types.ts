import type { AgentNativeMessageMetadata, AgentNativeToolMetadata, CanvasContext, SessionToolExecutionResult } from "./agent-native-workspace.js";
import type { ToolAccessReasonKey } from "./tool-access-reasons.js";

export const SESSION_PERMISSION_MODES = ["ask", "edit", "allow", "read", "plan"] as const;
export type SessionPermissionMode = (typeof SESSION_PERMISSION_MODES)[number];
export type SessionReasoningEffort = "low" | "medium" | "high";

export interface SessionPermissionModeOption {
  value: SessionPermissionMode;
  label: string;
  shortLabel: string;
  description: string;
  bestFor: string;
}

export const SESSION_PERMISSION_MODE_OPTIONS: readonly SessionPermissionModeOption[] = [
  {
    value: "ask",
    label: "逐项询问",
    shortLabel: "询问",
    description: "所有工具动作先停下来给出权限提示，由作者逐项批准或拒绝。",
    bestFor: "新书磨合、陌生 Agent、边界不确定的会话",
  },
  {
    value: "edit",
    label: "允许编辑",
    shortLabel: "可编辑",
    description: "允许读取、检索和改写正文/经纬文件；Shell、Worktree、外部 MCP 仍需确认。",
    bestFor: "写作会话、章节续写、可回滚的正文修订",
  },
  {
    value: "allow",
    label: "全部允许",
    shortLabel: "全允许",
    description: "默认放行读写、Shell、Worktree 与工具链动作，仅保留显式 blocklist。",
    bestFor: "已隔离的临时实验、可信自动化批处理",
  },
  {
    value: "read",
    label: "只读",
    shortLabel: "只读",
    description: "只允许读取和检索上下文，拒绝写入、Shell 与 Worktree，输出审稿意见不直接改稿。",
    bestFor: "审稿会话、连续性排查、发布前检查",
  },
  {
    value: "plan",
    label: "规划模式",
    shortLabel: "规划",
    description: "允许查阅素材并产出计划，不允许直接改正文、设定或执行工程化动作。",
    bestFor: "大纲规划、卷纲拆解、复杂任务先想清楚",
  },
] as const;

export const SESSION_PERMISSION_MODE_LABELS: Record<SessionPermissionMode, string> = Object.fromEntries(
  SESSION_PERMISSION_MODE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<SessionPermissionMode, string>;

export function isSessionPermissionMode(value: unknown): value is SessionPermissionMode {
  return typeof value === "string" && (SESSION_PERMISSION_MODES as readonly string[]).includes(value);
}

export function normalizeSessionPermissionMode(value: unknown, fallback: SessionPermissionMode = "edit"): SessionPermissionMode {
  if (isSessionPermissionMode(value)) {
    return value;
  }

  if (value === "deny") {
    return "read";
  }

  return fallback;
}

export function getSessionPermissionModeOption(mode: SessionPermissionMode): SessionPermissionModeOption {
  return SESSION_PERMISSION_MODE_OPTIONS.find((option) => option.value === mode) ?? SESSION_PERMISSION_MODE_OPTIONS[0]!;
}

export function getSessionPermissionModeLabel(mode: SessionPermissionMode): string {
  return getSessionPermissionModeOption(mode).label;
}

export function getSessionPermissionModeDescription(mode: SessionPermissionMode): string {
  return getSessionPermissionModeOption(mode).description;
}

export function getRecommendedSessionPermissionMode(input: {
  readonly agentId?: string;
  readonly sessionMode?: NarratorSessionMode;
}): SessionPermissionMode {
  const agentId = input.agentId?.toLowerCase() ?? "";

  if (input.sessionMode === "plan" || agentId.includes("planner") || agentId.includes("plan")) {
    return "plan";
  }

  if (agentId.includes("explorer") || agentId.includes("auditor") || agentId.includes("audit") || agentId.includes("review") || agentId.includes("continuity")) {
    return "read";
  }

  if (agentId.includes("architect") || agentId.includes("setting") || agentId.includes("settler") || agentId.includes("world")) {
    return "ask";
  }

  if (agentId.includes("writer") || agentId.includes("composer") || agentId.includes("reviser")) {
    return "edit";
  }

  return "ask";
}

export interface SessionToolPolicy {
  allow?: string[];
  deny?: string[];
  ask?: string[];
}

export interface SessionConfig {
  providerId: string;
  modelId: string;
  permissionMode: SessionPermissionMode;
  reasoningEffort: SessionReasoningEffort;
  serviceTier?: "default" | "priority";
  toolPolicy?: SessionToolPolicy;
  mode?: "normal" | "plan";
  /** Project type for scope-based tool filtering (e.g. "novel", "general") */
  projectType?: string;
  // --- Agent Runtime Hardening ---
  /** YOLO mode: auto-approve safe and write-level tools without confirmation */
  yoloMode?: boolean;
  /** Safety reflection: use current model to judge dangerous ops in YOLO mode */
  safetyReflection?: boolean;
  /** Safety reflection timeout in ms (default 15000) */
  safetyReflectionTimeoutMs?: number;
  /** Enable cascade compaction for long conversations */
  cascadeCompactEnabled?: boolean;
  /** Enable turn checkpoint for interrupt recovery */
  turnCheckpointEnabled?: boolean;
  /** Auto-recover interrupted turns on server startup */
  autoRecoverOnStartup?: boolean;
  /** Loop detection similarity threshold (0-1, default 0.8) */
  loopDetectionThreshold?: number;
  /** Token consumption warning ratio (0-1, default 0.5) */
  tokenConsumptionWarnRatio?: number;
  /** Max consecutive tool failures before force-stopping turn (default 5) */
  maxConsecutiveFailures?: number;
  /** Context cutoff: messages with seq <= this value are excluded from model context but preserved in history for viewing */
  contextCutoffSeq?: number;
}

export type NarratorSessionKind = "standalone" | "chapter";
export type NarratorSessionStatus = "active" | "archived";
export type NarratorSessionMode = "chat" | "plan";

export interface NarratorSessionRecoveryMetadata {
  lastSeq: number;
  lastAckedSeq: number;
  availableFromSeq: number;
  pendingMessageCount: number;
  pendingToolCallCount: number;
  pendingToolCallSummary?: string[];
  lastFailure?: {
    reason: string;
    message: string;
    at: string;
  };
  updatedAt: string;
}

export interface SessionGoal {
  id: string;
  objective: string;
  status: "active" | "pending" | "paused" | "complete";
  createdAt: string;
}

export interface NarratorSessionRecord {
  id: string;
  title: string;
  agentId: string;
  kind: NarratorSessionKind;
  sessionMode: NarratorSessionMode;
  status: NarratorSessionStatus;
  createdAt: string;
  lastModified: string;
  messageCount: number;
  sortOrder: number;
  worktree?: string;
  chapterId?: string;
  projectId?: string;
  parentSessionId?: string;
  forkMode?: "full" | "compressed";
  sessionConfig: SessionConfig;
  recentMessages?: NarratorSessionChatMessage[];
  recovery?: NarratorSessionRecoveryMetadata;
  cumulativeUsage?: SessionCumulativeUsage;
  goals?: SessionGoal[];
  pinned?: boolean;
}

export interface CreateNarratorSessionInput {
  title?: string;
  agentId?: string;
  kind?: NarratorSessionKind;
  sessionMode?: NarratorSessionMode;
  worktree?: string;
  chapterId?: string;
  projectId?: string;
  parentSessionId?: string;
  forkMode?: "full" | "compressed";
  sessionConfig?: Partial<SessionConfig>;
}

export interface UpdateNarratorSessionInput {
  title?: string;
  agentId?: string;
  kind?: NarratorSessionKind;
  sessionMode?: NarratorSessionMode;
  status?: NarratorSessionStatus;
  messageCount?: number;
  sortOrder?: number;
  worktree?: string;
  chapterId?: string;
  projectId?: string;
  sessionConfig?: Partial<SessionConfig>;
  recentMessages?: NarratorSessionChatMessage[];
  recovery?: NarratorSessionRecoveryMetadata;
  cumulativeUsage?: SessionCumulativeUsage;
  goals?: SessionGoal[];
  pinned?: boolean;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  providerId: "",
  modelId: "",
  permissionMode: "edit",
  reasoningEffort: "medium",
};

export interface MessageImageAttachment {
  type: "image";
  mimeType: string;
  filePath: string;   // server-side path (persisted)
  fileName?: string;
}

export type NarratorSessionChatRole = "user" | "assistant" | "system";

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface SessionCumulativeUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationInputTokens: number;
  totalCacheReadInputTokens: number;
  turnCount: number;
  /** 最后一次请求的 input tokens（代表当前上下文窗口占用） */
  lastInputTokens?: number;
  /** 最后一次请求时各部分的 token 分解（构造 prompt 时记录） */
  lastContextBreakdown?: Array<{ label: string; tokens: number }>;
}

export interface NarratorSessionRuntimeMetadata {
  providerId: string;
  providerName?: string;
  modelId: string;
  usage?: TokenUsage;
}

export interface NarratorSessionChatMessage {
  id: string;
  role: NarratorSessionChatRole;
  content: string;
  /** Provider reasoning/thinking content (DeepSeek reasoning_content, Claude thinking) */
  reasoning_content?: string;
  timestamp: number;
  seq?: number;
  toolCalls?: ToolCall[];
  runtime?: NarratorSessionRuntimeMetadata;
  metadata?: AgentNativeMessageMetadata & Record<string, unknown>;
  attachments?: MessageImageAttachment[];
}

export type ToolCallStatus = "pending" | "running" | "success" | "error";

export interface ToolCallExecutionEnvelope {
  runId?: string | null;
  attempts?: number;
  traceEnabled?: boolean;
  dumpEnabled?: boolean;
}

export interface ToolCallGovernanceEnvelope {
  allowed?: boolean;
  confirmationRequired?: boolean;
  source?: string;
  reason?: string;
  reasonKey?: ToolAccessReasonKey;
  execution?: ToolCallExecutionEnvelope;
}

export interface ToolCall {
  id?: string;
  toolName: string;
  status?: ToolCallStatus;
  summary?: string;
  command?: string;
  input?: unknown;
  duration?: number;
  output?: string;
  result?: ToolCallGovernanceEnvelope | SessionToolExecutionResult | AgentNativeToolMetadata | Record<string, unknown>;
  renderer?: AgentNativeToolMetadata["renderer"];
  artifact?: AgentNativeToolMetadata["artifact"];
  confirmation?: AgentNativeToolMetadata["confirmation"];
  guided?: AgentNativeToolMetadata["guided"];
  pgi?: AgentNativeToolMetadata["pgi"];
  narrative?: AgentNativeToolMetadata["narrative"];
  allowed?: boolean;
  confirmationRequired?: boolean;
  source?: string;
  reason?: string;
  reasonKey?: ToolAccessReasonKey;
  execution?: ToolCallExecutionEnvelope;
  error?: string;
  exitCode?: number;
  startedAt?: number;
  finishedAt?: number;
  /** @internal 流式输出缓冲（运行时，不持久化） */
  _streamingOutput?: string;
  /** @internal 流式输入预览（运行时，不持久化） */
  _streamingInput?: string;
}

export interface ChatMessage {
  id: string;
  role: NarratorSessionChatRole;
  content: string;
  timestamp: number;
  seq?: number;
  toolCalls?: ToolCall[];
  metadata?: AgentNativeMessageMetadata & Record<string, unknown>;
}

export interface NarratorSessionChatCursor {
  lastSeq: number;
  ackedSeq?: number;
}

export interface NarratorSessionChatSnapshot {
  session: NarratorSessionRecord;
  messages: NarratorSessionChatMessage[];
  cursor: NarratorSessionChatCursor;
}

export interface NarratorSessionChatHistory {
  sessionId: string;
  sinceSeq: number;
  availableFromSeq: number;
  resetRequired: boolean;
  messages: NarratorSessionChatMessage[];
  cursor: NarratorSessionChatCursor;
}

export interface UpdateNarratorSessionChatStateInput {
  messages: NarratorSessionChatMessage[];
}

export interface NarratorSessionChatMessageClientEnvelope {
  type?: "session:message";
  sessionId?: string;
  messageId?: string;
  content: string;
  sessionMode?: NarratorSessionMode;
  ack?: number;
  canvasContext?: CanvasContext;
  attachments?: Array<{ type: "image"; mimeType: string; data: string; fileName?: string }>;
}

export interface NarratorSessionChatAckClientEnvelope {
  type: "session:ack";
  sessionId?: string;
  ack: number;
}

export interface NarratorSessionChatAbortClientEnvelope {
  type: "session:abort";
  sessionId?: string;
}

export interface NarratorSessionChatContinueClientEnvelope {
  type: "session:continue";
  sessionId?: string;
}

/** Client → Server: user's decision on a safety-paused operation */
export interface NarratorSessionSafetyDecisionClientEnvelope {
  type: "session:safety-decision";
  sessionId?: string;
  decision: "approve" | "reject";
}

export type NarratorSessionChatClientMessage =
  | NarratorSessionChatMessageClientEnvelope
  | NarratorSessionChatAckClientEnvelope
  | NarratorSessionChatAbortClientEnvelope
  | NarratorSessionChatContinueClientEnvelope
  | NarratorSessionSafetyDecisionClientEnvelope;

export type NarratorSessionRecoveryState = "idle" | "recovering" | "reconnecting" | "replaying" | "resetting" | "failed";
export type NarratorSessionRecoveryReason = "initial-hydration" | "reconnect" | "replay" | "history-gap" | "server-reset" | "snapshot-load-failed" | "history-load-failed" | "websocket-error";

export interface NarratorSessionRecoveryEnvelope {
  state: NarratorSessionRecoveryState;
  reason?: NarratorSessionRecoveryReason;
}

export interface NarratorSessionChatSnapshotEnvelope {
  type: "session:snapshot";
  snapshot: NarratorSessionChatSnapshot;
  recovery?: NarratorSessionRecoveryEnvelope;
}

export interface NarratorSessionChatStateEnvelope {
  type: "session:state";
  session: NarratorSessionRecord;
  cursor: NarratorSessionChatCursor;
  recovery?: NarratorSessionRecoveryEnvelope;
}

export interface NarratorSessionChatMessageEnvelope {
  type: "session:message";
  sessionId: string;
  message: NarratorSessionChatMessage;
  cursor: NarratorSessionChatCursor;
}

export interface NarratorSessionChatErrorEnvelope {
  type: "session:error";
  sessionId?: string;
  error: string;
  code?: string;
  runtime?: Partial<NarratorSessionRuntimeMetadata>;
}

/** 结构化运行时错误 — 前后端共享 */
export interface RuntimeError {
  /** 错误消息（用户可见） */
  message: string;
  /** 错误代码（机器可读） */
  code: string;
  /** 是否可重试 */
  retryable: boolean;
  /** 错误发生时间戳 */
  timestamp: number;
  /** 运行时元数据（provider/model 等） */
  runtime?: Partial<NarratorSessionRuntimeMetadata>;
}

export interface NarratorSessionChatStreamEnvelope {
  type: "session:stream";
  sessionId: string;
  content: string;
}

export interface NarratorSessionChatToolStreamEnvelope {
  type: "session:tool-stream";
  sessionId: string;
  toolCallId: string;
  content: string;
}

export interface NarratorSessionChatToolInputChunkEnvelope {
  type: "session:tool-input-chunk";
  sessionId: string;
  toolCallId: string;
  partialInput: string;
}

/** Server → Client: safety reflection rejected a dangerous operation */
export interface NarratorSessionSafetyPauseEnvelope {
  type: "session:safety-pause";
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  reason: string;
}

export interface NarratorSessionCompactProgressEnvelope {
  type: "session:compact-progress";
  sessionId: string;
  stage: "cascade" | "segment";
  progress: number; // 0-100
  message?: string;
}

export type NarratorSessionChatServerEnvelope =
  | NarratorSessionChatSnapshotEnvelope
  | NarratorSessionChatStateEnvelope
  | NarratorSessionChatMessageEnvelope
  | NarratorSessionChatErrorEnvelope
  | NarratorSessionChatStreamEnvelope
  | NarratorSessionChatToolStreamEnvelope
  | NarratorSessionChatToolInputChunkEnvelope
  | NarratorSessionSafetyPauseEnvelope
  | NarratorSessionCompactProgressEnvelope;
