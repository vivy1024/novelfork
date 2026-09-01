import { describe, expect, it } from "vitest";

import { inspectSnapshot, summarizeScan } from "./report.js";
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
    ...partial,
  };
}

function snapshot(partial: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    snapshot_id: "qidian-newbook-2026-06-22",
    platform: "qidian",
    rank_type: "newbook",
    observed_at: "2026-06-22",
    parser_version: "0.1.0",
    records: [record()],
    ...partial,
  };
}

describe("market scan report", () => {
  it("names the public source instead of the internal rank key", () => {
    const report = inspectSnapshot(snapshot(), new Date("2026-06-22T00:00:00.000Z"));
    expect(report.source).toBe("起点 · 新书榜");
    expect(report.health).toBe("ok");
    expect(report.reason).toContain("起点 · 新书榜");
    expect(report.reason).not.toContain("newbook");
  });

  it("marks a successful snapshot stale after the freshness window", () => {
    const report = inspectSnapshot(snapshot(), new Date("2026-06-25T00:00:00.000Z"));
    expect(report.health).toBe("stale");
    expect(report.reason).toContain("只能当历史参考");
  });

  it("does not treat an empty or parse-failed scan as a usable ranking", () => {
    const failed = summarizeScan([
      snapshot({
        rank_type: "newbook",
        records: [record({ book_id: "", title: "", source_status: "parse_fail" })],
      }),
      snapshot({
        platform: "fanqie",
        rank_type: "male_read",
        snapshot_id: "fanqie-male_read-2026-06-22",
        records: [record({ platform: "fanqie", rank_type: "male_read", book_id: "", title: "", source_status: "empty" })],
      }),
    ], new Date("2026-06-22T00:00:00.000Z"));
    expect(failed.ok).toBe(false);
    expect(failed.succeeded).toBe(0);
    expect(failed.summary).toContain("这次没有扫到有效榜");
    expect(failed.summary).toContain("起点 · 新书榜");
    expect(failed.summary).toContain("番茄 · 男频阅读榜");
  });

  it("keeps a partial scan usable and still reports the failed lists", () => {
    const mixed = summarizeScan([
      snapshot(),
      snapshot({
        rank_type: "hotsales",
        snapshot_id: "qidian-hotsales-2026-06-22",
        records: [record({ rank_type: "hotsales", book_id: "", title: "", source_status: "empty" })],
      }),
    ], new Date("2026-06-22T00:00:00.000Z"));
    expect(mixed.ok).toBe(true);
    expect(mixed.succeeded).toBe(1);
    expect(mixed.failed).toBe(1);
    expect(mixed.summary).toContain("扫到 1 个有效榜");
    expect(mixed.summary).toContain("起点 · 畅销榜");
  });
});
