import { describe, expect, it } from "vitest";

import { AhoCorasickMatcher, loadFilterDictionary, tokenizeChineseText } from "../index.js";

describe("filter tokenizer", () => {
  it("splits Chinese text into paragraphs and sentences with offsets", () => {
    const tokens = tokenizeChineseText("韩立停下脚步。雨还在下！\n\n他说：走吧？");

    expect(tokens.paragraphs).toEqual([
      { text: "韩立停下脚步。雨还在下！", start: 0, end: 12 },
      { text: "他说：走吧？", start: 14, end: 20 },
    ]);
    expect(tokens.sentences.map((sentence) => sentence.text)).toEqual(["韩立停下脚步。", "雨还在下！", "他说：走吧？"]);
    expect(tokens.charCount).toBe(20);
  });

  it("handles empty and long text without throwing", () => {
    expect(tokenizeChineseText("")).toMatchObject({ charCount: 0, paragraphs: [], sentences: [] });
    const text = "凡人修仙。".repeat(2000);
    expect(tokenizeChineseText(text).sentences.length).toBe(2000);
  });
});

describe("AhoCorasickMatcher", () => {
  it("finds overlapping unicode keywords", () => {
    const matcher = new AhoCorasickMatcher(["值得注意", "值得注意的是", "注意"]);

    expect(matcher.search("但值得注意的是，雨声停了。")).toEqual([
      { keyword: "值得注意", start: 1, end: 5 },
      { keyword: "值得注意的是", start: 1, end: 7 },
      { keyword: "注意", start: 3, end: 5 },
    ]);
  });

  it("caches dictionaries by name", () => {
    const first = loadFilterDictionary("ai-vocabulary");
    const second = loadFilterDictionary("ai-vocabulary");

    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(5);
  });
});
