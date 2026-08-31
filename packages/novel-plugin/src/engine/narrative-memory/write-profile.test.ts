import { describe, expect, it } from "vitest";

import { emptyChapterStateProjection, type ChapterStateProjection } from "@vivy1024/novelfork-core";

import type { NarrativeContextCard } from "./types.js";
import { applyWriteProfileCountCaps, buildWriteProfile } from "./write-profile.js";

function projection(overrides: Partial<ChapterStateProjection> = {}): ChapterStateProjection {
  return emptyChapterStateProjection({
    lastChapter: 20,
    characters: Array.from({ length: 8 }, (_, index) => ({
      characterId: `c${index + 1}`,
      name: `角色${index + 1}`,
      currentState: `状态${index + 1}`,
      knowledge: [],
      firstChapter: index + 1,
      lastChapter: 20 - index,
      beats: [{ chapter: 20 - index, state: `状态${index + 1}` }],
    })),
    hooks: Array.from({ length: 10 }, (_, index) => ({
      hookId: `h${index + 1}`,
      type: "mystery",
      status: "open" as const,
      expectedPayoff: `伏笔${index + 1}`,
      notes: "",
      startChapter: index + 1,
      lastAdvancedChapter: 12 - index,
    })),
    summaries: Array.from({ length: 5 }, (_, index) => ({
      chapter: 16 - index,
      title: `第${16 - index}章`,
      characters: "",
      events: `摘要${16 - index}`,
      stateChanges: "",
      hookActivity: "",
      mood: "",
      chapterType: "",
    })),
    commitments: [{
      id: "next",
      text: "下章确认墨大夫是否察觉",
      targetChapter: 21,
      scope: "chapter",
      fulfilled: false,
      sourceChapter: 20,
    }],
    timeline: [{
      chapter: 20,
      storyTime: "入门第三日黄昏",
      label: "药园",
      durationFromPrev: "半日",
    }],
    ...overrides,
  });
}

function card(input: Partial<NarrativeContextCard> & Pick<NarrativeContextCard, "id" | "channel" | "title">): NarrativeContextCard {
  return {
    id: input.id,
    bookId: "book-1",
    sourceType: input.sourceType ?? "fact",
    sourceId: input.sourceId ?? input.id,
    channel: input.channel,
    title: input.title,
    content: input.content ?? input.title,
    brief: input.brief ?? input.title,
    tags: input.tags ?? [],
    entities: input.entities ?? [],
    priority: input.priority ?? 50,
    importance: input.importance ?? 50,
    accessCount: 0,
    reason: input.reason ?? "test",
    estimatedTokens: input.estimatedTokens ?? 20,
    validFromChapter: input.validFromChapter,
  };
}

describe("buildWriteProfile", () => {
  it("caps core characters, hooks and recent summaries at 6/8/3 unless named", () => {
    const profile = buildWriteProfile({
      projection: projection(),
      namedEntities: ["角色8"],
      currentChapter: 21,
    });

    expect(profile.coreCharacters.cap).toBe(6);
    expect(profile.activeHooks.cap).toBe(8);
    expect(profile.recentSummaries.cap).toBe(3);
    expect(profile.coreCharacters.items).toHaveLength(6);
    expect(profile.coreCharacters.items.map((item) => item.title)).toContain("角色8");
    expect(profile.activeHooks.items).toHaveLength(8);
    expect(profile.recentSummaries.items).toHaveLength(3);
    expect(profile.locationAndTime.items[0]?.summary).toContain("入门第三日黄昏");
    expect(profile.nextCommitments.items[0]?.title).toContain("墨大夫");
    expect(profile.trimReasons.some((item) => item.kind === "count-cap")).toBe(true);
    expect(profile.trimReasons.some((item) => item.kind === "named-keep")).toBe(true);
  });
});

describe("applyWriteProfileCountCaps", () => {
  it("keeps named entity cards even when the count cap is exceeded", () => {
    const profile = buildWriteProfile({
      projection: projection(),
      namedEntities: ["角色8", "伏笔10"],
      currentChapter: 21,
    });
    const cards = [
      ...Array.from({ length: 8 }, (_, index) => card({
        id: `state-${index + 1}`,
        channel: "state",
        title: `角色${index + 1}`,
        entities: [`角色${index + 1}`],
      })),
      ...Array.from({ length: 10 }, (_, index) => card({
        id: `hook-${index + 1}`,
        channel: "hooks",
        title: `伏笔${index + 1}`,
        entities: [`伏笔${index + 1}`],
      })),
    ];

    const result = applyWriteProfileCountCaps(cards, profile);
    expect(result.cards.some((item) => item.title === "角色8")).toBe(true);
    expect(result.cards.some((item) => item.title === "伏笔10")).toBe(true);
    expect(result.cards.filter((item) => item.channel === "state").length).toBeGreaterThanOrEqual(6);
    expect(result.trimReasons.some((item) => item.kind === "count-cap")).toBe(true);
  });
});
