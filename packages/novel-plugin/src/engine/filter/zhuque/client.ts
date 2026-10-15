import type { ZhuqueResult } from "../types.js";
import { checkPublicHttpEndpoint, type HostResolver } from "../../net-guard.js";

export interface ZhuqueConfig {
  apiKey: string;
  endpoint: string;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  /**
   * 域名解析器，发请求前用解析结果核对是否指向内网。本模块会进浏览器打包路径，
   * 不能自己引入 node:dns，由服务端路由注入（routes/filter.ts）。缺省时只接受 IP 字面量地址。
   */
  resolveHost?: HostResolver;
}

/** 单次请求超时（毫秒）的允许范围与默认值。 */
export const ZHUQUE_TIMEOUT_MS = { min: 1_000, max: 60_000, fallback: 10_000 } as const;
/** 失败重试次数的允许范围与默认值（总尝试次数 = 重试 + 1）。 */
export const ZHUQUE_RETRIES = { min: 0, max: 5, fallback: 2 } as const;

function clampInteger(value: unknown, range: { readonly min: number; readonly max: number; readonly fallback: number }): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return range.fallback;
  return Math.min(range.max, Math.max(range.min, Math.trunc(value)));
}

/** 超时限制在 1000–60000 毫秒；非数字回落到默认 10000。 */
export function clampZhuqueTimeoutMs(value: unknown): number {
  return clampInteger(value, ZHUQUE_TIMEOUT_MS);
}

/** 重试限制在 0–5 次；非数字回落到默认 2。 */
export function clampZhuqueRetries(value: unknown): number {
  return clampInteger(value, ZHUQUE_RETRIES);
}

type KvLike = { get(key: string): Promise<string | null | undefined> | string | null | undefined };

function parseScore(data: Record<string, unknown>): number {
  const raw = typeof data.aiProbability === "number"
    ? data.aiProbability * 100
    : typeof data.score === "number"
      ? data.score
      : typeof data.ai_rate === "number"
        ? data.ai_rate
        : 0;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// ZhuqueResult 只有一个 error 字符串，没有结构化 explanation 字段：这里把三段（发生了什么 /
// 为什么 / 建议怎么做）写进同一句，且不回显地址、底层错误与上游响应内容。
const ENDPOINT_REJECTED_ERROR = "检测服务地址不可用，已拒绝请求：地址必须是可解析到公网的 http(s) 地址，否则正文与密钥可能被送往本机文件或内网服务；请在朱雀检测设置里改用服务商的公网地址。";
const REDIRECT_ERROR = "检测服务返回了重定向，已按失败处理：跟随重定向可能把正文与密钥转发到未经校验的地址；请把设置里的地址改成重定向后的最终公网地址。";
const REQUEST_FAILED_ERROR = "检测服务请求失败，请稍后重试或检查服务配置。";

function isRedirect(response: Response): boolean {
  // redirect: "manual" 时，Bun/Node 返回原始 3xx；浏览器返回 type 为 opaqueredirect、status 为 0 的响应。
  return response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 把正文发往朱雀检测服务，只返回解析出的分数（T-10）。
 *
 * - 发请求前再校验一次地址（存量配置可能早于校验写入）：协议白名单、字面内网地址、DNS 解析结果。
 * - 不跟随重定向（redirect: "manual"），3xx 一律按失败处理且不重试。
 * - 上游响应体不原样回传、不落库（扫描报告会整份写进 filter_report.details），只保留分数。
 */
export async function scanWithZhuque(text: string, config: ZhuqueConfig): Promise<ZhuqueResult> {
  const check = await checkPublicHttpEndpoint(config.endpoint, config.resolveHost);
  if (!check.ok) {
    return { status: "failed", error: ENDPOINT_REJECTED_ERROR };
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  const attempts = clampZhuqueRetries(config.retries ?? ZHUQUE_RETRIES.fallback) + 1;
  const timeoutMs = clampZhuqueTimeoutMs(config.timeoutMs ?? ZHUQUE_TIMEOUT_MS.fallback);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(config.endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ text, mode: "text" }),
          signal: controller.signal,
          redirect: "manual",
        });
        if (isRedirect(response)) {
          return { status: "failed", error: REDIRECT_ERROR };
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: unknown = await response.json();
        if (!isRecord(data)) throw new Error("unexpected body");
        return { status: "success", score: parseScore(data) };
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // 底层错误可能含内部主机与端口，只在内部吞掉，不回显给调用方（T-10）。
    }
  }

  return { status: "failed", error: REQUEST_FAILED_ERROR };
}

/**
 * 读取朱雀配置。apiKey 在 kv 中可能是密文对象（T-10），由调用方注入解密器。
 * 解密器不由本模块引入，避免把 Node 加密模块带进浏览器打包路径（engine barrel 会导出本文件）。
 * 超时与重试按允许范围收敛，防止存量配置里的极端值拖住扫描。
 * JSON 损坏或解密失败时抛出，由调用方决定如何降级（见 routes/filter.ts）。
 */
export async function getZhuqueConfigFromKv(
  repo: KvLike,
  decrypt?: (sealed: unknown) => Promise<string>,
): Promise<Omit<ZhuqueConfig, "fetchImpl" | "resolveHost"> | null> {
  const raw = await repo.get("settings:zhuque");
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { apiKey?: unknown; endpoint?: unknown; timeoutMs?: unknown; retries?: unknown };
  if (!parsed.apiKey || typeof parsed.endpoint !== "string" || !parsed.endpoint) return null;
  // 没有解密器时不能把密文对象字符串化成 "[object Object]" 再当 key 发出去。
  if (typeof parsed.apiKey === "object" && !decrypt) return null;
  const apiKey = typeof parsed.apiKey === "object" && decrypt ? await decrypt(parsed.apiKey) : String(parsed.apiKey);
  if (!apiKey) return null;
  return {
    apiKey,
    endpoint: parsed.endpoint,
    timeoutMs: clampZhuqueTimeoutMs(parsed.timeoutMs),
    retries: clampZhuqueRetries(parsed.retries),
  };
}
