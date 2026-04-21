/**
 * 用户配置类型定义
 */

import {
  DEFAULT_SESSION_CONFIG,
  type SessionPermissionMode,
  type SessionReasoningEffort,
} from "../shared/session-types.js";

export type McpPolicyMode = SessionPermissionMode | "inherit";
export type ToolAccessMcpStrategy = McpPolicyMode;

export interface ToolAccessSettings {
  allowlist: string[];
  blocklist: string[];
  mcpStrategy: ToolAccessMcpStrategy;
}

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
}

export interface RecoverySettings {
  resumeOnStartup: boolean;
  maxRecoveryAttempts: number;
  maxRetryAttempts: number;
  initialRetryDelayMs: number;
  maxRetryDelayMs: number;
  backoffMultiplier: number;
  jitterPercent: number;
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
  recovery: RecoverySettings;
  toolAccess: ToolAccessSettings;
  runtimeDebug: RuntimeDebugSettings;
}

export interface ModelDefaultSettings {
  defaultSessionModel: string;
  summaryModel: string;
  subagentModelPool: string[];
}

export interface UserConfig {
  profile: UserProfile;
  preferences: UserPreferences;
  runtimeControls: RuntimeControlSettings;
  modelDefaults: ModelDefaultSettings;
  shortcuts: Record<string, string>;
  recentWorkspaces: string[];
}

export interface UserConfigPatch {
  profile?: Partial<UserProfile>;
  preferences?: Partial<UserPreferences>;
  runtimeControls?: Partial<RuntimeControlSettings>;
  modelDefaults?: Partial<ModelDefaultSettings>;
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
  },
  runtimeControls: {
    defaultPermissionMode: DEFAULT_SESSION_CONFIG.permissionMode,
    defaultReasoningEffort: DEFAULT_SESSION_CONFIG.reasoningEffort,
    contextCompressionThresholdPercent: 80,
    contextTruncateTargetPercent: 70,
    recovery: {
      resumeOnStartup: true,
      maxRecoveryAttempts: 5,
      maxRetryAttempts: 3,
      initialRetryDelayMs: 1000,
      maxRetryDelayMs: 30000,
      backoffMultiplier: 2,
      jitterPercent: 15,
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
      traceSampleRatePercent: 10,
    },
  },
  modelDefaults: {
    defaultSessionModel: "anthropic:claude-sonnet-4-6",
    summaryModel: "anthropic:claude-haiku-4-5",
    subagentModelPool: ["anthropic:claude-haiku-4-5", "openai:gpt-4-turbo"],
  },
  shortcuts: {},
  recentWorkspaces: [],
};
