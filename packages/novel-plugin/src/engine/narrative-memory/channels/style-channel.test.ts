import { describe, expect, it } from "vitest";

import { packNarrativeContext } from "../budget.js";
import { createStylePreset, type StylePreset } from "../../writing-layers/style-preset.js";
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

  it("injects book design without any author-habit cards", async () => {
    const isolated = await createStyleChannel().run({
      bookId: "book-b",
      bookDesignText: "B 的长期方向。",
    });
    expect(isolated.cards.map((item) => item.title)).toEqual(["本书设计"]);
    expect(isolated.cards.some((item) => item.tags.includes("author-profile"))).toBe(false);
  });

  describe("按场景类型注入范文", () => {
    function preset(): StylePreset {
      const value = createStylePreset();
      value.sources = [{
        id: "src",
        title: "参考作品",
        rules: [],
        samples: [
          { id: "fight", sceneType: "action", text: "刀光一闪，他侧身让过，反手扣住对方手腕。", evidence: "第3章", transfer: "source-only", status: "confirmed" },
          { id: "talk", sceneType: "dialogue", text: "“你来晚了。”她没回头。", evidence: "第5章", transfer: "transferable", status: "confirmed" },
          { id: "draft", sceneType: "action", text: "待审的范文。", evidence: "第6章", transfer: "transferable", status: "needs-review" },
        ],
      }];
      return value;
    }

    it("范文作为示例卡片注入，理由写明来源与作品专属，诊断记录场景类型来源与选择", async () => {
      const result = await createStyleChannel().run({
        bookId: "book-1",
        styleGuideText: "文风克制。",
        stylePreset: preset(),
        chapterNumber: 12,
        planText: "韩立与刺客交手，突围",
        budgetTokens: 1000,
      });

      const samples = result.cards.filter((item) => item.tags.includes("style-sample"));
      expect(samples.map((item) => item.id)).toEqual(["style:sample:src/fight", "style:sample:src/talk"]);
      expect(samples[0]!.content).toBe("刀光一闪，他侧身让过，反手扣住对方手腕。");
      expect(samples[0]!.brief).toBe(samples[0]!.content);
      expect(samples[0]!.reason).toContain("作品专属");
      expect(samples[0]!.priority).toBeLessThan(45);
      expect(samples.some((item) => item.content.includes("待审"))).toBe(false);

      const diagnostics = result.diagnostics?.styleSamples as Record<string, any>;
      expect(diagnostics.sceneTypes).toMatchObject({ source: "chapter-plan", types: ["action"] });
      expect(diagnostics.selected.map((item: { key: string; match: string }) => [item.key, item.match])).toEqual([
        ["src/fight", "scene-type"],
        ["src/talk", "fallback"],
      ]);
      expect(diagnostics.budget).toMatchObject({ channelBudgetTokens: 1000 });
      expect(diagnostics.budget.reservedTokens).toBeGreaterThan(0);
      expect(diagnostics.voiceConstraintsProvided).toBe(false);
    });

    it("先为指南占位，剩余预算放不下的范文裁掉并在告警里写明发生了什么与怎么做", async () => {
      const guide = "文风克制。".repeat(30);
      const result = await createStyleChannel().run({
        bookId: "book-1",
        styleGuideText: guide,
        stylePreset: preset(),
        planText: "韩立与刺客交手",
        budgetTokens: 50,
      });
      expect(result.cards.map((item) => item.id)).toEqual(["style:style-guide"]);
      const diagnostics = result.diagnostics?.styleSamples as Record<string, any>;
      expect(diagnostics.trimmed.map((item: { kind: string }) => item.kind)).toEqual(["token-budget", "token-budget"]);
      expect(result.warnings?.join(" ")).toContain("发生了什么");
      expect(result.warnings?.join(" ")).toContain("建议怎么做");
    });

    it("声线接缝只注入调用方给出的文本并计入预算占位", async () => {
      const result = await createStyleChannel().run({
        bookId: "book-1",
        voiceConstraints: "韩立：话少，多用短句。",
        budgetTokens: 1000,
      });
      expect(result.cards.map((item) => item.title)).toEqual(["角色声线"]);
      expect((result.diagnostics?.styleSamples as Record<string, any>).voiceConstraintsProvided).toBe(true);
    });
  });
});
