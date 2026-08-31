import { describe, it, expect } from "vitest";

import {
  generateMergeSuggestions,
  normalizeTitle,
  makeCanonicalKey,
  type MergeEntry,
} from "./merge-suggestions.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function entry(overrides: Partial<MergeEntry> & { id: string; title: string }): MergeEntry {
  return {
    bookId: "book-1",
    category: "characters",
    aliases: [],
    fields: {},
    relatedChapterNumbers: [],
    sourceRefs: [],
    isCanonical: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeTitle
// ---------------------------------------------------------------------------

describe("normalizeTitle", () => {
  it("strips whitespace, punctuation, brackets and lowercases", () => {
    expect(normalizeTitle("  韩 立  ")).toBe("韩立");
    expect(normalizeTitle("（韩立）")).toBe("韩立");
    expect(normalizeTitle("【韩立】")).toBe("韩立");
    expect(normalizeTitle("「韩立」")).toBe("韩立");
    expect(normalizeTitle("Han Li")).toBe("hanli");
  });

  it("applies NFKC normalization", () => {
    // ＨＡＮ (fullwidth) → HAN → han
    expect(normalizeTitle("ＨＡＮ")).toBe("han");
  });

  it("handles empty string", () => {
    expect(normalizeTitle("")).toBe("");
    expect(normalizeTitle("   ")).toBe("");
  });

  it("removes Chinese punctuation", () => {
    expect(normalizeTitle("韩立，字长生！")).toBe("韩立字长生");
  });
});

// ---------------------------------------------------------------------------
// makeCanonicalKey
// ---------------------------------------------------------------------------

describe("makeCanonicalKey", () => {
  it("creates category:normalizedTitle key", () => {
    expect(makeCanonicalKey("characters", "韩立")).toBe("characters:韩立");
    expect(makeCanonicalKey("characters", " Han Li ")).toBe("characters:hanli");
  });

  it("falls back to untitled for empty title", () => {
    expect(makeCanonicalKey("characters", "")).toBe("characters:untitled");
    expect(makeCanonicalKey("characters", "  ")).toBe("characters:untitled");
  });
});

// ---------------------------------------------------------------------------
// generateMergeSuggestions - empty / no matches
// ---------------------------------------------------------------------------

describe("generateMergeSuggestions", () => {
  it("returns empty result for empty input", () => {
    const result = generateMergeSuggestions([], { bookId: "book-1" });
    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(0);
  });

  it("returns all ungrouped when no duplicates", () => {
    const result = generateMergeSuggestions([
      entry({ id: "e1", title: "韩立" }),
      entry({ id: "e2", title: "南宫婉" }),
      entry({ id: "e3", title: "厉飞雨" }),
    ]);
    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(3);
  });

  // ---------------------------------------------------------------------------
  // bookId 硬隔离
  // ---------------------------------------------------------------------------

  it("does not merge entries from different books", () => {
    const result = generateMergeSuggestions([
      entry({ id: "e1", title: "韩立", bookId: "book-1" }),
      entry({ id: "e2", title: "韩立", bookId: "book-2" }),
    ], { bookId: "book-1" });
    expect(result.groups).toHaveLength(0);
    // only book-1 entries
    expect(result.ungrouped).toEqual(["e1"]);
  });

  // ---------------------------------------------------------------------------
  // 不同 category 不误合并
  // ---------------------------------------------------------------------------

  it("does not merge entries with different categories", () => {
    const result = generateMergeSuggestions([
      entry({ id: "e1", title: "火焰山", category: "locations" }),
      entry({ id: "e2", title: "火焰山", category: "props" }),
    ]);
    expect(result.groups).toHaveLength(0);
  });

  it("normalizes legacy categories before comparison", () => {
    const result = generateMergeSuggestions([
      entry({ id: "e1", title: "韩立", category: "character" }),
      entry({ id: "e2", title: "韩立", category: "characters" }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].category).toBe("characters");
  });

  // ---------------------------------------------------------------------------
  // exact title
  // ---------------------------------------------------------------------------

  it("matches exact title", () => {
    const result = generateMergeSuggestions([
      entry({ id: "e1", title: "韩立" }),
      entry({ id: "e2", title: "韩立" }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].score).toBeGreaterThanOrEqual(80);
    expect(result.groups[0].reasons.some((r) => r.reason === "exact-title")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // case-insensitive via normalized title
  // ---------------------------------------------------------------------------

  it("matches case-insensitively via normalized title", () => {
    const result = generateMergeSuggestions([
      entry({ id: "e1", title: "Han Li" }),
      entry({ id: "e2", title: "han li" }),
    ]);
    expect(result.groups).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // NFKC normalization
  // ---------------------------------------------------------------------------

  it("matches NFKC variants", () => {
    const result = generateMergeSuggestions([
      entry({ id: "e1", title: "ＨＡＮ" }), // fullwidth
      entry({ id: "e2", title: "HAN" }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].reasons.some(
      (r) => r.reason === "normalized-title" || r.reason === "exact-entry-key",
    )).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 括号/标点
  // ---------------------------------------------------------------------------

  it("matches after stripping brackets and punctuation", () => {
    const result = generateMergeSuggestions([
      entry({ id: "e1", title: "（韩立）" }),
      entry({ id: "e2", title: "韩立" }),
    ]);
    expect(result.groups).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // exact entryKey
  // ---------------------------------------------------------------------------

  it("matches exact entryKey", () => {
    const result = generateMergeSuggestions([
      entry({ id: "e1", title: "韩立A", entryKey: "characters:韩立" }),
      entry({ id: "e2", title: "韩立B", entryKey: "characters:韩立" }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].reasons.some((r) => r.reason === "exact-entry-key")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // title / alias 交叉命中
  // ---------------------------------------------------------------------------

  it("matches title ↔ alias cross-hit", () => {
    const result = generateMergeSuggestions([
      entry({ id: "e1", title: "韩立", aliases: ["长生真人"] }),
      entry({ id: "e2", title: "长生真人", aliases: [] }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].reasons.some((r) => r.reason === "title-alias-cross")).toBe(true);
  });

  it("matches alias ↔ alias cross-hit", () => {
    const result = generateMergeSuggestions([
      entry({ id: "e1", title: "韩立", aliases: ["长生真人"] }),
      entry({ id: "e2", title: "Han Li", aliases: ["长生真人"] }),
    ]);
    expect(result.groups).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // chapter-summaries 同 chapterNumber
  // ---------------------------------------------------------------------------

  it("matches chapter-summaries by chapterNumber", () => {
    const result = generateMergeSuggestions([
      entry({
        id: "e1",
        title: "第一章摘要",
        category: "chapter-summaries",
        fields: { chapterNumber: 1 },
      }),
      entry({
        id: "e2",
        title: "第1章概述",
        category: "chapter-summaries",
        fields: { chapterNumber: 1 },
      }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].reasons.some((r) => r.reason === "chapter-summary-same-chapter")).toBe(true);
  });

  it("does not match chapter-summaries with different chapters", () => {
    const result = generateMergeSuggestions([
      entry({
        id: "e1",
        title: "第一章摘要",
        category: "chapter-summaries",
        fields: { chapterNumber: 1 },
      }),
      entry({
        id: "e2",
        title: "第二章摘要",
        category: "chapter-summaries",
        fields: { chapterNumber: 2 },
      }),
    ]);
    expect(result.groups).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // relationships source/target/relationType
  // ---------------------------------------------------------------------------

  it("matches relationship by source + target", () => {
    const result = generateMergeSuggestions([
      entry({
        id: "e1",
        title: "林渊 × 苏晴",
        category: "relationships",
        fields: { sourceName: "林渊", targetName: "苏晴", relationType: "结盟" },
      }),
      entry({
        id: "e2",
        title: "林渊和苏晴",
        category: "relationships",
        fields: { sourceName: "林渊", targetName: "苏晴", relationType: "结盟" },
      }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].reasons.some((r) => r.reason === "relationship-key-match")).toBe(true);
  });

  it("matches relationship in reverse direction", () => {
    const result = generateMergeSuggestions([
      entry({
        id: "e1",
        title: "林渊 × 苏晴",
        category: "relationships",
        fields: { sourceName: "林渊", targetName: "苏晴", relationType: "师徒" },
      }),
      entry({
        id: "e2",
        title: "苏晴和林渊",
        category: "relationships",
        fields: { sourceName: "苏晴", targetName: "林渊", relationType: "师徒" },
      }),
    ]);
    expect(result.groups).toHaveLength(1);
  });

  it("scores higher when relationType also matches", () => {
    const withMatch = generateMergeSuggestions([
      entry({
        id: "e1",
        title: "A × B",
        category: "relationships",
        fields: { sourceName: "A", targetName: "B", relationType: "敌对" },
      }),
      entry({
        id: "e2",
        title: "A和B",
        category: "relationships",
        fields: { sourceName: "A", targetName: "B", relationType: "敌对" },
      }),
    ]);
    const withoutMatch = generateMergeSuggestions([
      entry({
        id: "e3",
        title: "A × B",
        category: "relationships",
        fields: { sourceName: "A", targetName: "B", relationType: "敌对" },
      }),
      entry({
        id: "e4",
        title: "A和B",
        category: "relationships",
        fields: { sourceName: "A", targetName: "B", relationType: "结盟" },
      }),
    ]);
    expect(withMatch.groups[0].score).toBeGreaterThan(withoutMatch.groups[0].score);
  });

  // ---------------------------------------------------------------------------
  // sourceRefs 重叠只能加分、不能单独触发
  // ---------------------------------------------------------------------------

  it("sourceRefs overlap alone does not trigger a merge", () => {
    const result = generateMergeSuggestions([
      entry({
        id: "e1",
        title: "完全不同的名称",
        sourceRefs: [{ chapterNumber: 1 }, { chapterNumber: 2 }],
      }),
      entry({
        id: "e2",
        title: "另一个名字",
        sourceRefs: [{ chapterNumber: 1 }, { chapterNumber: 3 }],
      }),
    ]);
    expect(result.groups).toHaveLength(0);
  });

  it("sourceRefs overlap adds bonus score to existing match", () => {
    const withRefs = generateMergeSuggestions([
      entry({
        id: "e1",
        title: "韩立",
        sourceRefs: [{ chapterNumber: 1 }, { chapterNumber: 2 }],
      }),
      entry({
        id: "e2",
        title: "韩立",
        sourceRefs: [{ chapterNumber: 1 }, { chapterNumber: 3 }],
      }),
    ]);
    const withoutRefs = generateMergeSuggestions([
      entry({ id: "e3", title: "韩立" }),
      entry({ id: "e4", title: "韩立" }),
    ]);
    expect(withRefs.groups[0].score).toBeGreaterThan(withoutRefs.groups[0].score);
    expect(withRefs.groups[0].reasons.some((r) => r.reason === "source-refs-overlap")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // survivor 选择
  // ---------------------------------------------------------------------------

  it("prefers canonical entry as survivor", () => {
    const result = generateMergeSuggestions([
      entry({ id: "candidate-1", title: "韩立", isCanonical: false }),
      entry({ id: "formal-1", title: "韩立", isCanonical: true }),
    ]);
    expect(result.groups[0].survivor).toBe("formal-1");
    expect(result.groups[0].duplicates).toEqual(["candidate-1"]);
  });

  // ---------------------------------------------------------------------------
  // 冲突字段原样报告
  // ---------------------------------------------------------------------------

  it("reports conflicting fields without choosing a value", () => {
    const result = generateMergeSuggestions([
      entry({ id: "e1", title: "韩立", fields: { gender: "男", age: 20 } }),
      entry({ id: "e2", title: "韩立", fields: { gender: "女", age: 20 } }),
    ]);
    expect(result.groups).toHaveLength(1);
    const genderConflict = result.groups[0].conflicts.find((c) => c.field === "gender");
    expect(genderConflict).toBeDefined();
    expect(genderConflict!.values).toHaveLength(2);
    expect(genderConflict!.values.map((v) => v.value)).toContain("男");
    expect(genderConflict!.values.map((v) => v.value)).toContain("女");
    // age=20 on both → no conflict
    expect(result.groups[0].conflicts.find((c) => c.field === "age")).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 多候选 requiresAuthorChoice
  // ---------------------------------------------------------------------------

  it("sets requiresAuthorChoice when multiple candidates", () => {
    const result = generateMergeSuggestions([
      entry({ id: "e1", title: "韩立", isCanonical: false }),
      entry({ id: "e2", title: "韩立", isCanonical: false }),
      entry({ id: "e3", title: "韩立", isCanonical: false }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].requiresAuthorChoice).toBe(true);
  });

  it("sets requiresAuthorChoice when conflicts exist", () => {
    const result = generateMergeSuggestions([
      entry({ id: "e1", title: "韩立", fields: { realm: "元婴期" } }),
      entry({ id: "e2", title: "韩立", fields: { realm: "化神期" } }),
    ]);
    expect(result.groups[0].requiresAuthorChoice).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // transitive grouping
  // ---------------------------------------------------------------------------

  it("groups transitively (A↔B, B↔C → single group)", () => {
    const result = generateMergeSuggestions([
      entry({ id: "e1", title: "韩立", aliases: ["小韩"] }),
      entry({ id: "e2", title: "小韩", aliases: ["长生真人"] }),
      entry({ id: "e3", title: "长生真人" }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].entries).toHaveLength(3);
  });

  // ---------------------------------------------------------------------------
  // threshold
  // ---------------------------------------------------------------------------

  it("respects custom threshold", () => {
    // normalized-title gives 60 points
    const low = generateMergeSuggestions([
      entry({ id: "e1", title: "（韩立）" }),
      entry({ id: "e2", title: "韩立" }),
    ], { threshold: 200 });
    expect(low.groups).toHaveLength(0);

    const high = generateMergeSuggestions([
      entry({ id: "e1", title: "（韩立）" }),
      entry({ id: "e2", title: "韩立" }),
    ], { threshold: 10 });
    expect(high.groups).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // groupKey 稳定性
  // ---------------------------------------------------------------------------

  it("produces stable groupKey regardless of input order", () => {
    const resultA = generateMergeSuggestions([
      entry({ id: "e1", title: "韩立" }),
      entry({ id: "e2", title: "韩立" }),
    ]);
    const resultB = generateMergeSuggestions([
      entry({ id: "e2", title: "韩立" }),
      entry({ id: "e1", title: "韩立" }),
    ]);
    expect(resultA.groups[0].groupKey).toBe(resultB.groups[0].groupKey);
  });

  // ---------------------------------------------------------------------------
  // does not perform writes
  // ---------------------------------------------------------------------------

  it("is a pure function with no side effects (returns readonly structures)", () => {
    const entries = [
      entry({ id: "e1", title: "韩立" }),
      entry({ id: "e2", title: "韩立" }),
    ];
    const before = JSON.stringify(entries);
    generateMergeSuggestions(entries);
    expect(JSON.stringify(entries)).toBe(before);
  });
});
