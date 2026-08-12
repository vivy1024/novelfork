import { describe, expect, it } from "vitest";
import { assessBookAiTaste } from "./ai-taste-assessment.js";
import { generateAiDisclosure } from "./ai-disclosure-generator.js";

describe("AI disclosure generator", () => {
  it("generates editable markdown disclosure without a fabricated ratio", () => {
    const report = assessBookAiTaste(
      "book-1",
      [{ chapterNumber: 1, chapterTitle: "第一章", wordCount: 1000, aiTasteScore: 0.5 }],
      "qimao",
    );

    const disclosure = generateAiDisclosure({
      bookId: "book-1",
      platform: "qimao",
      aiTasteReport: report,
      aiUsageTypes: ["大纲辅助", "校对"],
      modelNames: ["DeepSeek"],
      humanEditDescription: "作者逐章人工改写并定稿。",
    });

    expect(disclosure.markdownText).toContain("# AI 辅助使用说明");
    expect(disclosure.markdownText).toContain("大纲辅助、校对");
    expect(disclosure.markdownText).toContain("DeepSeek");
    expect(disclosure.markdownText).toContain("作者逐章人工改写并定稿");
    expect(disclosure.markdownText).toContain("本地 AI 味风险");
    expect(disclosure.markdownText).not.toContain("估算 AI 辅助比例");
  });

  it("uses safe defaults when logs are missing", () => {
    const report = assessBookAiTaste("book-1", [], "generic");
    const disclosure = generateAiDisclosure({ bookId: "book-1", platform: "generic", aiTasteReport: report });

    expect(disclosure.aiUsageTypes.length).toBeGreaterThan(0);
    expect(disclosure.modelNames).toEqual(["未记录"]);
  });
});
