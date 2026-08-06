import { describe, expect, it } from "vitest";

import { packNarrativeContext } from "../budget.js";
import { createStyleChannel } from "./style-channel.js";
import type { NarrativeContextCard } from "../types.js";

function card(overrides: Partial<NarrativeContextCard> & Pick<NarrativeContextCard, "id" | "channel" | "title" | "content">): NarrativeContextCard {
  return {
    bookId: "book-1",
    sourceType: "manual",
    sourceId: overrides.id,
    normal: overrides.content,
    summary: overrides.content,
    brief: overrides.content.slice(0, 80),
    tags: [],
    entities: [],
    priority: 50,
    importance: 50,
    accessCount: 0,
    reason: "test card",
    estimatedTokens: 20,
    ...overrides,
  };
}

describe("style channel", () => {
  it("returns style cards for style guide and compliance hints with small priority", async () => {
    const result = await createStyleChannel().run({
      bookId: "book-1",
      styleGuideText: "文风克制、细节扎实，少用宏大抒情。",
      complianceRules: ["避免平台导流", "避免敏感词"],
    });

    expect(result.cards.map((item) => item.title)).toEqual(expect.arrayContaining([
      "文风指南",
      "合规/发布风格约束",
    ]));
    expect(result.cards.every((item) => item.channel === "style")).toBe(true);
    expect(result.cards.every((item) => item.priority <= 45)).toBe(true);
    expect(result.cards.every((item) => item.importance <= 55)).toBe(true);
    expect(result.cards.every((item) => item.reason.length > 0)).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("never carries Writing Skills: 技能由磁盘 .novelfork/skills 交给 agent，不走 style 通道", async () => {
    const result = await createStyleChannel().run({
      bookId: "book-1",
      styleGuideText: "文风克制。",
      // 旧字段已删除；这里显式传入也不应产生 writing-skill 卡片。
      ...({ writingSkills: [{ id: "austere", title: "克制写实", text: "少形容词，多动作和观察。" }] } as Record<string, unknown>),
    });

    expect(result.cards.map((item) => item.title)).toEqual(["文风指南"]);
    expect(result.cards.some((item) => item.tags.includes("writing-skill"))).toBe(false);
    expect(result.cards.some((item) => item.id.includes("writing-skill"))).toBe(false);
  });

  it("keeps style cards droppable instead of overriding hard/state/facts", async () => {
    const styleResult = await createStyleChannel().run({
      bookId: "book-1",
      styleGuideText: "文风克制、细节扎实。",
      complianceRules: ["避免平台导流"],
    });

    const budgeted = packNarrativeContext([
      card({ id: "hard:canon", channel: "hard", title: "硬设定", content: "世界观硬事实不可改写。", priority: 100, importance: 100, estimatedTokens: 20 }),
      card({ id: "state:current", channel: "state", title: "当前状态", content: "角色仍在药园。", priority: 80, importance: 80, estimatedTokens: 20 }),
      card({ id: "facts:known", channel: "facts", title: "已知事实", content: "小瓶只能催熟药草。", priority: 75, importance: 75, estimatedTokens: 20 }),
      ...styleResult.cards.map((styleCard) => ({ ...styleCard, estimatedTokens: 200 })),
    ], {
      maxTokens: 90,
      channelBudgets: { hard: 90, state: 30, facts: 30, style: 1 },
    });

    expect(styleResult.cards.every((item) => item.channel === "style")).toBe(true);
    expect(budgeted.cards.map((item) => item.card.id)).toEqual(expect.arrayContaining(["hard:canon", "state:current", "facts:known"]));
    expect(budgeted.cards.some((item) => item.card.channel === "style")).toBe(false);
    expect(budgeted.droppedCards.map((item) => item.channel)).toContain("style");
  });

  it("returns skipped when no style configuration is available", async () => {
    const result = await createStyleChannel().run({ bookId: "book-1" });

    expect(result.status).toBe("skipped");
    expect(result.cards).toEqual([]);
    expect(result.warnings?.[0]).toContain("style channel 为空");
  });
});
