/**
 * 百万字规模基准：约 1000 章 × 1000 字的合成书（章节文件 + 事实 / 事件 / 伏笔 / 实体 / 出场 / 台账 / 时间锚）。
 *
 * 测：写前召回装配耗时与 token、段落全文索引（首建 / 增量检查 / 检索）、实体索引重建、对账、卷摘要选取、故事时间轴。
 * 另跑 250 / 500 章两档，按章数倍增看耗时是否超线性。
 *
 * 默认跳过；需要时：
 *   NOVELFORK_BENCH=1 npx vitest run src/engine/narrative-memory/million-chars.bench.test.ts
 * 数据写在临时目录，跑完删除。
 */
import { afterAll, describe, expect, it } from "vitest";

import { rebuildNarrativeEntityIndex } from "../narrative-entity/entity-index.js";
import { buildNarrativeContext } from "./build-narrative-context.js";
import { ensureBookPassageIndexFresh, passageBookKey, passageQueryTerms, searchPassageCandidates } from "./chapter-passage-index.js";
import { countSurvivingLedgerEvents } from "./settlement-idempotency.js";
import { reconcileSettlementLedger } from "./ledger-consistency.js";
import { createLongBookStorage, LONG_BOOK_ID, SCALE_CHARACTERS, seedScaleBook, type LongBookHandle } from "./long-book-fixture.js";
import { buildStoryArcCards } from "./story-arc.js";
import { readStoryTimeline } from "./story-time.js";

const SIZES = (process.env.NOVELFORK_BENCH_SIZES ?? "250,500,1000").split(",").map(Number).filter((value) => value > 0);
const handles: LongBookHandle[] = [];

afterAll(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()));
});

async function median(times: number, fn: () => Promise<unknown> | unknown): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < times; i += 1) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return Number(samples[Math.floor(samples.length / 2)]!.toFixed(1));
}

describe.skipIf(!process.env.NOVELFORK_BENCH)("百万字规模基准", () => {
  const results: Record<string, unknown>[] = [];

  for (const chapters of SIZES) {
    it(`${chapters} 章`, async () => {
      const handle = await createLongBookStorage(`novelfork-bench-${chapters}`);
      handles.push(handle);
      const seed = await seedScaleBook(handle, { chapters, charsPerChapter: 1000 });
      const { storage, bookRoot } = handle;

      const passageFirst = performance.now();
      const first = await ensureBookPassageIndexFresh(storage, LONG_BOOK_ID, bookRoot, { budgetMs: 600_000 });
      const passageIndexBuildMs = Math.round(performance.now() - passageFirst);
      expect(first.pending).toEqual([]);
      const passageFreshCheckMs = await median(3, () => ensureBookPassageIndexFresh(storage, LONG_BOOK_ID, bookRoot, { budgetMs: 600_000 }));
      const phrase = passageQueryTerms(["信物37"]).terms[0]!.phrase;
      const passageSearchMs = await median(5, () => searchPassageCandidates(storage, { bookId: LONG_BOOK_ID, phrases: [phrase], mode: "all", toChapter: chapters, limit: 20 }));
      const common = passageQueryTerms([SCALE_CHARACTERS[1]!]).terms[0]!.phrase;
      const passageCommonSearchMs = await median(5, () => searchPassageCandidates(storage, { bookId: LONG_BOOK_ID, phrases: [common], mode: "all", toChapter: chapters, limit: 60 }));

      // 改前写法对照：普通 JOIN（规划器把段落表放外层、逐行 MATCH）
      const legacyExpr = `book_key : "${passageBookKey(LONG_BOOK_ID)}" AND grams : (${phrase})`;
      const legacySql = storage.sqlite.prepare(`
        SELECT p.id FROM narrative_chapter_passage_fts JOIN narrative_chapter_passage p ON p.id = narrative_chapter_passage_fts.rowid
        WHERE narrative_chapter_passage_fts MATCH ? AND p.book_id = ? AND p.chapter_number BETWEEN 1 AND ?
        ORDER BY bm25(narrative_chapter_passage_fts, 0.0, 1.0) LIMIT 20`);
      const legacyPassageSearchMs = await median(3, () => legacySql.all(legacyExpr, LONG_BOOK_ID, chapters));
      const hitCount = searchPassageCandidates(storage, { bookId: LONG_BOOK_ID, phrases: [phrase], mode: "all", toChapter: chapters, limit: 20 }).length;
      // 改前对账写法对照：逐章查存活事件
      const ledgerRows = storage.sqlite.prepare<{ ids: string }>(`SELECT event_ids_json AS ids FROM narrative_chapter_settlement WHERE book_id = ?`).all(LONG_BOOK_ID);
      const legacyLedgerScanMs = await median(1, () => ledgerRows.forEach((row) => countSurvivingLedgerEvents(storage, LONG_BOOK_ID, JSON.parse(row.ids) as string[])));

      const current = chapters + 1;
      const entities = [SCALE_CHARACTERS[current % SCALE_CHARACTERS.length]!, SCALE_CHARACTERS[3]!];
      let pkgTokens = 0;
      let pkgCards = 0;
      const assemble = () => buildNarrativeContext({
        storage,
        bookId: LONG_BOOK_ID,
        purpose: "write_chapter",
        chapterNumber: current,
        entities,
        bookRoot,
        sceneText: `${entities[0]}回到旧地，想起信物37的下落。`,
        channelTimeoutMs: 60_000,
      }).then((pkg) => {
        pkgTokens = pkg.diagnostics.totalEstimatedTokens;
        pkgCards = pkg.cards.length;
        return pkg;
      });
      const assembleColdMs = await median(1, assemble);
      const assembleMs = await median(3, assemble);
      const channelMs = await assemble().then((pkg) => Object.fromEntries(pkg.diagnostics.channelStats.map((stat) => [stat.channel, Math.round(stat.latencyMs)])));

      const entityRebuildMs = await median(1, () => rebuildNarrativeEntityIndex(storage, LONG_BOOK_ID));
      const reconcileMs = await median(3, () => reconcileSettlementLedger(storage, { bookId: LONG_BOOK_ID, bookRoot, dryRun: true }));
      const storyArcMs = await median(3, () => buildStoryArcCards({ storage, bookId: LONG_BOOK_ID, currentChapter: current }));
      const storyTimelineMs = await median(3, () => readStoryTimeline(storage, LONG_BOOK_ID, chapters));

      const row = {
        chapters,
        totalChars: seed.totalChars,
        facts: seed.facts,
        events: seed.events,
        hooks: seed.hooks,
        seedMs: seed.seedMs,
        passageIndexBuildMs,
        passageFreshCheckMs,
        passageSearchMs,
        passageHits: hitCount,
        legacyPassageSearchMs,
        legacyLedgerScanMs,
        passageCommonSearchMs,
        assembleColdMs,
        assembleMs,
        assembleTokens: pkgTokens,
        assembleCards: pkgCards,
        channelMs,
        entityRebuildMs,
        reconcileMs,
        storyArcMs,
        storyTimelineMs,
      };
      results.push(row);
      console.log(`[million-bench] ${JSON.stringify(row)}`);
      expect(pkgCards).toBeGreaterThan(0);
    }, 1_800_000);
  }
});
