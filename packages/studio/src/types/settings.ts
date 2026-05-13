/**
 * 用户配置类型定义
 */

import { normalizeCodexSandboxMode, type CodexSandboxMode } from "../shared/codex-runtime-status.js";
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
  /** OLED 纯黑模式：深色模式下使用纯黑背景 */
  oledBlack: boolean;
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
  /** 终端字体大小 (8-32) */
  terminalFontSize: number;
  /** 终端主题 */
  terminalTheme: "auto" | "dark" | "light";
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
  /** 全局白名单目录（对所有会话自动放行） */
  directoryAllowlist: string[];
  /** 全局黑名单目录（对所有会话禁止访问，优先于白名单） */
  directoryBlocklist: string[];
  /** 全局命令白名单（支持通配符如 npm*） */
  commandAllowlist: string[];
  /** 全局命令黑名单（优先于白名单，支持可选拒绝提示词） */
  commandBlocklist: CommandBlockRule[];
}

export interface CommandBlockRule {
  pattern: string;
  /** 可选的拒绝提示词，告诉 AI 为什么不能用这个命令 */
  rejectHint?: string;
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
  /** 自动压缩后保留的最近对话轮数 */
  compressionKeepTurns: number;
  /** 已裁剪消息比例达到此值时强制压缩 */
  maxTruncateRatio: number;
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
  /** 仅保留报错请求 dump */
  dumpOnlyErrors: boolean;
  /** 发送方式：enter 或 ctrl-enter */
  sendMode: "enter" | "ctrl-enter";
  /** Codex OS sandbox 尚未接入，只允许保存为 planned 状态 */
  codexSandboxMode: CodexSandboxMode;
  /** 角色弧线自动追踪模式 */
  arcTrackingMode?: "off" | "rule" | "llm";
  /** 旧编码支持：自动检测并保留非 UTF-8 文件编码（GBK、Shift_JIS 等） */
  legacyEncoding: boolean;
  /** 刷新 Shell 环境：每次 Bash 执行时通过 login shell 加载最新环境变量 */
  refreshShellEnv: boolean;
  /** 新叙述者默认进入计划模式 */
  defaultPlanMode: boolean;
  /** 全局默认自动批准计划 */
  autoApprovePlan: boolean;
  /** 全局默认启用危险反思 */
  dangerReflection: boolean;
  /** 首 token 超时时间（秒），0=禁用 */
  firstTokenTimeout: number;
  /** 沉默工具调用阈值：连续多少次无文本输出后要求说明 */
  silentToolCallThreshold: number;
  /** 自定义可重试错误规则 */
  retryRules: RetryRule[];
  /** 用户自定义 hooks（工具执行前后 / turn 结束时触发 shell 命令） */
  hooks: Hook[];
}

export interface RetryRule {
  id: string;
  enabled: boolean;
  /** HTTP 状态码匹配（空=不匹配状态码） */
  httpStatus: string;
  /** 内容关键词匹配（空=不匹配内容） */
  contentKeyword: string;
}

export interface Hook {
  /** 触发事件 */
  event: "PreToolUse" | "PostToolUse" | "TurnComplete";
  /** 仅对指定工具触发（可选，不填则对所有工具触发） */
  toolName?: string;
  /** Shell 命令（支持 {file}、{tool} 占位符） */
  command: string;
  /** 超时毫秒（默认 10000） */
  timeout?: number;
  /** PreToolUse: 若为 true，exit code 2 将阻止工具执行 */
  blocking?: boolean;
}

export type ModelReferenceValidationStatus = "empty" | "valid" | "invalid";

export interface ModelDefaultValidation {
  defaultSessionModel: ModelReferenceValidationStatus;
  summaryModel: ModelReferenceValidationStatus;
  subagentModelPool: Record<string, ModelReferenceValidationStatus>;
  invalidModelIds: string[];
}

export interface ModelAggregationMember {
  providerId: string;
  modelId: string;
  /** 优先级，数字越小越优先 */
  priority: number;
}

export interface ModelAggregation {
  /** 聚合 ID */
  id: string;
  /** 显示名称（如 "DeepSeek V4 Flash"） */
  displayName: string;
  /** 聚合的供应商模型列表 */
  members: ModelAggregationMember[];
  /** 路由策略 */
  routingStrategy: "priority" | "round-robin" | "random";
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
  /** 模型聚合配置 */
  aggregations: ModelAggregation[];
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

export interface WorkspaceSettings {
  /** 最大活跃工作区数 */
  maxActiveWorktrees: number;
  /** 工作区大小警告阈值（MB） */
  sizeWarningMb: number;
  /** 休眠时自动保存 */
  autoSaveOnHibernate: boolean;
  /** 不活跃自动休眠时间（分钟，0=禁用） */
  hibernateAfterMinutes: number;
}

export interface WritingSettings {
  /** 默认文风偏好 */
  defaultTone: "concise" | "ornate" | "colloquial" | "literary";
  /** 去AI味强度 (0-100) */
  antiAiStrength: number;
  /** 句长控制 */
  sentenceLength: "short" | "medium" | "long";
  /** 对话比例目标 (0-100) */
  dialogueRatio: number;
  /** 默认人称视角 */
  defaultPov: "first" | "third-limited" | "third-omniscient" | "second";
  /** 每日字数目标 */
  dailyWordTarget: number;
  /** 章节字数最小值 */
  chapterMinWords: number;
  /** 章节字数最大值 */
  chapterMaxWords: number;
  /** 更新频率提醒 */
  reminderEnabled: boolean;
  /** 提醒时间 (HH:MM) */
  reminderTime: string;
  /** 节拍密度偏好 */
  beatDensity: "compact" | "standard" | "relaxed";
  /** 目标平台 */
  targetPlatforms: string[];
  /** 分级标准 */
  contentRating: "all-ages" | "teen" | "adult";
  /** 自定义敏感词 */
  customSensitiveWords: string;
}

export interface ProxySettings {
  /** 每个供应商的代理配置，key 是 providerId */
  providers: Record<string, string>;
  /** WebFetch 工具的代理 */
  webFetch: string;
  /** 平台集成的代理（Codex/Kiro） */
  platforms: Record<string, string>;
}

export interface AuthSettings {
  /** 认证模式：none=无认证（默认），builtin=内置邮箱密码，external=外部JWT */
  mode: "none" | "builtin" | "external";
  /** JWT 签名密钥（首次运行时自动生成） */
  secret: string;
  /** 外部 JWT 验证密钥（external 模式） */
  externalSecret?: string;
  /** 外部 JWKS URL（external 模式，替代 externalSecret） */
  externalJwksUrl?: string;
  /** 默认管理员邮箱（首次运行时创建） */
  adminEmail?: string;
  /** 默认管理员密码（首次运行时创建，之后应删除） */
  adminPassword?: string;
}

export interface McpServerEntry {
  id: string;
  name: string;
  transport: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  /** 是否在启动时自动连接 */
  autoConnect?: boolean;
}

export interface UserConfig {
  profile: UserProfile;
  preferences: UserPreferences;
  runtimeControls: RuntimeControlSettings;
  modelDefaults: ModelDefaultSettings;
  onboarding: OnboardingSettings;
  shortcuts: Record<string, string>;
  recentWorkspaces: string[];
  proxy: ProxySettings;
  workspace: WorkspaceSettings;
  writing: WritingSettings;
  /** 外部 API 调用 Token（如羽书 bot 调用时需要携带） */
  apiToken: string;
  /** 用户认证配置 */
  auth?: AuthSettings;
  /** MCP 服务器配置列表 */
  mcpServers?: McpServerEntry[];
}

export interface UserConfigPatch {
  profile?: Partial<UserProfile>;
  preferences?: Partial<UserPreferences>;
  runtimeControls?: Partial<RuntimeControlSettings>;
  modelDefaults?: Partial<ModelDefaultSettings>;
  onboarding?: OnboardingSettingsPatch;
  shortcuts?: Record<string, string>;
  recentWorkspaces?: string[];
  proxy?: Partial<ProxySettings>;
  workspace?: Partial<WorkspaceSettings>;
  writing?: Partial<WritingSettings>;
  apiToken?: string;
  auth?: Partial<AuthSettings>;
  mcpServers?: McpServerEntry[];
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
    oledBlack: false,
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
    terminalFontSize: 14,
    terminalTheme: "auto",
  },
  runtimeControls: {
    defaultPermissionMode: DEFAULT_SESSION_CONFIG.permissionMode,
    defaultReasoningEffort: DEFAULT_SESSION_CONFIG.reasoningEffort,
    contextCompressionThresholdPercent: 80,
    contextTruncateTargetPercent: 70,
    compressionKeepTurns: 4,
    maxTruncateRatio: 80,
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
      directoryAllowlist: [],
      directoryBlocklist: [],
      commandAllowlist: [],
      commandBlocklist: [],
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
    dumpOnlyErrors: false,
    sendMode: "enter",
    codexSandboxMode: normalizeCodexSandboxMode(undefined).mode,
    largeWindowCompressionThresholdPercent: 60,
    largeWindowTruncateTargetPercent: 50,
    arcTrackingMode: "rule",
    legacyEncoding: false,
    refreshShellEnv: false,
    defaultPlanMode: false,
    autoApprovePlan: true,
    dangerReflection: true,
    firstTokenTimeout: 0,
    silentToolCallThreshold: 25,
    retryRules: [],
    hooks: [],
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
    aggregations: [],
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
  proxy: {
    providers: {},
    webFetch: "",
    platforms: {},
  },
  workspace: {
    maxActiveWorktrees: 5,
    sizeWarningMb: 500,
    autoSaveOnHibernate: true,
    hibernateAfterMinutes: 30,
  },
  writing: {
    defaultTone: "concise",
    antiAiStrength: 70,
    sentenceLength: "medium",
    dialogueRatio: 40,
    defaultPov: "third-limited",
    dailyWordTarget: 3000,
    chapterMinWords: 2000,
    chapterMaxWords: 5000,
    reminderEnabled: false,
    reminderTime: "20:00",
    beatDensity: "standard",
    targetPlatforms: ["自由"],
    contentRating: "all-ages",
    customSensitiveWords: "",
  },
  apiToken: "",
  mcpServers: [],
};
