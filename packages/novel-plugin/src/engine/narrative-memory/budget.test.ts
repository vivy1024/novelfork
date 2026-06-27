import { describe, expect, it } from "vitest";

import { packNarrativeContext } from "./budget.js";
import type { NarrativeContextCard } from "./types.js";

function card(input: Partial<NarrativeContextCard> & Pick<NarrativeContextCard, "id" | "channel" | "title" | "content">): NarrativeContextCard {
  return {
    id: input.id,
    bookId: input.bookId ?? "book-1",
    sourceType: input.sourceType ?? "jingwei",
    sourceId: input.sourceId ?? input.id,
    channel: input.channel,
    title: input.title,
    content: input.content,
    normal: input.normal,
    summary: input.summary,
    brief: input.brief ?? input.title,
    tags: input.tags ?? [],
    entities: input.entities ?? [],
    priority: input.priority ?? 50,
    importance: input.importance ?? 50,
    accessCount: input.accessCount ?? 0,
    lastAccessedAt: input.lastAccessedAt,
    validFromChapter: input.validFromChapter,
    validUntilChapter: input.validUntilChapter,
    reason: input.reason ?? "test reason",
    estimatedTokens: input.estimatedTokens ?? 100,
    score: input.score,
    scoreBreakdown: input.scoreBreakdown,
  };
}

describe("packNarrativeContext", () => {
  it("keeps hard cards by degrading instead of dropping them", () => {
    const result = packNarrativeContext([
      card({ id: "hard-1", channel: "hard", title: "硬约束", content: "硬约束 full", normal: "硬约束 normal", summary: "硬约束 summary", brief: "硬约束 brief", estimatedTokens: 500, priority: 10 }),
    ], {
      maxTokens: 20,
      channelBudgets: { hard: 1 },
    });

    expect(result.cards.map((item) => item.card.id)).toEqual(["hard-1"]);
    expect(result.droppedCards).toHaveLength(0);
    expect(result.degradedCards).toContainEqual({ id: "hard-1", from: "full", to: "brief" });
    expect(result.cards[0]?.detailLevel).toBe("brief");
  });

  it("degrades then drops non-hard cards when their channel budget is exhausted", () => {
    const result = packNarrativeContext([
      card({ id: "state-keep", channel: "state", title: "高优先", content: "state full", summary: "state summary", brief: "s", estimatedTokens: 200, priority: 90, score: 90 }),
      card({ id: "state-drop", channel: "state", title: "低优先", content: "drop full", summary: "drop summary", brief: "d", estimatedTokens: 200, priority: 10, score: 10 }),
    ], {
      maxTokens: 1,
      channelBudgets: { state: 1 },
    });

    expect(result.cards.map((item) => item.card.id)).toEqual(["state-keep"]);
    expect(result.cards[0]?.detailLevel).toBe("brief");
    expect(result.droppedCards.map((item) => item.id)).toEqual(["state-drop"]);
    expect(result.degradedCards.some((item) => item.id === "state-keep")).toBe(true);
  });

  it("scales default channel budgets down to the caller maxTokens", () => {
    const result = packNarrativeContext([
      card({ id: "hard", channel: "hard", title: "硬约束", content: "hard", brief: "h", estimatedTokens: 100, priority: 100 }),
      card({ id: "state", channel: "state", title: "状态", content: "state", brief: "s", estimatedTokens: 100, priority: 90 }),
      card({ id: "style", channel: "style", title: "风格", content: "style", brief: "st", estimatedTokens: 100, priority: 10 }),
    ], { maxTokens: 60 });

    const allocatedTotal = Object.values(result.channelBudgets).reduce((sum, value) => sum + value, 0);
    expect(allocatedTotal).toBeLessThanOrEqual(60);
    expect(result.channelBudgets.hard).toBeGreaterThan(result.channelBudgets.style ?? 0);
  });

  it("reports packed/degraded/dropped cards and injected tokens by channel", () => {
    const result = packNarrativeContext([
      card({ id: "fact", channel: "facts", title: "事实", content: "fact full", summary: "fact summary", brief: "f", estimatedTokens: 100, priority: 80 }),
      card({ id: "style", channel: "style", title: "风格", content: "style full", summary: "style summary", brief: "s", estimatedTokens: 100, priority: 20 }),
    ], {
      maxTokens: 12,
      channelBudgets: { facts: 8, style: 4 },
    });

    expect(result.totalEstimatedTokens).toBeGreaterThan(0);
    expect(result.injectedTokensByChannel.facts).toBeGreaterThan(0);
    expect(result.degradedCards.length + result.droppedCards.length).toBeGreaterThan(0);
  });
});
