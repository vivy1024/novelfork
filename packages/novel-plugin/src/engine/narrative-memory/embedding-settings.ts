/**
 * 独立 embedding 提供商配置：落到 NovelFork 产品库 kv_store，
 * 不写 .env，不挤进 Runtime「AI 供应商」chat 配置。
 *
 * 地址口径（作者 2026-10-15 决定，按 NarraFork 模型供应商地址口径）：地址由管理员配置
 * （写接口在产品层只许管理员），本地模型服务（Ollama、LM Studio 的 localhost）与内网地址
 * 都是正当用法，不做内网限制；只做协议白名单——http(s) 以外的地址（file: 会被读成本机文件）
 * 在保存时拒绝，读出存量配置时也按未配置处理，保证 createEmbeddings 永远拿不到它。
 */

import {
  createEmbeddings,
  createKvRepository,
  getStorageDatabase,
  type EmbeddingConfig,
  type StorageDatabase,
} from "@vivy1024/novelfork-core";
import { isHttpEndpoint } from "../net-guard.js";
import { decryptSecret, encryptSecret } from "../secret-box.js";

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

async function parseStoredConfig(raw: string | null | undefined): Promise<EmbeddingConfig | null> {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Omit<EmbeddingConfig, "apiKey">> & { apiKey?: unknown };
    const baseUrl = typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim() : "";
    // 密文对象或旧版明文字符串都能读出；解密失败时视为未配置，不回显任何内容。
    const apiKey = parsed.apiKey === undefined ? "" : (await decryptSecret(parsed.apiKey).catch(() => "")).trim();
    const model = typeof parsed.model === "string" && parsed.model.trim()
      ? parsed.model.trim()
      : DEFAULT_EMBEDDING_MODEL;
    const dim = typeof parsed.dim === "number" && Number.isInteger(parsed.dim) && parsed.dim > 0
      ? parsed.dim
      : DEFAULT_EMBEDDING_DIM;
    if (!baseUrl || !apiKey) return null;
    // 存量配置可能早于协议校验写入：非 http(s) 地址视为未配置，发请求前就拦下。
    if (!isHttpEndpoint(baseUrl)) return null;
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
    return await parseStoredConfig(raw);
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
  const baseUrl = patch.baseUrl ?? current?.baseUrl ?? DEFAULT_EMBEDDING_BASE_URL;
  if (!isHttpEndpoint(baseUrl)) {
    throw new Error("向量模型的服务地址必须是 http 或 https 地址，配置没有保存：file: 等地址会被当成本机文件读取；请填写模型服务的接口地址（本机服务可用 http://localhost:端口/v1）。");
  }
  // A key belongs to the endpoint it was entered for. Moving to a different base URL
  // without supplying a new key must not carry the old key along to the new endpoint.
  const endpointChanged = current !== null && baseUrl.replace(/\/+$/, "") !== current.baseUrl.replace(/\/+$/, "");
  const carriedKey = endpointChanged ? "" : (current?.apiKey ?? "");
  const next: EmbeddingConfig = {
    baseUrl,
    model: patch.model ?? current?.model ?? DEFAULT_EMBEDDING_MODEL,
    dim: patch.dim ?? current?.dim ?? DEFAULT_EMBEDDING_DIM,
    apiKey: patch.apiKey ?? carriedKey,
  };
  await storeFor(storage).set(EMBEDDING_SETTINGS_KV_KEY, JSON.stringify({
    baseUrl: next.baseUrl,
    model: next.model,
    dim: next.dim,
    apiKey: next.apiKey ? await encryptSecret(next.apiKey) : "",
  }));
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
    // 底层错误可能含内部主机与端口（T-10），只据 HTTP 状态给出方向，不回显消息文本。
    const status = typeof (error as { status?: unknown })?.status === "number"
      ? (error as { status: number }).status
      : undefined;
    const message = status === 401 || status === 403
      ? "向量模型的 API Key 无效或无权限，请检查后重试。"
      : "向量模型连接失败，请检查服务地址与网络后重试。";
    return {
      ok: false,
      model: config.model,
      dim: config.dim,
      error: message,
    };
  }
}
