import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import type {
  ModelDefaultSettings,
  OnboardingSettings,
  ProxySettings,
  RuntimeControlSettings,
  ToolAccessSettings,
  RuntimeDebugSettings,
  RuntimeRecoverySettings,
  UserConfig,
  UserConfigPatch,
} from "../../types/settings.js";
import { DEFAULT_USER_CONFIG } from "../../types/settings.js";
import { isSessionPermissionMode, normalizeSessionPermissionMode } from "../../shared/session-types.js";
import { ProviderRuntimeStore } from "./provider-runtime-store.js";
import { buildRuntimeModelPool } from "./runtime-model-pool.js";
import { resolveRuntimeStoragePath } from "./runtime-storage-paths.js";

/**
 * 获取用户配置文件路径
 */
export function getUserConfigPath(): string {
  return resolveRuntimeStoragePath("user-config.json");
}

/**
 * 获取配置备份路径
 */
function getBackupPath(index: number): string {
  const configPath = getUserConfigPath();
  return join(dirname(configPath), `user-config.backup${index}.json`);
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
  const rawPermissionMode = (runtimeControls as { defaultPermissionMode?: unknown } | undefined)?.defaultPermissionMode;
  return {
    defaultPermissionMode: isSessionPermissionMode(rawPermissionMode)
      ? rawPermissionMode
      : normalizeSessionPermissionMode(rawPermissionMode, defaults.defaultPermissionMode),
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
    maxTurnSteps: clampNumber(runtimeControls?.maxTurnSteps, defaults.maxTurnSteps, 1, 1000),
    relaxedPlanning: typeof runtimeControls?.relaxedPlanning === "boolean" ? runtimeControls.relaxedPlanning : defaults.relaxedPlanning,
    yoloSkipReadonlyConfirmation: typeof runtimeControls?.yoloSkipReadonlyConfirmation === "boolean" ? runtimeControls.yoloSkipReadonlyConfirmation : defaults.yoloSkipReadonlyConfirmation,
    translateThinking: typeof runtimeControls?.translateThinking === "boolean" ? runtimeControls.translateThinking : defaults.translateThinking,
    expandReasoning: typeof runtimeControls?.expandReasoning === "boolean" ? runtimeControls.expandReasoning : defaults.expandReasoning,
    smartOutputCheck: typeof runtimeControls?.smartOutputCheck === "boolean" ? runtimeControls.smartOutputCheck : defaults.smartOutputCheck,
    forceUserLanguage: typeof runtimeControls?.forceUserLanguage === "boolean" ? runtimeControls.forceUserLanguage : defaults.forceUserLanguage,
    showTokenUsage: typeof runtimeControls?.showTokenUsage === "boolean" ? runtimeControls.showTokenUsage : defaults.showTokenUsage,
    showOutputRate: typeof runtimeControls?.showOutputRate === "boolean" ? runtimeControls.showOutputRate : defaults.showOutputRate,
    scrollAutoLoadHistory: typeof runtimeControls?.scrollAutoLoadHistory === "boolean" ? runtimeControls.scrollAutoLoadHistory : defaults.scrollAutoLoadHistory,
    dumpApiRequests: typeof runtimeControls?.dumpApiRequests === "boolean" ? runtimeControls.dumpApiRequests : defaults.dumpApiRequests,
    sendMode: runtimeControls?.sendMode === "ctrl-enter" ? "ctrl-enter" : defaults.sendMode,
    largeWindowCompressionThresholdPercent: clampNumber(runtimeControls?.largeWindowCompressionThresholdPercent, defaults.largeWindowCompressionThresholdPercent, 30, 95),
    largeWindowTruncateTargetPercent: clampNumber(runtimeControls?.largeWindowTruncateTargetPercent, defaults.largeWindowTruncateTargetPercent, 20, 90),
  };
}

function normalizeModelReference(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function getRuntimeModelIds(): Promise<Set<string>> {
  const pool = await buildRuntimeModelPool(new ProviderRuntimeStore());
  return new Set(pool.map((model) => model.modelId));
}

function modelReferenceStatus(modelId: string, validModelIds: ReadonlySet<string>) {
  if (!modelId) return "empty" as const;
  return validModelIds.has(modelId) ? "valid" as const : "invalid" as const;
}

async function sanitizeModelDefaults(modelDefaults?: Partial<ModelDefaultSettings> | null): Promise<ModelDefaultSettings> {
  const defaultModelDefaults = DEFAULT_USER_CONFIG.modelDefaults;
  const validModelIds = await getRuntimeModelIds();
  const defaultSessionModel = normalizeModelReference(modelDefaults?.defaultSessionModel ?? defaultModelDefaults.defaultSessionModel);
  const summaryModel = normalizeModelReference(modelDefaults?.summaryModel ?? defaultModelDefaults.summaryModel);
  const subagentModelPool = Array.isArray(modelDefaults?.subagentModelPool)
    ? modelDefaults.subagentModelPool.map(normalizeModelReference).filter(Boolean)
    : defaultModelDefaults.subagentModelPool;
  const validation = {
    defaultSessionModel: modelReferenceStatus(defaultSessionModel, validModelIds),
    summaryModel: modelReferenceStatus(summaryModel, validModelIds),
    subagentModelPool: Object.fromEntries(
      subagentModelPool.map((modelId) => [modelId, modelReferenceStatus(modelId, validModelIds)]),
    ),
    invalidModelIds: [defaultSessionModel, summaryModel, ...subagentModelPool]
      .filter((modelId, index, values) => modelId && modelReferenceStatus(modelId, validModelIds) === "invalid" && values.indexOf(modelId) === index),
  } satisfies ModelDefaultSettings["validation"];

  return {
    defaultSessionModel,
    summaryModel,
    exploreSubagentModel: normalizeModelReference(modelDefaults?.exploreSubagentModel ?? defaultModelDefaults.exploreSubagentModel),
    planSubagentModel: normalizeModelReference(modelDefaults?.planSubagentModel ?? defaultModelDefaults.planSubagentModel),
    generalSubagentModel: normalizeModelReference(modelDefaults?.generalSubagentModel ?? defaultModelDefaults.generalSubagentModel),
    subagentModelPool,
    codexReasoningEffort:
      modelDefaults?.codexReasoningEffort === "low"
      || modelDefaults?.codexReasoningEffort === "medium"
      || modelDefaults?.codexReasoningEffort === "high"
        ? modelDefaults.codexReasoningEffort
        : defaultModelDefaults.codexReasoningEffort,
    validation,
  };
}

function sanitizeOnboarding(onboarding?: Partial<OnboardingSettings> | null): OnboardingSettings {
  const defaults = DEFAULT_USER_CONFIG.onboarding;
  return {
    dismissedFirstRun: typeof onboarding?.dismissedFirstRun === "boolean" ? onboarding.dismissedFirstRun : defaults.dismissedFirstRun,
    dismissedGettingStarted: typeof onboarding?.dismissedGettingStarted === "boolean" ? onboarding.dismissedGettingStarted : defaults.dismissedGettingStarted,
    tasks: {
      hasOpenedJingwei: typeof onboarding?.tasks?.hasOpenedJingwei === "boolean" ? onboarding.tasks.hasOpenedJingwei : defaults.tasks.hasOpenedJingwei,
      hasTriedAiWriting: typeof onboarding?.tasks?.hasTriedAiWriting === "boolean" ? onboarding.tasks.hasTriedAiWriting : defaults.tasks.hasTriedAiWriting,
      hasTriedAiTasteScan: typeof onboarding?.tasks?.hasTriedAiTasteScan === "boolean" ? onboarding.tasks.hasTriedAiTasteScan : defaults.tasks.hasTriedAiTasteScan,
      hasReadWorkbenchIntro: typeof onboarding?.tasks?.hasReadWorkbenchIntro === "boolean" ? onboarding.tasks.hasReadWorkbenchIntro : defaults.tasks.hasReadWorkbenchIntro,
    },
  };
}

function sanitizeStringRecord(record: unknown, fallback: Record<string, string> = {}): Record<string, string> {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return fallback;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      result[key] = value.trim();
    }
  }
  return result;
}

function sanitizeProxy(proxy?: Partial<ProxySettings> | null): ProxySettings {
  const defaults = DEFAULT_USER_CONFIG.proxy;
  return {
    providers: sanitizeStringRecord(proxy?.providers, defaults.providers),
    webFetch: typeof proxy?.webFetch === "string" ? proxy.webFetch.trim() : defaults.webFetch,
    platforms: sanitizeStringRecord(proxy?.platforms, defaults.platforms),
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
    const defaults = {
      ...DEFAULT_USER_CONFIG,
      modelDefaults: await sanitizeModelDefaults(DEFAULT_USER_CONFIG.modelDefaults),
    };
    await saveUserConfig(defaults);
    return defaults;
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
      modelDefaults: await sanitizeModelDefaults(config.modelDefaults),
      onboarding: sanitizeOnboarding(config.onboarding),
      proxy: sanitizeProxy(config.proxy),
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
    modelDefaults: await sanitizeModelDefaults({ ...current.modelDefaults, ...(partial.modelDefaults ?? {}) }),
    onboarding: sanitizeOnboarding({
      ...current.onboarding,
      ...(partial.onboarding ?? {}),
      tasks: {
        ...current.onboarding.tasks,
        ...(partial.onboarding?.tasks ?? {}),
      },
    }),
    shortcuts: { ...current.shortcuts, ...(partial.shortcuts ?? {}) },
    recentWorkspaces: partial.recentWorkspaces ?? current.recentWorkspaces,
    proxy: sanitizeProxy({
      ...current.proxy,
      ...(partial.proxy ?? {}),
      providers: { ...current.proxy.providers, ...(partial.proxy?.providers ?? {}) },
      platforms: { ...current.proxy.platforms, ...(partial.proxy?.platforms ?? {}) },
    }),
  };
  await saveUserConfig(updated);
  return updated;
}
