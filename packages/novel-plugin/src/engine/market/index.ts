import { FANQIE_RANKS, MAX_BOOKS_PER_RANK_SCAN, MAX_RANKS_PER_PLATFORM_SCAN, QIDIAN_RANKS, type RankSourceConfig } from "./config.js";
import { generateAnalysis } from "./analysis.js";
import { scrapeFanqieRank } from "./fanqie.js";
import { scrapeQidianRank } from "./qidian.js";
import { samplePublicChapters } from "./public-chapter-sampler.js";
import {
  inspectSnapshot,
  latestSnapshots,
  summarizeScan,
  type MarketScanReport,
  type RankScanReport,
} from "./report.js";
import {
  listSnapshots,
  MarketSnapshotStore,
  saveSnapshots,
  type SnapshotFilter,
} from "./snapshot-store.js";
import { DEFAULT_MARKET_LEXICON, loadMarketLexicon, recordMatchesContext, type MarketLexicon } from "./lexicon-store.js";
import { listRankRegistry } from "./rank-registry.js";
import type { BookSnapshot, MarketFetchOptions, RankRecord } from "./types.js";

export * from "./types.js";
export * from "./config.js";
export * from "./fanqie-abogus.js";
export * from "./fanqie-pua.js";
export * from "./fanqie.js";
export * from "./qidian.js";
export * from "./snapshot-store.js";
export * from "./analysis.js";
export * from "./report.js";
export * from "./public-chapter-sampler.js";
export * from "./rank-registry.js";
export * from "./scan-prefs-store.js";
export * from "./lexicon-store.js";

export interface MarketScanInput {
  readonly platform?: "qidian" | "fanqie" | "all";
  readonly rankTypes?: readonly string[];
  readonly maxPages?: number;
  readonly categories?: readonly string[];
  readonly limit?: number;
}

export interface MarketQueryInput {
  readonly platform?: "qidian" | "fanqie";
  readonly rankType?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly analyze?: boolean;
  /** 读取期视图过滤：题材与条数在查询时刻应用，不回写快照。 */
  readonly categories?: readonly string[];
  readonly limit?: number;
}

export function resolveRankKeys(
  platform: "qidian" | "fanqie",
  requested: readonly string[] | undefined,
  registry: { readonly lookup: ReadonlyMap<string, RankSourceConfig>; readonly platformOf: ReadonlyMap<string, "qidian" | "fanqie"> },
): string[] {
  const builtin = (platform === "qidian" ? QIDIAN_RANKS : FANQIE_RANKS).map((rank) => rank.key);
  const customKeys = [...registry.lookup.keys()].filter((key) =>
    !builtin.includes(key) && registry.platformOf.get(key) === platform,
  );
  const available = [...builtin, ...customKeys];
  const filtered = requested?.length
    ? requested.filter((key) => available.includes(key))
    : available.slice(0, MAX_RANKS_PER_PLATFORM_SCAN);
  return filtered.slice(0, MAX_RANKS_PER_PLATFORM_SCAN);
}

export function normalizeScanCategories(categories?: readonly string[]): string[] {
  return [...new Set((categories ?? []).map((item) => item.trim()).filter(Boolean))];
}

export function clampScanLimit(limit?: number): number | undefined {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return undefined;
  const truncated = Math.trunc(limit);
  if (truncated <= 0) return undefined;
  return Math.min(truncated, MAX_BOOKS_PER_RANK_SCAN);
}

/**
 * 子串兼容旧行为的同步版本：词库可用走 recordMatchesContext；没有词库退化为旧子串匹配。
 */
export function recordMatchesCategories(category: string, categories: readonly string[]): boolean {
  if (categories.length === 0) return true;
  return recordMatchesContext(category, categories, DEFAULT_MARKET_LEXICON);
}

export function applyMarketScanFilters(
  snapshots: readonly BookSnapshot[],
  input: Pick<MarketScanInput, "categories" | "limit"> & { readonly lexicon?: MarketLexicon } = {},
): BookSnapshot[] {
  const categories = normalizeScanCategories(input.categories);
  const limit = clampScanLimit(input.limit);
  if (categories.length === 0 && limit === undefined) return [...snapshots];
  const lexicon = input.lexicon ?? DEFAULT_MARKET_LEXICON;
  return snapshots.map((snapshot) => {
    let records = snapshot.records as RankRecord[];
    if (categories.length > 0) {
      records = records.filter((record) =>
        record.source_status !== "ok" || recordMatchesContext(record.category, categories, lexicon),
      );
    }
    if (limit !== undefined) {
      const kept: RankRecord[] = [];
      let okCount = 0;
      for (const record of records) {
        const isOk = record.source_status === "ok" && Boolean(record.book_id);
        if (isOk) {
          if (okCount >= limit) continue;
          okCount += 1;
        }
        kept.push(record);
      }
      records = kept;
    }
    return { ...snapshot, records };
  });
}

export interface ScanMarketOptions extends MarketFetchOptions {
  readonly store?: MarketSnapshotStore;
  /** 测试/隔离环境用：覆盖 ~/.novelfork/market 配置目录（ranks.json 等）。 */
  readonly configRoot?: string;
}

/**
 * 抓取并落盘原始快照。过滤只发生在读取/返回期，换题材不必重新爬网。
 */
async function collectAndPersistMarketSnapshots(
  input: MarketScanInput,
  options: ScanMarketOptions,
): Promise<BookSnapshot[]> {
  const platforms: Array<"qidian" | "fanqie"> = input.platform === "all" || !input.platform
    ? ["qidian", "fanqie"]
    : [input.platform];
  const registry = await listRankRegistry({ rootDir: options.configRoot });
  const snapshots: BookSnapshot[] = [];
  for (const platform of platforms) {
    const keys = resolveRankKeys(platform, input.rankTypes, registry);
    for (const key of keys) {
      const config = registry.lookup.get(key);
      const fetchOptions: MarketFetchOptions = {
        ...options,
        maxPages: input.maxPages,
        ...(platform === "fanqie" && config && !FANQIE_RANKS.some((rank) => rank.key === key)
          ? { allowApiFallback: false }
          : {}),
      };
      const fetched = platform === "qidian"
        ? await scrapeQidianRank(key, fetchOptions, config)
        : await scrapeFanqieRank(key, fetchOptions, config);
      snapshots.push(fetched);
    }
  }
  const store = options.store ?? new MarketSnapshotStore();
  await saveSnapshots(snapshots, store);
  return snapshots;
}

async function viewMarketSnapshots(
  snapshots: readonly BookSnapshot[],
  input: Pick<MarketScanInput, "categories" | "limit">,
  configRoot?: string,
): Promise<BookSnapshot[]> {
  const lexicon = await loadMarketLexicon({ rootDir: configRoot });
  return applyMarketScanFilters(snapshots, { categories: input.categories, limit: input.limit, lexicon });
}

/**
 * raw-first：原始抓取永远先整批落盘（含失败/空态占位），
 * 才按本次请求参数产出过滤视图返回。过滤只影响返回值，不再有“换偏好=重新爬网”。
 */
export async function scanMarket(
  input: MarketScanInput = {},
  options: ScanMarketOptions = {},
): Promise<BookSnapshot[]> {
  const raw = await collectAndPersistMarketSnapshots(input, options);
  return viewMarketSnapshots(raw, input, options.configRoot);
}

export async function scanMarketWithReport(
  input: MarketScanInput = {},
  options: ScanMarketOptions = {},
): Promise<{ readonly snapshots: BookSnapshot[]; readonly report: MarketScanReport }> {
  const raw = await collectAndPersistMarketSnapshots(input, options);
  return {
    snapshots: await viewMarketSnapshots(raw, input, options.configRoot),
    report: summarizeScan(raw, options.now?.() ?? new Date()),
  };
}

export async function queryMarket(
  input: MarketQueryInput = {},
  options: { readonly store?: MarketSnapshotStore; readonly now?: () => Date; readonly configRoot?: string } = {},
) {
  const filter: SnapshotFilter = {
    ...(input.platform ? { platform: input.platform } : {}),
    ...(input.rankType ? { rank_type: input.rankType } : {}),
    ...(input.fromDate ? { fromDate: input.fromDate } : {}),
    ...(input.toDate ? { toDate: input.toDate } : {}),
  };
  const store = options.store ?? new MarketSnapshotStore();
  const now = options.now?.() ?? new Date();
  let snapshots = await listSnapshots(filter, store);
  if (input.categories?.length || input.limit) {
    const lexicon = await loadMarketLexicon({ rootDir: options.configRoot });
    snapshots = applyMarketScanFilters(snapshots, { categories: input.categories, limit: input.limit, lexicon });
  }
  const latest = latestSnapshots(snapshots);
  const ranks: RankScanReport[] = latest.map((snapshot) => inspectSnapshot(snapshot, now));
  const analysis = input.analyze && input.platform
    ? await generateAnalysis(input.platform, { filter, now: options.now })
    : undefined;
  return { snapshots, latest, ranks, analysis };
}

export { samplePublicChapters };
