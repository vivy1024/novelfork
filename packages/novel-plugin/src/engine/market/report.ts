import { SNAPSHOT_FRESH_DAYS, platformLabel, rankLabel, sourceLabel } from "./config.js";
import { okRecords } from "./snapshot-store.js";
import type { BookSnapshot } from "./types.js";

export type SnapshotHealth = "ok" | "stale" | "parse_fail" | "empty";

export interface RankScanReport {
  readonly platform: "qidian" | "fanqie";
  readonly rankType: string;
  readonly source: string;
  readonly observedAt: string;
  readonly health: SnapshotHealth;
  readonly bookCount: number;
  readonly reason: string;
}

export interface MarketScanReport {
  readonly ok: boolean;
  readonly scanned: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly bookCount: number;
  readonly ranks: readonly RankScanReport[];
  readonly summary: string;
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.POSITIVE_INFINITY;
  return Math.floor((end - start) / 86_400_000);
}

function snapshotStatus(snapshot: BookSnapshot): Exclude<SnapshotHealth, "stale"> {
  const books = okRecords(snapshot.records);
  if (books.length > 0) return "ok";
  if (snapshot.records.some((record) => record.source_status === "parse_fail")) return "parse_fail";
  return "empty";
}

export function inspectSnapshot(snapshot: BookSnapshot, now = new Date()): RankScanReport {
  const books = okRecords(snapshot.records);
  const status = snapshotStatus(snapshot);
  const age = daysBetween(snapshot.observed_at, utcDate(now));
  const stale = status === "ok" && age > SNAPSHOT_FRESH_DAYS;
  const health: SnapshotHealth = stale ? "stale" : status;
  const source = sourceLabel(snapshot.platform, snapshot.rank_type);
  const reason = health === "ok"
    ? `${source} ${snapshot.observed_at} 扫到 ${books.length} 本。`
    : health === "stale"
      ? `${source} 最近一次成功是 ${snapshot.observed_at}，已经超过 ${SNAPSHOT_FRESH_DAYS} 天，只能当历史参考。`
      : health === "parse_fail"
        ? `${source} 页面拿到了，但榜单结构对不上，这次没有记成有效榜。`
        : `${source} 这次没扫到书（空页或请求失败）。`;
  return {
    platform: snapshot.platform,
    rankType: snapshot.rank_type,
    source,
    observedAt: snapshot.observed_at,
    health,
    bookCount: books.length,
    reason,
  };
}

export function summarizeScan(snapshots: readonly BookSnapshot[], now = new Date()): MarketScanReport {
  const ranks = snapshots.map((snapshot) => inspectSnapshot(snapshot, now));
  const succeeded = ranks.filter((rank) => rank.health === "ok").length;
  const failed = ranks.length - succeeded;
  const bookCount = ranks.reduce((sum, rank) => sum + rank.bookCount, 0);
  const failedLines = ranks
    .filter((rank) => rank.health !== "ok")
    .map((rank) => rank.reason);
  const summaryParts = [
    succeeded > 0
      ? `扫到 ${succeeded} 个有效榜，共 ${bookCount} 本。`
      : "这次没有扫到有效榜。",
    failed > 0 ? `${failed} 个榜失败或过期：${failedLines.join(" ")}` : undefined,
    "榜单数据只留在本机快照，没有写入经纬。",
  ].filter(Boolean);
  return {
    ok: succeeded > 0,
    scanned: ranks.length,
    succeeded,
    failed,
    bookCount,
    ranks,
    summary: summaryParts.join(" "),
  };
}

export function latestSnapshots(snapshots: readonly BookSnapshot[]): BookSnapshot[] {
  const latest = new Map<string, BookSnapshot>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.platform}-${snapshot.rank_type}`;
    const current = latest.get(key);
    if (!current || snapshot.observed_at >= current.observed_at) latest.set(key, snapshot);
  }
  return [...latest.values()];
}

export function freshSnapshots(snapshots: readonly BookSnapshot[], now = new Date()): BookSnapshot[] {
  return latestSnapshots(snapshots).filter((snapshot) => inspectSnapshot(snapshot, now).health === "ok");
}

export function snapshotHealthLines(snapshots: readonly BookSnapshot[], now = new Date()): string[] {
  return latestSnapshots(snapshots).map((snapshot) => inspectSnapshot(snapshot, now).reason);
}

export { platformLabel, rankLabel, sourceLabel };
