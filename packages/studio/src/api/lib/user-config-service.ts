import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import type {
  ModelDefaultSettings,
  RuntimeControlSettings,
  ToolAccessSettings,
  RuntimeDebugSettings,
  RuntimeRecoverySettings,
  UserConfig,
  UserConfigPatch,
} from "../../types/settings.js";
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

function clampNumber(value: unknown, fallback: number, min: number, max: number, round = true): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = round ? Math.round(value) : value;
  return Math.min(max, Math.max(min, normalized));
}

function sanitizeStringList(values: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(values)) {
    return fallback;
  }

  return values
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function sanitizeRecovery(runtimeRecovery?: Partial<RuntimeRecoverySettings> | null): RuntimeRecoverySettings {
  const defaults = DEFAULT_USER_CONFIG.runtimeControls.recovery;
  return {
    resumeOnStartup: typeof runtimeRecovery?.resumeOnStartup === "boolean" ? runtimeRecovery.resumeOnStartup : defaults.resumeOnStartup,
    maxRecoveryAttempts: clampNumber(runtimeRecovery?.maxRecoveryAttempts, defaults.maxRecoveryAttempts, 0, 20),
    maxRetryAttempts: clampNumber(runtimeRecovery?.maxRetryAttempts, defaults.maxRetryAttempts, 0, 20),
    initialRetryDelayMs: clampNumber(runtimeRecovery?.initialRetryDelayMs, defaults.initialRetryDelayMs, 0, 300000),
    maxRetryDelayMs: clampNumber(runtimeRecovery?.maxRetryDelayMs, defaults.maxRetryDelayMs, 0, 600000),
    backoffMultiplier: clampNumber(runtimeRecovery?.backoffMultiplier, defaults.backoffMultiplier, 1, 10, false),
    jitterPercent: clampNumber(runtimeRecovery?.jitterPercent, defaults.jitterPercent, 0, 100),
  };
}

function sanitizeToolAccess(toolAccess?: Partial<ToolAccessSettings> | null): ToolAccessSettings {
  const defaults = DEFAULT_USER_CONFIG.runtimeControls.toolAccess;
  const mcpStrategy = toolAccess?.mcpStrategy;

  return {
    allowlist: sanitizeStringList(toolAccess?.allowlist, defaults.allowlist),
    blocklist: sanitizeStringList(toolAccess?.blocklist, defaults.blocklist),
    mcpStrategy: mcpStrategy === "inherit" || mcpStrategy === "allow" || mcpStrategy === "ask" || mcpStrategy === "deny"
      ? mcpStrategy
      : defaults.mcpStrategy,
  };
}

function sanitizeRuntimeDebug(runtimeDebug?: Partial<RuntimeDebugSettings> | null): RuntimeDebugSettings {
  const defaults = DEFAULT_USER_CONFIG.runtimeControls.runtimeDebug;
  return {
    tokenDebugEnabled: typeof runtimeDebug?.tokenDebugEnabled === "boolean" ? runtimeDebug.tokenDebugEnabled : defaults.tokenDebugEnabled,
    rateDebugEnabled: typeof runtimeDebug?.rateDebugEnabled === "boolean" ? runtimeDebug.rateDebugEnabled : defaults.rateDebugEnabled,
    dumpEnabled: typeof runtimeDebug?.dumpEnabled === "boolean" ? runtimeDebug.dumpEnabled : defaults.dumpEnabled,
    traceEnabled: typeof runtimeDebug?.traceEnabled === "boolean" ? runtimeDebug.traceEnabled : defaults.traceEnabled,
    traceSampleRatePercent: clampNumber(
      runtimeDebug?.traceSampleRatePercent,
      defaults.traceSampleRatePercent,
      0,
      100,
    ),
  };
}

function sanitizeRuntimeControls(runtimeControls?: Partial<RuntimeControlSettings> | null): RuntimeControlSettings {
  const defaults = DEFAULT_USER_CONFIG.runtimeControls;
  return {
    defaultPermissionMode:
      runtimeControls?.defaultPermissionMode === "allow"
      || runtimeControls?.defaultPermissionMode === "ask"
      || runtimeControls?.defaultPermissionMode === "deny"
        ? runtimeControls.defaultPermissionMode
        : defaults.defaultPermissionMode,
    defaultReasoningEffort:
      runtimeControls?.defaultReasoningEffort === "low"
      || runtimeControls?.defaultReasoningEffort === "medium"
      || runtimeControls?.defaultReasoningEffort === "high"
        ? runtimeControls.defaultReasoningEffort
        : defaults.defaultReasoningEffort,
    contextCompressionThresholdPercent: clampNumber(
      runtimeControls?.contextCompressionThresholdPercent,
      defaults.contextCompressionThresholdPercent,
      50,
      95,
    ),
    contextTruncateTargetPercent: clampNumber(
      runtimeControls?.contextTruncateTargetPercent,
      defaults.contextTruncateTargetPercent,
      40,
      90,
    ),
    recovery: sanitizeRecovery(runtimeControls?.recovery),
    toolAccess: sanitizeToolAccess(runtimeControls?.toolAccess),
    runtimeDebug: sanitizeRuntimeDebug(runtimeControls?.runtimeDebug),
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
  const mergedRuntimeControls: Partial<RuntimeControlSettings> = {
    ...current.runtimeControls,
    ...(partial.runtimeControls ?? {}),
    recovery: {
      ...current.runtimeControls.recovery,
      ...(partial.runtimeControls?.recovery ?? {}),
    },
    toolAccess: {
      ...current.runtimeControls.toolAccess,
      ...(partial.runtimeControls?.toolAccess ?? {}),
    },
    runtimeDebug: {
      ...current.runtimeControls.runtimeDebug,
      ...(partial.runtimeControls?.runtimeDebug ?? {}),
    },
  };

  const updated: UserConfig = {
    ...current,
    profile: { ...current.profile, ...(partial.profile ?? {}) },
    preferences: { ...current.preferences, ...(partial.preferences ?? {}) },
    runtimeControls: sanitizeRuntimeControls(mergedRuntimeControls),
    modelDefaults: sanitizeModelDefaults({ ...current.modelDefaults, ...(partial.modelDefaults ?? {}) }),
    shortcuts: { ...current.shortcuts, ...(partial.shortcuts ?? {}) },
    recentWorkspaces: partial.recentWorkspaces ?? current.recentWorkspaces,
  };
  await saveUserConfig(updated);
  return updated;
}
