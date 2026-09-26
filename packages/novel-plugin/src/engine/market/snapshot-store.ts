import { join } from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

import { resolveGlobalConfigDir } from "@vivy1024/novelfork-core";

import { PARSER_VERSION, SNAPSHOT_RETENTION_DAYS } from "./config.js";
import type { BookSnapshot, RankRecord } from "./types.js";

export interface SnapshotFilter {
  readonly platform?: string;
  readonly rank_type?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
}

export interface SnapshotStoreOptions {
  readonly rootDir?: string;
}

function defaultRootDir(): string {
  const fromEnv = process.env.NOVELFORK_MARKET_DIR?.trim();
  if (fromEnv) return join(fromEnv, "snapshots");
  return join(resolveGlobalConfigDir(), "market", "snapshots");
}

function snapshotFileName(snapshot: BookSnapshot): string {
  return `${snapshot.platform}-${snapshot.rank_type}-${snapshot.observed_at}.json`;
}

function parseFileName(name: string): { platform: string; rankType: string; date: string } | null {
  const match = name.match(/^(qidian|fanqie)-([a-z0-9_]+)-(\d{4}-\d{2}-\d{2})\.json$/i);
  if (!match) return null;
  return { platform: match[1]!.toLowerCase(), rankType: match[2]!, date: match[3]! };
}

function inRange(date: string, fromDate?: string, toDate?: string): boolean {
  if (fromDate && date < fromDate) return false;
  if (toDate && date > toDate) return false;
  return true;
}

export class MarketSnapshotStore {
  readonly rootDir: string;

  constructor(options: SnapshotStoreOptions = {}) {
    this.rootDir = options.rootDir ?? defaultRootDir();
  }

  async saveSnapshot(snapshot: BookSnapshot): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const payload: BookSnapshot = {
      ...snapshot,
      parser_version: snapshot.parser_version || PARSER_VERSION,
    };
    await writeFile(join(this.rootDir, snapshotFileName(payload)), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  async saveSnapshots(snapshots: ReadonlyArray<BookSnapshot>): Promise<void> {
    for (const snapshot of snapshots) await this.saveSnapshot(snapshot);
  }

  async listSnapshots(filter: SnapshotFilter = {}): Promise<BookSnapshot[]> {
    let names: string[] = [];
    try {
      names = await readdir(this.rootDir);
    } catch {
      return [];
    }
    const snapshots: BookSnapshot[] = [];
    for (const name of names) {
      const meta = parseFileName(name);
      if (!meta) continue;
      if (filter.platform && meta.platform !== filter.platform) continue;
      if (filter.rank_type && meta.rankType !== filter.rank_type) continue;
      if (!inRange(meta.date, filter.fromDate, filter.toDate)) continue;
      try {
        const parsed = JSON.parse(await readFile(join(this.rootDir, name), "utf8")) as BookSnapshot;
        if (parsed && Array.isArray(parsed.records)) snapshots.push(parsed);
      } catch {
        // skip corrupt snapshot
      }
    }
    return snapshots.sort((a, b) => `${a.observed_at}-${a.rank_type}`.localeCompare(`${b.observed_at}-${b.rank_type}`));
  }

  async loadRankAppearances(filter: SnapshotFilter = {}): Promise<Map<string, number>> {
    const snapshots = await this.listSnapshots(filter);
    const counts = new Map<string, number>();
    for (const snapshot of snapshots) {
      const seen = new Set<string>();
      for (const record of snapshot.records) {
        if (!record.book_id || record.source_status !== "ok" || seen.has(record.book_id)) continue;
        seen.add(record.book_id);
        counts.set(record.book_id, (counts.get(record.book_id) ?? 0) + 1);
      }
    }
    return counts;
  }

  async pruneOlderThan(days = SNAPSHOT_RETENTION_DAYS, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
    const snapshots = await this.listSnapshots({ toDate: cutoff });
    return snapshots.length;
  }
}

export function okRecords(records: ReadonlyArray<RankRecord>): RankRecord[] {
  return records.filter((record) => record.source_status === "ok" && record.book_id);
}

export const defaultSnapshotStore = new MarketSnapshotStore();

export function saveSnapshot(snapshot: BookSnapshot, store = defaultSnapshotStore): Promise<void> {
  return store.saveSnapshot(snapshot);
}

export function saveSnapshots(snapshots: ReadonlyArray<BookSnapshot>, store = defaultSnapshotStore): Promise<void> {
  return store.saveSnapshots(snapshots);
}

export function listSnapshots(filter?: SnapshotFilter, store = defaultSnapshotStore): Promise<BookSnapshot[]> {
  return store.listSnapshots(filter);
}

export function loadRankAppearances(filter?: SnapshotFilter, store = defaultSnapshotStore): Promise<Map<string, number>> {
  return store.loadRankAppearances(filter);
}
