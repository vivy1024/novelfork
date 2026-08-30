import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { generateAnalysis } from "./analysis.js";
import { MarketSnapshotStore } from "./snapshot-store.js";
import type { BookSnapshot, RankRecord } from "./types.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function record(partial: Partial<RankRecord>): RankRecord {
  return {
    platform: "qidian",
    book_id: "1",
    rank_type: "sanjiang",
    category: "玄幻",
    rank: 1,
    title: "剑来",
    author: "烽火",
    observed_at: "2026-06-22",
    source_status: "ok",
    parser_version: "0.1.0",
    ...partial,
  };
}

function snapshot(partial: Partial<BookSnapshot> & Pick<BookSnapshot, "rank_type" | "observed_at">): BookSnapshot {
  return {
    snapshot_id: `${partial.platform ?? "qidian"}-${partial.rank_type}-${partial.observed_at}`,
    platform: "qidian",
    parser_version: "0.1.0",
    records: [record({ rank_type: partial.rank_type, observed_at: partial.observed_at })],
    ...partial,
  };
}

describe("market snapshot store", () => {
  it("saves daily JSON and counts cross-list appearances", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "novelfork-market-"));
    roots.push(rootDir);
    const store = new MarketSnapshotStore({ rootDir });
    await store.saveSnapshots([
      snapshot({ rank_type: "sanjiang", observed_at: "2026-06-21", records: [record({ book_id: "1", rank_type: "sanjiang" })] }),
      snapshot({
        rank_type: "hotsales",
        observed_at: "2026-06-21",
        records: [
          record({ book_id: "1", rank_type: "hotsales" }),
          record({ book_id: "2", title: "第二本", rank_type: "hotsales" }),
        ],
      }),
      snapshot({ rank_type: "sanjiang", observed_at: "2026-06-22", records: [record({ book_id: "1" })] }),
    ]);
    expect(await store.listSnapshots({ platform: "qidian", fromDate: "2026-06-21" })).toHaveLength(3);
    const appearances = await store.loadRankAppearances({ platform: "qidian" });
    expect(appearances.get("1")).toBe(3);
    expect(appearances.get("2")).toBe(1);
  });

  it("generates markdown analysis from latest snapshots", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "novelfork-market-"));
    roots.push(rootDir);
    const store = new MarketSnapshotStore({ rootDir });
    await store.saveSnapshot(snapshot({
      rank_type: "sanjiang",
      observed_at: "2026-06-22",
      records: [
        record({ title: "修仙从签到开始", category: "玄幻", word_count: 200_000 }),
        record({ book_id: "9", title: "重生都市", category: "都市", word_count: 80_000, rank: 2 }),
      ],
    }));
    const analysis = await generateAnalysis("qidian", { store, now: () => new Date("2026-06-22T00:00:00.000Z") });
    expect(analysis.summary.total_books).toBe(2);
    expect(analysis.summary.top_categories).toEqual(expect.arrayContaining(["玄幻", "都市"]));
    expect(analysis.markdown).toContain("题材分布");
    expect(analysis.markdown).toContain("修仙");
    expect(analysis.markdown).not.toMatch(/content|正文/);
  });
});
