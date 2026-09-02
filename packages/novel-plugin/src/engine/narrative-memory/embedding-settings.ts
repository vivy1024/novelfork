/**
 * 独立 embedding 提供商配置：落到 NovelFork 产品库 kv_store，
 * 不写 .env，不挤进 Runtime「AI 供应商」chat 配置。
 */

import {
  createEmbeddings,
  createKvRepository,
  getStorageDatabase,
  type EmbeddingConfig,
  type StorageDatabase,
} from "@vivy1024/novelfork-core";

export const DEFAULT_EMBEDDING_MODEL = "BAAI/bge-m3";
export const DEFAULT_EMBEDDING_DIM = 1024;
export const DEFAULT_EMBEDDING_BASE_URL = "https://api.siliconflow.cn/v1";

export const EMBEDDING_SETTINGS_KV_KEY = "settings:embedding";
export const EMBEDDING_API_KEY_MASK = "********";

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

export interface EmbeddingSettingsStore {
  get(key: string): Promise<string | null | undefined> | string | null | undefined;
  set(key: string, value: string): Promise<void> | void;
}

function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 4) return EMBEDDING_API_KEY_MASK;
  return `${EMBEDDING_API_KEY_MASK}${trimmed.slice(-4)}`;
}

function parseStoredConfig(raw: string | null | undefined): EmbeddingConfig | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<EmbeddingConfig>;
    const baseUrl = typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim() : "";
    const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "";
    const model = typeof parsed.model === "string" && parsed.model.trim()
      ? parsed.model.trim()
      : DEFAULT_EMBEDDING_MODEL;
    const dim = typeof parsed.dim === "number" && Number.isInteger(parsed.dim) && parsed.dim > 0
      ? parsed.dim
      : DEFAULT_EMBEDDING_DIM;
    if (!baseUrl || !apiKey) return null;
    return { baseUrl, apiKey, model, dim };
  } catch {
    return null;
  }
}

export function toPublicEmbeddingSettings(config: EmbeddingConfig | null): PublicEmbeddingSettings {
  const baseUrl = config?.baseUrl || DEFAULT_EMBEDDING_BASE_URL;
  const model = config?.model || DEFAULT_EMBEDDING_MODEL;
  const dim = config?.dim || DEFAULT_EMBEDDING_DIM;
  const apiKey = config?.apiKey?.trim() ?? "";
  return {
    baseUrl,
    model,
    dim,
    hasApiKey: apiKey.length > 0,
    apiKeyMasked: maskSecret(apiKey),
    configured: apiKey.length > 0,
  };
}

function storeFor(storage?: StorageDatabase): EmbeddingSettingsStore {
  return createKvRepository(storage ?? getStorageDatabase());
}

export async function loadEmbeddingConfig(storage?: StorageDatabase): Promise<EmbeddingConfig | null> {
  try {
    const raw = await storeFor(storage).get(EMBEDDING_SETTINGS_KV_KEY);
    return parseStoredConfig(raw);
  } catch {
    return null;
  }
}

export async function readPublicEmbeddingSettings(storage?: StorageDatabase): Promise<PublicEmbeddingSettings> {
  return toPublicEmbeddingSettings(await loadEmbeddingConfig(storage));
}

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

export function parseEmbeddingSettingsPatch(body: unknown): EmbeddingSettingsPatch {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("请求体必须是对象。");
  }
  const source = body as Record<string, unknown>;
  let baseUrl: string | undefined;
  let model: string | undefined;
  let dim: number | undefined;
  let apiKey: string | undefined;
  if (typeof source.baseUrl === "string") {
    const trimmed = source.baseUrl.trim();
    if (!trimmed) throw new Error("接口地址不能为空。");
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("接口地址必须是 http 或 https。");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("接口地址")) throw error;
      throw new Error("接口地址必须是有效的 URL。");
    }
    baseUrl = trimmed.replace(/\/+$/, "");
  }
  if (typeof source.model === "string") {
    const trimmed = source.model.trim();
    if (!trimmed) throw new Error("模型名不能为空。");
    model = trimmed;
  }
  if (source.dim !== undefined) {
    const parsed = parsePositiveInt(source.dim, 0);
    if (parsed <= 0) throw new Error("向量维度必须是正整数。");
    dim = parsed;
  }
  if (typeof source.apiKey === "string") {
    const trimmed = source.apiKey.trim();
    if (trimmed !== EMBEDDING_API_KEY_MASK && !trimmed.startsWith(EMBEDDING_API_KEY_MASK)) {
      apiKey = trimmed;
    }
  }
  return {
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(dim !== undefined ? { dim } : {}),
    ...(apiKey !== undefined ? { apiKey } : {}),
  };
}

export async function saveEmbeddingSettings(
  patch: EmbeddingSettingsPatch,
  storage?: StorageDatabase,
): Promise<PublicEmbeddingSettings> {
  const current = await loadEmbeddingConfig(storage);
  const next: EmbeddingConfig = {
    baseUrl: patch.baseUrl ?? current?.baseUrl ?? DEFAULT_EMBEDDING_BASE_URL,
    model: patch.model ?? current?.model ?? DEFAULT_EMBEDDING_MODEL,
    dim: patch.dim ?? current?.dim ?? DEFAULT_EMBEDDING_DIM,
    apiKey: patch.apiKey ?? current?.apiKey ?? "",
  };
  await storeFor(storage).set(EMBEDDING_SETTINGS_KV_KEY, JSON.stringify(next));
  return toPublicEmbeddingSettings(next.apiKey ? next : null);
}

export async function probeEmbeddingSettings(input: {
  readonly storage?: StorageDatabase;
  readonly embed?: typeof createEmbeddings;
} = {}): Promise<EmbeddingProbeResult> {
  const config = await loadEmbeddingConfig(input.storage);
  if (!config) {
    return { ok: false, model: DEFAULT_EMBEDDING_MODEL, dim: DEFAULT_EMBEDDING_DIM, error: "尚未配置向量模型 API Key。" };
  }
  const embed = input.embed ?? createEmbeddings;
  try {
    const result = await embed(config, ["连通测试"]);
    const dim = result.vectors[0]?.length ?? result.dim;
    if (!result.vectors[0] || dim <= 0) {
      return { ok: false, model: config.model, dim: config.dim, error: "接口已响应，但没有返回向量。" };
    }
    return { ok: true, model: result.model || config.model, dim };
  } catch (error) {
    return {
      ok: false,
      model: config.model,
      dim: config.dim,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
