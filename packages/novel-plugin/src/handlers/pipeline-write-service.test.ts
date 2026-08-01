import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildHighRiskPendingReminder, buildPipelineChapterResultMetadata, buildPipelineContextPackage, summarizeAuditIssueCategories, writingSkillToStyleSnippet } from "./pipeline-write-service.js";
import type { ParsedWritingSkill } from "../engine/writing-skills/types.js";
import type { SceneSpec } from "./scene-spec-handler.js";
import type { NarrativeContextPackage } from "../engine/narrative-memory/types.js";

/**
 * 被检查的源码文件路径。
 *
 * 这些用例读自己的实现源码来断言管线纪律（例如「不得产生候选稿资源」）。
 * 不能直接把 import.meta.url 交给 readFile：vitest 下模块 URL 是 http:// 而非
 * file://，readFile 会拒绝。先在 file: 时正常还原路径，否则回退到包内相对路径。
 */
const SERVICE_SOURCE_PATH = import.meta.url.startsWith("file:")
  ? resolve(dirname(fileURLToPath(import.meta.url)), "pipeline-write-service.ts")
  : resolve(process.cwd(), "src/handlers/pipeline-write-service.ts");

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
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");

    expect(source).not.toContain("status: \"candidate\"");
    expect(source).not.toContain("type: \"draft\"");
    expect(source).not.toContain("candidateId");
    expect(source).not.toContain("candidate-chapter");
    expect(source).not.toContain("候选稿");
  });

  it("settles Narrative Memory only after the formal chapter resource is saved", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");

    const saveIndex = source.indexOf("await resourceService.create(bookId");
    const settlementIndex = source.indexOf("settleConfirmedChapter");

    expect(saveIndex).toBeGreaterThan(-1);
    expect(settlementIndex).toBeGreaterThan(saveIndex);
    expect(source).toContain("narrativeSettlement");
  });

  it("checks high-risk pending events before writer generation and follows saved blocking policy", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");

    const pendingCheckIndex = source.indexOf("listHighRiskPendingNarrativeEvents");
    const writerIndex = source.indexOf("const writer = new WriterAgent");

    expect(pendingCheckIndex).toBeGreaterThan(-1);
    expect(writerIndex).toBeGreaterThan(-1);
    expect(source).toContain("continueWithHighRiskPending === undefined");
    expect(source).toContain("blockWriteOnHighRiskPending");
    expect(pendingCheckIndex).toBeLessThan(writerIndex);
  });

  it("runs write.preflight context gate before writer generation", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");
    const gateIndex = source.indexOf("handleWritePreflight");
    const writerIndex = source.indexOf("const writer = new WriterAgent");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(source).toContain("context-not-ready");
    expect(source).toContain("empty-recent-progress");
    expect(gateIndex).toBeLessThan(writerIndex);
  });

  it("supports requireFactCheckPass hard reject path in source", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");
    expect(source).toContain("requireFactCheckPass");
    expect(source).toContain("fact-check-failed");
    expect(source).toContain("auditIssueCategories");
    expect(source).toContain("publishHint");
  });

  it("runs a platform publish check before saving and only blocks on sensitive block hits", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");
    const publishIndex = source.indexOf("handlePublishCheck");
    const saveIndex = source.indexOf("await resourceService.create(bookId");
    expect(publishIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeLessThan(saveIndex);
    expect(source).toContain("blockOnSensitiveBlock");
    expect(source).toContain("publish-blocked");
    expect(source).toContain("sensitiveScan.totalBlockCount");
  });

  it("runs the fact-check specialist revise after the normal revise loop and before length recheck", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");
    const loopEnd = source.indexOf("auditResult = await runAudit(finalContent); // re-audit 修订后的版本");
    const factIndex = source.indexOf("factCheckAutoRevise) {");
    const lengthRecheck = source.indexOf("let finalLengthCount = countChapterLength");
    expect(loopEnd).toBeGreaterThan(-1);
    expect(factIndex).toBeGreaterThan(loopEnd);
    expect(lengthRecheck).toBeGreaterThan(factIndex);
    expect(source).toContain("selectFactContinuityIssues");
    expect(source).toContain("[事实核查专项]");
    expect(source).toContain("factCheckRound");
  });
});

describe("summarizeAuditIssueCategories", () => {
  it("counts severities and types", () => {
    const summary = summarizeAuditIssueCategories([
      { severity: "critical", type: "continuity" },
      { severity: "critical", type: "continuity" },
      { severity: "warning", type: "ai_taste" },
      { severity: "info", type: "style" },
    ]);
    expect(summary.critical).toBe(2);
    expect(summary.warning).toBe(1);
    expect(summary.info).toBe(1);
    expect(summary.byType.continuity).toBe(2);
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
    expect(reminder).toContain("默认不阻断写作");
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

  it("maps active writing skills to style channel snippets only", () => {
    const skill: ParsedWritingSkill = {
      id: "austere",
      slug: "austere",
      name: "克制写实",
      description: "克制写实文风技能",
      kind: "prose",
      body: "少形容词，多动作和观察。",
      source: "user",
      mode: "manual",
      tags: ["restrained"],
    };

    expect(writingSkillToStyleSnippet(skill)).toEqual({
      id: "austere",
      title: "克制写实",
      text: "少形容词，多动作和观察。",
      tags: ["writing-skill", "prose", "restrained"],
    });
  });

  it("drops writing skills whose body is empty", () => {
    const skill: ParsedWritingSkill = {
      id: "blank",
      slug: "blank",
      name: "空 Skill",
      description: "无正文",
      kind: "workflow",
      body: "   \n  ",
      source: "user",
      mode: "manual",
    };

    expect(writingSkillToStyleSnippet(skill)).toBeNull();
  });
});
