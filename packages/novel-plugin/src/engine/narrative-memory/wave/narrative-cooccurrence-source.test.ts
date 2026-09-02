import { describe, expect, it } from "vitest";

import type { EntityDictionary, EntityDictionaryEntry } from "../entity-dictionary";
import { expandEntityLookupKeys, stripParentheticalSuffix } from "../entity-dictionary";
import { bellGain, NOVEL_ENTITY_SEMANTIC_GAIN } from "./directed-cooccurrence";
import { buildCooccurrenceFromEvents, recordsFromEvents, resolveTag } from "./narrative-cooccurrence-source";

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

describe("resolveTag 别名归一", () => {
  const dictionary = dict([
    { id: "e1", title: "薛行之（主角·2026-08-29权威版）", aliases: ["薛行之"] },
    { id: "e2", title: "方工（最终职责版）" },
    { id: "e3", title: "陈默（权威合并版）" },
    { id: "e4", title: "陈砚秋（宋工团队·练气三层·坎水）" },
  ]);

  it("带括号装饰的全称归一到剥括号后的短名", () => {
    const hit = resolveTag(dictionary, "薛行之（主角·2026-08-29权威版）");
    expect(hit?.resolved).toBe(true);
    expect(hit?.tag).toBe("薛行之");
  });

  it("短名也能命中（aliases 已登记）", () => {
    const hit = resolveTag(dictionary, "薛行之");
    expect(hit?.resolved).toBe(true);
    expect(hit?.tag).toBe("薛行之");
  });

  it("「陈默」和「陈砚秋」不会被模糊合成一个（宁可漏并不可错并）", () => {
    const mo = resolveTag(dictionary, "陈默");
    const yan = resolveTag(dictionary, "陈砚秋");
    expect(mo?.tag).toBe("陈默");
    expect(yan?.tag).toBe("陈砚秋");
    expect(mo?.tag).not.toBe(yan?.tag);
  });

  it("整句话不当实体，返回 null", () => {
    expect(resolveTag(dictionary, "建立按项目结算的七天事故复核协作")).toBeNull();
    expect(resolveTag(dictionary, "陈默交付含原版文件、练习记录和私聊的旧手机")).toBeNull();
  });

  it("未命中但像实体的名字保留原文，标 unresolved", () => {
    const hit = resolveTag(dictionary, "刘斌");
    expect(hit?.resolved).toBe(false);
    expect(hit?.tag).toBe("刘斌");
  });

  it("无字典时仍能识别像实体的名字（降级路径）", () => {
    const hit = resolveTag(undefined, "薛行之");
    expect(hit?.resolved).toBe(false);
    expect(hit?.tag).toBe("薛行之");
  });

  it("事件短语和伏笔标题不进共现标签", () => {
    const withForeshadow = dict([
      { id: "e1", title: "薛行之（主角·权威版）" },
      { id: "f1", title: "B-17异常波形", category: "foreshadowing" },
    ]);
    expect(resolveTag(withForeshadow, "故事主线时间")).toBeNull();
    expect(resolveTag(withForeshadow, "李文彬对薛行之的旧怨")).toBeNull();
    expect(resolveTag(withForeshadow, "驻场体检")).toBeNull();
    expect(resolveTag(withForeshadow, "练气三层")).toBeNull();
    expect(resolveTag(withForeshadow, "B-17异常波形")).toBeNull();
    expect(resolveTag(withForeshadow, "四千二百元")).toBeNull();
    expect(resolveTag(withForeshadow, "薛行之")?.tag).toBe("薛行之");
  });
});

describe("recordsFromEvents 按章聚合", () => {
  const dictionary = dict([
    { id: "e1", title: "薛行之（主角·权威版）" },
    { id: "e2", title: "方工（最终职责版）" },
    { id: "e3", title: "沈遥（体制内数据研究员）" },
  ]);

  it("复合主体拆开后各自归一，同一章去重保序", () => {
    const { records, resolvedTags } = recordsFromEvents({
      dictionary,
      events: [
        { chapterNumber: 12, subject: "薛行之与方工", object: "建立协作" },
        { chapterNumber: 12, subject: "薛行之", object: "方工" },
        { chapterNumber: 13, subject: "沈遥", object: "薛行之" },
      ],
    });
    expect(records).toHaveLength(2);
    // 第 12 章：薛行之先于方工（subject 拆分顺序），去重后仍是这两个
    expect(records[0]!.tagIds).toEqual(["薛行之", "方工"]);
    expect(records[0]!.chapterNumber).toBe(12);
    expect(records[1]!.tagIds).toEqual(["沈遥", "薛行之"]);
    expect(resolvedTags).toBeGreaterThan(0);
  });

  it("P2 提及清单优先于事件 subject/object", () => {
    const mentions = new Map<number, readonly string[]>([[12, ["薛行之", "林薇", "方工"]]]);
    const { records } = recordsFromEvents({
      dictionary,
      events: [{ chapterNumber: 12, subject: "薛行之", object: "方工" }],
      mentionsByChapter: mentions,
    });
    expect(records[0]!.tagIds).toEqual(["薛行之", "林薇", "方工"]);
  });

  it("空输入不报错", () => {
    const { records } = recordsFromEvents({ events: [] });
    expect(records).toEqual([]);
  });
});

describe("buildCooccurrenceFromEvents 端到端", () => {
  const dictionary = dict([
    { id: "e1", title: "薛行之（主角·权威版）" },
    { id: "e2", title: "方工（最终职责版）" },
    { id: "e3", title: "薛建国（父亲·权威版）" },
  ]);

  it("归一后节点用 canonical 名，带括号的全称不再作为独立节点", () => {
    const { graph } = buildCooccurrenceFromEvents({
      dictionary,
      events: [
        { chapterNumber: 1, subject: "薛行之（主角·权威版）", object: "薛建国（父亲·权威版）" },
        { chapterNumber: 12, subject: "薛行之", object: "方工" },
        { chapterNumber: 15, subject: "薛行之与方工", object: "建立按项目结算的七天事故复核协作" },
      ],
    });
    const nodeIds = new Set(graph.edges.flatMap((edge) => [edge.source, edge.target]));
    expect(nodeIds).toEqual(new Set(["方工", "薛行之", "薛建国"]));
    // 全称形态不应作为独立节点出现
    expect([...nodeIds].some((id) => id.includes("权威版"))).toBe(false);
  });

  it("同场多次的边权高于偶现", () => {
    const { graph } = buildCooccurrenceFromEvents({
      dictionary,
      events: [
        { chapterNumber: 1, subject: "薛行之", object: "薛建国" },
        { chapterNumber: 2, subject: "薛行之", object: "薛建国" },
        { chapterNumber: 3, subject: "薛行之", object: "薛建国" },
        { chapterNumber: 12, subject: "薛行之", object: "方工" },
      ],
    });
    const toFather = graph.edges.find((edge) => edge.source === "薛行之" && edge.target === "薛建国");
    const toFang = graph.edges.find((edge) => edge.source === "薛行之" && edge.target === "方工");
    expect(toFather).toBeDefined();
    expect(toFang).toBeDefined();
    expect(toFather!.coCount).toBeGreaterThan(toFang!.coCount);
    expect(toFather!.weight).toBeGreaterThan(toFang!.weight);
  });

  it("有 similarity 时用小说标定参数调制边权", () => {
    const sim = (source: string, target: string) => {
      const pair = [source, target].sort().join("|");
      if (pair === "薛建国|薛行之") return 0.615;
      if (pair === "方工|薛行之") return 0.256;
      return 0.2;
    };
    const { graph } = buildCooccurrenceFromEvents({
      dictionary,
      events: [
        { chapterNumber: 1, subject: "薛行之", object: "薛建国" },
        { chapterNumber: 12, subject: "薛行之", object: "方工" },
      ],
      similarity: sim,
      useNovelGain: true,
    });
    expect(graph.edges.length).toBeGreaterThan(0);
    const span = bellGain(0.256, NOVEL_ENTITY_SEMANTIC_GAIN) - bellGain(0.615, NOVEL_ENTITY_SEMANTIC_GAIN);
    expect(Math.abs(span)).toBeGreaterThan(0.3);
  });
});
