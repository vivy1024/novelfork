/**
 * 扫描偏好存储 — 把前端的「题材/本数/榜单勾选」从 localStorage 挪到服务端，
 * 让 Agent 工具与界面行为一致。
 *
 * 存 ~/.novelfork/market/scan-prefs.json。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { marketConfigDir, type MarketRankRegistryOptions } from "./rank-registry.js";

export type { MarketRankRegistryOptions };

export interface MarketScanPrefsFile {
  readonly platform?: "qidian" | "fanqie" | "all";
  readonly rankTypes?: readonly string[];
  readonly categories?: readonly string[];
  readonly limit?: number;
}

function prefsFilePath(rootDir?: string): string {
  return join(marketConfigDir(rootDir), "scan-prefs.json");
}

function prefStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = [...new Set(
    value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()),
  )];
  return items.length > 0 ? items : [];
}

export function normalizeScanPrefs(input: unknown): MarketScanPrefsFile | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const platform = record.platform === "qidian" || record.platform === "fanqie" || record.platform === "all"
    ? record.platform
    : undefined;
  const rankTypes = prefStringArray(record.rankTypes);
  const categories = prefStringArray(record.categories);
  const truncatedLimit = typeof record.limit === "number" && Number.isFinite(record.limit)
    ? Math.trunc(record.limit)
    : undefined;
  const limit = truncatedLimit !== undefined && truncatedLimit > 0
    ? Math.min(200, truncatedLimit)
    : undefined;
  const prefs: MarketScanPrefsFile = {
    ...(platform ? { platform } : {}),
    ...(rankTypes ? { rankTypes } : {}),
    ...(categories ? { categories } : {}),
    ...(limit ? { limit } : {}),
  };
  return Object.keys(prefs).length > 0 ? prefs : undefined;
}

export async function loadScanPrefs(options: MarketRankRegistryOptions = {}): Promise<MarketScanPrefsFile | undefined> {
  try {
    const raw = JSON.parse(await readFile(prefsFilePath(options.rootDir), "utf8")) as unknown;
    return normalizeScanPrefs(raw);
  } catch {
    return undefined;
  }
}

export async function saveScanPrefs(input: unknown, options: MarketRankRegistryOptions = {}): Promise<MarketScanPrefsFile | undefined> {
  const prefs = normalizeScanPrefs(input);
  if (!prefs) return undefined;
  const dir = marketConfigDir(options.rootDir);
  await mkdir(dir, { recursive: true });
  await writeFile(prefsFilePath(options.rootDir), `${JSON.stringify(prefs, null, 2)}\n`, "utf8");
  return prefs;
}
