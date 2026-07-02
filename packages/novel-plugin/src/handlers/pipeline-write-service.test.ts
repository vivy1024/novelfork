import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { buildHighRiskPendingReminder, buildPipelineChapterResultMetadata, buildPipelineContextPackage, beatTemplateToStyleSnippet, presetToStyleSnippet } from "./pipeline-write-service.js";
import type { BeatTemplate, Preset } from "../engine/presets/types.js";
import type { SceneSpec } from "./scene-spec-handler.js";
import type { NarrativeContextPackage } from "../engine/narrative-memory/types.js";

const sceneSpec: SceneSpec = {
  chapter: 12,
  title: "药园试探",
  wordTarget: 3200,
  scenes: [{
    characters: ["韩立"],
    location: "药园",
    conflict: "韩立试探小瓶秘密",
    mood: "谨慎",
    outcome: "发现小瓶催熟药草",
    hooks_used: ["小瓶"],
    hooks_planted: [],
  }],
  constraints: ["不得泄露小瓶秘密"],
};

const narrativeContext: NarrativeContextPackage = {
  bookId: "book-1",
  chapterNumber: 12,
  purpose: "write_chapter",
  cards: [],
  sections: {
    hard: "<hard_constraints>\nreason: 硬约束\n</hard_constraints>",
    state: "<narrative_state>状态</narrative_state>",
    timeline: "<timeline_context>前情</timeline_context>",
    hooks: "<active_hooks>伏笔</active_hooks>",
    facts: "<known_facts>事实</known_facts>",
    style: "<style_rules>文风</style_rules>",
    semantic: "<semantic_memory></semantic_memory>",
  },
  diagnostics: {
    totalMs: 25,
    totalEstimatedTokens: 123,
    channelStats: [{ channel: "hard", status: "ok", latencyMs: 3, candidateCount: 2, returnedCount: 1, estimatedTokens: 50 }],
    injectedTokensByChannel: { hard: 50 },
    droppedCardIds: ["drop-1"],
    degradedCards: [{ id: "hard-1", from: "full", to: "brief" }],
    warnings: ["hard warning"],
  },
};

describe("pipeline.write canonical result contract", () => {
  it("does not create candidate/draft writing resources in the production pipeline path", async () => {
    const source = await readFile(new URL("./pipeline-write-service.ts", import.meta.url), "utf-8");

    expect(source).not.toContain("status: \"candidate\"");
    expect(source).not.toContain("type: \"draft\"");
    expect(source).not.toContain("candidateId");
    expect(source).not.toContain("candidate-chapter");
    expect(source).not.toContain("候选稿");
  });

  it("settles Narrative Memory only after the formal chapter resource is saved", async () => {
    const source = await readFile(new URL("./pipeline-write-service.ts", import.meta.url), "utf-8");

    const saveIndex = source.indexOf("await resourceService.create(bookId");
    const settlementIndex = source.indexOf("settleConfirmedChapter");

    expect(saveIndex).toBeGreaterThan(-1);
    expect(settlementIndex).toBeGreaterThan(saveIndex);
    expect(source).toContain("narrativeSettlement");
  });

  it("checks high-risk pending events before writer generation", async () => {
    const source = await readFile(new URL("./pipeline-write-service.ts", import.meta.url), "utf-8");

    const pendingCheckIndex = source.indexOf("listHighRiskPendingNarrativeEvents");
    const writerIndex = source.indexOf("const writer = new WriterAgent");

    expect(pendingCheckIndex).toBeGreaterThan(-1);
    expect(writerIndex).toBeGreaterThan(-1);
    expect(pendingCheckIndex).toBeLessThan(writerIndex);
  });
});

describe("pipeline.write high-risk pending reminder", () => {
  it("summarizes high-risk pending events with evidence and handling entry", () => {
    const reminder = buildHighRiskPendingReminder([{
      id: "event-1",
      bookId: "book-1",
      chapterNumber: 12,
      eventType: "world_fact_introduced",
      subject: "世界规则",
      predicate: "改变",
      object: "灵根可被后天逆转",
      evidenceText: "韩立确认灵根可被后天逆转。",
      confidence: 0.92,
      source: "settle",
      status: "pending",
      riskLevel: "high",
      createdAt: "2026-07-02T00:00:00.000Z",
    }]);

    expect(reminder).toContain("高风险 pending NarrativeEvents");
    expect(reminder).toContain("event-1");
    expect(reminder).toContain("灵根可被后天逆转");
    expect(reminder).toContain("memory.events");
  });
});

describe("pipeline.write narrative context integration helpers", () => {
  it("maps NarrativeContextPackage sections into Writer selectedContext", () => {
    const contextPackage = buildPipelineContextPackage({
      chapterNumber: 12,
      sceneSpec,
      authorIntentDoc: "作者意图",
      currentFocusDoc: "当前焦点",
      narrativeContext,
      previousChapterTail: "前章尾部",
    });

    expect(contextPackage.selectedContext.map((item) => item.source)).toEqual(expect.arrayContaining([
      "narrative-memory/hard",
      "narrative-memory/state",
      "narrative-memory/timeline",
      "narrative-memory/hooks",
      "narrative-memory/facts",
      "narrative-memory/style",
      "narrative-memory/semantic",
    ]));
    expect(contextPackage.selectedContext.find((item) => item.source === "narrative-memory/hard")?.excerpt).toContain("<hard_constraints>");
    expect(contextPackage.selectedContext.find((item) => item.source === "prev_chapter_tail")?.excerpt).toBe("前章尾部");
  });

  it("keeps legacy jingweiContext when narrative context is absent", () => {
    const contextPackage = buildPipelineContextPackage({
      chapterNumber: 12,
      sceneSpec,
      jingweiContext: "旧经纬文本",
    });

    expect(contextPackage.selectedContext).toContainEqual(expect.objectContaining({ source: "jingwei", excerpt: "旧经纬文本" }));
    expect(contextPackage.selectedContext.some((item) => item.source.startsWith("narrative-memory/"))).toBe(false);
  });

  it("preserves legacy jingweiContext even when narrative context is present", () => {
    const contextPackage = buildPipelineContextPackage({
      chapterNumber: 12,
      sceneSpec,
      narrativeContext,
      jingweiContext: "旧经纬文本",
    });

    expect(contextPackage.selectedContext).toContainEqual(expect.objectContaining({ source: "jingwei", excerpt: "旧经纬文本" }));
    expect(contextPackage.selectedContext).toContainEqual(expect.objectContaining({ source: "narrative-memory/hard" }));
  });

  it("summarizes retrieval diagnostics into chapter result metadata", () => {
    const metadata = buildPipelineChapterResultMetadata({ narrativeContext });

    expect(metadata).toEqual({
      totalMs: 25,
      totalEstimatedTokens: 123,
      channelStats: [{ channel: "hard", status: "ok", latencyMs: 3, candidateCount: 2, returnedCount: 1, estimatedTokens: 50 }],
      injectedTokensByChannel: { hard: 50 },
      droppedCardIds: ["drop-1"],
      degradedCards: [{ id: "hard-1", from: "full", to: "brief" }],
      warnings: ["hard warning"],
    });
  });

  it("maps enabled presets and beat templates to style channel snippets only", () => {
    const preset: Preset = {
      id: "austere",
      name: "克制写实",
      category: "tone",
      description: "风格预设",
      promptInjection: "少形容词，多动作和观察。",
      tags: ["restrained"],
    };
    const beatTemplate: BeatTemplate = {
      id: "ending-hook",
      name: "章节尾钩子",
      description: "章末卡点模板。",
      beats: [{ index: 1, name: "悬念句", purpose: "留下具体未解问题。", wordRatio: 0.1, emotionalTone: "好奇", networkNovelTip: "问题必须具体。" }],
    };

    expect(presetToStyleSnippet(preset)).toEqual({
      id: "austere",
      title: "克制写实",
      text: "少形容词，多动作和观察。",
      tags: ["preset", "tone", "restrained"],
    });
    expect(beatTemplateToStyleSnippet(beatTemplate)).toEqual(expect.objectContaining({
      id: "ending-hook",
      title: "章节尾钩子",
      tags: ["beat-template", "beat"],
    }));
    expect(beatTemplateToStyleSnippet(beatTemplate)?.text).toContain("悬念句");
  });
});
