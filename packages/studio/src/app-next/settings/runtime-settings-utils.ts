import type {
  RuntimeCustomApiProtocol as RuntimeCustomApiProtocolContract,
  RuntimeCustomApiProviderSettings,
  RuntimeCustomModelSettings,
  RuntimeProviderProxySettings,
  RuntimeSettingsPatch,
} from "../runtime-admin";

export type RuntimePermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "readOnly"
  | "dontAsk";

export type RuntimeReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
export type RuntimeCustomApiProtocol = RuntimeCustomApiProtocolContract;
export type RuntimeProviderArrayKey = "customApiProviders";

const RUNTIME_CUSTOM_API_PROTOCOLS = new Set<RuntimeCustomApiProtocol>([
  "anthropic-official",
  "anthropic-compatible",
  "responses-compatible",
  "completions-compatible",
  "codex-native",
]);

function isRuntimeCustomApiProtocol(value: unknown): value is RuntimeCustomApiProtocol {
  return typeof value === "string"
    && RUNTIME_CUSTOM_API_PROTOCOLS.has(value as RuntimeCustomApiProtocol);
}
export type RuntimeEditableProvider = RuntimeCustomApiProviderSettings;

export interface RuntimeProviderArrayDefinition {
  readonly key: RuntimeProviderArrayKey;
  readonly label: string;
  readonly description: string;
  readonly addLabel: string;
}

export const RUNTIME_PROVIDER_ARRAYS: readonly RuntimeProviderArrayDefinition[] = [
  {
    key: "customApiProviders",
    label: "标准 API 供应商",
    description: "唯一可编辑的 canonical 数据源，覆盖 Anthropic、Responses、Chat Completions 与 Codex Native 标准协议。",
    addLabel: "添加标准 API 供应商",
  },
] as const;

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

export interface RuntimeProviderSecret {
  readonly key: "apiKey";
  readonly label: string;
  readonly value: string;
  readonly primary: boolean;
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
  readonly openaiModelsGrouped?: unknown;
  readonly anthropicModelsGrouped?: unknown;
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

export function runtimeAgentModelPatch(state: RuntimeAgentModelState): RuntimeSettingsPatch {
  return {
    agent: {
      hiddenModels: state.hiddenModels,
      customModels: state.customModels,
      modelContextWindows: state.modelContextWindows,
    },
  };
}

export function migrateRuntimeAgentModelPrefix(
  state: RuntimeAgentModelState,
  previousPrefix: string,
  nextPrefix: string,
): RuntimeAgentModelState {
  if (!previousPrefix || !nextPrefix || previousPrefix === nextPrefix) return state;
  const previous = `${previousPrefix}:`;
  const migrate = (value: string) => value.startsWith(previous)
    ? `${nextPrefix}:${value.slice(previous.length)}`
    : value;
  return {
    hiddenModels: [...new Set(state.hiddenModels.map(migrate))],
    customModels: state.customModels.map((model) => ({
      ...model,
      value: migrate(model.value),
      provider: model.provider === previousPrefix ? nextPrefix : model.provider,
    })),
    modelContextWindows: Object.fromEntries(
      Object.entries(state.modelContextWindows).map(([model, size]) => [migrate(model), size]),
    ),
  };
}

function groupedModelsForProvider(
  settings: RuntimeModelSettingsSource,
  provider: RuntimeEditableProvider,
): readonly unknown[] {
  const grouped = provider.protocol === "anthropic-official" || provider.protocol === "anthropic-compatible"
    ? settings.anthropicModelsGrouped
    : settings.openaiModelsGrouped;
  const group = asArray(grouped)
    .map(asRecord)
    .find((candidate) => readString(candidate, ["providerId", "id"]) === provider.id);
  return asArray(group?.models);
}

function modelOption(
  raw: unknown,
  provider: RuntimeEditableProvider,
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
  const providers = getRuntimeProviderArray(settings, "customApiProviders");
  const agentModels = getRuntimeAgentModelState(settings);

  return providers.flatMap((provider) => {
    if (provider.disabled && !includeDisabled) return [];
    const discovered = groupedModelsForProvider(settings, provider)
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
  _key: RuntimeProviderArrayKey,
): RuntimeEditableProvider[] {
  return asArray(settings.customApiProviders).flatMap((rawProvider) => {
    const provider = asRecord(rawProvider);
    const id = readString(provider, ["id"]);
    const name = readString(provider, ["name"]);
    const prefix = readString(provider, ["prefix"]);
    if (!id || !prefix) return [];
    return [{
      ...provider,
      id,
      name: name || prefix,
      prefix,
      apiKey: typeof provider.apiKey === "string" ? provider.apiKey : "",
      baseUrl: typeof provider.baseUrl === "string" ? provider.baseUrl : "",
      defaultModel: typeof provider.defaultModel === "string" ? provider.defaultModel : "",
      protocol: isRuntimeCustomApiProtocol(provider.protocol)
        ? provider.protocol
        : "responses-compatible",
    } as RuntimeEditableProvider];
  });
}

export function runtimeProviderPatch(
  _key: RuntimeProviderArrayKey,
  providers: readonly RuntimeEditableProvider[],
): RuntimeSettingsPatch {
  return { customApiProviders: providers };
}

export function createRuntimeProviderDraft(_key: RuntimeProviderArrayKey): RuntimeEditableProvider {
  return {
    id: "__new__",
    name: "新标准 API 供应商",
    prefix: "",
    apiKey: "",
    baseUrl: "",
    defaultModel: "",
    protocol: "responses-compatible",
    disabled: false,
    tlsRejectUnauthorized: true,
    codexWebSocket: false,
    codexWebSearch: true,
    codexImageGeneration: true,
    userAgentMode: "narrafork",
    extraHeaders: {},
    emulateCodexHeaders: false,
  };
}

export function providerArrayLabel(_key: RuntimeProviderArrayKey): string {
  return RUNTIME_PROVIDER_ARRAYS[0].label;
}

export function providerApiTypeLabel(
  _key: RuntimeProviderArrayKey,
  provider: RuntimeEditableProvider,
): string {
  const labels: Record<RuntimeCustomApiProtocol, string> = {
    "anthropic-official": "Anthropic 官方",
    "anthropic-compatible": "Anthropic 兼容",
    "codex-native": "Codex Native",
    "responses-compatible": "Responses 兼容",
    "completions-compatible": "Chat Completions 兼容",
  };
  return labels[provider.protocol ?? "responses-compatible"];
}

export function providerSecrets(
  _key: RuntimeProviderArrayKey,
  provider: RuntimeEditableProvider,
): RuntimeProviderSecret[] {
  return [{ key: "apiKey", label: "API Key", value: provider.apiKey ?? "", primary: true }];
}

export function isMaskedSecret(value: string | undefined | null): boolean {
  return Boolean(value?.startsWith("*"));
}

export function maskedSecretSummary(value: string | undefined | null): string {
  if (!value) return "未配置";
  return isMaskedSecret(value) ? value : "已配置";
}

export function modelsForProvider(
  groups: readonly RuntimeModelGroup[],
  provider: RuntimeEditableProvider,
): RuntimeModelOption[] {
  return groups.find((group) => group.id === provider.id)?.models.slice() ?? [];
}

export function toRuntimeModelValue(prefix: string, model: string): string {
  if (!model) return "";
  if (model.startsWith(`${prefix}:`)) return model;
  return prefix ? `${prefix}:${model}` : model;
}

export function normalizeProviderProxy(
  mode: RuntimeProviderProxySettings["mode"],
  url?: string,
): RuntimeProviderProxySettings | undefined {
  if (mode === "default") return undefined;
  return mode === "custom" ? { mode, url: url?.trim() ?? "" } : { mode };
}
