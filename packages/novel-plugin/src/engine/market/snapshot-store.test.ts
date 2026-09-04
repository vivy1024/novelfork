import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { generateAnalysis } from "./analysis.js";
import { queryMarket, scanMarket } from "./index.js";
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
    expect(analysis.markdown).toContain("来源与时效");
    expect(analysis.markdown).toContain("起点 · 三江推荐");
    expect(analysis.markdown).toContain("修仙");
    expect(analysis.markdown).not.toMatch(/content|正文/);
  });

  it("does not treat stale snapshots as today's market conclusion", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "novelfork-market-"));
    roots.push(rootDir);
    const store = new MarketSnapshotStore({ rootDir });
    await store.saveSnapshot(snapshot({
      rank_type: "sanjiang",
      observed_at: "2026-06-22",
    }));
    const analysis = await generateAnalysis("qidian", { store, now: () => new Date("2026-06-26T00:00:00.000Z") });
    expect(analysis.summary.total_books).toBe(0);
    expect(analysis.markdown).toContain("只能当历史参考");
    expect(analysis.markdown).toContain("没有仍算最新的有效榜");
  });

  it("persists unfiltered raw snapshots while returning a genre-limited view", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "novelfork-market-"));
    roots.push(rootDir);
    const store = new MarketSnapshotStore({ rootDir });
    const html = `
<ul class="all-img-list">
  <li>
    <h2><a href="/info/1001">剑来</a></h2>
    <p class="author"><a href="/author/1">烽火戏诸侯</a><a href="/all/xuanhuan">玄幻</a></p>
    <p class="intro">一剑开天门</p>
  </li>
  <li>
    <h2><a href="/info/1002">重生都市</a></h2>
    <p class="author"><a href="/author/2">某</a><a href="/all/dushi">都市</a></p>
    <p class="intro">重来一次</p>
  </li>
</ul>`;
    const fetchImpl: typeof fetch = async () => new Response(html, { status: 200 });
    const viewed = await scanMarket({
      platform: "qidian",
      rankTypes: ["newbook"],
      categories: ["玄幻"],
      limit: 1,
    }, {
      store,
      fetchImpl,
      delay: async () => undefined,
      now: () => new Date("2026-06-22T00:00:00.000Z"),
      maxPages: 1,
      configRoot: rootDir,
    });
    expect(viewed[0]?.records.filter((item) => item.source_status === "ok").map((item) => item.book_id)).toEqual(["1001"]);
    const persisted = await store.listSnapshots({ platform: "qidian", rank_type: "newbook" });
    expect(persisted[0]?.records.filter((item) => item.source_status === "ok").map((item) => item.book_id)).toEqual(["1001", "1002"]);
  });

  it("applies genre filters when reading historical snapshots without rewriting files", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "novelfork-market-"));
    roots.push(rootDir);
    const store = new MarketSnapshotStore({ rootDir });
    await store.saveSnapshot(snapshot({
      rank_type: "newbook",
      observed_at: "2026-06-22",
      records: [
        record({ book_id: "1", category: "玄幻", rank_type: "newbook" }),
        record({ book_id: "2", title: "重生都市", category: "都市", rank: 2, rank_type: "newbook" }),
      ],
    }));
    const result = await queryMarket({ categories: ["玄幻"] }, { store, configRoot: rootDir });
    expect(result.snapshots[0]?.records.filter((item) => item.source_status === "ok").map((item) => item.book_id)).toEqual(["1"]);
    expect((await store.listSnapshots())[0]?.records).toHaveLength(2);
  });
});
