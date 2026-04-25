import { describe, expect, it } from "vitest";

import { createAliasMatcher, matchTrackedByAliases } from "../bible/context/alias-matcher.js";
import { resolveNestedRefs } from "../bible/context/nested-resolver.js";
import { filterEntriesVisibleAtChapter, isVisibleAtChapter, parseVisibilityRule } from "../bible/context/visibility-filter.js";

interface TestEntry {
  id: string;
  name: string;
  aliasesJson?: string;
  visibilityRuleJson: string;
  nestedRefsJson?: string;
  updatedAt?: Date;
}

describe("Bible visibility filter", () => {
  it("parses invalid rules as global instead of throwing", () => {
    expect(parseVisibilityRule("not-json")).toEqual({ type: "global" });
    expect(parseVisibilityRule(JSON.stringify({ type: "unknown" }))).toEqual({ type: "global" });
  });

  it("honors visibleAfterChapter and visibleUntilChapter boundaries", () => {
    const entry: TestEntry = {
      id: "setting-1",
      name: "天道规则",
      visibilityRuleJson: JSON.stringify({ type: "global", visibleAfterChapter: 3, visibleUntilChapter: 5 }),
    };

    expect(isVisibleAtChapter(entry, 2)).toBe(false);
    expect(isVisibleAtChapter(entry, 3)).toBe(true);
    expect(isVisibleAtChapter(entry, 5)).toBe(true);
    expect(isVisibleAtChapter(entry, 6)).toBe(false);
  });

  it("filters mixed entries without mutating input", () => {
    const entries: TestEntry[] = [
      { id: "early", name: "早期", visibilityRuleJson: JSON.stringify({ type: "global", visibleUntilChapter: 2 }) },
      { id: "current", name: "当前", visibilityRuleJson: JSON.stringify({ type: "tracked", visibleAfterChapter: 2 }) },
      { id: "future", name: "未来", visibilityRuleJson: JSON.stringify({ type: "global", visibleAfterChapter: 9 }) },
    ];

    expect(filterEntriesVisibleAtChapter(entries, 3).map((entry) => entry.id)).toEqual(["current"]);
    expect(entries.map((entry) => entry.id)).toEqual(["early", "current", "future"]);
  });
});

describe("Bible nested resolver", () => {
  it("resolves nested references breadth-first and protects cycles", () => {
    const entries: TestEntry[] = [
      { id: "a", name: "A", visibilityRuleJson: JSON.stringify({ type: "global" }), nestedRefsJson: JSON.stringify(["b"]) },
      { id: "b", name: "B", visibilityRuleJson: JSON.stringify({ type: "nested", parentIds: ["a"] }), nestedRefsJson: JSON.stringify(["c"]) },
      { id: "c", name: "C", visibilityRuleJson: JSON.stringify({ type: "nested", parentIds: ["b"] }), nestedRefsJson: JSON.stringify(["a"]) },
    ];

    expect(resolveNestedRefs([entries[0]!], entries, { maxDepth: 3 }).map((entry) => entry.id)).toEqual(["b", "c"]);
  });

  it("stops at maxDepth 3", () => {
    const entries: TestEntry[] = [
      { id: "a", name: "A", visibilityRuleJson: JSON.stringify({ type: "global" }), nestedRefsJson: JSON.stringify(["b"]) },
      { id: "b", name: "B", visibilityRuleJson: JSON.stringify({ type: "nested", parentIds: ["a"] }), nestedRefsJson: JSON.stringify(["c"]) },
      { id: "c", name: "C", visibilityRuleJson: JSON.stringify({ type: "nested", parentIds: ["b"] }), nestedRefsJson: JSON.stringify(["d"]) },
      { id: "d", name: "D", visibilityRuleJson: JSON.stringify({ type: "nested", parentIds: ["c"] }), nestedRefsJson: JSON.stringify(["e"]) },
      { id: "e", name: "E", visibilityRuleJson: JSON.stringify({ type: "nested", parentIds: ["d"] }), nestedRefsJson: "[]" },
    ];

    expect(resolveNestedRefs([entries[0]!], entries, { maxDepth: 3 }).map((entry) => entry.id)).toEqual(["b", "c", "d"]);
  });
});

describe("Bible alias matcher", () => {
  it("matches tracked entries by name or aliases in one scan", () => {
    const entries: TestEntry[] = [
      { id: "char-1", name: "韩立", aliasesJson: JSON.stringify(["韩老魔", "韩天尊"]), visibilityRuleJson: JSON.stringify({ type: "tracked" }) },
      { id: "event-1", name: "小瓶现世", aliasesJson: "[]", visibilityRuleJson: JSON.stringify({ type: "tracked" }) },
      { id: "setting-1", name: "灵根", aliasesJson: JSON.stringify(["伪灵根"]), visibilityRuleJson: JSON.stringify({ type: "tracked" }) },
    ];

    const matched = matchTrackedByAliases(entries, "韩老魔拿起小瓶现世留下的线索。");

    expect(matched.map((entry) => entry.id)).toEqual(["char-1", "event-1"]);
  });

  it("deduplicates overlapping alias hits by entry id", () => {
    const entries: TestEntry[] = [
      { id: "char-1", name: "韩立", aliasesJson: JSON.stringify(["韩老魔", "韩立"]), visibilityRuleJson: JSON.stringify({ type: "tracked" }) },
    ];

    const matcher = createAliasMatcher(entries);

    expect(matcher.match("韩立就是韩老魔").map((entry) => entry.id)).toEqual(["char-1"]);
  });

  it("scans 500 tracked entries and long scene text within the performance budget", () => {
    const entries: TestEntry[] = Array.from({ length: 500 }, (_, index) => ({
      id: `entry-${index}`,
      name: `条目${index}`,
      aliasesJson: JSON.stringify([`别名${index}`]),
      visibilityRuleJson: JSON.stringify({ type: "tracked" }),
    }));
    const sceneText = `${"无关文本".repeat(2500)} 别名333 ${"铺垫".repeat(2500)} 条目499`;

    const startedAt = performance.now();
    const matched = matchTrackedByAliases(entries, sceneText);
    const elapsedMs = performance.now() - startedAt;

    expect(matched.map((entry) => entry.id)).toEqual(["entry-333", "entry-499"]);
    expect(elapsedMs).toBeLessThan(50);
  });
});
