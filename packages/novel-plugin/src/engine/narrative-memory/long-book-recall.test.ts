/**
 * 长篇（300 章 / 6 卷）召回回归：
 *   - 修订旧章不混入「未来」章节摘要（短板 1）
 *   - 写第 280 章时召回包里有前 5 卷卷摘要卡 + 当前卷近章（短板 2）
 *   - 召回包体积可度量（改前/改后对比用）
 */

import { afterEach, describe, expect, it } from "vitest";

import { buildNarrativeContext } from "./build-narrative-context.js";
import { createRecentSummaryChannel } from "./channels/recent-summary-channel.js";
import { upsertNarrativeFact } from "./facts.js";
import { createLongBookStorage, LONG_BOOK_ID, seedLongBook, type LongBookHandle } from "./long-book-fixture.js";
import type { NarrativeContextPackage } from "./types.js";

const handles: LongBookHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()));
});

async function longBook(updatedOrder: "old-first" | "new-first" = "old-first"): Promise<LongBookHandle> {
  const handle = await createLongBookStorage();
  handles.push(handle);
  await seedLongBook(handle.storage, updatedOrder);
  return handle;
}

/** 召回包里所有卡片正文中出现的「第N章」章号。 */
function mentionedChapters(pkg: NarrativeContextPackage): number[] {
  const text = pkg.cards.map((card) => `${card.title}\n${card.content}`).join("\n");
  return [...text.matchAll(/第(\d+)章/gu)].map((match) => Number(match[1]));
}

describe("长篇召回 · 章号上限（短板 1）", () => {
  it("recent-summary：修第 200 章时只取第 199、198、197 章，即使旧章 updated_at 更新", async () => {
    const { storage } = await longBook();
    const result = await createRecentSummaryChannel().run({ storage, bookId: LONG_BOOK_ID, currentChapter: 200, limit: 3 });
    expect(result.cards.map((card) => card.validFromChapter)).toEqual([199, 198, 197]);
  });

  it("recent-summary：写第 300 章时近章不被 updated_at 粗筛挤掉", async () => {
    const { storage } = await longBook();
    const result = await createRecentSummaryChannel().run({ storage, bookId: LONG_BOOK_ID, currentChapter: 300, limit: 5 });
    expect(result.cards.map((card) => card.validFromChapter)).toEqual([299, 298, 297, 296, 295]);
  });

  it("修第 120 章（全书已写到 300 章、近章最后更新）：召回包里不出现第 120 章及之后的任何摘要", async () => {
    const { storage } = await longBook("new-first");
    const pkg = await buildNarrativeContext({ storage, bookId: LONG_BOOK_ID, purpose: "revise", chapterNumber: 120, entities: [] });
    const chapters = mentionedChapters(pkg);
    expect(chapters.length).toBeGreaterThan(0);
    expect(chapters.filter((chapter) => chapter >= 120)).toEqual([]);
    // 当前卷（第 101–150 章）的近章仍在
    expect(chapters).toContain(119);
  });
});

describe("长篇召回 · 修旧章时事实不穿越", () => {
  it("修第 120 章：第 250 章才成立的事实、第 120 章本章结算出的事实都不进召回包（facts/state/剧情线状态卡）", async () => {
    const { storage } = await longBook("new-first");
    const fact = (id: string, object: string, chapter: number) => ({
      id, bookId: LONG_BOOK_ID, subject: "主角", predicate: "境界", object, category: "character_state", layer: "dynamic" as const,
      confidence: 0.9, sourceType: "event" as const, sourceChapter: chapter, validFromChapter: chapter,
      createdAt: "2026-06-22T00:00:00.000Z", updatedAt: `2026-06-22T00:0${chapter > 200 ? 2 : chapter === 120 ? 1 : 0}:00.000Z`,
    });
    upsertNarrativeFact(storage, fact("f-early", "筑基", 100));
    upsertNarrativeFact(storage, fact("f-this", "结丹", 120));
    upsertNarrativeFact(storage, fact("f-late", "元婴", 250));
    const pkg = await buildNarrativeContext({ storage, bookId: LONG_BOOK_ID, purpose: "revise", chapterNumber: 120, entities: ["主角"] });
    const text = [...pkg.cards.map((card) => card.content), ...Object.values(pkg.sections)].join("\n");
    expect(text).toContain("筑基");
    expect(text).not.toContain("元婴");
    expect(text).not.toContain("结丹");
  });
});

describe("长篇召回 · 层级摘要（短板 2）", () => {
  it("写第 280 章：前 5 卷各一张卷摘要卡，当前卷用近章细粒度", async () => {
    const { storage } = await longBook();
    const pkg = await buildNarrativeContext({ storage, bookId: LONG_BOOK_ID, purpose: "write_chapter", chapterNumber: 280, entities: [] });
    const arcCards = pkg.cards.filter((card) => card.tags.includes("volume-summary"));
    expect(arcCards.map((card) => card.title)).toEqual(expect.arrayContaining(["第1卷", "第2卷", "第3卷", "第4卷", "第5卷"].map((title) => expect.stringContaining(title))));
    expect(arcCards).toHaveLength(5);
    // 卷摘要卡不越过当前卷起点
    expect(arcCards.every((card) => (card.validUntilChapter ?? 0) <= 250)).toBe(true);
    const recent = pkg.cards.filter((card) => card.channel === "recent-summary").map((card) => card.validFromChapter);
    expect(recent).toContain(279);
    expect(recent.every((chapter) => (chapter ?? 0) >= 251 && (chapter ?? 0) < 280)).toBe(true);
    expect(mentionedChapters(pkg).filter((chapter) => chapter >= 280)).toEqual([]);
    console.info(`[long-book] write ch280 totalEstimatedTokens=${pkg.diagnostics.totalEstimatedTokens} cards=${pkg.cards.length}`);
  });

  it("修第 120 章：只有第 1、2 卷的卷摘要卡，没有第 3 卷之后的", async () => {
    const { storage } = await longBook("new-first");
    const pkg = await buildNarrativeContext({ storage, bookId: LONG_BOOK_ID, purpose: "revise", chapterNumber: 120, entities: [] });
    const arcTitles = pkg.cards.filter((card) => card.tags.includes("volume-summary")).map((card) => card.title);
    expect(arcTitles).toHaveLength(2);
    expect(arcTitles.join(" ")).not.toMatch(/第[3-6]卷/u);
  });

  it("预算紧时按「近章 > 当前卷 > 前卷 > 全书梗概」降档，不挤掉 hard", async () => {
    const { storage } = await longBook();
    const pkg = await buildNarrativeContext({
      storage,
      bookId: LONG_BOOK_ID,
      purpose: "write_chapter",
      chapterNumber: 280,
      entities: [],
      bookRulesText: "主角不得无故杀人。",
      maxTokens: 1200,
    });
    expect(pkg.cards.some((card) => card.channel === "hard")).toBe(true);
    expect(pkg.diagnostics.warnings.some((warning) => warning.startsWith("hard channel exceeds budget"))).toBe(false);
    // 近章最后一章永远在
    expect(pkg.cards.some((card) => card.channel === "recent-summary" && card.validFromChapter === 279)).toBe(true);
    expect(pkg.diagnostics.totalEstimatedTokens).toBeLessThanOrEqual(1200);
  });
});
