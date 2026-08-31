import { describe, expect, it } from "vitest";
import {
  chapterSummaryKey,
  deduplicateAliases,
  deduplicateSourceRefs,
  generateEntryKey,
  isValidSourceRef,
  mergeAliases,
  mergeSourceRefs,
  normalizeText,
  resolveEntryKey,
} from "./entry-identity.js";

describe("entry-identity", () => {
  it("normalizes spacing, casing, punctuation, and fullwidth chars", () => {
    expect(normalizeText("  Hello  World  ")).toBe("helloworld");
    expect(normalizeText("Ｈｅｌｌｏ")).toBe("hello");
    expect(normalizeText("测试（文本）")).toBe("测试文本");
  });

  it("generates ordinary and chapter-summary keys", () => {
    expect(generateEntryKey("characters", "张三")).toBe("characters:张三");
    expect(generateEntryKey("locations", "a".repeat(100))).toBe(`locations:${"a".repeat(48)}`);
    expect(generateEntryKey("chapter-summaries", "第12章", { chapterNumber: 12 })).toBe("chapter-summaries:chapter:12");
    expect(chapterSummaryKey(42)).toBe("chapter-summaries:chapter:42");
  });

  it("prefers explicit then existing keys so titles do not drift identity", () => {
    expect(resolveEntryKey({ entryKey: "custom:123", category: "a", title: "b" })).toBe("custom:123");
    expect(resolveEntryKey(
      { category: "new-cat", title: "new-title" },
      { entryKey: "old-cat:old-title" },
    )).toBe("old-cat:old-title");
    expect(resolveEntryKey({ category: "cat", title: "title" })).toBe("cat:title");
  });

  it("deduplicates aliases and source refs without inventing evidence", () => {
    expect(deduplicateAliases(["张三", " 张三 ", "李四", "张 三"], "张三")).toEqual(["李四"]);
    expect(mergeAliases(["a", "b"], ["b", " c "])).toEqual(["a", "b", "c"]);
    expect(isValidSourceRef({ chapterNumber: 1, excerpt: "a" })).toBe(true);
    expect(isValidSourceRef({ chapterNumber: 0, excerpt: "a" })).toBe(false);
    expect(isValidSourceRef({ chapterNumber: 0, excerpt: "file excerpt", path: "story/book_rules.md" })).toBe(true);
    expect(deduplicateSourceRefs([
      { chapterNumber: 2, excerpt: "b" },
      { chapterNumber: 1, excerpt: "a" },
      { chapterNumber: 2, excerpt: " b " },
    ])).toEqual([
      { chapterNumber: 2, excerpt: "b" },
      { chapterNumber: 1, excerpt: "a" },
    ]);
    expect(mergeSourceRefs(
      [{ chapterNumber: 1, excerpt: "a" }],
      [{ chapterNumber: 1, excerpt: "A" }, { chapterNumber: 2, excerpt: "b" }],
    )).toEqual([
      { chapterNumber: 1, excerpt: "a" },
      { chapterNumber: 2, excerpt: "b" },
    ]);
  });
});
