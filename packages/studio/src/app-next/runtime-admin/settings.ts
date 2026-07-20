import {
  createRuntimeAdminRequest,
  jsonRequest,
  type RuntimeAdminClientOptions,
} from "./client";

export type MaskedSecret = string;
export type RuntimeSettingsSection = Readonly<Record<string, unknown>>;

export interface RuntimeTlsSettings {
  readonly enabled: boolean;
  readonly certFile: string;
  readonly keyFile: string;
  readonly passphrase?: MaskedSecret;
  readonly caFile?: string;
}

export interface RuntimeServerSettings extends RuntimeSettingsSection {
  readonly port: number;
  readonly host: string;
  readonly openBrowser: "off" | "browser" | "app";
  readonly tls?: RuntimeTlsSettings;
}

export interface RuntimeProxySettings extends RuntimeSettingsSection {
  readonly mode: "system" | "direct" | "custom";
  readonly url?: string;
}

export interface RuntimePathsSettings extends RuntimeSettingsSection {
  readonly defaultProjectDir: string;
}

export interface RuntimeUpdateSettings extends RuntimeSettingsSection {
  readonly serverUrl?: string;
  readonly product?: string;
  readonly channel?: "stable" | "beta";
  readonly checkIntervalMinutes?: number;
  readonly autoDownload?: boolean;
}

export interface RuntimeRetryRule {
  readonly id: string;
  readonly domain?: string;
  readonly statusCode?: number;
  readonly keyword?: string;
  readonly enabled?: boolean;
  readonly note?: string;
}

export interface RuntimeCustomModelSettings extends RuntimeSettingsSection {
  readonly value: string;
  readonly label: string;
  readonly provider?: string;
  readonly channel?: string;
  readonly channelType?: string;
}

export interface RuntimeCommandWhitelistEntry {
  readonly pattern: string;
  readonly enabled?: boolean;
}

export interface RuntimeCommandBlacklistEntry {
  readonly pattern: string;
  readonly denyPrompt?: string;
  readonly enabled?: boolean;
}

export interface RuntimeWebFetchPatternEntry {
  readonly pattern: string;
  readonly enabled?: boolean;
}

export interface RuntimeWebFetchPolicy {
  readonly allowAll?: boolean;
  readonly whitelist?: readonly RuntimeWebFetchPatternEntry[];
  readonly blacklist?: readonly RuntimeWebFetchPatternEntry[];
}

export interface RuntimeAgentSettings extends RuntimeSettingsSection {
  readonly defaultModel?: string;
  readonly defaultPermissionMode?: string;
  readonly defaultStartInPlanMode?: boolean;
  readonly summaryModel?: string;
  readonly maxTurns?: number;
  readonly customRetryRules?: readonly RuntimeRetryRule[];
  readonly commandWhitelist?: readonly RuntimeCommandWhitelistEntry[];
  readonly commandBlacklist?: readonly RuntimeCommandBlacklistEntry[];
  readonly webFetchPolicy?: RuntimeWebFetchPolicy;
  readonly planReflectionAutoApprove?: boolean;
  readonly defaultSystemPrompt?: string | null;
  readonly hiddenModels?: readonly string[];
  readonly customModels?: readonly RuntimeCustomModelSettings[];
  readonly modelContextWindows?: Readonly<Record<string, number>>;
}

/** Agent-only patch; callers should construct this object instead of spreading GET settings. */
export interface RuntimeAgentSettingsPatch extends RuntimeSettingsSection {
  readonly commandWhitelist?: readonly RuntimeCommandWhitelistEntry[];
  readonly commandBlacklist?: readonly RuntimeCommandBlacklistEntry[];
  readonly webFetchPolicy?: RuntimeWebFetchPolicy;
  readonly planReflectionAutoApprove?: boolean;
  readonly defaultSystemPrompt?: string | null;
  readonly hiddenModels?: readonly string[];
  readonly customModels?: readonly RuntimeCustomModelSettings[];
  readonly modelContextWindows?: Readonly<Record<string, number>>;
}


export interface RuntimeProviderSettings extends RuntimeSettingsSection {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly apiKey?: MaskedSecret;
  readonly accessToken?: MaskedSecret;
  readonly oauthClientSecret?: MaskedSecret;
  readonly baseUrl?: string;
  readonly defaultModel?: string;
  readonly defaultContextWindow?: number;
  readonly proxy?: RuntimeProviderProxySettings;
  readonly disabled?: boolean;
}

export type RuntimeCustomApiProtocol =
  | "anthropic-official"
  | "anthropic-compatible"
  | "codex-native"
  | "responses-compatible"
  | "completions-compatible"
  | "gemini-compatible";

export interface RuntimeCustomApiProviderSettings extends RuntimeProviderSettings {
  readonly apiKey: MaskedSecret;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly protocol: RuntimeCustomApiProtocol;
  readonly geminiTransport?: "generate-content" | "interactions";
  readonly defaultReasoningEffort?: "none" | "low" | "medium" | "high" | "max" | null;
  readonly proxy?: RuntimeProviderProxySettings;
  readonly tlsRejectUnauthorized?: boolean;
  readonly codexAccountId?: string;
  readonly codexWebSocket?: boolean;
  readonly codexWebSearch?: boolean;
  readonly codexImageGeneration?: boolean;
  readonly userAgentMode?: "narrafork" | "claude-code" | "codex" | "custom";
  readonly customUserAgent?: string;
  readonly extraHeaders?: Readonly<Record<string, string>>;
  readonly emulateCodexHeaders?: boolean;
}

export interface RuntimeProviderProxySettings extends RuntimeSettingsSection {
  readonly mode: "default" | "direct" | "system" | "custom";
  readonly url?: string;
}

export interface RuntimeOpenAiProviderSettings extends RuntimeProviderSettings {
  readonly apiKey: MaskedSecret;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly responsesApi?: boolean;
  readonly apiMode?: "responses" | "completions" | "codex";
  readonly codexAccountId?: string;
  readonly codexWebSocket?: boolean;
  readonly codexWebSearch?: boolean;
  readonly codexImageGeneration?: boolean;
}

export interface RuntimeAnthropicProviderSettings extends RuntimeProviderSettings {
  readonly apiKey: MaskedSecret;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly defaultReasoningEffort?: "none" | "low" | "medium" | "high" | "max" | null;
  readonly tlsRejectUnauthorized?: boolean;
  readonly officialApi?: boolean;
}

export interface RuntimeNugProviderSettings extends RuntimeProviderSettings {
  readonly apiKey: MaskedSecret;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly nugUsername?: string;
  readonly nugUserId?: string;
  readonly oauthClientId?: string;
  readonly oauthClientSecret?: MaskedSecret;
  readonly oauthDeviceId?: string;
  readonly oauthCallbackUrl?: string;
}

export interface RuntimeClineProviderSettings extends RuntimeProviderSettings {
  readonly baseUrl: string;
  readonly accessToken?: MaskedSecret;
  readonly defaultModel: string;
  readonly enabledModels?: readonly string[];
}

/** Frontend-safe view of the Runtime settings response, including dynamic model metadata. */
export interface RuntimeSettings extends RuntimeSettingsSection {
  readonly server?: RuntimeServerSettings;
  readonly clientFingerprint?: RuntimeSettingsSection;
  readonly proxy?: RuntimeProxySettings;
  readonly paths?: RuntimePathsSettings;
  readonly knowledge?: RuntimeSettingsSection;
  readonly agent?: RuntimeAgentSettings;
  readonly chapters?: RuntimeSettingsSection;
  readonly containers?: RuntimeSettingsSection;
  readonly editor?: RuntimeSettingsSection;
  readonly auth?: RuntimeSettingsSection;
  readonly kiro?: RuntimeSettingsSection;
  readonly codex?: RuntimeSettingsSection;
  readonly search?: RuntimeSettingsSection;
  readonly routines?: RuntimeSettingsSection;
  /** Canonical editable standard-API provider collection. */
  readonly customApiProviders?: readonly RuntimeCustomApiProviderSettings[];
  /** Runtime-derived OpenAI-family cache; never PATCH this collection from Studio. */
  readonly openaiProviders?: readonly RuntimeOpenAiProviderSettings[];
  /** Runtime-derived Anthropic-family cache; never PATCH this collection from Studio. */
  readonly anthropicProviders?: readonly RuntimeAnthropicProviderSettings[];
  /** Runtime-derived Gemini-family cache; never PATCH this collection from Studio. */
  readonly geminiProviders?: readonly RuntimeProviderSettings[];
  readonly nugProviders?: readonly RuntimeNugProviderSettings[];
  readonly clineProviders?: readonly RuntimeClineProviderSettings[];
  readonly mcpServers?: readonly RuntimeSettingsSection[];
  readonly update?: RuntimeUpdateSettings;
  readonly vnet?: RuntimeSettingsSection;
  readonly shares?: RuntimeSettingsSection;
  readonly devices?: RuntimeSettingsSection;
  readonly kiroModels?: unknown;
  readonly openaiModels?: unknown;
  readonly openaiModelsGrouped?: unknown;
  readonly anthropicModelsGrouped?: unknown;
  readonly nugModelsGrouped?: unknown;
  readonly clineModelsGrouped?: unknown;
  readonly geminiModelsGrouped?: unknown;
  readonly customApiQuotas?: unknown;
  readonly codexAvailable?: boolean;
  readonly codexModels?: unknown;
  readonly builtinModelContextWindows?: Readonly<Record<string, number>>;
  readonly lanAddresses?: readonly string[];
  readonly summaryModelAvailable?: boolean;
  readonly serverRestarting?: boolean;
  readonly newUrl?: string;
}

/**
 * Only explicitly supplied top-level sections are sent. Callers must never spread a
 * GET response back into this patch because that can resend masked secrets.
 */
export interface RuntimeSettingsPatch {
  readonly server?: Partial<Omit<RuntimeServerSettings, "tls">> & { readonly tls?: RuntimeTlsSettings };
  readonly proxy?: RuntimeProxySettings;
  readonly paths?: Partial<RuntimePathsSettings>;
  readonly agent?: RuntimeAgentSettingsPatch;
  readonly chapters?: RuntimeSettingsSection;
  readonly containers?: RuntimeSettingsSection;
  readonly editor?: RuntimeSettingsSection;
  readonly auth?: RuntimeSettingsSection;
  readonly kiro?: RuntimeSettingsSection;
  readonly customApiProviders?: readonly RuntimeCustomApiProviderSettings[];
  readonly nugProviders?: readonly RuntimeNugProviderSettings[];
  readonly clineProviders?: readonly RuntimeClineProviderSettings[];
  readonly codex?: RuntimeSettingsSection;
  readonly clientFingerprint?: RuntimeSettingsSection;
  readonly search?: RuntimeSettingsSection;
  readonly routines?: RuntimeSettingsSection;
  readonly update?: RuntimeUpdateSettings;
  readonly vnet?: RuntimeSettingsSection;
  readonly shares?: RuntimeSettingsSection;
}

export interface TestModelInput {
  readonly model: string;
  readonly prompt: string;
}

export interface TestModelResult {
  readonly text: string;
  readonly requestUrls: readonly string[];
}

export interface GenerateTlsResult {
  readonly certPath: string;
  readonly keyPath: string;
  readonly expiresAt: string;
  readonly newUrl: string;
  readonly serverRestarting: true;
}

export interface RuntimeUpdateReleaseInfo {
  readonly version: string;
  readonly releaseDate: string;
  readonly releaseNotes?: string | Readonly<Record<string, string>>;
  readonly path: string;
  readonly sha512: string;
  readonly files: readonly {
    readonly url: string;
    readonly size: number;
    readonly sha512: string;
  }[];
  readonly releaseNotesPerVersion?: readonly {
    readonly version: string;
    readonly releaseDate: string;
    readonly releaseNotes?: string | Readonly<Record<string, string>>;
  }[];
}

export interface RuntimeUpdateCheckResult {
  readonly updateAvailable: boolean;
  readonly currentVersion: string;
  readonly latestVersion?: string;
  readonly releaseInfo?: RuntimeUpdateReleaseInfo;
  readonly downloadSize?: number;
  readonly totalSize?: number;
  readonly zstdPatchSize?: number;
  readonly strategy?: "zstd";
}

export interface AddRetryRuleInput {
  readonly domain?: string;
  readonly statusCode?: number;
  readonly keyword?: string;
  readonly note?: string;
}

export function createSettingsClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    get: () => request<RuntimeSettings>("/api/settings"),
    patch: (patch: RuntimeSettingsPatch) =>
      request<RuntimeSettings>("/api/settings", jsonRequest("PATCH", patch)),
    testModel: (input: TestModelInput) =>
      request<TestModelResult>("/api/settings/test-model", jsonRequest("POST", input)),
    generateTls: () =>
      request<GenerateTlsResult>("/api/settings/generate-tls", { method: "POST" }),
    checkUpdate: () => request<RuntimeUpdateCheckResult>("/api/update/check"),
    addRetryRule: (input: AddRetryRuleInput) =>
      request<RuntimeRetryRule>("/api/settings/retry-rules", jsonRequest("POST", input)),
  } as const;
}
