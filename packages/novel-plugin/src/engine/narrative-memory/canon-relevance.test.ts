/**
 * 短板 3：实体型 canon 不再全量进 hard。
 * 200 条角色 canon，本章出场 3 人：hard 只有全书硬规则，state 只有这 3 人的 canon，召回包不超预算。
 */

import { afterEach, describe, expect, it } from "vitest";

import type { SceneSpec } from "../../handlers/scene-spec-handler.js";
import { createStoryJingweiEntryRepository } from "../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../jingwei/repositories/section-repo.js";
import { buildNarrativeContext } from "./build-narrative-context.js";
import { createHardChannel } from "./channels/hard-channel.js";
import { createStateChannel } from "./channels/state-channel.js";
import { createLongBookStorage, LONG_BOOK_ID, type LongBookHandle } from "./long-book-fixture.js";

const handles: LongBookHandle[] = [];
const now = new Date("2026-06-22T00:00:00.000Z");

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()));
});

async function section(handle: LongBookHandle, id: string, key: string, name: string): Promise<void> {
  await createStoryJingweiSectionRepository(handle.storage).create({
    id, bookId: LONG_BOOK_ID, key, name, description: "", icon: null, order: 0, enabled: true, showInSidebar: true,
    participatesInAi: true, defaultVisibility: "global", fieldsJson: [], builtinKind: key, sourceTemplate: null, createdAt: now, updatedAt: now,
  });
}

async function canonEntry(handle: LongBookHandle, input: { id: string; sectionId: string; category: string; title: string; content: string; aliases?: string[]; relatedChapterNumbers?: number[] }): Promise<void> {
  await createStoryJingweiEntryRepository(handle.storage).create({
    id: input.id,
    bookId: LONG_BOOK_ID,
    sectionId: input.sectionId,
    title: input.title,
    contentMd: input.content,
    summaryMd: input.content.slice(0, 20),
    tags: [],
    aliases: input.aliases ?? [],
    customFields: {},
    relatedChapterNumbers: input.relatedChapterNumbers ?? [],
    relatedEntryIds: [],
    visibilityRule: { type: "global" },
    participatesInAi: true,
    tokenBudget: null,
    priorityTier: "core",
    layer: "canon",
    importance: 80,
    summaryL0: input.content.slice(0, 20),
    createdAt: now,
    updatedAt: now,
    category: input.category,
  });
}

/** 200 条角色 canon（角色001…角色200），外加 2 条世界规则、1 条写作规则、1 条地点 canon。 */
async function seedCanon(handle: LongBookHandle): Promise<void> {
  await section(handle, "sec-characters", "characters", "角色");
  await section(handle, "sec-world", "world-model", "世界模型");
  await section(handle, "sec-rules", "rules", "写作规则");
  await section(handle, "sec-locations", "locations", "地点");
  for (let index = 1; index <= 200; index += 1) {
    const name = `角色${String(index).padStart(3, "0")}`;
    await canonEntry(handle, {
      id: `char-${index}`,
      sectionId: "sec-characters",
      category: "characters",
      title: name,
      content: `${name}的人设：出身、性格、功法与口头禅，约百字的设定细节，用于测试长篇里设定条目的体量。`.repeat(2),
      ...(index === 7 ? { aliases: ["七少"] } : {}),
    });
  }
  await canonEntry(handle, { id: "world-1", sectionId: "sec-world", category: "world-model", title: "灵气规则", content: "灵气只在夜间流动。" });
  await canonEntry(handle, { id: "world-2", sectionId: "sec-world", category: "world-model", title: "境界划分", content: "炼气、筑基、结丹、元婴。" });
  await canonEntry(handle, { id: "rule-1", sectionId: "sec-rules", category: "rules", title: "写作禁忌", content: "不写现代网络用语。" });
  await canonEntry(handle, { id: "loc-1", sectionId: "sec-locations", category: "locations", title: "青石镇", content: "青石镇在山脚，镇口有老槐树。" });
}

const sceneSpec: SceneSpec = {
  chapter: 50,
  title: "镇口相遇",
  wordTarget: 3000,
  scenes: [{ characters: ["角色001", "角色002"], location: "青石镇", conflict: "旧怨", mood: "紧张", outcome: "暂时和解", hooks_used: [], hooks_planted: [] }],
  constraints: [],
};

describe("hard channel · 全书硬规则与实体型 canon 拆分", () => {
  it("hard 只收世界/规则类 canon；角色、地点类 canon 不进 hard，被筛掉的数量写进 diagnostics", async () => {
    const handle = await createLongBookStorage("novelfork-canon-hard");
    handles.push(handle);
    await seedCanon(handle);
    const result = await createHardChannel().run({ storage: handle.storage, bookId: LONG_BOOK_ID, sceneSpec });
    const titles = result.cards.map((card) => card.title);
    expect(titles).toEqual(expect.arrayContaining(["灵气规则", "境界划分", "写作禁忌"]));
    expect(titles.some((title) => title.startsWith("角色"))).toBe(false);
    expect(titles).not.toContain("青石镇");
    expect(result.diagnostics).toMatchObject({ entityCanonDeferred: 201 });
  });

  it("state 只注入本章出场（sceneSpec / 正文 / 别名命中）的实体 canon", async () => {
    const handle = await createLongBookStorage("novelfork-canon-state");
    handles.push(handle);
    await seedCanon(handle);
    const result = await createStateChannel().run({
      storage: handle.storage,
      bookId: LONG_BOOK_ID,
      currentChapter: 50,
      sceneSpec,
      sceneText: "七少从镇外赶来。",
      entities: ["角色001", "角色002", "青石镇"],
    });
    const canonTitles = result.cards.filter((card) => card.tags.includes("entity-canon")).map((card) => card.title).sort();
    expect(canonTitles).toEqual(["青石镇", "角色001", "角色002", "角色007"].sort());
  });

  it("修旧章：只关联到后面章节的实体 canon（后来才登场的角色）不注入，即使本章点名", async () => {
    const handle = await createLongBookStorage("novelfork-canon-revise");
    handles.push(handle);
    await section(handle, "sec-characters", "characters", "角色");
    await canonEntry(handle, { id: "char-early", sectionId: "sec-characters", category: "characters", title: "林舟", content: "林舟的人设。", relatedChapterNumbers: [3] });
    await canonEntry(handle, { id: "char-late", sectionId: "sec-characters", category: "characters", title: "南宫婉", content: "南宫婉第 80 章才登场的人设。", relatedChapterNumbers: [80] });
    const result = await createStateChannel().run({
      storage: handle.storage,
      bookId: LONG_BOOK_ID,
      currentChapter: 20,
      sceneText: "林舟与南宫婉在山门相遇。",
      entities: ["林舟", "南宫婉"],
    });
    const canonTitles = result.cards.filter((card) => card.tags.includes("entity-canon")).map((card) => card.title);
    expect(canonTitles).toEqual(["林舟"]);
  });

  it("buildNarrativeContext：200 条角色 canon 下本章 3 人出场，hard 只有硬规则，不触发超预算拒写", async () => {
    const handle = await createLongBookStorage("novelfork-canon-build");
    handles.push(handle);
    await seedCanon(handle);
    const pkg = await buildNarrativeContext({
      storage: handle.storage,
      bookId: LONG_BOOK_ID,
      purpose: "write_chapter",
      chapterNumber: 50,
      sceneSpec,
      sceneText: "七少从镇外赶来。",
      entities: [],
      maxTokens: 24000,
    });
    console.info(`[canon] totalEstimatedTokens=${pkg.diagnostics.totalEstimatedTokens} hard=${pkg.diagnostics.injectedTokensByChannel.hard ?? 0} hardCards=${pkg.cards.filter((card) => card.channel === "hard").length} overflow=${pkg.diagnostics.warnings.find((warning) => warning.startsWith("hard channel exceeds budget")) ?? "none"}`);
    const hardTitles = pkg.cards.filter((card) => card.channel === "hard").map((card) => card.title);
    expect(hardTitles.some((title) => title.startsWith("角色"))).toBe(false);
    const canonTitles = pkg.cards.filter((card) => card.tags.includes("entity-canon")).map((card) => card.title).sort();
    expect(canonTitles).toEqual(["青石镇", "角色001", "角色002", "角色007"].sort());
    expect(pkg.diagnostics.warnings.some((warning) => warning.startsWith("hard channel exceeds budget"))).toBe(false);
    expect(pkg.diagnostics.totalEstimatedTokens).toBeLessThanOrEqual(24000);
    const hardStat = pkg.diagnostics.channelStats.find((stat) => stat.channel === "hard");
    expect(hardStat?.metadata).toMatchObject({ entityCanonDeferred: 201 });
  });
});
