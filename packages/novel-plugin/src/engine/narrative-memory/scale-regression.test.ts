/**
 * 规模回归（300 章，常跑）：关键查询走索引、不做全表扫描；装配与对账耗时有宽松上界。
 * 百万字的实测数字见 million-chars.bench.test.ts（默认跳过）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildNarrativeContext } from "./build-narrative-context.js";
import { ensureBookPassageIndexFresh, passageBookKey, passageQueryTerms, searchPassageCandidates } from "./chapter-passage-index.js";
import { reconcileSettlementLedger } from "./ledger-consistency.js";
import { createLongBookStorage, LONG_BOOK_ID, SCALE_CHARACTERS, seedScaleBook, type LongBookHandle } from "./long-book-fixture.js";
import { readStoryTimeline } from "./story-time.js";

let handle: LongBookHandle;
const CHAPTERS = 300;

beforeAll(async () => {
  handle = await createLongBookStorage("novelfork-scale-regression");
  await seedScaleBook(handle, { chapters: CHAPTERS, charsPerChapter: 600 });
  await ensureBookPassageIndexFresh(handle.storage, LONG_BOOK_ID, handle.bookRoot, { budgetMs: 120_000 });
}, 120_000);

afterAll(async () => {
  await handle?.cleanup();
});

function plan(sql: string, ...params: unknown[]): string[] {
  return (handle.storage.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map((row) => row.detail);
}

/** 不允许对普通表做全表扫描（FTS 虚表的 MATCH 扫描与子查询结果扫描不算）。 */
function expectNoTableScan(details: readonly string[]): void {
  const scans = details.filter((detail) => /^SCAN /u.test(detail) && !/VIRTUAL TABLE|subquery|CONSTANT ROW/u.test(detail));
  expect(scans, details.join(" | ")).toEqual([]);
}

describe(`规模回归 · ${CHAPTERS} 章`, () => {
  it("段落检索：FTS 在外层，段落表按主键回查（不是对每段跑一次 MATCH）", () => {
    const phrase = passageQueryTerms(["信物37"]).terms[0]!.phrase;
    const expr = `book_key : "${passageBookKey(LONG_BOOK_ID)}" AND grams : (${phrase})`;
    const details = plan(`
      SELECT p.id FROM narrative_chapter_passage_fts
      CROSS JOIN narrative_chapter_passage p ON p.id = narrative_chapter_passage_fts.rowid
      WHERE narrative_chapter_passage_fts MATCH ? AND p.book_id = ? AND p.chapter_number BETWEEN ? AND ?
    `, expr, LONG_BOOK_ID, 1, CHAPTERS);
    expect(details[0]).toMatch(/SCAN narrative_chapter_passage_fts VIRTUAL TABLE/u);
    expect(details.some((detail) => /SEARCH p USING INTEGER PRIMARY KEY/u.test(detail))).toBe(true);
    const started = performance.now();
    const hits = searchPassageCandidates(handle.storage, { bookId: LONG_BOOK_ID, phrases: [phrase], mode: "all", toChapter: CHAPTERS, limit: 20 });
    expect(performance.now() - started).toBeLessThan(150);
    expect(hits.map((hit) => hit.chapterNumber)).toContain(37);
  });

  it("按章派生表、事实、事件、时间锚的按书读取都走索引", () => {
    for (const table of ["narrative_chapter_settlement", "narrative_chapter_mention", "narrative_story_time_anchor", "narrative_settlement_artifact"]) {
      expectNoTableScan(plan(`SELECT chapter_number, COUNT(*) FROM ${table} WHERE book_id = ? AND chapter_number IS NOT NULL GROUP BY chapter_number`, LONG_BOOK_ID));
    }
    expectNoTableScan(plan(`SELECT id FROM narrative_event WHERE book_id = ?`, LONG_BOOK_ID));
    expectNoTableScan(plan(`SELECT id FROM narrative_event WHERE book_id = ? AND chapter_number = ?`, LONG_BOOK_ID, 10));
    expectNoTableScan(plan(`SELECT id FROM narrative_fact WHERE book_id = ? AND subject = ?`, LONG_BOOK_ID, "慕容青云"));
    expectNoTableScan(plan(`SELECT id FROM narrative_story_time_anchor WHERE book_id = ? AND chapter_number <= ? ORDER BY chapter_number, ordinal`, LONG_BOOK_ID, 100));
    expectNoTableScan(plan(`SELECT id FROM narrative_chapter_passage WHERE book_id = ? AND chapter_number = ?`, LONG_BOOK_ID, 10));
  });

  it("对账一次读出存活事件，不逐章查询；耗时有上界", async () => {
    const started = performance.now();
    const result = await reconcileSettlementLedger(handle.storage, { bookId: LONG_BOOK_ID, bookRoot: handle.bookRoot, dryRun: true });
    expect(performance.now() - started).toBeLessThan(1500);
    expect(result.orphanedLedgerChapters).toEqual([]);
    expect(result.missingChapters).toEqual([]);
  });

  it("写前召回装配：卡片齐、耗时上界宽松，故事时间卡在内", async () => {
    const started = performance.now();
    const pkg = await buildNarrativeContext({
      storage: handle.storage,
      bookId: LONG_BOOK_ID,
      purpose: "write_chapter",
      chapterNumber: CHAPTERS + 1,
      entities: [SCALE_CHARACTERS[1]!],
      bookRoot: handle.bookRoot,
      sceneText: "想起信物37的下落。",
      channelTimeoutMs: 30_000,
    });
    expect(performance.now() - started).toBeLessThan(8000);
    expect(pkg.cards.some((card) => card.tags.includes("story-time"))).toBe(true);
    expect(pkg.diagnostics.totalEstimatedTokens).toBeGreaterThan(0);
  });

  it("故事时间轴推算线性（300 章内 50ms 内）", () => {
    const started = performance.now();
    const timeline = readStoryTimeline(handle.storage, LONG_BOOK_ID, CHAPTERS);
    expect(performance.now() - started).toBeLessThan(200);
    expect(timeline.points.length).toBeGreaterThan(200);
    expect(timeline.promises.length).toBe(CHAPTERS / 10);
  });
});
