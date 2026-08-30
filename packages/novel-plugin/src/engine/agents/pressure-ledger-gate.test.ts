import { describe, expect, it } from "vitest";

import { detectPressureLedgerIssues } from "./pressure-ledger-gate.js";

describe("detectPressureLedgerIssues", () => {
  it("无证据结清会阻断", () => {
    const violations = detectPressureLedgerIssues({
      chapterNumber: 16,
      content: "薛行之把报告合上，转身离开实验室。",
      items: [{ id: "debt-1", kind: "debt", name: "实验债", status: "resolved", lastChapter: 16 }],
    });
    expect(violations.some((item) => item.severity === "error" && item.description.includes("没有对应证据"))).toBe(true);
  });

  it("状态倒退会阻断", () => {
    const violations = detectPressureLedgerIssues({
      chapterNumber: 18,
      content: "实验债又变回未结。",
      items: [{ id: "hook-1", kind: "hook", name: "实验债", status: "resolved", lastChapter: 16 }],
      delta: {
        chapter: 18,
        hookOps: {
          upsert: [{
            hookId: "hook-1",
            startChapter: 3,
            type: "实验债",
            status: "open",
            lastAdvancedChapter: 18,
            expectedPayoff: "",
            notes: "",
          }],
          mention: [],
          resolve: [],
          defer: [],
        },
        resourceOps: [],
      },
    });
    expect(violations.some((item) => item.severity === "error" && item.description.includes("状态倒退"))).toBe(true);
  });

  it("关键账目遗忘只警告", () => {
    const violations = detectPressureLedgerIssues({
      chapterNumber: 20,
      content: "薛行之继续做实验。",
      items: [{ id: "money-1", kind: "money", name: "项目经费", lastChapter: 8 }],
    });
    expect(violations.some((item) => item.severity === "warning" && item.description.includes("可能被遗忘"))).toBe(true);
    expect(violations.every((item) => item.severity !== "error")).toBe(true);
  });

  it("正文有证据的正常结清不报警", () => {
    const violations = detectPressureLedgerIssues({
      chapterNumber: 16,
      content: "薛行之当众把实验债的欠条撕掉，两人两清。",
      items: [{ id: "debt-1", kind: "debt", name: "实验债", status: "resolved", lastChapter: 16 }],
    });
    expect(violations).toEqual([]);
  });
});
