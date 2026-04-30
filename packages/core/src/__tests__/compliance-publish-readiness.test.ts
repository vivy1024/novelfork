import { describe, expect, it } from "vitest";
import { checkPublishReadiness } from "../compliance/publish-readiness.js";

describe("publish readiness", () => {
  it("aggregates sensitive scan, AI ratio, and format check", () => {
    const report = checkPublishReadiness(
      "book-1",
      "qidian",
      [
        { chapterNumber: 1, title: "第1章 开始", content: "法轮功" + "字".repeat(1200), aiTasteScore: 0.1 },
        { chapterNumber: 2, title: "第2章 转折", content: "字".repeat(1200), aiTasteScore: 0.7 },
      ],
      { synopsis: "简介" },
    );

    expect(report.sensitiveScan.totalBlockCount).toBeGreaterThan(0);
    expect(report.aiRatio.chapters[1]!.isAboveThreshold).toBe(true);
    expect(report.formatCheck.chapterCount).toBe(2);
    expect(report.status).toBe("blocked");
    expect(report.continuity.status).toBe("unknown");
    expect(report.continuity.reason).toContain("连续性");
  });

  it("returns ready when no block or warning exists", () => {
    const report = checkPublishReadiness(
      "book-1",
      "generic",
      [
        { chapterNumber: 1, title: "第1章 开始", content: "字".repeat(12_000), aiTasteScore: 0.1 },
        { chapterNumber: 2, title: "第2章 继续", content: "字".repeat(12_000), aiTasteScore: 0.1 },
      ],
      { synopsis: "简介" },
    );

    expect(report.totalBlockCount).toBe(0);
    expect(report.status).toBe("ready");
  });
});
