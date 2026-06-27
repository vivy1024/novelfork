import { describe, expect, it } from "vitest";

import { mergeNarrativeContextCards } from "./merge.js";
import { scoreNarrativeContextCard } from "./scoring.js";
import type { NarrativeContextCard } from "./types.js";

function card(input: Partial<NarrativeContextCard> & Pick<NarrativeContextCard, "id" | "sourceType" | "sourceId" | "channel" | "title" | "content">): NarrativeContextCard {
  return {
    id: input.id,
    bookId: input.bookId ?? "book-1",
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    channel: input.channel,
    title: input.title,
    content: input.content,
    normal: input.normal,
    summary: input.summary,
    brief: input.brief ?? input.summary ?? input.content,
    tags: input.tags ?? [],
    entities: input.entities ?? [],
    priority: input.priority ?? 50,
    importance: input.importance ?? 50,
    accessCount: input.accessCount ?? 0,
    lastAccessedAt: input.lastAccessedAt,
    validFromChapter: input.validFromChapter,
    validUntilChapter: input.validUntilChapter,
    reason: input.reason ?? "test reason",
    estimatedTokens: input.estimatedTokens ?? 20,
    score: input.score,
    scoreBreakdown: input.scoreBreakdown,
  };
}

describe("Narrative merge/scoring", () => {
  it("dedupes cards by same sourceType + sourceId and keeps higher scored version", () => {
    const merged = mergeNarrativeContextCards([
      card({ id: "low", sourceType: "jingwei", sourceId: "entry-1", channel: "state", title: "韩立", content: "低优先", priority: 20 }),
      card({ id: "high", sourceType: "jingwei", sourceId: "entry-1", channel: "state", title: "韩立", content: "高优先", priority: 90 }),
    ], { currentChapter: 12, queryEntities: ["韩立"] });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("high");
    expect(merged[0]?.scoreBreakdown).toHaveProperty("channelBoost");
  });

  it("dedupes duplicate fact tuples across different fact ids", () => {
    const merged = mergeNarrativeContextCards([
      card({ id: "fact-a", sourceType: "fact", sourceId: "a", channel: "facts", title: "韩立 持有 小瓶", content: "韩立 持有 小瓶", entities: ["韩立", "小瓶"], score: 0.8 }),
      card({ id: "fact-b", sourceType: "fact", sourceId: "b", channel: "facts", title: "韩立 持有 小瓶", content: "韩立 持有 小瓶", entities: ["韩立", "小瓶"], score: 0.9 }),
    ], { currentChapter: 12, queryEntities: ["韩立"] });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.sourceId).toBe("b");
  });

  it("keeps hard channel when a hard card duplicates a non-hard card", () => {
    const merged = mergeNarrativeContextCards([
      card({ id: "state-rule", sourceType: "jingwei", sourceId: "rule-1", channel: "state", title: "规则", content: "普通状态", priority: 80 }),
      card({ id: "hard-rule", sourceType: "jingwei", sourceId: "rule-1", channel: "hard", title: "规则", content: "硬规则", priority: 70 }),
    ], { currentChapter: 12 });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("hard-rule");
    expect(merged[0]?.channel).toBe("hard");
  });

  it("dedupes jingwei cards by title and merges recall reasons", () => {
    const merged = mergeNarrativeContextCards([
      card({ id: "entry-a", sourceType: "jingwei", sourceId: "entry-a", channel: "state", title: "韩立", content: "角色状态", reason: "角色命中", priority: 70 }),
      card({ id: "entry-b", sourceType: "jingwei", sourceId: "entry-b", channel: "state", title: "韩立", content: "别名命中", reason: "别名命中", priority: 60 }),
    ], { currentChapter: 12, queryEntities: ["韩立"] });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("entry-a");
    expect(merged[0]?.reason).toContain("角色命中");
    expect(merged[0]?.reason).toContain("别名命中");
  });

  it("does not dedupe fact cards with same tuple but different validFromChapter", () => {
    const merged = mergeNarrativeContextCards([
      card({ id: "fact-old", sourceType: "fact", sourceId: "old", channel: "facts", title: "韩立 持有 小瓶", content: "旧状态", validFromChapter: 1 }),
      card({ id: "fact-new", sourceType: "fact", sourceId: "new", channel: "facts", title: "韩立 持有 小瓶", content: "新状态", validFromChapter: 8 }),
    ], { currentChapter: 12, queryEntities: ["韩立"] });

    expect(merged).toHaveLength(2);
  });

  it("scores with required MVP breakdown fields", () => {
    const scored = scoreNarrativeContextCard(card({
      id: "hook",
      sourceType: "hook",
      sourceId: "hook-1",
      channel: "hooks",
      title: "小瓶伏笔",
      content: "韩立的小瓶伏笔长期未回收。",
      entities: ["韩立", "小瓶"],
      priority: 80,
      importance: 70,
      estimatedTokens: 40,
      validFromChapter: 3,
      lastAccessedAt: "2026-06-21T00:00:00.000Z",
      scoreBreakdown: { ftsBoost: 3, factConfidenceBoost: 0.5 },
    }), { currentChapter: 12, queryEntities: ["韩立"], now: new Date("2026-06-22T00:00:00.000Z") });

    expect(scored.score).toBeGreaterThan(0);
    expect(scored.scoreBreakdown).toEqual(expect.objectContaining({
      channelBoost: expect.any(Number),
      entityMatchBoost: expect.any(Number),
      layerBoost: expect.any(Number),
      chapterProximityBoost: expect.any(Number),
      importanceBoost: expect.any(Number),
      ftsBoost: expect.any(Number),
      factConfidenceBoost: expect.any(Number),
      recencyBoost: expect.any(Number),
      tokenCostPenalty: expect.any(Number),
    }));
  });
});
