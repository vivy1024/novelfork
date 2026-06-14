import { describe, it, expect } from "vitest";
import { classifyGate, evaluateGate } from "./severity-gate.js";
import type { AuditIssue } from "./continuity.js";

function issue(severity: "critical" | "warning" | "info", category: string): AuditIssue {
  return { severity, category, description: "d", suggestion: "s" };
}

describe("severity-gate (P1-2 门禁分级)", () => {
  it("critical + 崩人设类别 → S1 致命", () => {
    expect(classifyGate(issue("critical", "OOC检查"))).toBe("S1");
    expect(classifyGate(issue("critical", "设定冲突"))).toBe("S1");
    expect(classifyGate(issue("critical", "正典事件一致性"))).toBe("S1");
  });

  it("critical + 其它类别 → S2 严重", () => {
    expect(classifyGate(issue("critical", "数值检查"))).toBe("S2");
    expect(classifyGate(issue("critical", "伏笔检查"))).toBe("S2");
  });

  it("warning → S3, info → S4", () => {
    expect(classifyGate(issue("warning", "节奏检查"))).toBe("S3");
    expect(classifyGate(issue("info", "文风检查"))).toBe("S4");
  });

  it("evaluateGate: 有 S1 → hasBlocking + hasRevisable", () => {
    const g = evaluateGate([issue("critical", "OOC检查"), issue("warning", "节奏检查")]);
    expect(g.hasBlocking).toBe(true);
    expect(g.hasRevisable).toBe(true);
    expect(g.counts).toEqual({ S1: 1, S2: 0, S3: 1, S4: 0 });
  });

  it("evaluateGate: 只有 S2 → 不阻断但可修订", () => {
    const g = evaluateGate([issue("critical", "数值检查")]);
    expect(g.hasBlocking).toBe(false);
    expect(g.hasRevisable).toBe(true);
    expect(g.counts.S2).toBe(1);
  });

  it("evaluateGate: 只有 S3/S4 → 既不阻断也不修订", () => {
    const g = evaluateGate([issue("warning", "x"), issue("info", "y")]);
    expect(g.hasBlocking).toBe(false);
    expect(g.hasRevisable).toBe(false);
  });

  it("evaluateGate: 空 → 全 0", () => {
    const g = evaluateGate([]);
    expect(g.hasBlocking).toBe(false);
    expect(g.hasRevisable).toBe(false);
    expect(g.counts).toEqual({ S1: 0, S2: 0, S3: 0, S4: 0 });
  });
});
