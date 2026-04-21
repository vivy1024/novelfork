import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import type { ModelDefaultSettings, RuntimeControlSettings, ToolAccessSettings, UserConfig, UserConfigPatch } from "../../types/settings.js";
import { DEFAULT_USER_CONFIG } from "../../types/settings.js";
import { providerManager } from "./provider-manager.js";

/**
 * 获取用户配置文件路径
 */
export function getUserConfigPath(): string {
  return join(homedir(), ".inkos", "user-config.json");
}

/**
 * 获取配置备份路径
 */
function getBackupPath(index: number): string {
  return join(homedir(), ".inkos", `user-config.backup${index}.json`);
}

/**
 * 确保配置目录存在
 */
async function ensureConfigDir(): Promise<void> {
  const configPath = getUserConfigPath();
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function sanitizeToolAccess(toolAccess?: Partial<ToolAccessSettings> | null): ToolAccessSettings {
  return {
    allowlist: Array.isArray(toolAccess?.allowlist)
      ? toolAccess.allowlist.filter((item): item is string => typeof item === "string")
      : DEFAULT_USER_CONFIG.runtimeControls.toolAccess.allowlist,
    blocklist: Array.isArray(toolAccess?.blocklist)
      ? toolAccess.blocklist.filter((item): item is string => typeof item === "string")
      : DEFAULT_USER_CONFIG.runtimeControls.toolAccess.blocklist,
    mcpStrategy:
      toolAccess?.mcpStrategy === "allow"
      || toolAccess?.mcpStrategy === "ask"
      || toolAccess?.mcpStrategy === "deny"
      || toolAccess?.mcpStrategy === "inherit"
        ? toolAccess.mcpStrategy
        : DEFAULT_USER_CONFIG.runtimeControls.toolAccess.mcpStrategy,
  };
}

function sanitizeRuntimeControls(runtimeControls?: Partial<RuntimeControlSettings> | null): RuntimeControlSettings {
  return {
    defaultPermissionMode:
      runtimeControls?.defaultPermissionMode === "allow"
      || runtimeControls?.defaultPermissionMode === "ask"
      || runtimeControls?.defaultPermissionMode === "deny"
        ? runtimeControls.defaultPermissionMode
        : DEFAULT_USER_CONFIG.runtimeControls.defaultPermissionMode,
    defaultReasoningEffort:
      runtimeControls?.defaultReasoningEffort === "low"
      || runtimeControls?.defaultReasoningEffort === "medium"
      || runtimeControls?.defaultReasoningEffort === "high"
        ? runtimeControls.defaultReasoningEffort
        : DEFAULT_USER_CONFIG.runtimeControls.defaultReasoningEffort,
    contextCompressionThresholdPercent: clampNumber(
      runtimeControls?.contextCompressionThresholdPercent,
      DEFAULT_USER_CONFIG.runtimeControls.contextCompressionThresholdPercent,
      50,
      95,
    ),
    contextTruncateTargetPercent: clampNumber(
      runtimeControls?.contextTruncateTargetPercent,
      DEFAULT_USER_CONFIG.runtimeControls.contextTruncateTargetPercent,
      40,
      90,
    ),
    toolAccess: sanitizeToolAccess(runtimeControls?.toolAccess),
  };
}

function normalizeKnownModelId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  return providerManager.getModel(normalized) ? normalized : undefined;
}

function sanitizeModelDefaults(modelDefaults?: Partial<ModelDefaultSettings> | null): ModelDefaultSettings {
  const defaultModelDefaults = DEFAULT_USER_CONFIG.modelDefaults;
  const defaultSessionModel = normalizeKnownModelId(modelDefaults?.defaultSessionModel);
  const summaryModel = normalizeKnownModelId(modelDefaults?.summaryModel);
  const subagentModelPool = Array.isArray(modelDefaults?.subagentModelPool)
    ? modelDefaults.subagentModelPool.map(normalizeKnownModelId).filter((value): value is string => Boolean(value))
    : defaultModelDefaults.subagentModelPool;

  return {
    defaultSessionModel: defaultSessionModel ?? defaultModelDefaults.defaultSessionModel,
    summaryModel: summaryModel ?? defaultModelDefaults.summaryModel,
    subagentModelPool: subagentModelPool.length > 0 ? subagentModelPool : defaultModelDefaults.subagentModelPool,
  };
}

/**
 * 加载用户配置
 */
export async function loadUserConfig(): Promise<UserConfig> {
  await ensureConfigDir();
  const configPath = getUserConfigPath();

  if (!existsSync(configPath)) {
    // 首次运行，创建默认配置
    await saveUserConfig(DEFAULT_USER_CONFIG);
    return DEFAULT_USER_CONFIG;
  }

  try {
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw) as UserConfig;
    // 合并默认值（处理新增字段）
    return {
      ...DEFAULT_USER_CONFIG,
      ...config,
      profile: { ...DEFAULT_USER_CONFIG.profile, ...config.profile },
      preferences: { ...DEFAULT_USER_CONFIG.preferences, ...config.preferences },
      runtimeControls: sanitizeRuntimeControls(config.runtimeControls),
      modelDefaults: sanitizeModelDefaults(config.modelDefaults),
    };
  } catch (error) {
    console.error("Failed to load user config, using default:", error);
    return DEFAULT_USER_CONFIG;
  }
}

/**
 * 保存用户配置（带备份）
 */
export async function saveUserConfig(config: UserConfig): Promise<void> {
  await ensureConfigDir();
  const configPath = getUserConfigPath();

  // 如果配置文件已存在，先备份
  if (existsSync(configPath)) {
    try {
      const existing = await readFile(configPath, "utf-8");
      // 轮转备份：backup3 <- backup2 <- backup1 <- current
      for (let i = 2; i >= 0; i--) {
        const oldPath = i === 0 ? configPath : getBackupPath(i);
        const newPath = getBackupPath(i + 1);
        if (existsSync(oldPath)) {
          await writeFile(newPath, await readFile(oldPath, "utf-8"), "utf-8");
        }
      }
    } catch (error) {
      console.warn("Failed to backup config:", error);
    }
  }

  // 保存新配置
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * 更新用户配置（部分更新）
 */
export async function updateUserConfig(partial: UserConfigPatch): Promise<UserConfig> {
  const current = await loadUserConfig();
  const updated: UserConfig = {
    ...current,
    profile: { ...current.profile, ...(partial.profile ?? {}) },
    preferences: { ...current.preferences, ...(partial.preferences ?? {}) },
    runtimeControls: sanitizeRuntimeControls({ ...current.runtimeControls, ...(partial.runtimeControls ?? {}) }),
    modelDefaults: sanitizeModelDefaults({ ...current.modelDefaults, ...(partial.modelDefaults ?? {}) }),
    shortcuts: { ...current.shortcuts, ...(partial.shortcuts ?? {}) },
    recentWorkspaces: partial.recentWorkspaces ?? current.recentWorkspaces,
  };
  await saveUserConfig(updated);
  return updated;
}
