import { describe, expect, it } from "vitest";
import { buildBudgetPressureNotice } from "./agent-turn-runtime.js";

describe("buildBudgetPressureNotice", () => {
  const CW = 200_000;

  it("低于 80% 不提示", () => {
    expect(buildBudgetPressureNotice(100_000, CW)).toBe(""); // 50%
    expect(buildBudgetPressureNotice(159_000, CW)).toBe(""); // 79.5%
  });

  it("80%~92% 软提示", () => {
    const notice = buildBudgetPressureNotice(160_000, CW); // 80%
    expect(notice).toContain("上下文已用 80%");
    expect(notice).toContain("尽快收尾");
    expect(notice).not.toContain("即将溢出");
  });

  it(">=92% 紧急提示", () => {
    const notice = buildBudgetPressureNotice(184_000, CW); // 92%
    expect(notice).toContain("上下文已用 92%");
    expect(notice).toContain("即将溢出");
    expect(notice).toContain("立即完成");
  });

  it("缺省/非法参数返回空串", () => {
    expect(buildBudgetPressureNotice(0, CW)).toBe("");
    expect(buildBudgetPressureNotice(100_000, 0)).toBe("");
    expect(buildBudgetPressureNotice(-1, CW)).toBe("");
    expect(buildBudgetPressureNotice(100_000, -1)).toBe("");
  });

  it("边界：恰好 80% 触发软提示，79% 不触发", () => {
    expect(buildBudgetPressureNotice(Math.ceil(CW * 0.80), CW)).toContain("尽快收尾");
    expect(buildBudgetPressureNotice(Math.floor(CW * 0.79), CW)).toBe("");
  });

  it("超过 100% 也按紧急处理", () => {
    const notice = buildBudgetPressureNotice(250_000, CW); // 125%
    expect(notice).toContain("即将溢出");
  });
});
