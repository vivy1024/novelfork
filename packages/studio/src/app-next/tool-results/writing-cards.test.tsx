import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderToolResult } from "./registry";
import type { ToolResultAction } from "./registry";

afterEach(() => cleanup());

describe("write.preflight 预检卡", () => {
  it("展示阻断项的人话三段式，而不是裸 code", () => {
    render(<>{renderToolResult({
      toolName: "write.preflight",
      result: {
        renderer: "write.preflight",
        data: {
          ok: false,
          chapterNumber: 12,
          blockers: [{
            code: "empty-recent-progress",
            message: "已有 11 章进度，但近章摘要为空。",
            explanation: {
              whatHappened: "近章记忆是空的。",
              whyItMatters: "写手会自行编造前情，越写越偏。",
              suggestedAction: "先用 memory.settle_range 回填 1–11 章。",
            },
          }],
          warningItems: [],
          recentChapters: [],
        },
      },
    })}</>);

    expect(screen.getByTestId("tool-result-write-preflight")).toBeTruthy();
    expect(screen.getByText("写前检查未通过 · 第12章")).toBeTruthy();
    expect(screen.getByText("近章记忆是空的。")).toBeTruthy();
    expect(screen.getByText("写手会自行编造前情，越写越偏。")).toBeTruthy();
    expect(screen.getByText("先用 memory.settle_range 回填 1–11 章。")).toBeTruthy();
    // 不把内部 code 甩给用户
    expect(screen.queryByText("empty-recent-progress")).toBeNull();
  });

  it("通过时展示指示、卷纲与平台", () => {
    render(<>{renderToolResult({
      toolName: "write.preflight",
      result: {
        renderer: "write.preflight",
        data: {
          ok: true,
          chapterNumber: 47,
          resolvedDirective: "让林舟通过守门人试炼。",
          needsUserConfirm: true,
          blockers: [],
          warningItems: [{ code: "style-disabled", message: "未启用文风预设。" }],
          currentVolume: { title: "开篇卷", goal: "立住动机" },
          platform: { label: "番茄小说", platform: "fanqie" },
          recentChapters: [{ number: 46, summary: "抵达山门" }],
        },
      },
    })}</>);

    expect(screen.getByText("写前检查通过 · 第47章")).toBeTruthy();
    expect(screen.getByText("让林舟通过守门人试炼。")).toBeTruthy();
    expect(screen.getByText("（来自焦点默认，需你确认）")).toBeTruthy();
    expect(screen.getByText("卷纲：开篇卷")).toBeTruthy();
    expect(screen.getByText("平台：番茄小说")).toBeTruthy();
    expect(screen.getByText("1 条提醒")).toBeTruthy();
  });
});

describe("book.dissect 采纳卡", () => {
  it("说明产物是 needs-review 待确认，而非直接入 canon", () => {
    render(<>{renderToolResult({
      toolName: "book.dissect",
      result: {
        renderer: "book.dissect",
        data: {
          ok: true,
          fromChapter: 1,
          toChapter: 30,
          applied: true,
          settled: true,
          knowledge: {
            characterCards: [{ name: "林舟" }, { name: "苏晚" }],
            worldElements: [{ name: "青冥山门" }],
            openHooks: [{ name: "旧伤来历" }],
            detailedSummaries: [{ number: 1, summary: "开篇" }],
            suggestedFocus: "进入山门试炼",
          },
        },
      },
    })}</>);

    expect(screen.getByTestId("tool-result-book-dissect")).toBeTruthy();
    expect(screen.getByText("第 1–30 章")).toBeTruthy();
    expect(screen.getByText("人物 2")).toBeTruthy();
    expect(screen.getByText("林舟、苏晚")).toBeTruthy();
    expect(screen.getByText("needs-review（待确认）")).toBeTruthy();
    expect(screen.getByText("已同时结算叙事记忆。")).toBeTruthy();
    expect(screen.getByText("进入山门试炼")).toBeTruthy();
  });

  it("未 apply 时说明尚未写入经纬", () => {
    render(<>{renderToolResult({
      toolName: "book.dissect",
      result: { renderer: "book.dissect", data: { ok: true, applied: false, draft: { characters: ["林舟"] } } },
    })}</>);

    expect(screen.getByText(/仅预览，未写入暂存/)).toBeTruthy();
  });

  it("staging 卡可直接触发 promote/reject，且不转交 bookId", async () => {
    const actions: ToolResultAction[] = [];
    const renderCard = (id: string) =>
      render(<>{renderToolResult({
        toolName: "book.dissect",
        result: {
          renderer: "book.dissect",
          data: {
            ok: true,
            applied: true,
            staging: [{
              id,
              proposedTitle: "边界规则",
              kind: "rules",
              status: "needs-review",
              bookId: "forged-book",
            }],
            knowledge: { characterCards: [{ name: "林舟" }] },
          },
        },
        onAction: (action) => {
          actions.push(action);
          return Promise.resolve({ ok: true, summary: `已处理「边界规则」。` });
        },
      })}</>);

    // 先拒绝一条独立候选（验收拒绝路径，不依赖 promote 先行完成）
    renderCard("staging-reject");
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    await waitFor(() => expect(actions).toHaveLength(1));
    expect(actions[0]).toEqual({
      type: "lore.write.staging",
      toolName: "lore.write",
      input: { stagingId: "staging-reject", stagingDecision: "reject", title: "边界规则" },
    });
    expect(actions[0]?.input).not.toHaveProperty("bookId");
    cleanup();

    // 再渲染一条独立候选点提升
    renderCard("staging-promote");
    fireEvent.click(screen.getByRole("button", { name: "提升" }));
    await waitFor(() => expect(actions).toHaveLength(2));
    expect(actions[1]).toEqual({
      type: "lore.write.staging",
      toolName: "lore.write",
      input: { stagingId: "staging-promote", stagingDecision: "promote", title: "边界规则" },
    });
    expect(actions[1]?.input).not.toHaveProperty("bookId");
    await waitFor(() => expect(screen.getByText("已提升").textContent).toBe("已提升"));
  });

  it("staging 操作失败时展示错误但不吞掉后续点击", async () => {
    const onAction = vi.fn((action: ToolResultAction) => {
      if (action.input.stagingDecision === "promote") {
        return Promise.reject(new Error("写入失败：已回滚"));
      }
      return Promise.resolve({ ok: true, summary: "已拒绝「边界规则」。" });
    });
    render(<>{renderToolResult({
      toolName: "book.dissect",
      result: {
        renderer: "book.dissect",
        data: {
          ok: true,
          applied: true,
          staging: [{ id: "staging-2", proposedTitle: "边界规则", kind: "rules", status: "needs-review" }],
        },
      },
      onAction,
    })}</>);

    fireEvent.click(screen.getByRole("button", { name: "提升" }));
    await waitFor(() => expect(screen.getByText("写入失败：已回滚")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    await waitFor(() => expect(screen.getByText("已拒绝").textContent).toBe("已拒绝"));
    expect(onAction).toHaveBeenCalledTimes(2);
  });
});

describe("outline.volume 卷纲卡", () => {
  it("suggest 结果明确标注未保存", () => {
    render(<>{renderToolResult({
      toolName: "outline.volume",
      result: {
        renderer: "outline.volume",
        data: {
          ok: true,
          action: "suggest",
          suggestion: [
            { id: "v1", title: "开篇卷", chapterRange: { from: 1, to: 60 }, goal: "立住动机", status: "planned" },
          ],
          outline: null,
        },
      },
    })}</>);

    expect(screen.getByTestId("tool-result-outline-volume")).toBeTruthy();
    expect(screen.getByText("卷纲草案（未保存）")).toBeTruthy();
    expect(screen.getByText(/确认后用 outline.volume\(action=set\) 保存/)).toBeTruthy();
    expect(screen.getByText("第 1–60 章")).toBeTruthy();
  });

  it("已保存卷纲标出当前卷", () => {
    render(<>{renderToolResult({
      toolName: "outline.volume",
      result: {
        renderer: "outline.volume",
        data: {
          ok: true,
          action: "get",
          outline: {
            volumes: [
              { id: "v1", title: "开篇卷", chapterRange: { from: 1, to: 60 }, goal: "立住动机", status: "done" },
              { id: "v2", title: "山门卷", chapterRange: { from: 61, to: 140 }, goal: "拿到入门资格", status: "active" },
            ],
          },
          currentVolume: { id: "v2", title: "山门卷" },
        },
      },
    })}</>);

    expect(screen.getByText("2 卷")).toBeTruthy();
    expect(screen.getByText("当前卷")).toBeTruthy();
    expect(screen.queryByText("卷纲草案（未保存）")).toBeNull();
  });

  it("空卷纲给出下一步", () => {
    render(<>{renderToolResult({
      toolName: "outline.volume",
      result: { renderer: "outline.volume", data: { ok: true, action: "get", outline: null } },
    })}</>);

    expect(screen.getByText(/还没有卷纲/)).toBeTruthy();
  });
});

describe("publish.check 投稿风险自检卡", () => {
  it("展示规则来源、复核状态与正文证据", () => {
    render(<>{renderToolResult({
      toolName: "publish.check",
      result: {
        renderer: "compliance.publish-readiness",
        data: {
          ok: true,
          status: "needs-review",
          platformLabel: "起点中文网",
          blockCount: 2,
          warnCount: 3,
          suggestCount: 1,
          checkedChapters: 12,
          report: {
            status: "needs-review",
            aiTaste: { overallRiskLevel: "high" },
            rulePack: { name: "NovelFork 投稿风险自检规则", version: "2026.08", confidence: "medium", source: "本地规则" },
            evidence: [{ ruleId: "sensitive:demo", message: "命中本地风险词", context: "…【示例词】…", suggestion: "人工判断语境" }],
          },
          notes: ["第 3 章命中本地风险词"],
        },
      },
    })}</>);

    expect(screen.getByTestId("tool-result-publish-readiness")).toBeTruthy();
    expect(screen.getByText("需人工复核")).toBeTruthy();
    expect(screen.getByText("起点中文网")).toBeTruthy();
    expect(screen.getByText("已检 12 章")).toBeTruthy();
    expect(screen.getByText("AI 味线索")).toBeTruthy();
    expect(screen.getByText(/NovelFork 投稿风险自检规则/)).toBeTruthy();
    expect(screen.getByText("命中本地风险词")).toBeTruthy();
    expect(screen.getByText("第 3 章命中本地风险词")).toBeTruthy();
  });

  it("ready 状态不把结果表述为平台通过", () => {
    render(<>{renderToolResult({
      toolName: "publish.check",
      result: { renderer: "publish.check", data: { ok: true, status: "ready", blockCount: 0, warnCount: 0, suggestCount: 0 } },
    })}</>);

    expect(screen.getByText("未发现明显线索")).toBeTruthy();
    expect(screen.queryByText("可以发布")).toBeNull();
  });
});

describe("publish.export 发布包卡", () => {
  it("展示写出目录、包含项和未混入的内容", () => {
    render(<>{renderToolResult({
      toolName: "publish.export",
      result: {
        renderer: "publish.export",
        data: {
          ok: true,
          outputDir: "export/publish",
          files: ["README.md", "book.json", "catalog.md", "chapters/0001_山门.md", "publish-advice.md"],
          chapters: [{ number: 1, title: "山门", fileName: "0001_山门.md", wordCount: 2200 }],
          included: ["作品信息", "目录", "章节正文", "投稿准备建议"],
          excluded: ["附件 / 图片 / 音视频", "Narrative Memory（facts/events/logs）"],
          adviceIncluded: true,
          adviceStatus: "has-warnings",
        },
      },
    })}</>);

    expect(screen.getByTestId("tool-result-publish-export")).toBeTruthy();
    expect(screen.getByText("发布包已写出")).toBeTruthy();
    expect(screen.getByText("export/publish")).toBeTruthy();
    expect(screen.getByText("作品信息")).toBeTruthy();
    expect(screen.getByText("投稿建议状态：has-warnings（仅供人工复核）")).toBeTruthy();
    expect(screen.getByText(/未混入：附件/)).toBeTruthy();
  });
});

describe("卡片健壮性", () => {
  it("载荷缺失时退回 generic 而不是崩", () => {
    for (const renderer of ["write.preflight", "book.dissect", "outline.volume", "publish.check", "publish.export"]) {
      cleanup();
      render(<>{renderToolResult({ toolName: renderer, result: { renderer, data: null } })}</>);
      expect(screen.getByTestId("tool-result-generic")).toBeTruthy();
    }
  });
});

describe("pipeline.write 结果卡", () => {
  it("展示真实阶段状态、技能结果、结算重试和人工复核建议", () => {
    render(<>{renderToolResult({
      toolName: "pipeline.write",
      result: {
        renderer: "pipeline.chapter-result",
        data: {
          title: "药园试探",
          chapterNumber: 12,
          wordCount: 3200,
          auditPassed: false,
          needsHumanReview: true,
          auditIssueCategories: { critical: 1, warning: 2, info: 0, byType: { continuity: 1 } },
          pipelineStages: [
            { stage: "写前预检", status: "ok", detail: "硬门 blockers 已清空" },
            { stage: "Skills 合规", status: "warning", detail: "1 条技能提醒" },
            { stage: "章后结算", status: "failed", detail: "memory.settle_chapter：抽取器超时" },
          ],
          publishHint: {
            status: "has-warnings",
            warnings: [
              "Writing Skill「压力账本」：关键债务无证据结清",
              "审计仍有 critical/S2，建议人工复核后再发布。",
            ],
          },
          settlementDispatch: { toolName: "memory.settle_chapter", ok: false, dispatched: "tool-call" },
          settlementError: "第12章正文已保存，但章后结算失败。",
        },
      },
    })}</>);

    expect(screen.getByTestId("tool-result-pipeline")).toBeTruthy();
    expect(screen.getByTestId("pipeline-stages")).toBeTruthy();
    expect(screen.getByText("写前预检")).toBeTruthy();
    expect(screen.getByText("通过")).toBeTruthy();
    expect(screen.getByText("有提醒")).toBeTruthy();
    expect(screen.getByText("1 通过 · 1 提醒 · 1 失败")).toBeTruthy();
    expect(screen.getByText("章后结算")).toBeTruthy();
    expect(screen.getByTestId("pipeline-settlement-dispatch")).toBeTruthy();
    expect(screen.getByText("结算失败")).toBeTruthy();
    expect(screen.getByTestId("pipeline-skill-results")).toBeTruthy();
    expect(screen.getByText("Writing Skill「压力账本」：关键债务无证据结清")).toBeTruthy();
    expect(screen.getByTestId("pipeline-human-review")).toBeTruthy();
    expect(screen.getByText("需要人工干预")).toBeTruthy();
    expect(screen.getByTestId("pipeline-settlement-retry")).toBeTruthy();
    expect(screen.getByText(/重试 memory.settle_chapter/)).toBeTruthy();
  });

  it("失败结果展示错误信息和对应恢复建议，不假装已保存", () => {
    render(<>{renderToolResult({
      toolName: "pipeline.write",
      result: {
        renderer: "pipeline.chapter-result",
        ok: false,
        error: "context-not-ready",
        summary: "已有 11 章进度，但近章摘要为空。",
        data: {
          ok: false,
          code: "context-not-ready",
          error: "已有 11 章进度，但近章摘要为空。",
          explanation: "近章记忆是空的，写下去会自行编造前情。",
        },
      },
    })}</>);

    expect(screen.getByTestId("pipeline-failure")).toBeTruthy();
    expect(screen.getByText("近章记忆未就绪")).toBeTruthy();
    expect(screen.getByText("已有 11 章进度，但近章摘要为空。")).toBeTruthy();
    expect(screen.getByText(/先用 memory.settle_range 回填近章/)).toBeTruthy();
    expect(screen.queryByText("审计通过")).toBeNull();
  });
});

describe("memory.read 七栏 write profile", () => {
  it("展示核心角色/伏笔/近章上限与裁剪原因", () => {
    render(<>{renderToolResult({
      toolName: "memory.read",
      result: {
        renderer: "narrative-memory.read",
        data: {
          cards: [{ id: "c1", title: "韩立", channel: "state", brief: "抵达药园", reason: "点名实体", estimatedTokens: 12 }],
          diagnostics: { totalEstimatedTokens: 12, warnings: [], trimReasons: [{ id: "c2", reason: "核心角色超过上限 6。" }] },
          writeProfile: {
            locationAndTime: { title: "当前位置与故事时间", items: [{ title: "药园", summary: "入门第三日黄昏" }] },
            hardConstraints: { title: "硬约束", items: [{ title: "不得暴露小瓶" }] },
            coreCharacters: { title: "核心角色", items: [{ title: "韩立", named: true }], cap: 6, trimmed: 2, candidateCount: 8 },
            activeHooks: { title: "活跃伏笔", items: [{ title: "小瓶来历" }], cap: 8, trimmed: 0 },
            recentSummaries: { title: "近三章速记", items: [{ title: "第12章" }], cap: 3 },
            nextCommitments: { title: "下一章承诺", items: [{ title: "确认墨大夫是否察觉" }] },
            continuityRisks: { title: "连贯性风险", items: [] },
          },
        },
      },
    })}</>);

    expect(screen.getByTestId("write-profile")).toBeTruthy();
    expect(screen.getByText("核心角色")).toBeTruthy();
    expect(screen.getByText("1/6")).toBeTruthy();
    expect(screen.getByText("点名")).toBeTruthy();
    expect(screen.getByText(/裁剪原因/)).toBeTruthy();
  });
});

describe("scene.spec 点名实体", () => {
  it("展示 namedEntities", () => {
    render(<>{renderToolResult({
      toolName: "scene.spec",
      result: {
        renderer: "scene.spec",
        data: {
          sceneSpec: {
            chapter: 5,
            title: "雨夜",
            wordTarget: 3000,
            scenes: [{ characters: ["林舟"], location: "旧巷", conflict: "跟踪", mood: "紧绷", outcome: "锁定仓库", hooks_used: [], hooks_planted: [] }],
            constraints: [],
          },
          namedEntities: ["账本", "林舟"],
        },
      },
    })}</>);

    expect(screen.getByTestId("scene-spec-named-entities")).toBeTruthy();
    expect(screen.getByText(/点名实体：账本、林舟/)).toBeTruthy();
  });
});
