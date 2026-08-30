import {
  BACKOFF_DELAY_MS,
  MAX_RETRIES,
  REQUEST_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  USER_AGENTS,
} from "./config.js";
import type { MarketFetchOptions } from "./types.js";

export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function pickUserAgent(random: () => number = Math.random): string {
  const index = Math.min(USER_AGENTS.length - 1, Math.floor(random() * USER_AGENTS.length));
  return USER_AGENTS[index] ?? USER_AGENTS[0];
}

export function jitterDelay(
  range: { readonly min: number; readonly max: number },
  random: () => number = Math.random,
): number {
  return range.min + Math.floor(random() * (range.max - range.min + 1));
}

export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
}

export function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function extractAttr(tag: string, name: string): string {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

export async function fetchText(
  url: string,
  options: MarketFetchOptions & { readonly headers?: Record<string, string> } = {},
): Promise<{ readonly ok: boolean; readonly status: number; readonly text: string }> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const delay = options.delay ?? sleep;
  const random = options.random ?? Math.random;
  const headers = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "User-Agent": options.userAgent ?? pickUserAgent(random),
    ...options.headers,
  };

  let lastStatus = 0;
  let lastText = "";
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await delay(jitterDelay({ min: BACKOFF_DELAY_MS.initial, max: BACKOFF_DELAY_MS.max }, random));
    } else if (!options.delay) {
      await delay(jitterDelay(REQUEST_DELAY_MS, random));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, { headers, signal: controller.signal });
      const text = await response.text();
      lastStatus = response.status;
      lastText = text;
      if (response.ok) return { ok: true, status: response.status, text };
      if (response.status < 500 && response.status !== 403 && response.status !== 429) {
        return { ok: false, status: response.status, text };
      }
    } catch (error) {
      lastText = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: lastStatus, text: lastText };
}
