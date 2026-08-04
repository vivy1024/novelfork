import type {
  RuntimeCustomApiProtocol as RuntimeCustomApiProtocolContract,
  RuntimeCustomApiProviderSettings,
  RuntimeCustomModelSettings,
  RuntimeClineProviderSettings,
  RuntimeNugProviderSettings,
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

export interface RuntimeProviderArrayDefinition {
  readonly key: RuntimeProviderArrayKey;
  readonly label: string;
  readonly description: string;
  readonly addLabel: string;
}

export const RUNTIME_PROVIDER_ARRAYS: readonly RuntimeProviderArrayDefinition[] = [
  {
    key: "customApiProviders",
    label: "标准 API 连接",
    description: "管理 Anthropic、Gemini、Responses、Chat Completions 与 Codex Native API 连接。",
    addLabel: "添加标准 API 连接",
  },
  {
    key: "nugProviders",
    label: "NUG 反代服务",
    description: "管理 NarraFork Unified Gateway 反代服务和远端模型通道。",
    addLabel: "添加 NUG 反代服务",
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
  readonly nugProviders?: readonly unknown[];
  readonly clineProviders?: readonly unknown[];
  readonly openaiModelsGrouped?: unknown;
  readonly anthropicModelsGrouped?: unknown;
  readonly geminiModelsGrouped?: unknown;
  readonly nugModelsGrouped?: unknown;
  readonly clineModelsGrouped?: unknown;
  readonly kiroModels?: unknown;
  readonly codexModels?: unknown;
  readonly builtinModelContextWindows?: unknown;
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

export type RuntimePlatformModelKind = "kiro" | "codex";

interface RuntimePlatformModelIdentity {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
}

function platformModelOption(
  raw: unknown,
  identity: RuntimePlatformModelIdentity,
  agentModels: RuntimeAgentModelState,
  builtinWindows: Record<string, unknown>,
  custom: boolean,
): RuntimeModelOption | null {
  const record = asRecord(raw);
  const rawId = typeof raw === "string"
    ? raw
    : readString(record, ["value", "model_id", "modelId", "id", "model"]);
  if (!rawId) return null;
  const modelId = rawId.startsWith(`${identity.prefix}:`)
    ? rawId.slice(identity.prefix.length + 1)
    : rawId;
  const value = `${identity.prefix}:${modelId}`;
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
  const builtin = builtinWindows[value] ?? builtinWindows[modelId];
  return {
    value,
    label,
    provider: identity.prefix,
    providerId: identity.id,
    providerLabel: identity.name,
    modelId,
    hidden: agentModels.hiddenModels.includes(value),
    custom,
    contextWindow: agentModels.modelContextWindows[value]
      ?? (typeof builtin === "number" && Number.isFinite(builtin) ? builtin : undefined),
  };
}

function platformCustomModels(
  identity: RuntimePlatformModelIdentity,
  agentModels: RuntimeAgentModelState,
  builtinWindows: Record<string, unknown>,
): RuntimeModelOption[] {
  return agentModels.customModels
    .filter((model) => model.value.startsWith(`${identity.prefix}:`))
    .map((model) => platformModelOption(model, identity, agentModels, builtinWindows, true))
    .filter((model): model is RuntimeModelOption => Boolean(model));
}

function platformModelList(settings: RuntimeModelSettingsSource, platform: RuntimePlatformModelKind): readonly unknown[] {
  return asArray(platform === "kiro" ? settings.kiroModels : settings.codexModels);
}

/** Builds Kiro or built-in Codex inventory with the same agent-level hide/context/custom semantics as API providers. */
export function buildRuntimePlatformModelOptions(
  settings: RuntimeModelSettingsSource,
  platform: RuntimePlatformModelKind,
  options: RuntimeModelGroupOptions = {},
): RuntimeModelOption[] {
  const identity: RuntimePlatformModelIdentity = platform === "kiro"
    ? { id: "__platform_kiro__", name: "Kiro", prefix: "kiro" }
    : { id: "__platform_codex__", name: "内建 Codex", prefix: "codex" };
  const agentModels = getRuntimeAgentModelState(settings);
  const builtinWindows = asRecord(settings.builtinModelContextWindows);
  const seen = new Set<string>();
  return [
    ...platformModelList(settings, platform)
      .map((raw) => platformModelOption(raw, identity, agentModels, builtinWindows, false))
      .filter((model): model is RuntimeModelOption => Boolean(model)),
    ...platformCustomModels(identity, agentModels, builtinWindows),
  ].filter((model) => {
    if (seen.has(model.value) || (!options.includeHidden && model.hidden)) return false;
    seen.add(model.value);
    return true;
  });
}

/** Builds the model inventory for one Cline connection from its Runtime grouped model cache. */
export function buildRuntimeClineModelOptions(
  settings: RuntimeModelSettingsSource,
  provider: Pick<RuntimeClineProviderSettings, "id" | "name" | "prefix">,
  options: RuntimeModelGroupOptions = {},
): RuntimeModelOption[] {
  const identity: RuntimePlatformModelIdentity = {
    id: provider.id,
    name: provider.name || provider.prefix,
    prefix: provider.prefix,
  };
  const group = asArray(settings.clineModelsGrouped)
    .map(asRecord)
    .find((candidate) => readString(candidate, ["providerId", "id"]) === provider.id);
  const agentModels = getRuntimeAgentModelState(settings);
  const builtinWindows = asRecord(settings.builtinModelContextWindows);
  const seen = new Set<string>();
  return [
    ...asArray(group?.models)
      .map((raw) => platformModelOption(raw, identity, agentModels, builtinWindows, false))
      .filter((model): model is RuntimeModelOption => Boolean(model)),
    ...platformCustomModels(identity, agentModels, builtinWindows),
  ].filter((model) => {
    if (seen.has(model.value) || (!options.includeHidden && model.hidden)) return false;
    seen.add(model.value);
    return true;
  });
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

export function runtimeProviderPatch(
  key: "customApiProviders",
  providers: readonly RuntimeEditableProvider[],
): RuntimeSettingsPatch;
export function runtimeProviderPatch(
  key: "nugProviders",
  providers: readonly RuntimeEditableNugProvider[],
): RuntimeSettingsPatch;
export function runtimeProviderPatch(
  key: RuntimeProviderArrayKey,
  providers: readonly (RuntimeEditableProvider | RuntimeEditableNugProvider)[],
): RuntimeSettingsPatch;
export function runtimeProviderPatch(
  key: RuntimeProviderArrayKey,
  providers: readonly (RuntimeEditableProvider | RuntimeEditableNugProvider)[],
): RuntimeSettingsPatch {
  return key === "nugProviders"
    ? { nugProviders: providers as RuntimeSettingsPatch["nugProviders"] }
    : { customApiProviders: providers as RuntimeSettingsPatch["customApiProviders"] };
}

export function createRuntimeProviderDraft(protocol: RuntimeCustomApiProtocol = "responses-compatible"): RuntimeEditableProvider {
  return {
    id: "__new__",
    name: "新标准 API 供应商",
    prefix: "",
    apiKey: "",
    baseUrl: "",
    defaultModel: "",
    protocol,
    geminiTransport: protocol === "gemini-compatible" ? "generate-content" : undefined,
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

export function createRuntimeNugProviderDraft(): RuntimeEditableNugProvider {
  return {
    id: "__new__",
    name: "NUG 反代服务",
    prefix: "nug",
    apiKey: "",
    baseUrl: "",
    defaultModel: "",
    disabled: false,
  };
}

export function providerArrayLabel(key: RuntimeProviderArrayKey): string {
  return RUNTIME_PROVIDER_ARRAYS.find((definition) => definition.key === key)?.label ?? "供应商";
}

export function providerApiTypeLabel(
  key: RuntimeProviderArrayKey,
  provider: RuntimeEditableProvider | RuntimeEditableNugProvider,
): string {
  if (key === "nugProviders") return "NUG 反代";
  const customProvider = provider as RuntimeEditableProvider;
  const labels: Record<RuntimeCustomApiProtocol, string> = {
    "anthropic-official": "Anthropic 官方",
    "anthropic-compatible": "Anthropic 兼容",
    "codex-native": "Codex Native",
    "responses-compatible": "Responses 兼容",
    "completions-compatible": "Chat Completions 兼容",
    "gemini-compatible": "Gemini 兼容",
  };
  return labels[customProvider.protocol ?? "responses-compatible"];
}

export function providerSecrets(
  _key: RuntimeProviderArrayKey,
  provider: RuntimeEditableProvider | RuntimeEditableNugProvider,
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
  provider: RuntimeEditableProvider | RuntimeEditableNugProvider,
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

// ---------------------------------------------------------------------------
// 前缀冲突检测
// ---------------------------------------------------------------------------

const RESERVED_PREFIXES = new Set(["kiro", "codex"]);

/**
 * 构建 prefix → providerId 映射。
 * 用于实时检测前缀是否与其他供应商或保留前缀冲突。
 */
export function buildPrefixMap(settings: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  const custom = getRuntimeProviderArray(settings, "customApiProviders") as Array<{ id: string; prefix?: string }>;
  const nug = getRuntimeProviderArray(settings, "nugProviders") as Array<{ id: string; prefix?: string }>;
  for (const p of [...custom, ...nug]) {
    if (p.prefix) map.set(p.prefix, p.id);
  }
  return map;
}

/**
 * 返回前缀验证错误文案；无冲突时返回 undefined。
 */
export function getPrefixError(
  prefix: string,
  currentProviderId: string,
  allPrefixToId: Map<string, string>,
): string | undefined {
  if (!prefix) return undefined;
  if (RESERVED_PREFIXES.has(prefix)) return `前缀 "${prefix}" 是系统保留名称，不能使用。`;
  const owner = allPrefixToId.get(prefix);
  if (owner && owner !== currentProviderId) return `前缀 "${prefix}" 已被其他供应商使用。`;
  return undefined;
}

/**
 * 为新供应商生成不冲突的 prefix。
 */
export function getUniquePrefix(
  base: string,
  currentId: string,
  allPrefixToId: Map<string, string>,
): string {
  if (!getPrefixError(base, currentId, allPrefixToId)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!getPrefixError(candidate, currentId, allPrefixToId)) return candidate;
  }
  return base;
}

// ---------------------------------------------------------------------------
// 从 baseUrl 域名自动推导 name + prefix
// ---------------------------------------------------------------------------

/**
 * 从 URL 中提取主域名 label（倒数第二级），如：
 * - `https://api.openai.com/v1` → "openai"
 * - `https://open.bigmodel.cn` → "bigmodel"
 * 无法解析或为 IP/localhost 时返回 null。
 */
export function extractPrimaryDomainLabel(rawUrl: string): string | null {
  let url: URL;
  try {
    const normalized = rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`;
    url = new URL(normalized);
  } catch {
    return null;
  }
  const hostname = url.hostname;
  if (!hostname || hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null;
  const labels = hostname.split(".");
  if (labels.length < 2) return null;
  return labels[labels.length - 2] || null;
}
