import { describe, expect, it } from "vitest";

import type { AuditIssue } from "./continuity.js";
import { isFactContinuityIssue, selectFactContinuityIssues } from "./severity-gate.js";

function issue(partial: Partial<AuditIssue> & Pick<AuditIssue, "severity" | "category">): AuditIssue {
  return {
    severity: partial.severity,
    category: partial.category,
    description: partial.description ?? "描述",
    suggestion: partial.suggestion ?? "建议",
  };
}

describe("isFactContinuityIssue", () => {
  it("matches critical lore, timeline, numeric and knowledge issues", () => {
    expect(isFactContinuityIssue(issue({ severity: "critical", category: "设定冲突" }))).toBe(true);
    expect(isFactContinuityIssue(issue({ severity: "critical", category: "时间线检查" }))).toBe(true);
    expect(isFactContinuityIssue(issue({ severity: "critical", category: "数值检查" }))).toBe(true);
    expect(isFactContinuityIssue(issue({ severity: "critical", category: "信息越界" }))).toBe(true);
    expect(isFactContinuityIssue(issue({ severity: "critical", category: "OOC检查" }))).toBe(true);
  });

  it("matches by description when category is generic", () => {
    expect(isFactContinuityIssue(issue({
      severity: "critical",
      category: "未分类",
      description: "与前文事实矛盾：韩立第 3 章已离开药园",
    }))).toBe(true);
  });

  it("ignores non-critical severities", () => {
    expect(isFactContinuityIssue(issue({ severity: "warning", category: "设定冲突" }))).toBe(false);
    expect(isFactContinuityIssue(issue({ severity: "info", category: "时间线检查" }))).toBe(false);
  });

  it("ignores critical issues unrelated to facts", () => {
    expect(isFactContinuityIssue(issue({
      severity: "critical",
      category: "节奏检查",
      description: "开篇节奏过缓",
    }))).toBe(false);
  });
});

describe("selectFactContinuityIssues", () => {
  it("returns only critical fact/continuity issues", () => {
    const selected = selectFactContinuityIssues([
      issue({ severity: "critical", category: "设定冲突" }),
      issue({ severity: "critical", category: "节奏检查", description: "节奏慢" }),
      issue({ severity: "warning", category: "时间线检查" }),
      issue({ severity: "critical", category: "时间线检查" }),
    ]);
    expect(selected).toHaveLength(2);
    expect(selected.map((item) => item.category)).toEqual(["设定冲突", "时间线检查"]);
  });
});
