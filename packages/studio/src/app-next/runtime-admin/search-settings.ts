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
export type CustomSearchProviderProtocol = "zhipu-web-search-v1" | "tavily-mcp";

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

export const SEARCH_PROTOCOL_BASE_URLS: Readonly<Record<CustomSearchProviderProtocol, string>> = {
  "zhipu-web-search-v1": "https://open.bigmodel.cn/api/paas/v4",
  "tavily-mcp": "https://mcp.tavily.com/mcp/",
};

export const DEFAULT_SEARCH_TIMEOUT_MS = 60_000;
export const DEFAULT_SEARCH_MAX_OUTPUT_CHARS = 24_000;

export function normalizeSearchProtocol(value: unknown): CustomSearchProviderProtocol {
  return value === "tavily-mcp" ? "tavily-mcp" : "zhipu-web-search-v1";
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
            baseUrl: provider.baseUrl || SEARCH_PROTOCOL_BASE_URLS[protocol],
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
