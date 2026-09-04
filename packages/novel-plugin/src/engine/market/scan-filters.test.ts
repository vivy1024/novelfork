import { describe, expect, it } from "vitest";

import { applyMarketScanFilters, clampScanLimit, recordMatchesCategories } from "./index.js";
import { DEFAULT_MARKET_LEXICON, recordMatchesContext } from "./lexicon-store.js";
import type { BookSnapshot, RankRecord } from "./types.js";

function record(partial: Partial<RankRecord> = {}): RankRecord {
  return {
    platform: "qidian",
    book_id: "1",
    rank_type: "newbook",
    category: "玄幻",
    rank: 1,
    title: "剑来",
    author: "烽火",
    observed_at: "2026-06-22",
    source_status: "ok",
    parser_version: "0.1.0",
    intro: "一剑开天门",
    ...partial,
  };
}

function snapshot(records: RankRecord[]): BookSnapshot {
  return {
    snapshot_id: "qidian-newbook-2026-06-22",
    platform: "qidian",
    rank_type: "newbook",
    observed_at: "2026-06-22",
    parser_version: "0.1.0",
    records,
  };
}

describe("market scan filters", () => {
  it("keeps intro while filtering by genre and book count", () => {
    const filtered = applyMarketScanFilters([
      snapshot([
        record({ book_id: "1", category: "玄幻", intro: "一剑开天门", rank: 1 }),
        record({ book_id: "2", title: "重生都市", category: "都市", intro: "重来一次", rank: 2 }),
        record({ book_id: "3", title: "诸天从签到开始", category: "玄幻诸天", intro: "签到", rank: 3 }),
      ]),
    ], { categories: ["玄幻"], limit: 1 });

    expect(filtered[0]?.records.filter((item) => item.source_status === "ok")).toEqual([
      expect.objectContaining({
        book_id: "1",
        category: "玄幻",
        intro: "一剑开天门",
      }),
    ]);
  });

  it("clamps per-rank book count to the public scan ceiling", () => {
    expect(clampScanLimit(0)).toBeUndefined();
    expect(clampScanLimit(12.9)).toBe(12);
    expect(clampScanLimit(9_999)).toBe(200);
  });

  it("keeps fuzzy genre matches after exact and alias checks", () => {
    const filtered = applyMarketScanFilters([
      snapshot([
        record({ book_id: "1", category: "玄幻诸天", rank: 1 }),
        record({ book_id: "2", category: "都市生活", rank: 2 }),
      ]),
    ], { categories: ["玄幻"] });
    expect(filtered[0]?.records.map((item) => item.book_id)).toEqual(["1"]);
  });

  it("matches aliases before falling back to substring", () => {
    expect(recordMatchesContext("都市生活", ["都市"], DEFAULT_MARKET_LEXICON)).toBe(true);
    expect(recordMatchesContext("东方玄幻", ["玄幻"], DEFAULT_MARKET_LEXICON)).toBe(true);
    expect(recordMatchesContext("历史", ["都市"], DEFAULT_MARKET_LEXICON)).toBe(false);
    expect(recordMatchesCategories("玄幻诸天", ["玄幻"])).toBe(true);
  });
});
