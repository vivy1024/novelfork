import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildHighRiskPendingReminder, buildPipelineChapterResultMetadata, buildPipelineContextPackage, summarizeAuditIssueCategories } from "./pipeline-write-service.js";
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

  /**
   * 「保存先于结算」原来靠源码里 settleConfirmedChapter 的字符串位置断言。
   * 结算改成工具调用后，这个函数名已不出现在本文件里，源码位置断言不但会失效，
   * 本身也很弱：它只证明代码这么写，不证明运行时真的这么跑。
   *
   * 现在用**更强**的方式锁同一条纪律，分两层：
   * 1. 结构层（本用例）：结算调用点必须在 resourceService.create 之后，
   *    且管线不得把正文直接交给结算（否则又能绕过落盘）。
   * 2. 行为层（下方 settlement dispatch 用例）：结算工具只读已落盘正文，
   *    章节没落盘就必然结算失败——顺序变成数据依赖，而不是书写顺序的约定。
   */
  it("dispatches settlement only after the formal chapter resource is saved", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");

    const saveIndex = source.indexOf("await resourceService.create(bookId");
    const settlementIndex = source.indexOf("dispatchChapterSettlement({");

    expect(saveIndex).toBeGreaterThan(-1);
    expect(settlementIndex).toBeGreaterThan(saveIndex);
    expect(source).toContain("narrativeSettlement");

    // 管线不得把内存里的正文直接传给结算：结算的正文来源必须是已落盘章节。
    expect(source).not.toContain("content: finalContent,\n        confirmedAt");
    expect(source).not.toContain("settleConfirmedChapter");
  });

  it("checks high-risk pending events before persisting and follows saved blocking policy", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");

    expect(source.indexOf("listHighRiskPendingNarrativeEvents")).toBeGreaterThan(-1);
    expect(source).toContain("continueWithHighRiskPending === undefined");
    expect(source).toContain("blockWriteOnHighRiskPending");
    // pipeline.write 不再内部生成正文（无 WriterAgent）。
    expect(source).not.toContain("const writer = new WriterAgent");
  });

  it("runs write.preflight context gate before persisting", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");
    expect(source.indexOf("handleWritePreflight")).toBeGreaterThan(-1);
    expect(source).toContain("context-not-ready");
    expect(source).toContain("empty-recent-progress");
    expect(source).toContain("explanationText");
    expect(source).not.toContain("const writer = new WriterAgent");
  });

  it("fails closed when preflight cannot run; skill 生效证据由 loadedSkills 注入", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");
    expect(source).toContain("preflight-execution-failed");
    expect(source).toContain("Context gate failed closed");
    expect(source).toContain("loadedSkills");
    expect(source).not.toContain("Context gate skipped");
    expect(source).not.toContain("verifyWritingSkillAcknowledgements");
  });

  it("carries the outline's real chapter ranges and rejects out-of-range chapters", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");
    expect(source).toContain("const ranges = volumeContext.volumes.map((volume) => volume.chapterRange);");
    expect(source).toContain("volumeRanges = ranges.length > 0 ? ranges : undefined;");
    expect(source).toContain("volume-range-violation");
    expect(source).not.toContain("chaptersPerVolume: book.targetChapters");
  });

  it("supports requireFactCheckPass hard reject path in source", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");
    expect(source).toContain("requireFactCheckPass");
    expect(source).toContain("fact-check-failed");
    expect(source).toContain("auditIssueCategories");
    expect(source).toContain("publishHint");
  });

  it("runs a submission risk check before saving without platform-rule blocking", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");
    const publishIndex = source.indexOf("handlePublishCheck");
    const saveIndex = source.indexOf("await resourceService.create(bookId");
    expect(publishIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeLessThan(saveIndex);
    expect(source).toContain("高风险线索");
    expect(source).not.toContain("blockOnSensitiveBlock");
    expect(source).not.toContain("publish-blocked");
  });

  it("keeps fact-check result fields for the Agent-facing contract but never spawns a reviser", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");
    expect(source).toContain("factCheckRevised");
    expect(source).toContain("factCheckRound");
    expect(source).toContain("handleChapterAuditV2");
    expect(source).not.toContain("new ReviserAgent");
    expect(source).not.toContain("new ContinuityAuditor");
    expect(source).not.toContain("new LengthNormalizerAgent");
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

});

describe("pipeline.write beat budget hard gate", () => {
  it("rejects a block-level beat budget before persisting and explains why", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");
    expect(source.indexOf("code: \"beat-budget-invalid\"")).toBeGreaterThan(-1);
    expect(source).toContain("checkBeatBudget");
    expect(source).toContain("为什么要看：");
    expect(source).toContain("建议怎么做：");
    // 预算目标必须取书籍权威字数，不能被模型生成的 sceneSpec.wordTarget 顶掉。
    expect(source).toContain("chapterTarget: book.chapterWordCount");
  });

  it("keeps writing when sceneSpec has no beat budget at all", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");
    expect(source).toContain("未提供 beatBudget");
    expect(source).toContain("旧书兼容路径");
  });
});

describe("pipeline.write settlement degradation", () => {
  it("keeps the generated chapter when settlement fails and tells the agent to retry the settlement tool", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");

    // 结算失败绝不能回滚/丢弃已保存的正文：失败只进 settlementError，不改 ok。
    expect(source).toContain("settlementDispatch && !settlementDispatch.ok");
    expect(source).toContain("正文已保存");
    expect(source).toContain("重试不会丢稿");
    // 失败路径不得返回错误码把整次写章判失败。
    expect(source).not.toContain("code: \"settlement-failed\"");
  });

  it("never swallows a settlement failure into publishHint before the chapter is saved", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");
    // publishHint 在落盘前组装，结算在落盘后发生，二者不能再耦合。
    expect(source).not.toContain("writeOutput.settlementError");
  });
});

describe("pipeline.write writing skill evidence", () => {
  it("接受 Runtime 注入的 loadedSkills，不再要求原文引用硬门", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");
    expect(source).toContain("loadedSkills");
    expect(source).not.toContain("code: \"skills-not-acknowledged\"");
    expect(source).not.toContain("verifyWritingSkillAcknowledgements");
    expect(source).not.toContain("Skill acknowledgement gate failed closed");
  });

  it("no longer injects writing skills through the style channel", async () => {
    const source = await readFile(SERVICE_SOURCE_PATH, "utf-8");
    expect(source).not.toContain("writingSkills:");
    expect(source).not.toContain("writingSkillsApplied");
    expect(source).not.toContain("writingSkillToStyleSnippet");
  });
});
