/**
 * 长篇伏笔召回回归（300 章、200 条未回收伏笔）：
 *   - 本章提到触发词 / 到期的伏笔打败一堆与本章无关的休眠旧伏笔，进得了最终召回包
 *   - 休眠提醒按「多久没被提醒」轮转，记在条目 fields_json.remindedChapters
 *   - 预定回收区间覆盖本章的伏笔带「本章到期伏笔」
 *   - 老条目（没有新字段）照常召回
 */

import { afterEach, describe, expect, it } from "vitest";

import { buildNarrativeContext } from "./build-narrative-context.js";
import { createHooksChannel, DORMANT_HOOK_TAG, DUE_HOOK_TAG } from "./channels/hooks-channel.js";
import { loadDueForeshadows } from "./foreshadow-due.js";
import { parseForeshadowLedgerFields } from "./foreshadow-ledger.js";
import { createLongBookStorage, dormantFillerHooks, LONG_BOOK_ID, seedForeshadowHooks, seedLongBook, type LongBookHandle } from "./long-book-fixture.js";
import type { SceneSpec } from "../../handlers/scene-spec-handler.js";

const handles: LongBookHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()));
});

async function bookWithHooks(withSummaries = false): Promise<LongBookHandle> {
  const handle = await createLongBookStorage("novelfork-long-hooks");
  handles.push(handle);
  if (withSummaries) await seedLongBook(handle.storage);
  await seedForeshadowHooks(handle.storage, [
    ...dormantFillerHooks(197),
    {
      id: "hook-jade",
      title: "玉佩来历",
      plantedChapter: 12,
      contentMd: "老者留下的玉佩背面刻着一个「秦」字。",
      fields: { triggerKeywords: ["青石镇", "秦家"], triggerCondition: "主角回到青石镇", importance: "high" },
    },
    {
      id: "hook-due",
      title: "师父的遗言",
      plantedChapter: 40,
      contentMd: "师父临终只说了半句话。",
      fields: { targetRange: "295-305", payoffConstraint: "必须由大师兄转述后半句" },
    },
    // 老条目：只有 status / plantedChapter，名字出现在本章场景里
    { id: "hook-legacy", title: "断剑", plantedChapter: 30, contentMd: "主角那把断剑的另一半下落不明。" },
  ]);
  return handle;
}

const sceneSpec: SceneSpec = {
  chapter: 300,
  title: "重返青石镇",
  wordTarget: 3000,
  scenes: [{ characters: ["韩立"], location: "青石镇老街", conflict: "旧人认出韩立", mood: "平静→紧张", outcome: "韩立掏出断剑", hooks_used: ["断剑"], hooks_planted: [] }],
  constraints: [],
};

function remindedOf(handle: LongBookHandle, entryId: string): readonly number[] {
  const row = handle.storage.sqlite.prepare<{ fieldsJson: string }>(`SELECT fields_json AS fieldsJson FROM story_jingwei_entry WHERE id = ?`).get(entryId);
  return parseForeshadowLedgerFields(JSON.parse(row?.fieldsJson ?? "{}") as Record<string, unknown>).remindedChapters;
}

describe("长篇伏笔召回 · 相关度压过休眠", () => {
  it("第 300 章、200 条未回收伏笔：触发词命中、到期、场景点名的三条都排在最前，无关旧账只占提醒名额", async () => {
    const handle = await bookWithHooks();
    const result = await createHooksChannel().run({
      storage: handle.storage,
      bookId: LONG_BOOK_ID,
      currentChapter: 300,
      sceneSpec,
      sceneText: "韩立重返青石镇。",
      entities: ["韩立"],
      limit: 24,
    });
    const ids = result.cards.map((card) => card.sourceId);
    const dormant = result.cards.filter((card) => card.tags.includes(DORMANT_HOOK_TAG));
    // 提醒卡封顶 3 条（默认），其余名额按相关度
    expect(dormant).toHaveLength(3);
    const ranked = result.cards.filter((card) => !card.tags.includes(DORMANT_HOOK_TAG)).map((card) => card.sourceId);
    expect(ranked.slice(0, 3).sort()).toEqual(["hook-due", "hook-jade", "hook-legacy"]);
    // 相关伏笔不会被当成「休眠提醒」占名额，也只出现一次
    for (const id of ["hook-jade", "hook-due", "hook-legacy"]) expect(ids.filter((item) => item === id)).toHaveLength(1);
    const due = result.cards.find((card) => card.sourceId === "hook-due")!;
    expect(due.tags).toContain(DUE_HOOK_TAG);
    expect(due.content).toContain("【本章到期伏笔】");
    expect(due.content).toContain("必须由大师兄转述后半句");
    expect(result.cards.find((card) => card.sourceId === "hook-jade")!.reason).toContain("青石镇");
  });

  it("完整召回（含 300 章摘要、七栏伏笔上限与 token 预算）：三条相关伏笔都进了最终包", async () => {
    const handle = await bookWithHooks(true);
    const pkg = await buildNarrativeContext({
      storage: handle.storage,
      bookId: LONG_BOOK_ID,
      purpose: "write_chapter",
      chapterNumber: 300,
      sceneSpec,
      sceneText: "韩立重返青石镇。",
      entities: ["韩立"],
    });
    const hookIds = pkg.cards.filter((card) => card.channel === "hooks").map((card) => card.sourceId);
    expect(hookIds).toEqual(expect.arrayContaining(["hook-jade", "hook-due", "hook-legacy"]));
    expect(pkg.sections.hooks).toContain("本章到期伏笔");
    expect(pkg.sections.hooks).toContain("玉佩来历");
  });

  it("没有任何相关信号时，到期伏笔仍在，旧账按休眠提醒出现", async () => {
    const handle = await bookWithHooks();
    const result = await createHooksChannel().run({ storage: handle.storage, bookId: LONG_BOOK_ID, currentChapter: 300, entities: [] });
    expect(result.cards[3]?.sourceId).toBe("hook-due");
    expect(result.diagnostics).toMatchObject({ dueHooks: [expect.objectContaining({ entryId: "hook-due", status: "in-range", from: 295, to: 305 })] });
    expect(loadDueForeshadows(handle.storage, LONG_BOOK_ID, 300).map((hook) => hook.entryId)).toEqual(["hook-due"]);
    expect(loadDueForeshadows(handle.storage, LONG_BOOK_ID, 200)).toEqual([]);
  });
});

describe("长篇伏笔召回 · 休眠提醒轮转", () => {
  it("逐章写作：提醒写进 remindedChapters，下一章换别的伏笔；同章重跑不变；诊断召回不推进轮转", async () => {
    const handle = await bookWithHooks();
    const pick = async (chapter: number, purpose: "write_chapter" | "audit" = "write_chapter") => {
      const pkg = await buildNarrativeContext({ storage: handle.storage, bookId: LONG_BOOK_ID, purpose, chapterNumber: chapter, entities: [] });
      return pkg.cards.filter((card) => card.tags.includes(DORMANT_HOOK_TAG)).map((card) => card.sourceId).sort();
    };
    const first = await pick(300);
    expect(first).toHaveLength(3);
    for (const id of first) expect(remindedOf(handle, id)).toEqual([300]);
    // 同章重跑（写前检查 + 保存前各一次）结果不变，也不重复记
    expect(await pick(300)).toEqual(first);
    for (const id of first) expect(remindedOf(handle, id)).toEqual([300]);

    const seen = new Set(first);
    const second = await pick(301);
    expect(second.some((id) => first.includes(id))).toBe(false);
    for (const id of second) seen.add(id);

    // 审计召回看得到提醒，但不记录
    const audit = await pick(302, "audit");
    for (const id of audit) expect(remindedOf(handle, id)).not.toContain(302);

    // 连写 20 章：每章 3 条，60 次提醒落在 60 条不同的伏笔上（池子 197 条，不会重复）
    for (let chapter = 302; chapter < 320; chapter += 1) for (const id of await pick(chapter)) seen.add(id);
    expect(seen.size).toBe(60);
  }, 120_000);
});
