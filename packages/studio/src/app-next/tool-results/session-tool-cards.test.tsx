import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderToolResult, resolveToolResultRendererKey } from "./registry";

afterEach(() => cleanup());

describe("renderer key 错配修正", () => {
  it("pgi.ask 声明的 renderer 命中 PgiCard，不再退回 generic", () => {
    expect(resolveToolResultRendererKey({ toolName: "pgi.ask", result: { renderer: "pgi.ask" } })).toBe("pgi");
  });

  it("narrative.read_line 声明的 renderer 命中 NarrativeLineCard", () => {
    expect(resolveToolResultRendererKey({ toolName: "narrative.read_line", result: { renderer: "narrative.line" } })).toBe("narrative");
  });

  it("scene.spec / chapter.audit / memory.* 各自命中专属卡", () => {
    expect(resolveToolResultRendererKey({ toolName: "scene.spec", result: { renderer: "scene.spec" } })).toBe("scene-spec");
    expect(resolveToolResultRendererKey({ toolName: "chapter.audit", result: { renderer: "chapter.audit" } })).toBe("chapter-audit");
    expect(resolveToolResultRendererKey({ toolName: "memory.read", result: { renderer: "narrative-memory.read" } })).toBe("memory-read");
    expect(resolveToolResultRendererKey({ toolName: "memory.graph", result: { renderer: "narrative-memory.graph" } })).toBe("memory-graph");
    expect(resolveToolResultRendererKey({ toolName: "memory.events", result: { renderer: "narrative-memory.events" } })).toBe("memory-events");
  });

  it("narrative.mutationPreview 仍显式走 generic（无差异预览卡）", () => {
    expect(resolveToolResultRendererKey({ toolName: "narrative.propose_change", result: { renderer: "narrative.mutationPreview" } })).toBe("generic");
  });
});

describe("pgi.ask 追问卡", () => {
  it("展示问题与追问理由", () => {
    render(<>{renderToolResult({
      toolName: "pgi.ask",
      result: {
        renderer: "pgi.ask",
        data: {
          questions: [
            { id: "foreshadow-payoff:1", prompt: "本章是否兑现旧伤伏笔？", reason: "检测到临近回收伏笔。", options: ["兑现", "延后"] },
          ],
        },
      },
    })}</>);

    expect(screen.getByTestId("tool-result-pgi")).toBeTruthy();
    expect(screen.getByText("本章是否兑现旧伤伏笔？")).toBeTruthy();
    expect(screen.getByText("检测到临近回收伏笔。")).toBeTruthy();
    expect(screen.getByText("选项：兑现 / 延后")).toBeTruthy();
  });

  it("无追问时给出下一步", () => {
    render(<>{renderToolResult({
      toolName: "pgi.ask",
      result: { renderer: "pgi.ask", data: { questions: [], skippedReason: "no-questions" } },
    })}</>);

    expect(screen.getByText(/本章无需追问/)).toBeTruthy();
  });
});

describe("narrative.read_line 叙事线卡", () => {
  it("展示结构规模、未回收伏笔与告警", () => {
    render(<>{renderToolResult({
      toolName: "narrative.read_line",
      result: {
        renderer: "narrative.line",
        data: {
          lines: [{ title: "主叙事线", nodeIds: [], edgeIds: [] }],
          nodes: [{ id: "a" }, { id: "b" }],
          edges: [{ id: "e1" }],
          beats: [{ id: "beat1" }],
          foreshadowThreads: [
            { id: "f1", title: "旧伤来历", status: "due" },
            { id: "f2", title: "已兑现线索", status: "paid-off" },
          ],
          conflictThreads: [{ id: "c1", title: "主角与宗门", status: "escalating" }],
          warnings: [{ severity: "warning", summary: "伏笔已到回收窗口：旧伤来历" }],
        },
      },
    })}</>);

    expect(screen.getByTestId("tool-result-narrative")).toBeTruthy();
    expect(screen.getByText("主叙事线")).toBeTruthy();
    expect(screen.getByText("节点 2")).toBeTruthy();
    expect(screen.getByText("伏笔已到回收窗口：旧伤来历")).toBeTruthy();
    // 未回收伏笔只算 open/due，paid-off 不计入
    expect(screen.getByText("未回收伏笔 1")).toBeTruthy();
  });
});

describe("scene.spec 写作蓝图卡", () => {
  it("展示场景、情节点预算与不合规拦截", () => {
    render(<>{renderToolResult({
      toolName: "scene.spec",
      result: {
        renderer: "scene.spec",
        data: {
          sceneSpec: {
            chapter: 12,
            title: "守门人试炼",
            wordTarget: 3000,
            scenes: [
              { characters: ["林舟"], location: "山门前", conflict: "被守门人拦下", mood: "紧张→释然", outcome: "通过试炼", hooks_used: [], hooks_planted: [] },
            ],
            beatBudget: [
              { summary: "在账单上发现4800元转出", density: "dense", words: 300, function: "信息揭示" },
            ],
            constraints: ["用户指示：让林舟通过守门人试炼"],
          },
          beatBudget: {
            ok: false,
            chapterTarget: 3000,
            ceiling: 3300,
            total: 300,
            budgetLine: "预算合计：300字（目标3000，范围3000-3300）",
            findings: [
              {
                code: "sum-below-target",
                severity: "block",
                whatHappened: "情节点预算合计 300 字，低于本章目标 3000 字。",
                whyItMatters: "缺口会被模型即兴填补，通常填成注水段落。",
                suggestedAction: "把爽点类情节点拆得更细。",
              },
            ],
          },
          modelCalls: [{
            id: "scene.spec:model-call:1",
            purpose: "生成结构化写作蓝图",
            provider: "test-provider",
            model: "test-current-model",
            status: "completed",
            durationMs: 1250,
            request: { messageCount: 2, maxTokens: 4000 },
            usage: { promptTokens: 800, completionTokens: 400, totalTokens: 1200 },
          }],
        },
      },
    })}</>);

    expect(screen.getByTestId("tool-result-scene-spec")).toBeTruthy();
    expect(screen.getByText("写作蓝图 · 第12章")).toBeTruthy();
    expect(screen.getByText("在账单上发现4800元转出（信息揭示）")).toBeTruthy();
    expect(screen.getByText("情节点预算合计 300 字，低于本章目标 3000 字。")).toBeTruthy();
    expect(screen.getByText(/beat-budget-invalid/)).toBeTruthy();
    expect(screen.getByTestId("secondary-model-calls")).toBeTruthy();
    expect(screen.getByText("test-provider/test-current-model")).toBeTruthy();
    expect(screen.getAllByText("1200 tokens")).toHaveLength(2);
  });
});

describe("chapter.audit 审计卡", () => {
  it("按硬/软约束分组展示，用后端 description/suggestion", () => {
    render(<>{renderToolResult({
      toolName: "chapter.audit",
      result: {
        renderer: "chapter.audit",
        data: {
          ok: true,
          passed: false,
          wordCount: 2800,
          hardViolations: [
            { ruleId: "H7", severity: "hard", location: "他心想她不知道", description: "叙述者透露了非 POV 角色的内心想法", suggestion: "只从当前 POV 角色视角描写。" },
          ],
          softViolations: [
            { ruleId: "S1", severity: "soft", description: "章节字数 2800 低于目标 3000 的 80%。", suggestion: "考虑扩展场景描写。" },
          ],
        },
      },
    })}</>);

    expect(screen.getByTestId("tool-result-chapter-audit")).toBeTruthy();
    expect(screen.getByText("章节审计未通过")).toBeTruthy();
    expect(screen.getByText("硬约束违反 1")).toBeTruthy();
    expect(screen.getByText("叙述者透露了非 POV 角色的内心想法")).toBeTruthy();
    expect(screen.getByText("章节字数 2800 低于目标 3000 的 80%。")).toBeTruthy();
  });
});

describe("pipeline.write 结果卡", () => {
  it("按真实结果字段展示审计、修订、结算与内部模型调用", () => {
    render(<>{renderToolResult({
      toolName: "pipeline.write",
      result: {
        renderer: "pipeline.chapter-result",
        data: {
          chapterNumber: 4,
          title: "铃声之后",
          wordCount: 3120,
          auditPassed: false,
          auditIssueCategories: { critical: 1, warning: 2, info: 0, byType: { continuity: 1, rhythm: 2 } },
          revised: true,
          reviseRounds: 1,
          factCheckRevised: true,
          factCheckRound: 1,
          needsHumanReview: true,
          narrativeSettlement: { extracted: 5, autoApplied: 3, pending: 2 },
          publishHint: { status: "has-warnings", warnings: ["建议抽查关键事实。"] },
          modelCalls: [
            {
              id: "pipeline.write:model-call:1",
              purpose: "执行章节生成、审计、修订与结算",
              provider: "test-provider",
              model: "test-current-model",
              status: "completed",
              durationMs: 2500,
              request: { messageCount: 2 },
              usage: { totalTokens: 2400 },
            },
            {
              id: "pipeline.write:model-call:2",
              purpose: "执行章节生成、审计、修订与结算",
              provider: "test-provider",
              model: "test-current-model",
              status: "completed",
              durationMs: 900,
              request: { messageCount: 2 },
              usage: { totalTokens: 600 },
            },
          ],
        },
      },
    })}</>);

    expect(screen.getByTestId("tool-result-pipeline")).toBeTruthy();
    expect(screen.getByText("第4章 铃声之后")).toBeTruthy();
    expect(screen.getByText("自动修订 1 轮")).toBeTruthy();
    expect(screen.getByText("需要人工复核")).toBeTruthy();
    expect(screen.getByText("Narrative Memory")).toBeTruthy();
    expect(screen.getByText("2 次")).toBeTruthy();
    expect(screen.getByText("3000 tokens")).toBeTruthy();
    expect(screen.getByText("建议抽查关键事实。")).toBeTruthy();
  });
});

describe("memory.read 召回卡", () => {
  it("展示卡数、token、召回告警与条目证据", () => {
    render(<>{renderToolResult({
      toolName: "memory.read",
      result: {
        renderer: "narrative-memory.read",
        data: {
          diagnostics: { totalEstimatedTokens: 1200, warnings: ["近章记忆稀疏"] },
          warnings: ["近章记忆稀疏"],
          cards: [
            { id: "card1", title: "林舟当前状态", channel: "state", brief: "重伤未愈", reason: "写章需要角色现状", content: "林舟右臂骨折，仍在恢复。", estimatedTokens: 40 },
          ],
        },
      },
    })}</>);

    expect(screen.getByTestId("tool-result-memory-read")).toBeTruthy();
    expect(screen.getByText("1 张卡 · 约 1200 tokens")).toBeTruthy();
    expect(screen.getByText("近章记忆稀疏")).toBeTruthy();
    expect(screen.getByText("林舟当前状态")).toBeTruthy();
    expect(screen.getByText("召回理由：写章需要角色现状")).toBeTruthy();
  });
});

describe("memory.graph 图谱卡", () => {
  it("列出事实与事件三元组", () => {
    render(<>{renderToolResult({
      toolName: "memory.graph",
      result: {
        renderer: "narrative-memory.graph",
        data: {
          view: "relationship",
          facts: [
            { id: "f1", subject: "林舟", predicate: "敌对", object: "宗主", category: "relationship", layer: "dynamic", sourceChapter: 8, evidenceText: "第八章正面冲突" },
          ],
          events: [
            { id: "e1", subject: "林舟", predicate: "结识", object: "苏晚", eventType: "relationship_changed", chapterNumber: 9, riskLevel: "low", status: "applied" },
          ],
        },
      },
    })}</>);

    expect(screen.getByTestId("tool-result-memory-graph")).toBeTruthy();
    expect(screen.getByText("关系图")).toBeTruthy();
    expect(screen.getByText("1 条事实 · 1 个事件")).toBeTruthy();
    expect(screen.getByText("林舟 · 敌对 · 宗主")).toBeTruthy();
  });
});

describe("memory.events 事件流卡", () => {
  it("展示 pending 事件的三元组与风险", () => {
    render(<>{renderToolResult({
      toolName: "memory.events",
      result: {
        renderer: "narrative-memory.events",
        data: {
          events: [
            { id: "e1", subject: "林舟", predicate: "获得", object: "断刃", eventType: "world_fact_introduced", chapterNumber: 10, riskLevel: "medium", status: "pending", evidenceText: "在废墟中拾得断刃" },
          ],
        },
      },
    })}</>);

    expect(screen.getByTestId("tool-result-memory-events")).toBeTruthy();
    expect(screen.getByText("林舟 · 获得 · 断刃")).toBeTruthy();
    expect(screen.getByText("待审")).toBeTruthy();
  });
});

describe("新卡片健壮性", () => {
  it("载荷缺失时退回 generic 而不是崩", () => {
    for (const renderer of ["scene.spec", "chapter.audit", "narrative-memory.read", "narrative-memory.graph", "narrative-memory.events", "pgi.ask", "narrative.line"]) {
      cleanup();
      render(<>{renderToolResult({ toolName: renderer, result: { renderer, data: null } })}</>);
      expect(screen.getByTestId("tool-result-generic")).toBeTruthy();
    }
  });
});
