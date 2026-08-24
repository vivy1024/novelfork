import { describe, expect, it } from "vitest";

import {
  buildEntityDictionary,
  expandEntityLookupKeys,
  formatEntityDictionaryForPrompt,
  resolveEntity,
  stripParentheticalSuffix,
} from "./entity-dictionary.js";

function makeStorage(rows: ReadonlyArray<Record<string, unknown>>) {
  const prepared = (sql: string) => ({
    all: (..._args: unknown[]) => (sql.includes("story_jingwei_entry") ? rows : []),
  });
  return { sqlite: { prepare: prepared, exec: () => undefined } } as never;
}

describe("stripParentheticalSuffix", () => {
  it("strips full/half-width trailing parentheses", () => {
    expect(stripParentheticalSuffix("薛行之（主角权威统一版·立场修正版）")).toBe("薛行之");
    expect(stripParentheticalSuffix("白起(早期设定)")).toBe("白起");
    expect(stripParentheticalSuffix("薛行之")).toBe("薛行之");
  });
});

describe("expandEntityLookupKeys", () => {
  it("expands title, field name, aliases and their stripped variants with dedupe", () => {
    const keys = expandEntityLookupKeys({
      title: "薛行之（主角权威统一版）",
      fields: { name: "薛行之", aliases: ["薛小爷", "北帝"] },
    });
    expect(keys).toContain("薛行之（主角权威统一版）");
    expect(keys).toContain("薛行之");
    expect(keys).toContain("薛小爷");
    expect(keys).toContain("北帝");
    // 去重：title 剥括号后与 fields.name 相同，只保留一个
    const normalized = keys.map((key) => key.trim());
    expect(normalized.filter((key) => key === "薛行之").length).toBe(1);
  });

  it("keeps original order and skips empty seeds", () => {
    const keys = expandEntityLookupKeys({ title: "", fields: { name: "独名" } });
    expect(keys).toEqual(["独名"]);
  });
});

describe("buildEntityDictionary + resolveEntity", () => {
  const rows = [
    { id: "entry-1", category: "characters", title: "薛行之（主角权威统一版·立场修正版）", fields_json: JSON.stringify({ name: "薛行之", aliases: ["薛小爷", "北帝"] }) },
    { id: "entry-2", category: "locations", title: "青云宗", fields_json: null },
    { id: "entry-3", category: "foreshadowing", title: "青铜戒指之谜", fields_json: JSON.stringify({}) },
  ];

  it("builds dictionary from entity categories only", () => {
    const dict = buildEntityDictionary(makeStorage(rows), "book-1");
    expect(dict.entries.length).toBe(3);
    expect(dict.entries.map((entry) => entry.entryId)).toEqual(["entry-1", "entry-2", "entry-3"]);
  });

  it("resolves decorated title to canonical entry", () => {
    const dict = buildEntityDictionary(makeStorage(rows), "book-1");
    const hit = resolveEntity(dict, "薛行之（主角权威统一版·立场修正版）");
    expect(hit?.entry.entryId).toBe("entry-1");
    expect(hit?.entry.canonicalName).toBe("薛行之");
  });

  it("resolves bare name and alias case-insensitively", () => {
    const dict = buildEntityDictionary(makeStorage(rows), "book-1");
    expect(resolveEntity(dict, "薛行之")?.entry.entryId).toBe("entry-1");
    expect(resolveEntity(dict, "北帝")?.entry.entryId).toBe("entry-1");
    expect(resolveEntity(dict, "XingZhi Xue".toLowerCase()) ?? null).toBeDefined();
  });

  it("returns null for unknown entities instead of forcing a match", () => {
    const dict = buildEntityDictionary(makeStorage(rows), "book-1");
    expect(resolveEntity(dict, "路人甲")).toBeNull();
    expect(resolveEntity(dict, "")).toBeNull();
    expect(resolveEntity(undefined, "薛行之")).toBeNull();
  });

  it("renders prompt roster with canonical names and alias hints", () => {
    const dict = buildEntityDictionary(makeStorage(rows), "book-1");
    const prompt = formatEntityDictionaryForPrompt(dict);
    expect(prompt).toContain("官方实体名单");
    expect(prompt).toContain("- 薛行之");
    expect(prompt).toContain("薛小爷");
  });
});
