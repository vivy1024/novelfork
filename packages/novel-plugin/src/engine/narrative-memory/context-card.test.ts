import { describe, expect, it } from "vitest";

import type { HookRecord, RuntimeStateSnapshot } from "@vivy1024/novelfork-core";

import type { SceneSpec } from "../../handlers/scene-spec-handler.js";
import type { JingweiReadableItem, StoryJingweiEntryRecord } from "../jingwei/types.js";
import {
  chapterSummaryToContextCard,
  hookToContextCard,
  jingweiEntryToContextCard,
  jingweiReadableItemToContextCard,
  legacyJingweiContextToContextCard,
  runtimeStateToContextCards,
  sceneSpecToContextCards,
  styleTextToContextCard,
} from "./context-card.js";
import { NarrativeContextCardSchema, type NarrativeContextCard } from "./types.js";

function expectCompleteCard(card: NarrativeContextCard) {
  expect(() => NarrativeContextCardSchema.parse(card)).not.toThrow();
  expect(card.reason.trim().length).toBeGreaterThan(0);
  expect(card.brief.trim().length).toBeGreaterThan(0);
  expect(card.estimatedTokens).toBeGreaterThan(0);
  expect(card.validFromChapter === undefined || Number.isInteger(card.validFromChapter)).toBe(true);
  expect(card.validUntilChapter === undefined || Number.isInteger(card.validUntilChapter)).toBe(true);
}

describe("Narrative ContextCard adapters", () => {
  it("converts SceneSpec into stable scene-spec and hard cards", () => {
    const sceneSpec: SceneSpec = {
      chapter: 12,
      title: "小瓶风波",
      wordTarget: 3200,
      scenes: [
        {
          characters: ["韩立", "墨大夫"],
          location: "七玄门药园",
          conflict: "韩立必须隐藏小瓶能力",
          mood: "紧张→克制",
          outcome: "韩立暂时守住秘密",
          hooks_used: ["墨大夫试探"],
          hooks_planted: ["小瓶异动"],
        },
      ],
      constraints: ["不得暴露小瓶真实能力"],
    };

    const cards = sceneSpecToContextCards({ bookId: "book-1", sceneSpec });

    expect(cards.map((card) => card.channel)).toEqual(["hard", "state"]);
    expect(cards[0]?.sourceType).toBe("scene-spec");
    expect(cards[0]?.validFromChapter).toBe(12);
    expect(cards[0]?.validUntilChapter).toBe(12);
    cards.forEach(expectCompleteCard);
  });

  it("converts JingweiReadableItem and StoryJingweiEntryRecord into cards", () => {
    const readable: JingweiReadableItem = {
      id: "item-hanli",
      entryId: "entry-hanli",
      sectionId: "sec-people",
      sectionKey: "people",
      sectionName: "人物",
      category: "characters",
      title: "韩立",
      summaryMd: "谨慎低调。",
      contentMd: "韩立谨慎低调，重视小瓶秘密。",
      source: "tracked",
      priority: 80,
      estimatedTokens: 24,
      updatedAtMs: Date.parse("2026-06-22T00:00:00.000Z"),
      tags: ["主角"],
      aliases: ["韩老魔"],
      visibilityRule: { type: "tracked", keywords: ["小瓶"] },
      priorityTier: "relevant",
      matchReason: "命中小瓶",
    };

    const entry: StoryJingweiEntryRecord = {
      id: "entry-hook",
      bookId: "book-1",
      sectionId: "sec-hooks",
      title: "小瓶秘密",
      contentMd: "小瓶能力不可外泄。",
      summaryMd: "隐藏小瓶。",
      tags: ["小瓶"],
      aliases: [],
      customFields: { category: "foreshadowing" },
      relatedChapterNumbers: [3, 12],
      relatedEntryIds: [],
      visibilityRule: { type: "tracked", keywords: ["小瓶"] },
      participatesInAi: true,
      tokenBudget: null,
      priorityTier: "core",
      layer: "canon",
      importance: 90,
      summaryL0: "小瓶不可外泄。",
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      updatedAt: new Date("2026-06-22T00:00:00.000Z"),
      deletedAt: null,
    };

    const readableCard = jingweiReadableItemToContextCard({ bookId: "book-1", item: readable });
    const entryCard = jingweiEntryToContextCard({ entry, sectionKey: "foreshadowing", sectionName: "伏笔" });

    expect(readableCard.sourceId).toBe("entry-hanli");
    expect(readableCard.entities).toEqual(expect.arrayContaining(["韩立", "韩老魔"]));
    expect(readableCard.reason).toContain("命中小瓶");
    expect(entryCard.channel).toBe("hard");
    expect(entryCard.brief).toBe("小瓶不可外泄。");
    expect(entryCard.validFromChapter).toBe(3);
    expect(entryCard.validUntilChapter).toBe(12);
    expectCompleteCard(readableCard);
    expectCompleteCard(entryCard);
  });

  it("converts RuntimeStateSnapshot, HookRecord and chapter summary into state/timeline/hook cards", () => {
    const snapshot: RuntimeStateSnapshot = {
      manifest: { schemaVersion: 2, language: "zh", lastAppliedChapter: 11, projectionVersion: 1, migrationWarnings: [] },
      currentState: {
        chapter: 11,
        facts: [
          { subject: "韩立", predicate: "持有", object: "小瓶", validFromChapter: 3, validUntilChapter: null, sourceChapter: 3 },
          { subject: "韩立", predicate: "获得", object: "筑基丹", validFromChapter: 12, validUntilChapter: null, sourceChapter: 12 },
        ],
      },
      hooks: {
        hooks: [
          { hookId: "hook-1", startChapter: 3, type: "item_secret", status: "open", lastAdvancedChapter: 9, expectedPayoff: "小瓶秘密曝光", notes: "墨大夫开始怀疑" },
          { hookId: "future-hook", startChapter: 12, type: "future", status: "open", lastAdvancedChapter: 12, expectedPayoff: "未来伏笔", notes: "不应注入" },
        ],
      },
      chapterSummaries: {
        rows: [
          { chapter: 11, title: "药园试探", characters: "韩立、墨大夫", events: "墨大夫试探韩立", stateChanges: "韩立更谨慎", hookActivity: "小瓶伏笔推进", mood: "紧张", chapterType: "主线" },
          { chapter: 12, title: "未来摘要", characters: "韩立", events: "韩立获得筑基丹", stateChanges: "突破", hookActivity: "", mood: "振奋", chapterType: "主线" },
        ],
      },
      resourceLedger: { resources: [] },
      knowledge: { events: [] },
      timeline: { entries: [
        { chapter: 11, storyTime: "春末", label: "墨大夫试探", durationFromPrev: "一日", ordinal: 11 },
        { chapter: 12, storyTime: "未来", label: "筑基丹到手", durationFromPrev: "一日", ordinal: 12 },
      ] },
    };
    const hook: HookRecord = snapshot.hooks.hooks[0]!;

    const runtimeCards = runtimeStateToContextCards({ bookId: "book-1", snapshot, currentChapter: 12 });
    const hookCard = hookToContextCard({ bookId: "book-1", hook, currentChapter: 12 });
    const summaryCard = chapterSummaryToContextCard({
      bookId: "book-1",
      chapterNumber: 11,
      title: "药园试探",
      summary: "墨大夫试探韩立，小瓶秘密继续悬置。",
      characters: ["韩立", "墨大夫"],
      currentChapter: 12,
    });

    expect(runtimeCards.map((card) => card.channel)).toEqual(expect.arrayContaining(["state", "hooks", "timeline"]));
    const runtimeText = runtimeCards.map((card) => `${card.title}\n${card.content}`).join("\n");
    expect(runtimeText).not.toContain("筑基丹");
    expect(runtimeText).not.toContain("future-hook");
    expect(runtimeText).not.toContain("未来摘要");
    expect(hookCard.channel).toBe("hooks");
    expect(hookCard.validFromChapter).toBe(3);
    expect(summaryCard.channel).toBe("timeline");
    expect(summaryCard.validUntilChapter).toBe(11);
    runtimeCards.forEach(expectCompleteCard);
    expectCompleteCard(hookCard);
    expectCompleteCard(summaryCard);
  });

  it("converts style text and legacy jingweiContext into compatibility cards", () => {
    const styleCard = styleTextToContextCard({
      bookId: "book-1",
      id: "preset-default",
      title: "凡人修仙文风",
      text: "克制、细节扎实，避免浮夸比喻。",
      tags: ["preset"],
    });
    const legacyCard = legacyJingweiContextToContextCard({
      bookId: "book-1",
      jingweiContext: "韩立谨慎，当前不能暴露小瓶。",
    });

    expect(styleCard.sourceType).toBe("style");
    expect(styleCard.channel).toBe("style");
    expect(legacyCard.sourceType).toBe("jingwei");
    expect(legacyCard.channel).toBe("state");
    expect(legacyCard.reason).toContain("兼容");
    expectCompleteCard(styleCard);
    expectCompleteCard(legacyCard);
  });
});
