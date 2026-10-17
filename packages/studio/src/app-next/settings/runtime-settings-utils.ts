import type {
  RuntimeCustomApiProtocol as RuntimeCustomApiProtocolContract,
  RuntimeCustomApiProviderSettings,
  RuntimeCustomModelSettings,
  RuntimeNugProviderSettings,
} from "../runtime-admin";

export type RuntimeCustomApiProtocol = RuntimeCustomApiProtocolContract;
export type RuntimeProviderArrayKey = "customApiProviders" | "nugProviders";

const RUNTIME_CUSTOM_API_PROTOCOLS = new Set<RuntimeCustomApiProtocol>([
  "anthropic-official",
  "anthropic-compatible",
  "responses-compatible",
  "completions-compatible",
  "codex-native",
  "gemini-compatible",
]);

function isRuntimeCustomApiProtocol(value: unknown): value is RuntimeCustomApiProtocol {
  return typeof value === "string"
    && RUNTIME_CUSTOM_API_PROTOCOLS.has(value as RuntimeCustomApiProtocol);
}
export type RuntimeEditableProvider = RuntimeCustomApiProviderSettings;
export type RuntimeEditableNugProvider = RuntimeNugProviderSettings;

export interface RuntimeModelOption {
  readonly value: string;
  readonly label: string;
  readonly provider: string;
  readonly providerId: string;
  readonly providerLabel: string;
  readonly modelId: string;
  readonly hidden: boolean;
  readonly custom: boolean;
  readonly contextWindow?: number;
}

export interface RuntimeModelGroup {
  readonly id: string;
  readonly label: string;
  readonly prefix: string;
  readonly disabled: boolean;
  readonly models: readonly RuntimeModelOption[];
}

export interface RuntimeModelGroupOptions {
  readonly includeHidden?: boolean;
  readonly includeDisabled?: boolean;
}

export interface RuntimeAgentModelState {
  readonly hiddenModels: string[];
  readonly customModels: RuntimeCustomModelSettings[];
  readonly modelContextWindows: Record<string, number>;
}

/** Minimal GET shape needed to derive the canonical standard-API model inventory. */
export interface RuntimeModelSettingsSource {
  readonly agent?: unknown;
  readonly customApiProviders?: readonly unknown[];
  readonly nugProviders?: readonly unknown[];
  readonly anthropicModelsGrouped?: unknown;
  readonly geminiModelsGrouped?: unknown;
  readonly openaiModelsGrouped?: unknown;
  readonly nugModelsGrouped?: unknown;
  /** Codex 账号不在任何 *Providers 数组里：可用与否只看这个标志，模型来自 codexModels。 */
  readonly codexAvailable?: unknown;
  readonly codexModels?: unknown;
}

const CODEX_PREFIX = "codex";

function disabledProviderPrefixes(settings: RuntimeModelSettingsSource): ReadonlySet<string> {
  return new Set(
    asArray(asRecord(settings.agent).disabledProviders).filter((value): value is string => typeof value === "string"),
  );
}

/**
 * 已配好、可用的供应商数量（向导第 2 步据此放行）。与 Runtime 原生向导的
 * countConfiguredProviders 同口径：Runtime 读设置时已把 openai/anthropic/geminiProviders
 * 并进 customApiProviders，所以只需看 customApiProviders、nugProviders 与 Codex；
 * 被停用、在 agent.disabledProviders 里、没填密钥（NUG 还要地址）的都不算。
 */
export function countConfiguredProviders(settings: RuntimeModelSettingsSource | null | undefined): number {
  if (!settings) return 0;
  const disabled = disabledProviderPrefixes(settings);
  const configured = new Set<string>();
  const add = (kind: string, providers: unknown, requireBaseUrl: boolean) => {
    for (const raw of asArray(providers)) {
      const provider = asRecord(raw);
      const prefix = readString(provider, ["prefix"]);
      if (provider.disabled === true || (prefix && disabled.has(prefix))) continue;
      if (!readString(provider, ["apiKey"])) continue;
      if (requireBaseUrl && !readString(provider, ["baseUrl"])) continue;
      configured.add(`${kind}:${readString(provider, ["id"]) || prefix}`);
    }
  };
  add("custom", settings.customApiProviders, false);
  add("nug", settings.nugProviders, true);
  if (settings.codexAvailable === true && !disabled.has(CODEX_PREFIX)) configured.add(CODEX_PREFIX);
  return configured.size;
}

/** Codex 模型组：账号可用且前缀未被禁用时才有。与 Runtime 原生 useAllModels 的做法一致。 */
function codexModelGroup(
  settings: RuntimeModelSettingsSource,
  agentModels: RuntimeAgentModelState,
  includeHidden: boolean,
): RuntimeModelGroup | null {
  if (settings.codexAvailable !== true || disabledProviderPrefixes(settings).has(CODEX_PREFIX)) return null;
  const seen = new Set<string>();
  const models = asArray(settings.codexModels)
    .filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
    .flatMap((id): RuntimeModelOption[] => {
      const modelId = id.trim();
      const value = `${CODEX_PREFIX}:${modelId}`;
      const hidden = agentModels.hiddenModels.includes(value);
      if (seen.has(value) || (hidden && !includeHidden)) return [];
      seen.add(value);
      return [{
        value,
        label: modelId,
        provider: CODEX_PREFIX,
        providerId: CODEX_PREFIX,
        providerLabel: "Codex",
        modelId,
        hidden,
        custom: false,
        contextWindow: agentModels.modelContextWindows[value],
      }];
    });
  return models.length > 0
    ? { id: CODEX_PREFIX, label: "Codex", prefix: CODEX_PREFIX, disabled: false, models }
    : null;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeCustomModel(raw: unknown): RuntimeCustomModelSettings | null {
  const record = asRecord(raw);
  const value = readString(record, ["value"]);
  const label = readString(record, ["label"]);
  if (!value || !label) return null;
  return {
    value,
    label,
    ...(typeof record.provider === "string" ? { provider: record.provider } : {}),
    ...(typeof record.channel === "string" ? { channel: record.channel } : {}),
    ...(typeof record.channelType === "string" ? { channelType: record.channelType } : {}),
  };
}

export function getRuntimeAgentModelState(settings: RuntimeModelSettingsSource): RuntimeAgentModelState {
  const agent = asRecord(settings.agent);
  const hiddenModels = asArray(agent.hiddenModels)
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const customModels = asArray(agent.customModels)
    .map(normalizeCustomModel)
    .filter((model): model is RuntimeCustomModelSettings => Boolean(model));
  const rawWindows = asRecord(agent.modelContextWindows);
  const modelContextWindows = Object.fromEntries(
    Object.entries(rawWindows).flatMap(([model, value]) =>
      typeof value === "number" && Number.isInteger(value) && value >= 1 ? [[model, value]] : [],
    ),
  );
  return {
    hiddenModels: [...new Set(hiddenModels)],
    customModels,
    modelContextWindows,
  };
}

function groupedModelsForProvider(
  settings: RuntimeModelSettingsSource,
  provider: RuntimeEditableProvider | RuntimeEditableNugProvider,
  arrayKey: RuntimeProviderArrayKey,
): readonly unknown[] {
  if (arrayKey === "nugProviders") {
    const group = asArray(settings.nugModelsGrouped)
      .map(asRecord)
      .find((candidate) => readString(candidate, ["providerId", "id"]) === provider.id);
    return asArray(group?.models);
  }
  const customProvider = provider as RuntimeEditableProvider;
  const grouped = customProvider.protocol === "anthropic-official" || customProvider.protocol === "anthropic-compatible"
    ? settings.anthropicModelsGrouped
    : customProvider.protocol === "gemini-compatible"
      ? settings.geminiModelsGrouped
      : settings.openaiModelsGrouped;
  const group = asArray(grouped)
    .map(asRecord)
    .find((candidate) => readString(candidate, ["providerId", "id"]) === provider.id);
  return asArray(group?.models);
}

function modelOption(
  raw: unknown,
  provider: RuntimeEditableProvider | RuntimeEditableNugProvider,
  agentModels: RuntimeAgentModelState,
  custom: boolean,
): RuntimeModelOption | null {
  const record = asRecord(raw);
  const rawId = typeof raw === "string"
    ? raw
    : readString(record, ["value", "model_id", "modelId", "id", "model"]);
  if (!rawId) return null;
  const modelId = rawId.startsWith(`${provider.prefix}:`)
    ? rawId.slice(provider.prefix.length + 1)
    : rawId;
  const value = rawId.startsWith(`${provider.prefix}:`)
    ? rawId
    : `${provider.prefix}:${rawId}`;
  const label = typeof raw === "string"
    ? modelId
    : readString(record, [
      "label",
      "display_name",
      "displayName",
      "model_short_name",
      "modelShortName",
      "model_name",
      "modelName",
      "name",
    ]) || modelId;
  return {
    value,
    label,
    provider: provider.prefix,
    providerId: provider.id,
    providerLabel: provider.name || provider.prefix,
    modelId,
    hidden: agentModels.hiddenModels.includes(value),
    custom,
    contextWindow: agentModels.modelContextWindows[value] ?? provider.defaultContextWindow,
  };
}

export function buildRuntimeModelGroups(
  settings: RuntimeModelSettingsSource,
  options: RuntimeModelGroupOptions = {},
): RuntimeModelGroup[] {
  const includeHidden = options.includeHidden === true;
  const includeDisabled = options.includeDisabled === true;
  const providerEntries: Array<{
    readonly arrayKey: RuntimeProviderArrayKey;
    readonly provider: RuntimeEditableProvider | RuntimeEditableNugProvider;
  }> = [
    ...getRuntimeProviderArray(settings, "customApiProviders").map((provider) => ({
      arrayKey: "customApiProviders" as const,
      provider,
    })),
    ...getRuntimeProviderArray(settings, "nugProviders").map((provider) => ({
      arrayKey: "nugProviders" as const,
      provider,
    })),
  ];
  const agentModels = getRuntimeAgentModelState(settings);

  const providerGroups = providerEntries.flatMap(({ arrayKey, provider }): RuntimeModelGroup[] => {
    if (provider.disabled && !includeDisabled) return [];
    const discovered = groupedModelsForProvider(settings, provider, arrayKey)
      .map((raw) => modelOption(raw, provider, agentModels, false))
      .filter((model): model is RuntimeModelOption => Boolean(model));
    const custom = agentModels.customModels
      .filter((model) => model.value.startsWith(`${provider.prefix}:`))
      .map((model) => modelOption(model, provider, agentModels, true))
      .filter((model): model is RuntimeModelOption => Boolean(model));
    const seen = new Set<string>();
    const models = [...discovered, ...custom].filter((model) => {
      if (seen.has(model.value) || (!includeHidden && model.hidden)) return false;
      seen.add(model.value);
      return true;
    });
    return models.length > 0 ? [{
      id: provider.id,
      label: provider.name || provider.prefix,
      prefix: provider.prefix,
      disabled: Boolean(provider.disabled),
      models,
    }] : [];
  });
  const codex = codexModelGroup(settings, agentModels, includeHidden);
  return codex ? [...providerGroups, codex] : providerGroups;
}

export function buildRuntimeModelOptions(settings: RuntimeModelSettingsSource): RuntimeModelOption[] {
  return buildRuntimeModelGroups(settings).flatMap((group) => group.models);
}

export function getRuntimeProviderArray(
  settings: RuntimeModelSettingsSource,
  key: "customApiProviders",
): RuntimeEditableProvider[];
export function getRuntimeProviderArray(
  settings: RuntimeModelSettingsSource,
  key: "nugProviders",
): RuntimeEditableNugProvider[];
export function getRuntimeProviderArray(
  settings: RuntimeModelSettingsSource,
  key: RuntimeProviderArrayKey,
): Array<RuntimeEditableProvider | RuntimeEditableNugProvider>;
export function getRuntimeProviderArray(
  settings: RuntimeModelSettingsSource,
  key: RuntimeProviderArrayKey,
): Array<RuntimeEditableProvider | RuntimeEditableNugProvider> {
  const source = key === "nugProviders" ? settings.nugProviders : settings.customApiProviders;
  return asArray(source).flatMap((rawProvider): Array<RuntimeEditableProvider | RuntimeEditableNugProvider> => {
    const provider = asRecord(rawProvider);
    const id = readString(provider, ["id"]);
    const name = readString(provider, ["name"]);
    const prefix = readString(provider, ["prefix"]);
    if (!id || !prefix) return [];
    const common = {
      ...provider,
      id,
      name: name || prefix,
      prefix,
      apiKey: typeof provider.apiKey === "string" ? provider.apiKey : "",
      baseUrl: typeof provider.baseUrl === "string" ? provider.baseUrl : "",
      defaultModel: typeof provider.defaultModel === "string" ? provider.defaultModel : "",
    };
    if (key === "nugProviders") return [common as RuntimeEditableNugProvider];
    return [{
      ...common,
      protocol: isRuntimeCustomApiProtocol(provider.protocol)
        ? provider.protocol
        : "responses-compatible",
    } as RuntimeEditableProvider];
  });
}
