import { FANQIE_RANKS, MAX_RANKS_PER_PLATFORM_SCAN, QIDIAN_RANKS } from "./config.js";
import { generateAnalysis } from "./analysis.js";
import { scrapeFanqieRanks } from "./fanqie.js";
import { scrapeQidianRanks } from "./qidian.js";
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
import type { BookSnapshot, MarketFetchOptions } from "./types.js";

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

export interface MarketScanInput {
  readonly platform?: "qidian" | "fanqie" | "all";
  readonly rankTypes?: readonly string[];
  readonly maxPages?: number;
}

export interface MarketQueryInput {
  readonly platform?: "qidian" | "fanqie";
  readonly rankType?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly analyze?: boolean;
}

function knownKeys(platform: "qidian" | "fanqie"): string[] {
  return (platform === "qidian" ? QIDIAN_RANKS : FANQIE_RANKS).map((rank) => rank.key);
}

function resolveRankKeys(platform: "qidian" | "fanqie", requested?: readonly string[]): string[] {
  const available = knownKeys(platform);
  const filtered = requested?.length
    ? requested.filter((key) => available.includes(key))
    : available.slice(0, MAX_RANKS_PER_PLATFORM_SCAN);
  return filtered.slice(0, MAX_RANKS_PER_PLATFORM_SCAN);
}

export async function scanMarket(
  input: MarketScanInput = {},
  options: MarketFetchOptions & { readonly store?: MarketSnapshotStore } = {},
): Promise<BookSnapshot[]> {
  const platforms: Array<"qidian" | "fanqie"> = input.platform === "all" || !input.platform
    ? ["qidian", "fanqie"]
    : [input.platform];
  const snapshots: BookSnapshot[] = [];
  for (const platform of platforms) {
    const keys = resolveRankKeys(platform, input.rankTypes);
    const fetched = platform === "qidian"
      ? await scrapeQidianRanks(keys, { ...options, maxPages: input.maxPages })
      : await scrapeFanqieRanks(keys, { ...options, maxPages: input.maxPages });
    snapshots.push(...fetched);
  }
  const store = options.store ?? new MarketSnapshotStore();
  await saveSnapshots(snapshots, store);
  return snapshots;
}

export async function scanMarketWithReport(
  input: MarketScanInput = {},
  options: MarketFetchOptions & { readonly store?: MarketSnapshotStore } = {},
): Promise<{ readonly snapshots: BookSnapshot[]; readonly report: MarketScanReport }> {
  const snapshots = await scanMarket(input, options);
  return { snapshots, report: summarizeScan(snapshots, options.now?.() ?? new Date()) };
}

export async function queryMarket(
  input: MarketQueryInput = {},
  options: { readonly store?: MarketSnapshotStore; readonly now?: () => Date } = {},
) {
  const filter: SnapshotFilter = {
    ...(input.platform ? { platform: input.platform } : {}),
    ...(input.rankType ? { rank_type: input.rankType } : {}),
    ...(input.fromDate ? { fromDate: input.fromDate } : {}),
    ...(input.toDate ? { toDate: input.toDate } : {}),
  };
  const store = options.store ?? new MarketSnapshotStore();
  const now = options.now?.() ?? new Date();
  const snapshots = await listSnapshots(filter, store);
  const latest = latestSnapshots(snapshots);
  const ranks: RankScanReport[] = latest.map((snapshot) => inspectSnapshot(snapshot, now));
  const analysis = input.analyze && input.platform
    ? await generateAnalysis(input.platform, { filter, now: options.now })
    : undefined;
  return { snapshots, latest, ranks, analysis };
}

export { samplePublicChapters };
