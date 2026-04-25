import type { ZhuqueResult } from "../types.js";

export interface ZhuqueConfig {
  apiKey: string;
  endpoint: string;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
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

export async function scanWithZhuque(text: string, config: ZhuqueConfig): Promise<ZhuqueResult> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const attempts = (config.retries ?? 2) + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
      try {
        const response = await fetchImpl(config.endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ text, mode: "text" }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as Record<string, unknown>;
        return { status: "success", score: parseScore(data), raw: data };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      lastError = error;
    }
  }

  return { status: "failed", error: lastError instanceof Error ? lastError.message : String(lastError) };
}

export async function getZhuqueConfigFromKv(repo: KvLike): Promise<Omit<ZhuqueConfig, "fetchImpl"> | null> {
  const raw = await repo.get("settings:zhuque");
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<ZhuqueConfig>;
  if (!parsed.apiKey || !parsed.endpoint) return null;
  return {
    apiKey: parsed.apiKey,
    endpoint: parsed.endpoint,
    timeoutMs: parsed.timeoutMs,
    retries: parsed.retries,
  };
}
