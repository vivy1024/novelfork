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

  it("同配额下新近变动的 fact（高 score）胜出，旧 fact 被丢弃", () => {
    const result = packNarrativeContext([
      card({ id: "fact-new", channel: "facts", title: "新事实", content: "new full", summary: "new summary", brief: "n", estimatedTokens: 200, priority: 50, score: 80 }),
      card({ id: "fact-old", channel: "facts", title: "旧事实", content: "old full", summary: "old summary", brief: "o", estimatedTokens: 200, priority: 50, score: 20 }),
    ], {
      maxTokens: 1,
      channelBudgets: { facts: 1 },
    });

    expect(result.cards.map((item) => item.card.id)).toEqual(["fact-new"]);
    expect(result.droppedCards.map((item) => item.id)).toEqual(["fact-old"]);
  });

  it("hard 卡片不因『旧』被丢弃，只降级（新近度负加权也不伤 canon）", () => {
    const result = packNarrativeContext([
      card({
        id: "hard-old",
        channel: "hard",
        title: "旧硬约束",
        content: "hard full",
        normal: "hard normal",
        summary: "hard summary",
        brief: "h",
        estimatedTokens: 500,
        priority: 10,
        score: 5,
        scoreBreakdown: { recentChangeBoost: -20 },
      }),
    ], {
      maxTokens: 1,
      channelBudgets: { hard: 1 },
    });

    expect(result.cards.map((item) => item.card.id)).toEqual(["hard-old"]);
    expect(result.droppedCards).toHaveLength(0);
  });

  it("因『旧』被丢弃/降级的卡片产出可解释 warning，且不指向 hard", () => {
    const result = packNarrativeContext([
      card({ id: "state-fresh", channel: "state", title: "新状态", content: "fresh full", summary: "fresh summary", brief: "f", estimatedTokens: 200, priority: 50, score: 80, scoreBreakdown: { recentChangeBoost: 20 } }),
      card({ id: "state-aged", channel: "state", title: "旧状态", content: "aged full", summary: "aged summary", brief: "a", estimatedTokens: 200, priority: 50, score: 10, scoreBreakdown: { recentChangeBoost: -18 } }),
    ], {
      maxTokens: 1,
      channelBudgets: { state: 1 },
    });

    expect(result.droppedCards.map((item) => item.id)).toContain("state-aged");
    expect(result.warnings.some((w) => w.includes("state-aged") && w.includes("未变动"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("state-fresh"))).toBe(false);
  });
});

describe("层级前情档位与实体型 canon（长篇）", () => {
  it("层级前情档单独装箱：按 priority 先降档、后丢弃最低档（全书梗概先走），不占 timeline 份额", () => {
    const arc = (id: string, priority: number) => card({
      id, channel: "timeline", title: id, content: "长".repeat(400), summary: "短".repeat(60), brief: "简".repeat(30),
      tags: ["story-arc"], priority, estimatedTokens: 400,
    });
    const tail = card({ id: "tail", channel: "timeline", title: "前章尾部", content: "尾".repeat(100), brief: "尾", priority: 88, estimatedTokens: 100 });
    const result = packNarrativeContext([arc("current", 56), arc("vol-5", 48), arc("synopsis", 12), tail], {
      channelBudgets: { timeline: 100 },
      storyArcBudget: 50,
    });
    expect(result.storyArcBudget).toBe(50);
    // timeline 自己的份额照常装前章尾部
    expect(result.cards.map((item) => item.card.id)).toContain("tail");
    // 全降到 brief 仍超：先丢全书梗概，再丢最远前卷，本卷前情保住
    expect(result.droppedCards.map((item) => item.id).sort()).toEqual(["synopsis", "vol-5"]);
    expect(result.cards.find((item) => item.card.id === "current")?.detailLevel).toBe("brief");
  });

  it("默认预算表里层级前情档从 timeline 拆出，hard 的缩放份额不变", () => {
    const result = packNarrativeContext([], { maxTokens: 24000 });
    // 改前：hard 12000 / 总表 68100 × 24000 → 4229 + 余数 1 = 4230；timeline 9000 → 3171
    expect(result.channelBudgets.hard).toBe(4230);
    expect(result.channelBudgets.timeline + result.storyArcBudget).toBeGreaterThanOrEqual(3170);
  });

  it("出场实体的 canon 设定在 state 通道里最后才动：先丢其它 state 卡，只降档不丢", () => {
    const result = packNarrativeContext([
      card({ id: "canon-a", channel: "state", title: "角色甲", content: "甲".repeat(200), brief: "甲".repeat(40), tags: ["entity-canon"], priority: 90, estimatedTokens: 200 }),
      card({ id: "other", channel: "state", title: "别的状态", content: "乙".repeat(200), brief: "乙".repeat(40), priority: 95, score: 200, estimatedTokens: 200 }),
    ], { channelBudgets: { state: 60 } });
    expect(result.cards.map((item) => item.card.id)).toEqual(["canon-a"]);
    expect(result.droppedCards.map((item) => item.id)).toEqual(["other"]);
  });

  it("出场实体的 canon 设定真被裁掉时，warnings 点名，不静默", () => {
    const result = packNarrativeContext([
      card({ id: "canon-a", channel: "state", title: "角色甲", content: "甲".repeat(200), brief: "甲".repeat(50), tags: ["entity-canon"], priority: 90, estimatedTokens: 200 }),
    ], { channelBudgets: { state: 10 } });
    expect(result.droppedCards.map((item) => item.id)).toEqual(["canon-a"]);
    expect(result.warnings.some((warning) => warning.includes("出场实体设定未能注入") && warning.includes("角色甲"))).toBe(true);
  });
});
