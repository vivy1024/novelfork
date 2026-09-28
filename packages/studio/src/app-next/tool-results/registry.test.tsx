import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GenericToolResultRenderer, renderToolResult, resolveToolResultRendererKey } from "./registry";

afterEach(() => cleanup());

describe("tool-results registry", () => {
  it("只为已验证兼容的 Runtime renderer 启用专用卡", () => {
    expect(resolveToolResultRendererKey({ toolName: "cockpit.snapshot", result: { data: {} } })).toBe("cockpit");
    expect(resolveToolResultRendererKey({ toolName: "pipeline.write", result: { data: {} } })).toBe("pipeline");
    // 补了专属卡后，这些工具名也会解析到对应保留键（不再退回 generic）。
    expect(resolveToolResultRendererKey({ toolName: "chapter.audit", result: { data: {} } })).toBe("chapter-audit");
    // narrative.read_line 的 renderer 值是 "narrative.line"，工具名本身仍未登记，按名解析回落 generic。
    expect(resolveToolResultRendererKey({ toolName: "narrative.read_line", result: { data: {} } })).toBe("generic");
    expect(resolveToolResultRendererKey({ toolName: "narrative.read_line", result: { renderer: "narrative.line" } })).toBe("narrative");
  });

  it("result.renderer 优先于 toolName 且不会按前缀误匹配", () => {
    expect(resolveToolResultRendererKey({ toolName: "custom.wrapper", result: { renderer: "pipeline.chapter-result" } })).toBe("pipeline");
    expect(resolveToolResultRendererKey({ toolName: "pipeline.import_chapters", result: { renderer: "pipeline.import_chapters" } })).toBe("generic");
  });

  it("unknown fallback 保留 raw data", () => {
    const raw = { ok: true, nested: { value: "保留原始载荷" } };
    render(<GenericToolResultRenderer toolName="unknown.tool" result={raw} />);

    expect(screen.getByTestId("tool-result-generic")).toBeTruthy();
    expect(screen.getByText("unknown.tool")).toBeTruthy();
    expect(screen.getByText(/"value": "保留原始载荷"/)).toBeTruthy();
  });

  it("renderToolResult 为 unknown renderer 使用 generic fallback", () => {
    render(<>{renderToolResult({ toolName: "third.party", result: { renderer: "unknown.renderer", data: { hello: "world" } } })}</>);

    expect(screen.getByTestId("tool-result-generic")).toBeTruthy();
    expect(screen.getByText(/"hello": "world"/)).toBeTruthy();
  });

  it.each([
    ["tool-result-cockpit", "cockpit.snapshot", { renderer: "cockpit.snapshot", data: { book: { id: "b", title: "灵潮纪元", status: "active" }, progress: { chapterCount: 3, totalWords: 9000 } } }, "灵潮纪元"],
    ["tool-result-pipeline", "pipeline.write", { renderer: "pipeline.chapter-result", data: { title: "第三章", chapterNumber: 3, auditPassed: true } }, "第3章 第三章"],
  ])("渲染 %s smoke card", (testId, toolName, result, expectedText) => {
    render(<>{renderToolResult({ toolName, result })}</>);

    expect(screen.getByTestId(testId)).toBeTruthy();
    expect(screen.getByText(expectedText)).toBeTruthy();
  });

  it("驾驶舱卡片按快照结构显示进度、焦点、风险、伏笔，并可在画布打开近期章节", () => {
    const onOpenArtifact = vi.fn();
    const artifact = { id: "chapter:2", kind: "chapter", title: "第二章", renderer: "chapter.result", openInCanvas: true };
    render(<>{renderToolResult({
      toolName: "cockpit.snapshot",
      onOpenArtifact,
      result: {
        renderer: "cockpit.snapshot",
        data: {
          book: { id: "b", title: "青云剑录", status: "outlining" },
          progress: { status: "available", chapterCount: 2, targetChapters: 100, totalWords: 6100, chapterWordTarget: 3000 },
          currentFocus: { status: "available", content: "林砚入门试炼" },
          riskCards: { status: "available", items: [{ id: "r1", kind: "expired-hook", title: "伏笔超期", detail: "锈剑来历已 12 章未推进", level: "warning" }] },
          openHooks: { status: "available", items: [{ id: "h1", text: "锈剑来历", sourceChapter: 1, status: "open" }] },
          recentChapterResults: { status: "available", items: [{ id: "c2", chapterNumber: 2, title: "试剑", wordCount: 3000, artifact }] },
        },
      },
    })}</>);

    expect(screen.getByText("规划中")).toBeTruthy();
    expect(screen.getByText(/2 章 \/ 目标 100 章 · 共 6,100 字/)).toBeTruthy();
    expect(screen.getByText("林砚入门试炼")).toBeTruthy();
    expect(screen.getByText(/锈剑来历已 12 章未推进/)).toBeTruthy();
    expect(screen.getByText(/1 条（锈剑来历）/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "在画布打开" }));
    expect(onOpenArtifact).toHaveBeenCalledWith(artifact);
  });

  it("驾驶舱快照为空时给出缺省文案，不误报", () => {
    render(<>{renderToolResult({ toolName: "cockpit.snapshot", result: { renderer: "cockpit.snapshot", data: {} } })}</>);
    expect(screen.getByText("驾驶舱快照")).toBeTruthy();
    expect(screen.getByText("暂无风险提示")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "在画布打开" })).toBeNull();
  });

  it("artifact 结果提供在画布打开动作", () => {
    const onOpenArtifact = vi.fn();
    const artifact = { kind: "chapter", id: "chapter:3", title: "第三章" };
    render(<>{renderToolResult({ toolName: "pipeline.write", result: { renderer: "pipeline.chapter-result", data: { title: "第三章" }, artifact }, onOpenArtifact })}</>);

    fireEvent.click(screen.getByRole("button", { name: "在画布打开" }));

    expect(onOpenArtifact).toHaveBeenCalledWith(artifact);
  });

  it("也能从 Runtime data.artifact 提供画布打开动作", () => {
    const onOpenArtifact = vi.fn();
    const artifact = { kind: "chapter", id: "chapter:4", title: "第四章" };
    render(<>{renderToolResult({
      toolName: "pipeline.write",
      result: { renderer: "pipeline.chapter-result", data: { title: "第四章", artifact } },
      onOpenArtifact,
    })}</>);

    fireEvent.click(screen.getByRole("button", { name: "在画布打开" }));

    expect(onOpenArtifact).toHaveBeenCalledWith(artifact);
  });
});
