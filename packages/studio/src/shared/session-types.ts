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
  toolPolicy?: SessionToolPolicy;
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
  sessionConfig: SessionConfig;
  recentMessages?: NarratorSessionChatMessage[];
  recovery?: NarratorSessionRecoveryMetadata;
  cumulativeUsage?: SessionCumulativeUsage;
}

export interface CreateNarratorSessionInput {
  title?: string;
  agentId?: string;
  kind?: NarratorSessionKind;
  sessionMode?: NarratorSessionMode;
  worktree?: string;
  chapterId?: string;
  projectId?: string;
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
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  providerId: "",
  modelId: "",
  permissionMode: "edit",
  reasoningEffort: "medium",
};

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
  timestamp: number;
  seq?: number;
  toolCalls?: ToolCall[];
  runtime?: NarratorSessionRuntimeMetadata;
  metadata?: AgentNativeMessageMetadata & Record<string, unknown>;
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

export type NarratorSessionChatClientMessage =
  | NarratorSessionChatMessageClientEnvelope
  | NarratorSessionChatAckClientEnvelope
  | NarratorSessionChatAbortClientEnvelope;

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

export interface NarratorSessionChatStreamEnvelope {
  type: "session:stream";
  sessionId: string;
  content: string;
}

export type NarratorSessionChatServerEnvelope =
  | NarratorSessionChatSnapshotEnvelope
  | NarratorSessionChatStateEnvelope
  | NarratorSessionChatMessageEnvelope
  | NarratorSessionChatErrorEnvelope
  | NarratorSessionChatStreamEnvelope;
