import { describe, it, expect } from "vitest";
import { synthesizeAdversarialAudits, ADVERSARIAL_VIEW_DIMENSIONS, type AuditView } from "./adversarial-audit.js";
import type { AuditResult, AuditIssue } from "./continuity.js";

function issue(severity: "critical" | "warning" | "info", category: string, description: string): AuditIssue {
  return { severity, category, description, suggestion: "fix it" };
}

function view(issues: AuditIssue[], passed = true): AuditResult {
  return { passed, issues, summary: "" };
}

describe("synthesizeAdversarialAudits (P1-1 合成器)", () => {
  it("合并三视角 issue 并按严重度排序", () => {
    const r = synthesizeAdversarialAudits({
      continuity: view([issue("warning", "设定冲突", "A")]),
      narrative: view([issue("critical", "节奏检查", "B")]),
      text: view([issue("info", "文风检查", "C")]),
    });
    expect(r.issues).toHaveLength(3);
    expect(r.issues[0]!.severity).toBe("critical"); // 严重度排序：critical 在前
    expect(r.issues[2]!.severity).toBe("info");
  });

  it("有 critical 时 passed=false", () => {
    const r = synthesizeAdversarialAudits({
      continuity: view([issue("critical", "OOC检查", "崩人设")]),
      narrative: view([]),
      text: view([]),
    });
    expect(r.passed).toBe(false);
  });

  it("无 critical 时 passed=true", () => {
    const r = synthesizeAdversarialAudits({
      continuity: view([issue("warning", "x", "y")]),
      narrative: view([issue("info", "a", "b")]),
      text: view([]),
    });
    expect(r.passed).toBe(true);
  });

  it("同一问题去重，取更高严重度并计入需复核", () => {
    // 两个视角报同一问题（category+description 相同），但严重度不同
    const r = synthesizeAdversarialAudits({
      continuity: view([issue("warning", "数值检查", "灵石账目对不上")]),
      narrative: view([issue("critical", "数值检查", "灵石账目对不上")]),
      text: view([]),
    });
    expect(r.issues).toHaveLength(1); // 去重
    expect(r.issues[0]!.severity).toBe("critical"); // 取更高严重度
    expect(r.needsReviewCount).toBe(1); // 视角间分歧
    expect(r.passed).toBe(false);
  });

  it("完全相同严重度的重复问题只去重不计需复核", () => {
    const r = synthesizeAdversarialAudits({
      continuity: view([issue("warning", "文风检查", "句式单调")]),
      narrative: view([]),
      text: view([issue("warning", "文风检查", "句式单调")]),
    });
    expect(r.issues).toHaveLength(1);
    expect(r.needsReviewCount).toBe(0);
  });

  it("空审查结果 passed=true 无 issue", () => {
    const r = synthesizeAdversarialAudits({
      continuity: view([]), narrative: view([]), text: view([]),
    });
    expect(r.issues).toHaveLength(0);
    expect(r.passed).toBe(true);
  });

  it("视角维度分组无重叠且覆盖核心维度", () => {
    const all = new Set<number>();
    const dup: number[] = [];
    for (const v of Object.keys(ADVERSARIAL_VIEW_DIMENSIONS) as AuditView[]) {
      for (const id of ADVERSARIAL_VIEW_DIMENSIONS[v]) {
        if (all.has(id)) dup.push(id);
        all.add(id);
      }
    }
    expect(dup).toEqual([]); // 三视角维度不重叠
    // 覆盖关键维度：OOC(1)/数值(5)/伏笔(6)/节奏(7)/文风(8)/AI腔段落(20)
    for (const key of [1, 5, 6, 7, 8, 20]) expect(all.has(key)).toBe(true);
  });
});
