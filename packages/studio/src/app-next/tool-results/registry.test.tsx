import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GenericToolResultRenderer, renderToolResult, resolveToolResultRendererKey } from "./registry";

afterEach(() => cleanup());

describe("tool-results registry", () => {
  it("预留 cockpit/questionnaire/pgi/guided/candidate/narrative renderer key", () => {
    expect(resolveToolResultRendererKey({ toolName: "cockpit.get_snapshot", result: { data: {} } })).toBe("cockpit");
    expect(resolveToolResultRendererKey({ toolName: "questionnaire.start", result: { data: {} } })).toBe("questionnaire");
    expect(resolveToolResultRendererKey({ toolName: "pgi.generate_questions", result: { data: {} } })).toBe("pgi");
    expect(resolveToolResultRendererKey({ toolName: "guided.exit", result: { data: {} } })).toBe("guided");
    expect(resolveToolResultRendererKey({ toolName: "candidate.create_chapter", result: { data: {} } })).toBe("candidate");
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
});
