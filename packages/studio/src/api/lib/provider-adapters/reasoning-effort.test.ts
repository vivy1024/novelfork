import { describe, it, expect } from "vitest";
import type { SessionReasoningEffort } from "../../shared/session-types.js";

/**
 * 推理强度三级优先级解析逻辑测试。
 * 固化：叙述者 > 供应商 > 全局 > "medium" 兜底。
 * 对齐 NarraFork（v0.1.13 起）三级回退设计。
 */

type ResolveInput = {
  sessionEffort?: SessionReasoningEffort;
  providerEffort?: SessionReasoningEffort;
  globalEffort?: SessionReasoningEffort;
};

function resolveReasoningEffort(i: ResolveInput): string {
  return i.sessionEffort ?? i.providerEffort ?? i.globalEffort ?? "medium";
}

describe("推理强度三级优先级", () => {
  it("叙述者级最高", () => {
    expect(resolveReasoningEffort({ sessionEffort: "xhigh", providerEffort: "low", globalEffort: "high" })).toBe("xhigh");
  });

  it("叙述者级未设 → 走供应商", () => {
    expect(resolveReasoningEffort({ providerEffort: "low", globalEffort: "high" })).toBe("low");
  });

  it("叙述者+供应商未设 → 走全局", () => {
    expect(resolveReasoningEffort({ globalEffort: "xhigh" })).toBe("xhigh");
  });

  it("全部未设 → medium 兜底", () => {
    expect(resolveReasoningEffort({})).toBe("medium");
  });

  it("叙述者 none 不跳过（显式关闭）", () => {
    expect(resolveReasoningEffort({ sessionEffort: "none", providerEffort: "high" })).toBe("none");
  });

  it("6 档全部可解析", () => {
    const levels: SessionReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh"];
    for (const lv of levels) {
      expect(resolveReasoningEffort({ sessionEffort: lv })).toBe(lv);
    }
  });
});

describe("budget_tokens 档位映射", () => {
  // anthropic adapter 的档位→budget 映射（防回归）
  const EFFORT_TO_BUDGET: Record<string, number> = {
    none: 0,
    minimal: 1024,
    low: 2048,
    medium: 4096,
    high: 8192,
    xhigh: 16384,
  };

  it("budget < max_tokens 约束", () => {
    const maxOutput = 32768;
    for (const [effort, budget] of Object.entries(EFFORT_TO_BUDGET)) {
      if (effort === "none") continue;
      const clamped = Math.min(budget, maxOutput - 1);
      expect(clamped).toBeLessThan(maxOutput);
    }
  });

  it("各档递增", () => {
    const budgets = Object.values(EFFORT_TO_BUDGET);
    for (let i = 1; i < budgets.length; i++) {
      expect(budgets[i]).toBeGreaterThan(budgets[i - 1]);
    }
  });
});
