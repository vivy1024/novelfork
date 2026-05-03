/**
 * 用户配置类型定义
 */

import {
  DEFAULT_SESSION_CONFIG,
  type SessionPermissionMode,
  type SessionReasoningEffort,
} from "../shared/session-types.js";

export interface UserProfile {
  name: string;
  email: string;
  avatar?: string;
  gitName?: string;
  gitEmail?: string;
}

export interface UserPreferences {
  theme: "light" | "dark" | "auto";
  fontSize: number;
  fontFamily: string;
  editorLineHeight: number;
  editorTabSize: number;
  autoSave: boolean;
  autoSaveDelay: number;
  dailyWordTarget: number;
  workbenchMode: boolean;
  advancedAnimations: boolean;
  wrapMarkdown: boolean;
  wrapCode: boolean;
  wrapDiff: boolean;
  language: string;
}

export interface RuntimeRecoverySettings {
  resumeOnStartup: boolean;
  maxRecoveryAttempts: number;
  maxRetryAttempts: number;
  initialRetryDelayMs: number;
  maxRetryDelayMs: number;
  backoffMultiplier: number;
  jitterPercent: number;
}

export type McpPolicyMode = "inherit" | "allow" | "ask" | "deny";

export interface ToolAccessSettings {
  allowlist: string[];
  blocklist: string[];
  mcpStrategy: McpPolicyMode;
}

export interface RuntimeDebugSettings {
  tokenDebugEnabled: boolean;
  rateDebugEnabled: boolean;
  dumpEnabled: boolean;
  traceEnabled: boolean;
  traceSampleRatePercent: number;
}

export interface RuntimeControlSettings {
  defaultPermissionMode: SessionPermissionMode;
  defaultReasoningEffort: SessionReasoningEffort;
  contextCompressionThresholdPercent: number;
  contextTruncateTargetPercent: number;
  /** 大窗口（>600k）裁剪起始 % */
  largeWindowCompressionThresholdPercent: number;
  /** 大窗口（>600k）压缩起始 % */
  largeWindowTruncateTargetPercent: number;
  recovery: RuntimeRecoverySettings;
  toolAccess: ToolAccessSettings;
  runtimeDebug: RuntimeDebugSettings;
  /** Agent 工具循环最大步数（默认 200，对齐 NarraFork） */
  maxTurnSteps: number;
  /** 宽松规划模式：plan 模式下写入工具改为 prompt 而非 deny */
  relaxedPlanning: boolean;
  /** YOLO 模式：allow 权限下跳过 read/draft-write 工具的确认暂停 */
  yoloSkipReadonlyConfirmation: boolean;
  /** 翻译思考内容：推理块完成后通过摘要模型翻译为用户语言 */
  translateThinking: boolean;
  /** 默认展开推理内容 */
  expandReasoning: boolean;
  /** 智能检查输出中断：自动检测截断并发送继续消息 */
  smartOutputCheck: boolean;
  /** 要求叙述者使用用户语言回复 */
  forceUserLanguage: boolean;
  /** 显示每轮对话的 Token 用量 */
  showTokenUsage: boolean;
  /** 显示实时 AI 输出速率 */
  showOutputRate: boolean;
  /** 滚动时自动加载更早消息 */
  scrollAutoLoadHistory: boolean;
  /** Dump 每条 API 请求 */
  dumpApiRequests: boolean;
  /** 发送方式：enter 或 ctrl-enter */
  sendMode: "enter" | "ctrl-enter";
}

export type ModelReferenceValidationStatus = "empty" | "valid" | "invalid";

export interface ModelDefaultValidation {
  defaultSessionModel: ModelReferenceValidationStatus;
  summaryModel: ModelReferenceValidationStatus;
  subagentModelPool: Record<string, ModelReferenceValidationStatus>;
  invalidModelIds: string[];
}

export interface ModelDefaultSettings {
  defaultSessionModel: string;
  summaryModel: string;
  /** Explore 子代理默认模型 */
  exploreSubagentModel: string;
  /** Plan 子代理默认模型 */
  planSubagentModel: string;
  /** General 子代理默认模型 */
  generalSubagentModel: string;
  subagentModelPool: string[];
  /** Codex 专属推理强度 */
  codexReasoningEffort: SessionReasoningEffort;
  validation: ModelDefaultValidation;
}

export interface OnboardingTaskSettings {
  hasOpenedJingwei: boolean;
  hasTriedAiWriting: boolean;
  hasTriedAiTasteScan: boolean;
  hasReadWorkbenchIntro: boolean;
}

export interface OnboardingSettings {
  dismissedFirstRun: boolean;
  dismissedGettingStarted: boolean;
  tasks: OnboardingTaskSettings;
}

export interface OnboardingSettingsPatch {
  dismissedFirstRun?: boolean;
  dismissedGettingStarted?: boolean;
  tasks?: Partial<OnboardingTaskSettings>;
}

export interface UserConfig {
  profile: UserProfile;
  preferences: UserPreferences;
  runtimeControls: RuntimeControlSettings;
  modelDefaults: ModelDefaultSettings;
  onboarding: OnboardingSettings;
  shortcuts: Record<string, string>;
  recentWorkspaces: string[];
}

export interface UserConfigPatch {
  profile?: Partial<UserProfile>;
  preferences?: Partial<UserPreferences>;
  runtimeControls?: Partial<RuntimeControlSettings>;
  modelDefaults?: Partial<ModelDefaultSettings>;
  onboarding?: OnboardingSettingsPatch;
  shortcuts?: Record<string, string>;
  recentWorkspaces?: string[];
}

export const DEFAULT_USER_CONFIG: UserConfig = {
  profile: {
    name: "",
    email: "",
    gitName: "",
    gitEmail: "",
  },
  preferences: {
    theme: "auto",
    fontSize: 14,
    fontFamily: "system-ui, -apple-system, sans-serif",
    editorLineHeight: 1.6,
    editorTabSize: 2,
    autoSave: true,
    autoSaveDelay: 2000,
    dailyWordTarget: 6000,
    workbenchMode: false,
    advancedAnimations: true,
    wrapMarkdown: true,
    wrapCode: true,
    wrapDiff: true,
    language: "zh",
  },
  runtimeControls: {
    defaultPermissionMode: DEFAULT_SESSION_CONFIG.permissionMode,
    defaultReasoningEffort: DEFAULT_SESSION_CONFIG.reasoningEffort,
    contextCompressionThresholdPercent: 80,
    contextTruncateTargetPercent: 70,
    recovery: {
      resumeOnStartup: true,
      maxRecoveryAttempts: 3,
      maxRetryAttempts: 5,
      initialRetryDelayMs: 1000,
      maxRetryDelayMs: 30000,
      backoffMultiplier: 2,
      jitterPercent: 20,
    },
    toolAccess: {
      allowlist: [],
      blocklist: [],
      mcpStrategy: "inherit",
    },
    runtimeDebug: {
      tokenDebugEnabled: false,
      rateDebugEnabled: false,
      dumpEnabled: false,
      traceEnabled: false,
      traceSampleRatePercent: 0,
    },
    maxTurnSteps: 200,
    relaxedPlanning: false,
    yoloSkipReadonlyConfirmation: false,
    translateThinking: false,
    expandReasoning: false,
    smartOutputCheck: false,
    forceUserLanguage: true,
    showTokenUsage: false,
    showOutputRate: false,
    scrollAutoLoadHistory: true,
    dumpApiRequests: false,
    sendMode: "enter",
    largeWindowCompressionThresholdPercent: 60,
    largeWindowTruncateTargetPercent: 50,
  },
  modelDefaults: {
    defaultSessionModel: "",
    summaryModel: "",
    exploreSubagentModel: "",
    planSubagentModel: "",
    generalSubagentModel: "",
    subagentModelPool: [],
    codexReasoningEffort: "high",
    validation: {
      defaultSessionModel: "empty",
      summaryModel: "empty",
      subagentModelPool: {},
      invalidModelIds: [],
    },
  },
  onboarding: {
    dismissedFirstRun: false,
    dismissedGettingStarted: false,
    tasks: {
      hasOpenedJingwei: false,
      hasTriedAiWriting: false,
      hasTriedAiTasteScan: false,
      hasReadWorkbenchIntro: false,
    },
  },
  shortcuts: {},
  recentWorkspaces: [],
};
