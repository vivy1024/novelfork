import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GenericToolResultRenderer, renderToolResult, resolveToolResultRendererKey } from "./registry";

afterEach(() => cleanup());

describe("tool-results registry", () => {
  it("只为已验证兼容的 Runtime renderer 启用专用卡", () => {
    expect(resolveToolResultRendererKey({ toolName: "cockpit.snapshot", result: { data: {} } })).toBe("cockpit");
    expect(resolveToolResultRendererKey({ toolName: "pipeline.write", result: { data: {} } })).toBe("pipeline");
    expect(resolveToolResultRendererKey({ toolName: "chapter.audit", result: { data: {} } })).toBe("generic");
    expect(resolveToolResultRendererKey({ toolName: "pgi.ask", result: { data: {} } })).toBe("generic");
    expect(resolveToolResultRendererKey({ toolName: "narrative.read_line", result: { data: {} } })).toBe("generic");
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
    ["tool-result-cockpit", "cockpit.snapshot", { renderer: "cockpit.snapshot", data: { bookTitle: "灵潮纪元", currentFocus: "第三章", risk: "低" } }, "当前焦点：第三章"],
    ["tool-result-pipeline", "pipeline.write", { renderer: "pipeline.chapter-result", data: { title: "第三章", chapterNumber: 3, auditPassed: true } }, "第3章 第三章"],
  ])("渲染 %s smoke card", (testId, toolName, result, expectedText) => {
    render(<>{renderToolResult({ toolName, result })}</>);

    expect(screen.getByTestId(testId)).toBeTruthy();
    expect(screen.getByText(expectedText)).toBeTruthy();
  });

  it("artifact 结果提供在画布打开动作", () => {
    const onOpenArtifact = vi.fn();
    const artifact = { kind: "chapter", id: "chapter:3", title: "第三章" };
    render(<>{renderToolResult({ toolName: "pipeline.write", result: { renderer: "pipeline.chapter-result", data: { title: "第三章" }, artifact }, onOpenArtifact })}</>);

    fireEvent.click(screen.getByRole("button", { name: "在画布打开" }));

    expect(onOpenArtifact).toHaveBeenCalledWith(artifact);
  });
});
