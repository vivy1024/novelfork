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

  return providerEntries.flatMap(({ arrayKey, provider }) => {
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
