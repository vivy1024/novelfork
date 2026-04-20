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
}

export interface RuntimeControlSettings {
  defaultPermissionMode: SessionPermissionMode;
  defaultReasoningEffort: SessionReasoningEffort;
  contextCompressionThresholdPercent: number;
  contextTruncateTargetPercent: number;
}

export interface UserConfig {
  profile: UserProfile;
  preferences: UserPreferences;
  runtimeControls: RuntimeControlSettings;
  shortcuts: Record<string, string>;
  recentWorkspaces: string[];
}

export interface UserConfigPatch {
  profile?: Partial<UserProfile>;
  preferences?: Partial<UserPreferences>;
  runtimeControls?: Partial<RuntimeControlSettings>;
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
  },
  shortcuts: {},
  recentWorkspaces: [],
};
