import { describe, expect, it } from "vitest";
import { assessBookAiTaste, normalizeAiTasteScore } from "./ai-taste-assessment.js";

describe("AI taste risk estimator", () => {
  it("normalizes local AI taste scores without claiming a generation ratio", () => {
    expect(normalizeAiTasteScore(0.1)).toBe(0.1);
    expect(normalizeAiTasteScore(0.7)).toBe(0.7);
    expect(normalizeAiTasteScore(1.5)).toBe(0.015);
  });

  it("accepts 0-100 scores", () => {
    expect(normalizeAiTasteScore(70)).toBe(0.7);
  });

  it("returns only local risk signals and rule provenance", () => {
    const report = assessBookAiTaste(
      "book-1",
      [
        { chapterNumber: 1, chapterTitle: "第一章", wordCount: 1000, aiTasteScore: 0.1 },
        { chapterNumber: 2, chapterTitle: "第二章", wordCount: 3000, aiTasteScore: 0.7 },
      ],
      "fanqie",
    );

    expect(report.totalWords).toBe(4000);
    expect(report.overallRiskLevel).toBe("high");
    expect(report.chapters[1]?.evidence).toMatchObject({
      ruleId: "ai-taste-heuristic",
      rulePackId: "AI_TASTE_RULE_PACK",
      severity: "high",
      chapterNumber: 2,
      message: expect.stringContaining("70/100"),
    });
    expect(report.rulePack).toMatchObject({ id: "AI_TASTE_RULE_PACK", confidence: "low" });
    expect(report.methodology).toContain("不估算 AI 生成比例");
    expect("platformThreshold" in report).toBe(false);
    expect("aiRatio" in report).toBe(false);
  });

  it("handles empty chapters safely", () => {
    const report = assessBookAiTaste("book-1", [], "generic");
    expect(report.totalWords).toBe(0);
    expect(report.overallRiskLevel).toBe("low");
  });
});
