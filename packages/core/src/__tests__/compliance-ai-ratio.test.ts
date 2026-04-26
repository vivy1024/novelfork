import { describe, expect, it } from "vitest";
import { estimateBookAiRatio, estimateChapterAiRatio } from "../compliance/ai-ratio-estimator.js";

describe("AI ratio estimator", () => {
  it("maps AI taste score to coarse ratio bands", () => {
    expect(estimateChapterAiRatio(0.1)).toBe(0);
    expect(estimateChapterAiRatio(0.3)).toBe(0.1);
    expect(estimateChapterAiRatio(0.5)).toBe(0.3);
    expect(estimateChapterAiRatio(0.7)).toBe(0.5);
    expect(estimateChapterAiRatio(0.9)).toBe(0.7);
  });

  it("accepts 0-100 scores", () => {
    expect(estimateChapterAiRatio(70)).toBe(0.5);
  });

  it("estimates book ratio with word-count weighting", () => {
    const report = estimateBookAiRatio(
      "book-1",
      [
        { chapterNumber: 1, chapterTitle: "第一章", wordCount: 1000, aiTasteScore: 0.1 },
        { chapterNumber: 2, chapterTitle: "第二章", wordCount: 3000, aiTasteScore: 0.7 },
      ],
      "fanqie",
    );

    expect(report.totalWords).toBe(4000);
    expect(report.overallAiRatio).toBeCloseTo(0.375, 3);
    expect(report.overallLevel).toBe("danger");
    expect(report.methodology).toContain("粗略估算");
  });

  it("handles empty chapters safely", () => {
    const report = estimateBookAiRatio("book-1", [], "generic");

    expect(report.totalWords).toBe(0);
    expect(report.overallAiRatio).toBe(0);
  });
});
