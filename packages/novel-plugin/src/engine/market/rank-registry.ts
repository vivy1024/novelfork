/**
 * 自定义榜单注册表。
 *
 * 内置榜单（QIDIAN_RANKS / FANQIE_RANKS）是硬编码基座；用户在
 * ~/.novelfork/market/ranks.json 追加自己的榜单。抓取侧（qidian.ts /
 * fanqie.ts）本来就是 URL 驱动的，自定义榜只要 URL 合法即可直接工作，
 * 无需新增解析逻辑。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { FANQIE_RANKS, QIDIAN_RANKS, type RankSourceConfig } from "./config.js";

export type MarketRankPlatform = "qidian" | "fanqie";

export interface CustomMarketRank extends RankSourceConfig {
  readonly platform: MarketRankPlatform;
}

export interface RankRegistry {
  readonly builtin: readonly RankSourceConfig[];
  readonly custom: readonly CustomMarketRank[];
  /** key（含 platform 前缀的自定义 key 仍只按 key 查）→ 解析出的抓取配置。 */
  readonly lookup: ReadonlyMap<string, RankSourceConfig>;
  /** key → 平台；custom 自带 platform，builtin 通过原表反查。 */
  readonly platformOf: ReadonlyMap<string, MarketRankPlatform>;
}

export interface MarketRankRegistryOptions {
  /** 测试用：覆盖 ~/.novelfork/market 根目录。 */
  readonly rootDir?: string;
}

const RANK_KEY_RE = /^[a-z][a-z0-9_]*$/;
const PLATFORM_HOST_SUFFIX: Readonly<Record<MarketRankPlatform, string>> = {
  qidian: "qidian.com",
  fanqie: "fanqienovel.com",
};

export function marketConfigDir(rootDir?: string): string {
  if (rootDir) return rootDir;
  const fromEnv = process.env.NOVELFORK_MARKET_DIR?.trim();
  if (fromEnv) return fromEnv;
  const home = homedir();
  if (home) return join(home, ".novelfork", "market");
  return join(process.cwd(), ".novelfork", "market");
}

function ranksFilePath(rootDir?: string): string {
  return join(marketConfigDir(rootDir), "ranks.json");
}

function isRankPlatform(value: unknown): value is MarketRankPlatform {
  return value === "qidian" || value === "fanqie";
}

function normalizeStoredRank(value: unknown): CustomMarketRank | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.key !== "string" || typeof record.name !== "string") return undefined;
  if (typeof record.url !== "string" || !isRankPlatform(record.platform)) return undefined;
  return {
    key: record.key,
    name: record.name,
    platform: record.platform,
    url: record.url,
    mobileUrl: typeof record.mobileUrl === "string" && record.mobileUrl.trim()
      ? record.mobileUrl
      : record.url,
  };
}

export async function loadCustomRanks(options: MarketRankRegistryOptions = {}): Promise<CustomMarketRank[]> {
  try {
    const raw = JSON.parse(await readFile(ranksFilePath(options.rootDir), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as { ranks?: unknown }).ranks)) return [];
    return ((raw as { ranks: unknown[] }).ranks)
      .map(normalizeStoredRank)
      .filter((rank): rank is CustomMarketRank => Boolean(rank));
  } catch {
    return [];
  }
}

async function saveCustomRanks(ranks: readonly CustomMarketRank[], options: MarketRankRegistryOptions = {}): Promise<void> {
  const dir = marketConfigDir(options.rootDir);
  await mkdir(dir, { recursive: true });
  await writeFile(ranksFilePath(options.rootDir), `${JSON.stringify({ ranks }, null, 2)}\n`, "utf8");
}

export async function listRankRegistry(options: MarketRankRegistryOptions = {}): Promise<RankRegistry> {
  const custom = await loadCustomRanks(options);
  const builtin = [...QIDIAN_RANKS, ...FANQIE_RANKS];
  const lookup = new Map<string, RankSourceConfig>();
  const platformOf = new Map<string, MarketRankPlatform>();
  for (const rank of QIDIAN_RANKS) {
    lookup.set(rank.key, rank);
    platformOf.set(rank.key, "qidian");
  }
  for (const rank of FANQIE_RANKS) {
    lookup.set(rank.key, rank);
    platformOf.set(rank.key, "fanqie");
  }
  for (const rank of custom) {
    lookup.set(rank.key, rank);
    platformOf.set(rank.key, rank.platform);
  }
  return { builtin, custom, lookup, platformOf };
}

/** 自定义榜的输入校验失败时列出全部错误，别让作者一个个修。 */
export function validateCustomRank(input: unknown, existing: { customKeys: ReadonlySet<string> }): { ok: true; rank: CustomMarketRank } | { ok: false; errors: string[] } {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const errors: string[] = [];
  const key = typeof record.key === "string" ? record.key.trim() : "";
  if (!key || !RANK_KEY_RE.test(key)) errors.push("key 必须是小写字母/数字/下划线");
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) errors.push("榜单名称不能为空");
  const platform = record.platform;
  if (!isRankPlatform(platform)) errors.push("platform 只能是 qidian 或 fanqie");
  const url = typeof record.url === "string" ? record.url.trim() : "";

  const platformOk = isRankPlatform(platform);
  for (const [field, value, required] of [["url", url, true], ["mobileUrl", typeof record.mobileUrl === "string" ? record.mobileUrl.trim() : "", false]] as const) {
    if (!value) {
      if (required) errors.push(`${field} 不能为空`);
      continue;
    }
    let host = "";
    try {
      host = new URL(value).hostname;
    } catch {
      errors.push(`${field} 不是合法 URL`);
      continue;
    }
    if (platformOk) {
      const suffix = PLATFORM_HOST_SUFFIX[platform];
      if (!(host === suffix || host.endsWith(`.${suffix}`))) {
        errors.push(`${field} 必须指向 ${suffix}（SSRF 红线，不让榜单跑外站）`);
      }
    }
  }

  const builtinKeys = new Set([...QIDIAN_RANKS, ...FANQIE_RANKS].map((rank) => rank.key));
  if (key && builtinKeys.has(key)) errors.push(`key "${key}" 与内置榜同名，会遮蔽内置配置`);
  if (!platformOk || errors.length > 0) {
    return { ok: false, errors };
  }
  const rank: CustomMarketRank = {
    key,
    name,
    platform,
    url,
    mobileUrl: typeof record.mobileUrl === "string" && record.mobileUrl.trim() ? record.mobileUrl.trim() : url,
  };
  // existing.customKeys 允许覆盖（PUT 语义），这里不参与判错。
  void existing;
  return { ok: true, rank };
}

export async function upsertCustomRank(input: unknown, options: MarketRankRegistryOptions = {}): Promise<{ ok: true; rank: CustomMarketRank } | { ok: false; errors: string[] }> {
  const custom = await loadCustomRanks(options);
  const result = validateCustomRank(input, { customKeys: new Set(custom.map((rank) => rank.key)) });
  if (!result.ok) return result;
  const others = custom.filter((rank) => rank.key !== result.rank.key);
  await saveCustomRanks([...others, result.rank], options);
  return { ok: true, rank: result.rank };
}

export async function deleteCustomRank(key: string, options: MarketRankRegistryOptions = {}): Promise<boolean> {
  const custom = await loadCustomRanks(options);
  const next = custom.filter((rank) => rank.key !== key);
  if (next.length === custom.length) return false;
  await saveCustomRanks(next, options);
  return true;
}
