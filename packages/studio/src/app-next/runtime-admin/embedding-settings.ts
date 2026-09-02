import {
  createRuntimeAdminRequest,
  jsonRequest,
  type RuntimeAdminClientOptions,
} from "./client";

export interface PublicEmbeddingSettings {
  readonly baseUrl: string;
  readonly model: string;
  readonly dim: number;
  readonly hasApiKey: boolean;
  readonly apiKeyMasked: string;
  readonly configured: boolean;
}

export interface EmbeddingSettingsPatch {
  readonly baseUrl?: string;
  readonly model?: string;
  readonly dim?: number;
  readonly apiKey?: string;
}

export interface EmbeddingProbeResult {
  readonly ok: boolean;
  readonly model: string;
  readonly dim: number;
  readonly error?: string;
}

export const DEFAULT_EMBEDDING_BASE_URL = "https://api.siliconflow.cn/v1";
export const DEFAULT_EMBEDDING_MODEL = "BAAI/bge-m3";
export const DEFAULT_EMBEDDING_DIM = 1024;

export function createEmbeddingSettingsClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    get: () => request<PublicEmbeddingSettings>("/api/embedding"),
    save: (patch: EmbeddingSettingsPatch) =>
      request<PublicEmbeddingSettings>("/api/embedding", jsonRequest("PUT", patch)),
    test: () =>
      request<EmbeddingProbeResult>("/api/embedding/test", jsonRequest("POST", {})),
  } as const;
}

export type EmbeddingSettingsClient = ReturnType<typeof createEmbeddingSettingsClient>;
