import { describe, it, expect } from "vitest";
import { loadDictionary, scanChapter, scanBook } from "../compliance/sensitive-scanner.js";
import type { SensitiveWord } from "../compliance/types.js";

describe("platform compliance sensitive scanner", () => {
  it("loads common and platform seed dictionaries", () => {
    const dict = loadDictionary("qidian");

    expect(dict.some((w) => w.word === "法轮功")).toBe(true);
    expect(dict.some((w) => w.word === "AI生成")).toBe(true);
  });

  it("detects known words with context and severity", () => {
    const dict = loadDictionary("generic");
    const result = scanChapter("他在墙上看见法轮功三个字。", 1, "第一章", dict, "generic");

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.word).toBe("法轮功");
    expect(result.hits[0]!.severity).toBe("block");
    expect(result.hits[0]!.positions[0]!.context).toContain("【法轮功】");
  });

  it("keeps platform metadata when scanning a book", () => {
    const result = scanBook(
      [
        { chapterNumber: 1, title: "第一章", content: "正文很干净。" },
        { chapterNumber: 2, title: "第二章", content: "作者说求月票。" },
      ],
      "qidian",
    );

    expect(result.platform).toBe("qidian");
    expect(result.chapters[1]!.platform).toBe("qidian");
    expect(result.totalSuggestCount).toBeGreaterThan(0);
  });

  it("supports imported custom words", () => {
    const custom: SensitiveWord[] = [
      {
        word: "自定义禁词",
        category: "custom",
        severity: "warn",
        platforms: ["generic"],
        suggestion: "替换该词",
      },
    ];

    const dict = loadDictionary("generic", custom);
    const result = scanChapter("这里有一个自定义禁词。", 1, "第一章", dict, "generic");

    expect(result.hits.some((h) => h.word === "自定义禁词")).toBe(true);
  });
});
