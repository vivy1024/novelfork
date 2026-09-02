import { describe, expect, it } from "vitest";

import { expandEntityLookupKeys, stripParentheticalSuffix, type EntityDictionary, type EntityDictionaryEntry } from "./entity-dictionary.js";
import { collectChapterMentions, parseMentionedEntityNames, scanDictionaryMentions } from "./chapter-mention.js";

function dict(entries: Array<{ id: string; title: string; category?: string; aliases?: string[] }>): EntityDictionary {
  const built: EntityDictionaryEntry[] = [];
  const index = new Map<string, EntityDictionaryEntry>();
  for (const raw of entries) {
    const lookupKeys = expandEntityLookupKeys({
      title: raw.title,
      ...(raw.aliases ? { aliasColumn: raw.aliases } : {}),
    });
    const canonicalName = stripParentheticalSuffix(raw.title) || raw.title;
    const entry: EntityDictionaryEntry = {
      entryId: raw.id,
      category: raw.category ?? "characters",
      canonicalName,
      title: raw.title,
      lookupKeys,
    };
    built.push(entry);
    for (const key of lookupKeys) {
      const norm = key.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
      if (norm && !index.has(norm)) index.set(norm, entry);
    }
  }
  return { bookId: "book-1", entries: built, index };
}

describe("scanDictionaryMentions", () => {
  const dictionary = dict([
    { id: "e1", title: "薛行之（主角·权威版）", aliases: ["薛行之"] },
    { id: "e2", title: "林薇（甲方流程执行者）" },
    { id: "f1", title: "B-17异常波形", category: "foreshadowing" },
  ]);

  it("按正文首次出现位置排序，伏笔不进清单", () => {
    const mentions = scanDictionaryMentions("林薇先到。薛行之随后进门。B-17异常波形闪了一下。", dictionary);
    expect(mentions.map((item) => item.name)).toEqual(["林薇", "薛行之"]);
    expect(mentions[0]!.position).toBeLessThan(mentions[1]!.position);
    expect(mentions.every((item) => item.source === "dictionary")).toBe(true);
  });
});

describe("collectChapterMentions", () => {
  const dictionary = dict([
    { id: "e1", title: "薛行之（主角·权威版）" },
    { id: "e2", title: "方工（最终职责版）" },
  ]);

  it("字典扫描、事件、LLM 三路并集去重，事件短语丢弃", () => {
    const mentions = collectChapterMentions({
      content: "薛行之走进实验室。",
      dictionary,
      eventNames: ["薛行之与方工", "故事主线时间"],
      llmNames: ["方工", "练气三层"],
    });
    expect(mentions.map((item) => item.name)).toEqual(["薛行之", "方工"]);
  });
});

describe("parseMentionedEntityNames", () => {
  it("去空白去重", () => {
    expect(parseMentionedEntityNames(["薛行之", " 方工 ", "薛行之", 1, ""])).toEqual(["薛行之", "方工"]);
  });
});
