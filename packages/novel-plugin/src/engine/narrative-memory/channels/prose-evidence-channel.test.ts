/**
 * 原文证据通道：写第 300 章时，能从第 47 章正文里捞回摘要与经纬都没记下的旧物；
 * 预算、开关、近章窗口、事实去重与「太常见的词不算证据」各一例。
 */

import { afterEach, describe, expect, it } from "vitest";

import { resolveNarrativeChannelBudgets } from "../budget.js";
import { buildNarrativeContext } from "../build-narrative-context.js";
import { upsertNarrativeFact } from "../facts.js";
import { createLongBookStorage, LONG_BOOK_ID, seedLongBook, seedLongBookChapterFiles, type LongBookHandle } from "../long-book-fixture.js";
import { createProseEvidenceChannel } from "./prose-evidence-channel.js";

const handles: LongBookHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()));
});

const CHAPTER_47 = [
  "主角在第47章路过一处废弃的驿站，檐下挂着褪色的旗。",
  "他在驿站的墙洞里摸到一只青铜罗盘，盘面刻着七颗星，指针始终指向西北。主角把青铜罗盘用油布包好，塞进行囊最底层，没有告诉任何人。",
  "天黑前他离开驿站，回头望去，旗子已经被风扯成两半。",
].join("\n\n");

async function longBookWithProse(overrides: Record<number, string> = { 47: CHAPTER_47 }): Promise<LongBookHandle> {
  const handle = await createLongBookStorage("novelfork-prose-evidence");
  handles.push(handle);
  await seedLongBook(handle.storage);
  await seedLongBookChapterFiles(handle.bookRoot, 299, overrides);
  return handle;
}

const sceneSpec = {
  chapter: 300,
  title: "罗盘指路",
  wordTarget: 3000,
  scenes: [{
    characters: ["主角"],
    location: "西北荒原",
    conflict: "迷路时主角取出青铜罗盘辨认方向",
    mood: "紧张",
    outcome: "找到出口",
    hooks_used: [],
    hooks_planted: [],
  }],
  constraints: [],
};

describe("原文证据通道", () => {
  it("写第 300 章：从第 47 章正文里找回青铜罗盘，标为原文证据并带 chapter.read 偏移", async () => {
    const { storage, bookRoot } = await longBookWithProse();
    const result = await createProseEvidenceChannel().run({
      storage, bookId: LONG_BOOK_ID, bookRoot, currentChapter: 300, sceneSpec, entities: ["主角", "青铜罗盘"],
    });
    expect(result.cards.length).toBeGreaterThan(0);
    const card = result.cards[0]!;
    expect(card.channel).toBe("prose-evidence");
    expect(card.title).toBe("原文证据·第47章");
    expect(card.validFromChapter).toBe(47);
    expect(card.content).toContain("【青铜罗盘】");
    expect(card.content).toMatch(/chapter\.read offset=\d+ limit=\d+/u);
    // 主角名几乎每章都有，不能单独构成证据
    expect(result.cards.every((item) => item.entities.some((entity) => entity !== "主角"))).toBe(true);
    // 预算：最多 3 段、合计不超过 1200 字
    expect(result.cards.length).toBeLessThanOrEqual(3);
    expect(result.cards.reduce((sum, item) => sum + Array.from(item.content).length, 0)).toBeLessThanOrEqual(1200);
  });

  it("没有点名实体时，靠蓝图文本里的长片段也能命中", async () => {
    const { storage, bookRoot } = await longBookWithProse();
    const result = await createProseEvidenceChannel().run({
      storage, bookId: LONG_BOOK_ID, bookRoot, currentChapter: 300, sceneText: "迷路时主角取出青铜罗盘辨认方向", entities: [],
    });
    expect(result.cards.map((card) => card.validFromChapter)).toEqual([47]);
  });

  it("近章窗口内的章不取：写第 50 章时第 47 章由近章摘要覆盖", async () => {
    const { storage, bookRoot } = await longBookWithProse();
    const result = await createProseEvidenceChannel().run({
      storage, bookId: LONG_BOOK_ID, bookRoot, currentChapter: 50, sceneSpec, entities: ["青铜罗盘"],
    });
    expect(result.cards).toEqual([]);
  });

  it("同章事实已带这段证据原文时不重复注入", async () => {
    const { storage, bookRoot } = await longBookWithProse();
    upsertNarrativeFact(storage, {
      id: "f-compass", bookId: LONG_BOOK_ID, subject: "主角", predicate: "得到", object: "青铜罗盘", category: "item", layer: "dynamic",
      confidence: 0.9, sourceType: "event", sourceChapter: 47, validFromChapter: 47,
      evidenceText: "他在驿站的墙洞里摸到一只青铜罗盘",
      createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z",
    });
    const result = await createProseEvidenceChannel().run({
      storage, bookId: LONG_BOOK_ID, bookRoot, currentChapter: 300, sceneSpec, entities: ["青铜罗盘"],
    });
    expect(result.cards).toEqual([]);
    expect(result.diagnostics?.dedupedByFacts).toBeGreaterThan(0);
  });

  it("多处命中时每章最多一段、总共不超过配置的段数与字数", async () => {
    const overrides: Record<number, string> = {};
    for (const chapter of [10, 20, 30, 40, 47]) {
      overrides[chapter] = `第${chapter}章里，那只青铜罗盘又出现了。${"他盯着青铜罗盘看了很久，指针一动不动。".repeat(12)}`;
    }
    const { storage, bookRoot } = await longBookWithProse(overrides);
    const result = await createProseEvidenceChannel().run({
      storage, bookId: LONG_BOOK_ID, bookRoot, currentChapter: 300, entities: ["青铜罗盘"], maxPassages: 2, maxChars: 300,
    });
    expect(result.cards).toHaveLength(2);
    expect(new Set(result.cards.map((card) => card.validFromChapter)).size).toBe(2);
    expect(result.cards.reduce((sum, item) => sum + Array.from(item.content).length, 0)).toBeLessThanOrEqual(300);
  });

  it("接进召回包：默认开启，进 prose-evidence 分段；关掉开关后不出现；预算紧时不挤 hard", async () => {
    const { storage, bookRoot } = await longBookWithProse();
    const pkg = await buildNarrativeContext({
      storage, bookId: LONG_BOOK_ID, purpose: "write_chapter", chapterNumber: 300, sceneSpec, entities: ["青铜罗盘"], bookRoot,
      bookRulesText: "主角不得无故杀人。",
    });
    const evidence = pkg.cards.filter((card) => card.channel === "prose-evidence");
    expect(evidence.map((card) => card.validFromChapter)).toEqual([47]);
    expect(pkg.sections["prose-evidence"]).toContain("青铜罗盘");
    expect(pkg.sections["prose-evidence"]).toContain("<chapter_text_evidence>");
    const budget = resolveNarrativeChannelBudgets({ maxTokens: 24000 })["prose-evidence"];
    expect(budget).toBeGreaterThanOrEqual(1150);
    expect(budget).toBeLessThanOrEqual(1250);
    expect(pkg.diagnostics.injectedTokensByChannel["prose-evidence"] ?? 0).toBeGreaterThan(0);
    expect(pkg.diagnostics.injectedTokensByChannel["prose-evidence"] ?? 0).toBeLessThanOrEqual(budget);

    const off = await buildNarrativeContext({
      storage, bookId: LONG_BOOK_ID, purpose: "write_chapter", chapterNumber: 300, sceneSpec, entities: ["青铜罗盘"], bookRoot,
      enabledChannels: { "prose-evidence": false },
    });
    expect(off.cards.some((card) => card.channel === "prose-evidence")).toBe(false);

    const tight = await buildNarrativeContext({
      storage, bookId: LONG_BOOK_ID, purpose: "write_chapter", chapterNumber: 300, sceneSpec, entities: ["青铜罗盘"], bookRoot,
      bookRulesText: "主角不得无故杀人。", maxTokens: 1200,
    });
    expect(tight.cards.some((card) => card.channel === "hard")).toBe(true);
    expect(tight.diagnostics.totalEstimatedTokens).toBeLessThanOrEqual(1200);
  });

  it("没给书籍目录时跳过，不报错", async () => {
    const { storage } = await longBookWithProse();
    const pkg = await buildNarrativeContext({ storage, bookId: LONG_BOOK_ID, purpose: "write_chapter", chapterNumber: 300, entities: ["青铜罗盘"] });
    expect(pkg.cards.some((card) => card.channel === "prose-evidence")).toBe(false);
  });
});
