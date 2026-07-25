import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderToolResult } from "./registry";

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

    expect(screen.getByText(/仅预览，未写入经纬/)).toBeTruthy();
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

describe("publish.check 发布自检卡", () => {
  it("展示状态与四个维度计数", () => {
    render(<>{renderToolResult({
      toolName: "publish.check",
      result: {
        renderer: "compliance.publish-readiness",
        data: {
          ok: false,
          status: "blocked",
          platformLabel: "起点中文网",
          blockCount: 2,
          warnCount: 3,
          suggestCount: 1,
          checkedChapters: 12,
          report: {
            status: "blocked",
            aiRatio: { estimatedAiRatio: 0.42 },
            formatCheck: { passed: false },
            continuity: { passed: true },
          },
          notes: ["第 3 章命中敏感词"],
        },
      },
    })}</>);

    expect(screen.getByTestId("tool-result-publish-readiness")).toBeTruthy();
    expect(screen.getByText("不建议发布")).toBeTruthy();
    expect(screen.getByText("起点中文网")).toBeTruthy();
    expect(screen.getByText("已检 12 章")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText("格式：有问题")).toBeTruthy();
    expect(screen.getByText("连续性：通过")).toBeTruthy();
    expect(screen.getByText("第 3 章命中敏感词")).toBeTruthy();
  });

  it("ready 状态显示可以发布", () => {
    render(<>{renderToolResult({
      toolName: "publish.check",
      result: { renderer: "publish.check", data: { ok: true, status: "ready", blockCount: 0, warnCount: 0, suggestCount: 0 } },
    })}</>);

    expect(screen.getByText("可以发布")).toBeTruthy();
  });
});

describe("卡片健壮性", () => {
  it("载荷缺失时退回 generic 而不是崩", () => {
    for (const renderer of ["write.preflight", "book.dissect", "outline.volume", "publish.check"]) {
      cleanup();
      render(<>{renderToolResult({ toolName: renderer, result: { renderer, data: null } })}</>);
      expect(screen.getByTestId("tool-result-generic")).toBeTruthy();
    }
  });
});
