import { describe, expect, it } from "vitest";
import { estimateBookAiRatio } from "../compliance/ai-ratio-estimator.js";
import { generateAiDisclosure } from "../compliance/ai-disclosure-generator.js";

describe("AI disclosure generator", () => {
  it("generates editable markdown disclosure", () => {
    const report = estimateBookAiRatio(
      "book-1",
      [{ chapterNumber: 1, chapterTitle: "第一章", wordCount: 1000, aiTasteScore: 0.5 }],
      "qimao",
    );

    const disclosure = generateAiDisclosure({
      bookId: "book-1",
      platform: "qimao",
      aiRatioReport: report,
      aiUsageTypes: ["大纲辅助", "校对"],
      modelNames: ["DeepSeek"],
      humanEditDescription: "作者逐章人工改写并定稿。",
    });

    expect(disclosure.markdownText).toContain("# AI 辅助使用说明");
    expect(disclosure.markdownText).toContain("大纲辅助、校对");
    expect(disclosure.markdownText).toContain("DeepSeek");
    expect(disclosure.markdownText).toContain("作者逐章人工改写并定稿");
  });

  it("uses safe defaults when logs are missing", () => {
    const report = estimateBookAiRatio("book-1", [], "generic");
    const disclosure = generateAiDisclosure({ bookId: "book-1", platform: "generic", aiRatioReport: report });

    expect(disclosure.aiUsageTypes.length).toBeGreaterThan(0);
    expect(disclosure.modelNames).toEqual(["未记录"]);
  });
});
