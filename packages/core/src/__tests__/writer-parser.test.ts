import { describe, it, expect } from "vitest";
import { WriterAgent } from "../agents/writer.js";
import type { WriteChapterOutput } from "../agents/writer.js";
import type { GenreProfile } from "../models/genre-profile.js";

const defaultGenreProfile: GenreProfile = {
  name: "测试",
  id: "test",
  chapterTypes: [],
  fatigueWords: [],
  numericalSystem: true,
  powerScaling: false,
  eraResearch: false,
  pacingRule: "",
  satisfactionTypes: [],
  auditDimensions: [],
};

/**
 * WriterAgent.parseOutput is private, so we access it via prototype to test
 * the extraction logic directly without needing to mock the full LLM pipeline.
 */
function callParseOutput(
  chapterNumber: number,
  content: string,
  genreProfile: GenreProfile = defaultGenreProfile,
): WriteChapterOutput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = WriterAgent.prototype as any;
  return proto.parseOutput.call(null, chapterNumber, content, genreProfile);
}

// ---------------------------------------------------------------------------
// Full tagged output
// ---------------------------------------------------------------------------

describe("WriterAgent parseOutput", () => {
  const fullOutput = [
    "=== PRE_WRITE_CHECK ===",
    "| 检查项 | 本章记录 | 备注 |",
    "|--------|----------|------|",
    "| 上下文范围 | 第1章 | |",
    "",
    "=== CHAPTER_TITLE ===",
    "吞天之始",
    "",
    "=== CHAPTER_CONTENT ===",
    "陈风站在悬崖边，俯视着脚下的万丈深渊。",
    "一股强烈的吸力从深渊中传来，仿佛有什么东西在召唤他。",
    "",
    "=== POST_SETTLEMENT ===",
    "| 结算项 | 本章记录 | 备注 |",
    "|--------|----------|------|",
    "| 资源账本 | 期初0 / 增量+100 / 期末100 | |",
    "",
    "=== UPDATED_STATE ===",
    "# 状态卡",
    "| 字段 | 值 |",
    "|------|-----|",
    "| 章节 | 1 |",
    "",
    "=== UPDATED_LEDGER ===",
    "# 资源账本",
    "| 章节 | 期初 | 来源 | 增量 | 期末 |",
    "|------|------|------|------|------|",
    "| 1 | 0 | 深渊果实 | +100 | 100 |",
    "",
    "=== UPDATED_HOOKS ===",
    "# 伏笔池",
    "| ID | 伏笔 | 状态 |",
    "|-----|------|------|",
    "| H001 | 深渊之物 | open |",
  ].join("\n");

  it("extracts all sections from a complete tagged output", () => {
    const result = callParseOutput(1, fullOutput);

    expect(result.chapterNumber).toBe(1);
    expect(result.title).toBe("吞天之始");
    expect(result.content).toContain("陈风站在悬崖边");
    expect(result.content).toContain("召唤他");
    expect(result.preWriteCheck).toContain("检查项");
    expect(result.postSettlement).toContain("资源账本");
    expect(result.updatedState).toContain("状态卡");
    expect(result.updatedLedger).toContain("深渊果实");
    expect(result.updatedHooks).toContain("H001");
  });

  it("calculates wordCount as the length of chapter content", () => {
    const result = callParseOutput(1, fullOutput);
    const expectedContent =
      "陈风站在悬崖边，俯视着脚下的万丈深渊。\n一股强烈的吸力从深渊中传来，仿佛有什么东西在召唤他。";
    expect(result.wordCount).toBe(expectedContent.length);
  });

  // -------------------------------------------------------------------------
  // Missing sections
  // -------------------------------------------------------------------------

  it("returns default title when CHAPTER_TITLE is missing", () => {
    const output = [
      "=== CHAPTER_CONTENT ===",
      "Some content here.",
    ].join("\n");

    const result = callParseOutput(42, output);
    expect(result.title).toBe("第42章");
  });

  it("returns empty content when CHAPTER_CONTENT is missing", () => {
    const output = [
      "=== CHAPTER_TITLE ===",
      "A Title",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.content).toBe("");
    expect(result.wordCount).toBe(0);
  });

  it("returns fallback strings for missing state sections", () => {
    const output = [
      "=== CHAPTER_TITLE ===",
      "Title",
      "",
      "=== CHAPTER_CONTENT ===",
      "Content.",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.updatedState).toBe("(状态卡未更新)");
    expect(result.updatedLedger).toBe("(账本未更新)");
    expect(result.updatedHooks).toBe("(伏笔池未更新)");
  });

  it("returns empty string for missing PRE_WRITE_CHECK", () => {
    const output = [
      "=== CHAPTER_TITLE ===",
      "Title",
      "",
      "=== CHAPTER_CONTENT ===",
      "Content.",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.preWriteCheck).toBe("");
  });

  it("returns empty string for missing POST_SETTLEMENT", () => {
    const output = [
      "=== CHAPTER_TITLE ===",
      "Title",
      "",
      "=== CHAPTER_CONTENT ===",
      "Content.",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.postSettlement).toBe("");
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it("handles completely empty input", () => {
    const result = callParseOutput(1, "");
    expect(result.chapterNumber).toBe(1);
    expect(result.title).toBe("第1章");
    expect(result.content).toBe("");
    expect(result.wordCount).toBe(0);
    expect(result.updatedState).toBe("(状态卡未更新)");
    expect(result.updatedLedger).toBe("(账本未更新)");
    expect(result.updatedHooks).toBe("(伏笔池未更新)");
  });

  it("handles content with no tags at all", () => {
    const result = callParseOutput(5, "Just some random text without tags");
    expect(result.title).toBe("第5章");
    expect(result.content).toBe("");
    expect(result.wordCount).toBe(0);
  });

  it("preserves multiline content within a section", () => {
    const output = [
      "=== CHAPTER_CONTENT ===",
      "第一段：这里是开头。",
      "",
      "第二段：这里是中间。",
      "",
      "第三段：这里是结尾。",
      "",
      "=== POST_SETTLEMENT ===",
      "No settlement.",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.content).toContain("第一段");
    expect(result.content).toContain("第二段");
    expect(result.content).toContain("第三段");
  });

  it("trims whitespace from extracted section values", () => {
    const output = [
      "=== CHAPTER_TITLE ===",
      "   吞天之始   ",
      "",
      "=== CHAPTER_CONTENT ===",
      "  内容  ",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.title).toBe("吞天之始");
    expect(result.content).toBe("内容");
  });

  it("correctly counts Chinese characters in wordCount", () => {
    const chineseContent = "这是一段测试文本，包含二十个中文字符加上标点符号。";
    const output = [
      "=== CHAPTER_CONTENT ===",
      chineseContent,
    ].join("\n");

    const result = callParseOutput(1, output);
    // wordCount is content.length which counts each character (including punctuation)
    expect(result.wordCount).toBe(chineseContent.length);
  });
});
