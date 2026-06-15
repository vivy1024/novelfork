import type { SessionPermissionMode, SessionReasoningEffort, SessionToolPolicy } from "../../../shared/session-types";

export interface ConversationModelOption {
  providerId: string;
  providerLabel?: string;
  modelId: string;
  modelLabel?: string;
  supportsTools?: boolean;
  supportsReasoning?: boolean;
  contextWindow?: number;
  protocol?: string;
}

export interface ConversationBindingFact {
  label: string;
  worktree?: string;
  projectId?: string;
}

export interface ConversationWorkspaceFact {
  path?: string;
  /** Git 分支名 */
  branch?: string;
  /** 未提交变更数 */
  changes?: number;
  git?:
    | { status: "clean"; summary?: string }
    | { status: "dirty"; summary: string }
    | { status: "unavailable"; reason: string };
}

export interface ConversationUsageBucket {
  input_tokens?: number;
  output_tokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ConversationCostSummary {
  status: "unknown" | "known";
  amount?: number | null;
  currency?: string;
}

export interface ConversationContextUsage {
  usedTokens: number;
  maxTokens?: number;
  trimThreshold?: number;
  compactThreshold?: number;
  checkpointNotice?: string;
}

export interface ConversationUsage extends ConversationUsageBucket {
  currentTurn?: ConversationUsageBucket;
  cumulative?: ConversationUsageBucket;
  cost?: ConversationCostSummary;
}

/**
 * 叙述者主状态（对标 NarraFork status-registry narratorStatus）
 */
export type NarratorState = "idle" | "working" | "waiting" | "archived";

/**
 * 叙述者子状态（对标 NarraFork status-registry narratorSubstatus）
 * 用于在主状态基础上提供更细粒度的 UI 反馈
 */
export type NarratorSubstatus =
  | "unread"
  | "error"
  | "interrupted"
  | "suspended"
  | "manual_override"
  | "reasoning"
  | "reflecting"
  | "compacting"
  | "planning"
  | "plan_reflecting"
  | "retrying"
  | "queued"
  | "tool_calling"
  | "thinking";

export interface ConversationStatus {
  state: string;
  label: string;
  /** 对标 NarraFork 叙述者主状态 */
  narratorState?: NarratorState;
  /** 对标 NarraFork 叙述者子状态（优先级高于 narratorState 的 UI 展示） */
  substatus?: NarratorSubstatus;
  /** Streaming 开始时间戳（用于计时器） */
  streamingStartedAt?: number;
  /** 上一轮耗时（毫秒） */
  lastTurnDurationMs?: number;
  /** 当前正在调用的工具名 */
  toolName?: string;
  providerId?: string;
  providerLabel?: string;
  modelId?: string;
  modelLabel?: string;
  /** 当前供应商的 API 模式 */
  apiMode?: "completions" | "responses" | "codex";
  /** 当前供应商的兼容格式 */
  providerCompatibility?: "openai-compatible" | "anthropic-compatible";
  permissionMode?: SessionPermissionMode;
  reasoningEffort?: SessionReasoningEffort;
  serviceTier?: "default" | "priority";
  usage?: ConversationUsage;
  contextUsage?: ConversationContextUsage;
  plannedRuntimePanels?: readonly string[];
  messageCount?: number;
  binding?: ConversationBindingFact;
  workspace?: ConversationWorkspaceFact;
  modelOptions?: readonly ConversationModelOption[];
  toolPolicySummary?: SessionToolPolicy;
  unsupportedToolsReason?: string;
  reasoningUnsupportedReason?: string;
  permissionModeDisabledReasons?: Partial<Record<SessionPermissionMode, string>>;
  sessionConfigLoaded?: boolean;
  /** 分叉来源会话 ID */
  parentSessionId?: string;
  /** 是否处于计划模式（从 sessionMode 或 permissionMode === "plan" 推断） */
  planMode?: boolean;
}

export interface ConversationSessionConfigPatch {
  providerId?: string;
  modelId?: string;
  permissionMode?: SessionPermissionMode;
  reasoningEffort?: SessionReasoningEffort;
  serviceTier?: "default" | "priority";
}

/** @deprecated ConversationStatusBar 组件已被 NarratorStatusBar 取代，仅保留类型导出。 */
export interface ConversationStatusBarProps {
  status: ConversationStatus;
  onUpdateSessionConfig?: (patch: ConversationSessionConfigPatch) => Promise<void> | void;
}
