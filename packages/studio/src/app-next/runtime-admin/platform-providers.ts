import {
  createRuntimeAdminRequest,
  encodePathSegment,
  jsonRequest,
  withQuery,
  type OkResponse,
  type RuntimeAdminClientOptions,
} from "./client";

export interface RuntimePlatformCredential {
  readonly id: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly name?: string;
  readonly region?: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly priority?: number;
  readonly expiresAt?: string;
  readonly lastUsedAt?: string;
  readonly successCount?: number;
  readonly failureCount?: number;
  readonly tier?: string;
  readonly meterUsage?: number;
  readonly quota?: number;
  readonly [key: string]: unknown;
}

export interface RuntimePlatformAccountSnapshot {
  readonly total?: number;
  readonly available?: number;
  readonly currentId?: string;
  readonly loadBalancingMode?: "priority" | "balanced" | "tier-balanced";
  readonly entries?: readonly RuntimePlatformCredential[];
  readonly credentials?: readonly RuntimePlatformCredential[];
  readonly accounts?: readonly RuntimePlatformCredential[];
  readonly [key: string]: unknown;
}

export interface RuntimeUsageWindow {
  readonly label?: string;
  readonly used?: number;
  readonly limit?: number;
  readonly remaining?: number;
  readonly percent?: number;
  readonly resetAt?: string;
  readonly resetInSeconds?: number;
}

/** Remote provider usage payloads vary by account tier; these normalized fields cover the Runtime contract. */
export interface RuntimeCredentialUsage extends Readonly<Record<string, unknown>> {
  readonly used?: number;
  readonly limit?: number;
  readonly remaining?: number;
  readonly percent?: number;
  readonly resetAt?: string;
  readonly windows?: readonly RuntimeUsageWindow[];
}

export interface RuntimeKiroUsageQueueItem {
  readonly id?: string;
  readonly credentialId?: string;
  readonly status?: "pending" | "running" | "done" | "failed" | string;
  readonly error?: string;
}

export interface RuntimeKiroUsageQueue {
  readonly isRunning?: boolean;
  readonly items?: readonly RuntimeKiroUsageQueueItem[];
}

export interface RuntimeKiroStatus {
  readonly available?: boolean;
  readonly snapshot?: RuntimePlatformAccountSnapshot;
  readonly usageCache?: Readonly<Record<string, RuntimeCredentialUsage>>;
  readonly usageQueue?: RuntimeKiroUsageQueue;
}

/**
 * Codex exposes its account snapshot directly from `/api/codex/status`.
 * `snapshot` remains optional for compatibility with older Runtime builds.
 */
export interface RuntimeCodexUsageQueueItem {
  readonly id?: string;
  readonly credentialId?: string;
  readonly status?: "pending" | "running" | "done" | "failed" | string;
  readonly error?: string;
  readonly updatedAt?: string;
}

export interface RuntimeCodexUsageQueue {
  readonly isRunning?: boolean;
  readonly items?: readonly RuntimeCodexUsageQueueItem[];
}

export interface RuntimeCodexStatus extends RuntimePlatformAccountSnapshot {
  readonly snapshot?: RuntimePlatformAccountSnapshot;
  readonly usageCache?: Readonly<Record<string, RuntimeCredentialUsage>>;
  readonly usageQueue?: RuntimeCodexUsageQueue;
  readonly tierOrder?: readonly string[];
  readonly effectiveTierOrder?: readonly string[];
  readonly useWebSocket?: boolean;
  readonly useWebSearch?: boolean;
  readonly useImageGeneration?: boolean;
}

export interface RuntimeKiroCredentialUpdate {
  readonly email?: string;
  readonly displayName?: string;
  readonly region?: string;
}

export interface RuntimeCodexCredentialUpdate {
  readonly displayName?: string;
  readonly priority?: number;
}

export interface RuntimeCodexCredentialRemovalResult extends OkResponse {
  readonly removed?: number;
  readonly ids?: readonly string[];
}

export interface RuntimeCodexFingerprint {
  readonly userAgentMode: "narrafork" | "claude-code" | "codex" | "custom";
  readonly customUserAgent: string;
  readonly extraHeaders: Readonly<Record<string, string>>;
  readonly emulateCodexHeaders: boolean;
  readonly installationId: string;
}

export interface RuntimeCodexFingerprintPatch {
  readonly userAgentMode?: RuntimeCodexFingerprint["userAgentMode"];
  readonly customUserAgent?: string;
  readonly extraHeaders?: Readonly<Record<string, string>>;
  readonly emulateCodexHeaders?: boolean;
}

export interface RuntimeClineStatus {
  readonly authenticated: boolean;
  readonly email?: string;
  readonly displayName?: string;
  readonly totalModels?: number;
  readonly pendingAuth?: boolean;
  readonly providers?: readonly {
    readonly id: string;
    readonly name: string;
    readonly prefix: string;
    readonly hasToken: boolean;
  }[];
}

export interface RuntimeClineModel {
  readonly id: string;
  readonly name?: string;
  readonly contextLength?: number;
  readonly promptPrice?: string;
  readonly completionPrice?: string;
}

export interface RuntimeClineModelSearchResult {
  readonly models: readonly RuntimeClineModel[];
  readonly total: number;
}

export interface RuntimeClineBalance {
  readonly balance: number;
  readonly currency?: string;
  readonly [key: string]: unknown;
}

export interface RuntimeClineRecommendedModel extends RuntimeClineModel {
  readonly description?: string;
  readonly provider?: string;
}

export interface RuntimeClineRecommendedModels {
  readonly recommended: readonly RuntimeClineRecommendedModel[];
  readonly free: readonly RuntimeClineRecommendedModel[];
}

export interface RuntimeBrowserAuthStartResult {
  readonly authorizeUrl: string;
}

export interface RuntimeDeviceAuthStartResult {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete?: string;
  readonly expiresIn?: number;
  readonly interval?: number;
}

export interface RuntimeDeviceAuthPollResult {
  readonly pending: boolean;
  readonly error?: string;
  readonly [key: string]: unknown;
}

export interface RuntimeCodexStatusInput {
  readonly availablePage?: number;
  readonly unavailablePage?: number;
  readonly pageSize?: number;
}

export interface RuntimePlatformProvidersClient {
  readonly kiroStatus: () => Promise<RuntimeKiroStatus>;
  readonly kiroImportCredentials: (credentials: readonly unknown[]) => Promise<{ readonly added: number; readonly duplicates: number }>;
  readonly kiroDisableCredential: (credentialId: string) => Promise<OkResponse>;
  readonly kiroEnableCredential: (credentialId: string) => Promise<OkResponse>;
  readonly kiroResetCredential: (credentialId: string) => Promise<OkResponse>;
  readonly kiroRefreshCredential: (credentialId: string) => Promise<OkResponse>;
  readonly kiroUpdateCredential: (credentialId: string, patch: RuntimeKiroCredentialUpdate) => Promise<OkResponse>;
  readonly kiroSetCredentialPriority: (credentialId: string, priority: number) => Promise<OkResponse>;
  readonly kiroGetCredentialUsage: (credentialId: string) => Promise<RuntimeCredentialUsage>;
  readonly kiroDeleteCredential: (credentialId: string) => Promise<OkResponse>;
  readonly kiroSetLoadBalancingMode: (mode: "priority" | "balanced") => Promise<OkResponse>;
  readonly kiroRefreshModels: () => Promise<{ readonly models?: readonly unknown[]; readonly count?: number }>;

  readonly codexStatus: (input?: RuntimeCodexStatusInput) => Promise<RuntimeCodexStatus>;
  readonly codexBrowserAuth: () => Promise<RuntimeBrowserAuthStartResult>;
  readonly codexCancelBrowserAuth: () => Promise<OkResponse>;
  readonly codexStartDeviceAuth: () => Promise<RuntimeDeviceAuthStartResult>;
  readonly codexPollDeviceAuth: () => Promise<RuntimeDeviceAuthPollResult>;
  readonly codexCancelDeviceAuth: () => Promise<OkResponse>;
  readonly codexImportCredentials: (credentials: readonly unknown[]) => Promise<{ readonly added: number; readonly duplicates: number }>;
  readonly codexImportText: (text: string) => Promise<{ readonly added: number; readonly duplicates: number }>;
  readonly codexDisableCredential: (credentialId: string) => Promise<OkResponse>;
  readonly codexEnableCredential: (credentialId: string) => Promise<OkResponse>;
  readonly codexResetCredential: (credentialId: string) => Promise<OkResponse>;
  readonly codexRefreshCredential: (credentialId: string) => Promise<OkResponse>;
  readonly codexUpdateCredential: (credentialId: string, patch: RuntimeCodexCredentialUpdate) => Promise<OkResponse>;
  readonly codexGetCredentialUsage: (credentialId: string) => Promise<RuntimeCredentialUsage>;
  readonly codexDeleteCredentials: (credentialIds: readonly string[]) => Promise<RuntimeCodexCredentialRemovalResult>;
  readonly codexDeleteUnhealthyCredentials: () => Promise<RuntimeCodexCredentialRemovalResult>;
  readonly codexDeleteCredential: (credentialId: string) => Promise<OkResponse>;
  readonly codexSetLoadBalancingMode: (mode: "priority" | "balanced" | "tier-balanced") => Promise<OkResponse>;
  readonly codexSetTierOrder: (tierOrder: readonly string[]) => Promise<OkResponse>;
  readonly codexClearUsageQueue: () => Promise<OkResponse>;
  readonly codexGetFingerprint: () => Promise<RuntimeCodexFingerprint>;
  readonly codexUpdateFingerprint: (patch: RuntimeCodexFingerprintPatch) => Promise<Omit<RuntimeCodexFingerprint, "installationId"> & OkResponse>;
  readonly codexRegenerateInstallationId: () => Promise<OkResponse & { readonly installationId: string }>;
  readonly codexSetUseWebSocket: (useWebSocket: boolean) => Promise<OkResponse & { readonly useWebSocket: boolean }>;

  readonly clineStatus: () => Promise<RuntimeClineStatus>;
  readonly clineBrowserAuth: () => Promise<RuntimeBrowserAuthStartResult>;
  readonly clineCancelBrowserAuth: () => Promise<OkResponse>;
  readonly clineImportCallback: (callbackUrl: string) => Promise<{ readonly ok: boolean; readonly email?: string; readonly displayName?: string }>;
  readonly clineLogout: () => Promise<OkResponse>;
  readonly clineRefreshModels: () => Promise<{ readonly models: readonly RuntimeClineModel[]; readonly results?: readonly { readonly providerId: string; readonly name: string; readonly count: number; readonly error?: string }[] }>;
  readonly clineGetProviderModels: (providerId: string) => Promise<{ readonly models: readonly RuntimeClineModel[]; readonly fromCache: boolean }>;
  readonly clineRefreshProviderModels: (providerId: string) => Promise<{ readonly count: number; readonly fromCache: boolean }>;
  readonly clinePoolSearch: (query: string, limit?: number) => Promise<RuntimeClineModelSearchResult>;
  readonly clinePoolCount: () => Promise<{ readonly count: number }>;
  readonly clineSetEnabledModels: (models: readonly string[]) => Promise<{ readonly ok: boolean; readonly count: number; readonly modelContextWindows?: Readonly<Record<string, number>> }>;
  readonly clineBalance: () => Promise<RuntimeClineBalance>;
  readonly clineRecommendedModels: () => Promise<RuntimeClineRecommendedModels>;
  readonly clineRefreshUserInfo: () => Promise<RuntimeClineStatus>;
}

/**
 * Runtime-native administration APIs for providers that are intentionally not
 * represented as user-defined customApiProviders. These calls keep Kiro,
 * built-in Codex accounts, and Cline's account flow on their own server routes.
 */
export function createPlatformProvidersClient(
  options: RuntimeAdminClientOptions = {},
): RuntimePlatformProvidersClient {
  const request = createRuntimeAdminRequest(options);
  const credentialPath = (provider: "kiro" | "codex", credentialId: string, action: string) =>
    `/api/${provider}/credentials/${encodePathSegment(credentialId)}/${action}`;

  return {
    kiroStatus: () => request<RuntimeKiroStatus>("/api/kiro/status"),
    kiroImportCredentials: (credentials) =>
      request("/api/kiro/credentials/import", jsonRequest("POST", { credentials })),
    kiroDisableCredential: (credentialId) => request(credentialPath("kiro", credentialId, "disable"), { method: "POST" }),
    kiroEnableCredential: (credentialId) => request(credentialPath("kiro", credentialId, "enable"), { method: "POST" }),
    kiroResetCredential: (credentialId) => request(credentialPath("kiro", credentialId, "reset"), { method: "POST" }),
    kiroRefreshCredential: (credentialId) => request(credentialPath("kiro", credentialId, "refresh"), { method: "POST" }),
    kiroUpdateCredential: (credentialId, patch) =>
      request(`/api/kiro/credentials/${encodePathSegment(credentialId)}`, jsonRequest("PATCH", patch)),
    kiroSetCredentialPriority: (credentialId, priority) =>
      request(credentialPath("kiro", credentialId, "priority"), jsonRequest("POST", { priority })),
    kiroGetCredentialUsage: (credentialId) =>
      request<RuntimeCredentialUsage>(credentialPath("kiro", credentialId, "usage")),
    kiroDeleteCredential: (credentialId) => request(`/api/kiro/credentials/${encodePathSegment(credentialId)}`, { method: "DELETE" }),
    kiroSetLoadBalancingMode: (mode) =>
      request("/api/kiro/load-balancing-mode", jsonRequest("POST", { mode })),
    kiroRefreshModels: () => request("/api/kiro/models/refresh", { method: "POST" }),

    codexStatus: (input = {}) => request<RuntimeCodexStatus>(withQuery("/api/codex/status", {
      availablePage: input.availablePage,
      unavailablePage: input.unavailablePage,
      pageSize: input.pageSize,
    })),
    codexBrowserAuth: () => request<RuntimeBrowserAuthStartResult>("/api/codex/auth/browser", { method: "POST" }),
    codexCancelBrowserAuth: () => request<OkResponse>("/api/codex/auth/browser/cancel", { method: "POST" }),
    codexStartDeviceAuth: () => request<RuntimeDeviceAuthStartResult>("/api/codex/auth/device/start", { method: "POST" }),
    codexPollDeviceAuth: () =>
      request<RuntimeDeviceAuthPollResult>("/api/codex/auth/device/poll", { method: "POST" }),
    codexCancelDeviceAuth: () => request<OkResponse>("/api/codex/auth/device/cancel", { method: "POST" }),
    codexImportCredentials: (credentials) =>
      request("/api/codex/import", jsonRequest("POST", { credentials })),
    codexImportText: (text) => request("/api/codex/import", jsonRequest("POST", { text })),
    codexDisableCredential: (credentialId) => request(credentialPath("codex", credentialId, "disable"), { method: "POST" }),
    codexEnableCredential: (credentialId) => request(credentialPath("codex", credentialId, "enable"), { method: "POST" }),
    codexResetCredential: (credentialId) => request(credentialPath("codex", credentialId, "reset"), { method: "POST" }),
    codexRefreshCredential: (credentialId) => request(credentialPath("codex", credentialId, "refresh"), { method: "POST" }),
    codexUpdateCredential: (credentialId, patch) =>
      request(`/api/codex/credentials/${encodePathSegment(credentialId)}`, jsonRequest("PATCH", patch)),
    codexGetCredentialUsage: (credentialId) =>
      request<RuntimeCredentialUsage>(credentialPath("codex", credentialId, "usage"), { method: "POST" }),
    codexDeleteCredentials: (credentialIds) =>
      request<RuntimeCodexCredentialRemovalResult>("/api/codex/credentials/batch", jsonRequest("DELETE", { ids: credentialIds })),
    codexDeleteUnhealthyCredentials: () =>
      request<RuntimeCodexCredentialRemovalResult>("/api/codex/credentials/unhealthy", { method: "DELETE" }),
    codexDeleteCredential: (credentialId) => request(`/api/codex/credentials/${encodePathSegment(credentialId)}`, { method: "DELETE" }),
    codexSetLoadBalancingMode: (mode) =>
      request("/api/codex/load-balancing-mode", jsonRequest("POST", { mode })),
    codexSetTierOrder: (tierOrder) => request("/api/codex/tier-order", jsonRequest("POST", { tierOrder })),
    codexClearUsageQueue: () => request<OkResponse>("/api/codex/usage-queue/clear", { method: "POST" }),
    codexGetFingerprint: () => request<RuntimeCodexFingerprint>("/api/codex/fingerprint"),
    codexUpdateFingerprint: (patch) =>
      request<Omit<RuntimeCodexFingerprint, "installationId"> & OkResponse>("/api/codex/fingerprint", jsonRequest("POST", patch)),
    codexRegenerateInstallationId: () =>
      request<OkResponse & { readonly installationId: string }>("/api/codex/fingerprint/regenerate-installation-id", { method: "POST" }),
    codexSetUseWebSocket: (useWebSocket) =>
      request<OkResponse & { readonly useWebSocket: boolean }>("/api/codex/use-websocket", jsonRequest("POST", { useWebSocket })),

    clineStatus: () => request<RuntimeClineStatus>("/api/cline/status"),
    clineBrowserAuth: () => request<RuntimeBrowserAuthStartResult>("/api/cline/auth/browser", { method: "POST" }),
    clineCancelBrowserAuth: () => request<OkResponse>("/api/cline/auth/cancel", { method: "POST" }),
    clineImportCallback: (callbackUrl) => request("/api/cline/auth/callback", jsonRequest("POST", { callbackUrl })),
    clineLogout: () => request<OkResponse>("/api/cline/auth/logout", { method: "POST" }),
    clineRefreshModels: () => request("/api/cline/models/refresh", { method: "POST" }),
    clineGetProviderModels: (providerId) =>
      request(`/api/cline/providers/${encodePathSegment(providerId)}/models`),
    clineRefreshProviderModels: (providerId) =>
      request(`/api/cline/providers/${encodePathSegment(providerId)}/models/refresh`, { method: "POST" }),
    clinePoolSearch: (query, limit = 100) =>
      request<RuntimeClineModelSearchResult>(withQuery("/api/cline/pool/search", { q: query, limit })),
    clinePoolCount: () => request("/api/cline/pool/count"),
    clineSetEnabledModels: (models) => request("/api/cline/enabled-models", jsonRequest("POST", { models })),
    clineBalance: () => request("/api/cline/balance"),
    clineRecommendedModels: () => request<RuntimeClineRecommendedModels>("/api/cline/recommended-models"),
    clineRefreshUserInfo: () => request<RuntimeClineStatus>("/api/cline/user-info/refresh", { method: "POST" }),
  };
}
