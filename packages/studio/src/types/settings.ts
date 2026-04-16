/**
 * 用户配置类型定义
 */

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

export interface UserConfig {
  profile: UserProfile;
  preferences: UserPreferences;
  shortcuts: Record<string, string>;
  recentWorkspaces: string[];
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
  shortcuts: {},
  recentWorkspaces: [],
};
