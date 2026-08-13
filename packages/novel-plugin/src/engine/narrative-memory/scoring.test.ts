import { describe, expect, it } from "vitest";

import { scoreNarrativeContextCard } from "./scoring.js";
import type { NarrativeContextCard } from "./types.js";

function card(input: Partial<NarrativeContextCard> & Pick<NarrativeContextCard, "id" | "channel">): NarrativeContextCard {
  return {
    id: input.id,
    bookId: input.bookId ?? "book-1",
    sourceType: input.sourceType ?? "fact",
    sourceId: input.sourceId ?? input.id,
    channel: input.channel,
    title: input.title ?? "标题",
    content: input.content ?? "内容",
    brief: input.brief ?? "简",
    tags: input.tags ?? [],
    entities: input.entities ?? [],
    priority: input.priority ?? 50,
    importance: input.importance ?? 50,
    accessCount: input.accessCount ?? 0,
    validFromChapter: input.validFromChapter,
    validUntilChapter: input.validUntilChapter,
    reason: input.reason ?? "reason",
    estimatedTokens: input.estimatedTokens ?? 100,
    score: input.score,
    scoreBreakdown: input.scoreBreakdown,
  };
}

describe("scoreNarrativeContextCard 新近变动加权", () => {
  it("同通道下新近变动的 fact 得分高于旧 fact", () => {
    const fresh = scoreNarrativeContextCard(card({ id: "fresh", channel: "facts", validFromChapter: 99 }), { currentChapter: 100 });
    const old = scoreNarrativeContextCard(card({ id: "old", channel: "facts", validFromChapter: 8 }), { currentChapter: 100 });
    expect(fresh.scoreBreakdown?.recentChangeBoost).toBeGreaterThan(old.scoreBreakdown?.recentChangeBoost ?? 0);
    expect(fresh.score ?? 0).toBeGreaterThan(old.score ?? 0);
  });

  it("hard 通道不吃新近度加权（canon 不随时间失效）", () => {
    const oldHard = scoreNarrativeContextCard(card({ id: "hard-old", channel: "hard", validFromChapter: 1 }), { currentChapter: 100 });
    const freshHard = scoreNarrativeContextCard(card({ id: "hard-fresh", channel: "hard", validFromChapter: 100 }), { currentChapter: 100 });
    expect(oldHard.scoreBreakdown?.recentChangeBoost).toBe(0);
    expect(freshHard.scoreBreakdown?.recentChangeBoost).toBe(0);
  });

  it("旧内容吃负加权，新内容吃正加权", () => {
    const veryOld = scoreNarrativeContextCard(card({ id: "vo", channel: "state", validFromChapter: 1 }), { currentChapter: 100 });
    const brandNew = scoreNarrativeContextCard(card({ id: "bn", channel: "state", validFromChapter: 100 }), { currentChapter: 100 });
    expect(veryOld.scoreBreakdown?.recentChangeBoost).toBeLessThan(0);
    expect(brandNew.scoreBreakdown?.recentChangeBoost).toBeGreaterThan(0);
  });

  it("边界：缺当前章号时加权为 0（中性）", () => {
    const scored = scoreNarrativeContextCard(card({ id: "x", channel: "facts", validFromChapter: 5 }), {});
    expect(scored.scoreBreakdown?.recentChangeBoost).toBe(0);
  });

  it("边界：缺变动章号时加权为 0（不臆造旧惩罚）", () => {
    const scored = scoreNarrativeContextCard(card({ id: "x", channel: "facts" }), { currentChapter: 100 });
    expect(scored.scoreBreakdown?.recentChangeBoost).toBe(0);
  });

  it("边界：同章（变动章=当前章）吃满额正加权", () => {
    const scored = scoreNarrativeContextCard(card({ id: "x", channel: "facts", validFromChapter: 100 }), { currentChapter: 100 });
    expect(scored.scoreBreakdown?.recentChangeBoost).toBeGreaterThan(0);
  });

  it("边界：未来生效（变动章晚于当前章）不超过满额正加权", () => {
    const future = scoreNarrativeContextCard(card({ id: "f", channel: "facts", validFromChapter: 120 }), { currentChapter: 100 });
    const same = scoreNarrativeContextCard(card({ id: "s", channel: "facts", validFromChapter: 100 }), { currentChapter: 100 });
    expect(future.scoreBreakdown?.recentChangeBoost).toBe(same.scoreBreakdown?.recentChangeBoost);
  });
});
