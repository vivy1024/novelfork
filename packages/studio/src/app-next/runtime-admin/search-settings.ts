import {
  createRuntimeAdminRequest,
  jsonRequest,
  type RuntimeAdminClientOptions,
} from "./client";
import type {
  RuntimeProviderSettings,
  RuntimeSettingsSection,
} from "./settings";

export type SearchChannelKind = "native" | "kiro-mcp" | "nug-mcp" | "custom-api" | "subagent";
export type SearchReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

/**
 * Protocol ids are defined by the Runtime adapter registry, which grows without
 * product changes (bocha, unifuncs, custom-http were all invisible while this
 * was a hardcoded union). Keep it a string and resolve metadata from
 * `/api/settings/search/protocols`.
 */
export type CustomSearchProviderProtocol = string;

/** Localized labels as reported by the Runtime protocol registry. */
export interface SearchProtocolLocalizedText {
  readonly en: string;
  readonly "zh-CN": string;
}

export interface SearchProtocolMeta {
  readonly id: string;
  readonly label: SearchProtocolLocalizedText;
  readonly description: SearchProtocolLocalizedText;
  readonly defaultBaseUrl: string;
}

export interface SearchChannelConfig {
  id: string;
  kind: SearchChannelKind;
  enabled: boolean;
  providerId?: string;
  model?: string;
  reasoningEffort?: SearchReasoningEffort;
  maxTurns?: number;
  timeoutMs?: number;
}

export interface CustomSearchProviderConfig {
  id: string;
  name: string;
  disabled?: boolean;
  protocol: CustomSearchProviderProtocol;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  options?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface SearchSettings {
  channels: SearchChannelConfig[];
  customProviders: CustomSearchProviderConfig[];
  defaultTimeoutMs: number;
  maxOutputChars: number;
}

export interface SearchSettingsResponse extends RuntimeSettingsSection {
  readonly search?: Partial<SearchSettings>;
  readonly agent?: RuntimeSettingsSection;
  readonly customApiProviders?: readonly RuntimeProviderSettings[];
  readonly openaiProviders?: readonly RuntimeProviderSettings[];
  readonly anthropicProviders?: readonly RuntimeProviderSettings[];
  readonly nugProviders?: readonly RuntimeProviderSettings[];
  readonly clineProviders?: readonly RuntimeProviderSettings[];
  readonly kiroModels?: unknown;
  readonly codexModels?: unknown;
  readonly openaiModelsGrouped?: unknown;
  readonly anthropicModelsGrouped?: unknown;
  readonly nugModelsGrouped?: unknown;
  readonly clineModelsGrouped?: unknown;
}

export interface TestSearchChannelInput {
  readonly channelId?: string;
  readonly query: string;
  readonly purpose?: string;
}

export interface TestSearchChannelResult {
  readonly text: string;
  readonly channelId: string;
  readonly channelLabel: string;
  readonly attempts?: readonly unknown[];
}

/**
 * Fallback base URLs for the two protocols that shipped before the registry was
 * consumed. Only used when the registry request fails; the registry remains the
 * authoritative source.
 */
export const SEARCH_PROTOCOL_BASE_URLS: Readonly<Record<string, string>> = {
  "zhipu-web-search-v1": "https://open.bigmodel.cn/api/paas/v4",
  "tavily-mcp": "https://mcp.tavily.com/mcp/",
};

export const DEFAULT_SEARCH_PROTOCOL = "zhipu-web-search-v1";
export const CUSTOM_HTTP_PROTOCOL = "custom-http";

export const DEFAULT_SEARCH_TIMEOUT_MS = 60_000;
export const DEFAULT_SEARCH_MAX_OUTPUT_CHARS = 24_000;

/**
 * Keep an unknown protocol string as-is when the registry has not loaded yet, so
 * a provider configured against a newer Runtime is never silently rewritten to
 * the default protocol on save.
 */
export function normalizeSearchProtocol(
  value: unknown,
  knownProtocols?: readonly string[],
): CustomSearchProviderProtocol {
  if (typeof value !== "string" || value.length === 0) return DEFAULT_SEARCH_PROTOCOL;
  if (!knownProtocols || knownProtocols.length === 0) return value;
  return knownProtocols.includes(value) ? value : DEFAULT_SEARCH_PROTOCOL;
}

export function protocolDefaultBaseUrl(
  protocol: string,
  registry?: readonly SearchProtocolMeta[],
): string {
  const fromRegistry = registry?.find((meta) => meta.id === protocol)?.defaultBaseUrl;
  return fromRegistry ?? SEARCH_PROTOCOL_BASE_URLS[protocol] ?? "";
}

export function normalizeSearchSettings(response: SearchSettingsResponse): SearchSettings {
  const search = response.search ?? {};
  return {
    channels: Array.isArray(search.channels)
      ? search.channels.map((channel) => ({ ...channel }))
      : [],
    customProviders: Array.isArray(search.customProviders)
      ? search.customProviders.map((provider) => {
          const protocol = normalizeSearchProtocol(provider.protocol);
          return {
            ...provider,
            protocol,
            baseUrl: provider.baseUrl || protocolDefaultBaseUrl(protocol),
            headers: provider.headers ? { ...provider.headers } : undefined,
            options: provider.options ? { ...provider.options } : undefined,
          };
        })
      : [],
    defaultTimeoutMs: search.defaultTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
    maxOutputChars: search.maxOutputChars ?? DEFAULT_SEARCH_MAX_OUTPUT_CHARS,
  };
}

/** Runtime-backed client for the search section of NarraFork settings. */
export function createSearchSettingsClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    get: () => request<SearchSettingsResponse>("/api/settings"),
    listProtocols: () =>
      request<readonly SearchProtocolMeta[]>("/api/settings/search/protocols"),
    save: (search: SearchSettings) =>
      request<SearchSettingsResponse>("/api/settings", jsonRequest("PATCH", { search })),
    testChannel: (input: TestSearchChannelInput) =>
      request<TestSearchChannelResult>(
        "/api/settings/search/test",
        jsonRequest("POST", input),
      ),
  } as const;
}

export type SearchSettingsClient = ReturnType<typeof createSearchSettingsClient>;
