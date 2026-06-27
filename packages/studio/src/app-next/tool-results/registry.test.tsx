import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GenericToolResultRenderer, renderToolResult, resolveToolResultRendererKey } from "./registry";

afterEach(() => cleanup());

describe("tool-results registry", () => {
  it("预留 cockpit/questionnaire/pgi/guided/narrative renderer key", () => {
    expect(resolveToolResultRendererKey({ toolName: "cockpit.get_snapshot", result: { data: {} } })).toBe("cockpit");
    expect(resolveToolResultRendererKey({ toolName: "questionnaire.start", result: { data: {} } })).toBe("questionnaire");
    expect(resolveToolResultRendererKey({ toolName: "pgi.generate_questions", result: { data: {} } })).toBe("pgi");
    expect(resolveToolResultRendererKey({ toolName: "guided.exit", result: { data: {} } })).toBe("guided");
    expect(resolveToolResultRendererKey({ toolName: "narrative.audit", result: { data: {} } })).toBe("narrative");
  });

  it("result.renderer 优先于 toolName 推断", () => {
    expect(resolveToolResultRendererKey({ toolName: "custom.wrapper", result: { renderer: "guided.plan" } })).toBe("guided");
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
    ["tool-result-cockpit", "cockpit.get_snapshot", { renderer: "cockpit.snapshot", data: { bookTitle: "灵潮纪元", currentFocus: "第三章", risk: "低" } }, "当前焦点：第三章"],
    ["tool-result-questionnaire", "questionnaire.start", { renderer: "questionnaire.template", data: { title: "生成前问卷", questions: ["主角此章目标？"] } }, "主角此章目标？"],
    ["tool-result-pgi", "pgi.generate_questions", { renderer: "pgi.questions", data: { questions: ["伏笔是否回收？"], answers: ["先不回收"] } }, "伏笔是否回收？"],
    ["tool-result-guided", "guided.exit", { renderer: "guided.plan", data: { title: "第三章计划", steps: ["铺垫冲突", "进入章节结果"] } }, "铺垫冲突"],
    ["tool-result-narrative", "narrative.audit", { renderer: "narrative.line", data: { title: "叙事线快照", arcs: ["城门冲突"] } }, "城门冲突"],
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
