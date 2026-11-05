import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeChapterEventExtractor } from "./chapter-event-extractor.js";
import { persistNarrativeEvents } from "./events.js";
import { selectExtractorLedgerContext } from "./extractor-context.js";
import { upsertNarrativeFact } from "./facts.js";
import { queryCurrentNarrativeLedger } from "./ledger.js";
import { applyNarrativeEvents } from "./reducer.js";
import { narrativeFactSlotKey } from "./slot-key.js";
import { recomputeNarrativeStateSlots } from "./slot-recompute.js";
import { canonicalFactPredicate, canonicalizeStatePredicate, normalizeStateFact } from "./state-predicate.js";
import { replaceChapterMentions } from "./storage.js";
import type { NarrativeEvent, NarrativeFact } from "./types.js";
import { toOpenForeshadowSnapshots } from "../narrative-taxonomy/foreshadow-states.js";

const BOOK = "book-1";
const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-state-slot-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function event(input: Pick<NarrativeEvent, "id" | "eventType" | "subject" | "predicate" | "object" | "chapterNumber">): NarrativeEvent {
  return {
    ...input,
    bookId: BOOK,
    evidenceText: "证据",
    confidence: 0.9,
    source: "settle",
    status: "applied",
    riskLevel: "low",
    createdAt: "2026-07-01T00:00:00.000Z",
  };
}

function fact(partial: Partial<NarrativeFact> & Pick<NarrativeFact, "id" | "subject" | "predicate" | "object">): NarrativeFact {
  return {
    bookId: BOOK,
    category: "character_state",
    layer: "dynamic",
    confidence: 0.9,
    sourceType: "event",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...partial,
  };
}

function slotOf(category: string, predicate: string, object = "值", subject = "韩立"): string {
  return narrativeFactSlotKey({ bookId: BOOK, category, subject, predicate, object });
}

describe("受控状态谓词表", () => {
  it.each([
    ["location", "所在位置", "所在"],
    ["location", "本章所在位置", "所在"],
    ["location", "本章主要活动位置", "所在"],
    ["location", "当前所在地", "所在"],
    ["character_state", "到达", "所在"],
    ["character_state", "修为", "境界"],
    ["character_state", "修为境界", "境界"],
    ["character_state", "当前修为", "境界"],
    ["character_state", "目前境界", "境界"],
    ["character_state", "突破至", "境界"],
    ["character_state", "境界（突破后）", "境界"],
    ["character_state", "所属门派", "所属"],
    ["character_state", "加入宗门", "所属"],
    ["character_state", "当前阵营", "所属"],
    ["character_state", "职位", "身份"],
    ["character_state", "伤势状态", "伤势"],
    ["character_state", "本章情绪", "情绪"],
    ["character_state", "心理状态", "情绪"],
    ["character_state", "与墨大夫的关系", "与墨大夫的关系"],
    ["character_state", "和厉飞雨之间的关系", "与厉飞雨的关系"],
    ["character_state", "对南宫婉的态度", "对南宫婉的态度"],
    ["character_state", "身亡", "生死"],
    ["character_state", "离开", "去向"],
  ])("[%s] %s → %s", (category, predicate, slot) => {
    expect(canonicalizeStatePredicate({ category, predicate, object: "值" })?.slot).toBe(slot);
  });

  it.each([
    ["character_state", "青元轮测试结果"],
    ["character_state", "对标注工作性质的认识"],
    ["character_state", "账户余额"],
    ["character_state", "修"],
    ["character_state", "真实身份"],
    ["character_state", "处境状态"],
    ["relationship", "所在位置"],
    ["world_fact", "修为"],
  ])("[%s] %s 认不出，保持原样", (category, predicate) => {
    expect(canonicalizeStatePredicate({ category, predicate, object: "值" })).toBeNull();
    expect(canonicalFactPredicate({ category, predicate, object: "值" })).toBe(predicate);
  });

  it("只有取值在 object 里的槽才改写谓词；生死 / 持有 只并槽", () => {
    expect(canonicalFactPredicate({ category: "location", predicate: "本章所在位置", object: "药园" })).toBe("所在");
    expect(canonicalFactPredicate({ category: "character_state", predicate: "当前修为", object: "筑基" })).toBe("境界");
    expect(canonicalFactPredicate({ category: "character_state", predicate: "身亡", object: "被一剑穿心" })).toBe("身亡");
    expect(canonicalFactPredicate({ category: "character_state", predicate: "失去", object: "青铜镜" })).toBe("失去");
  });

  it("三类硬状态的旧接口不变，新槽位不进 normalizeStateFact", () => {
    expect(normalizeStateFact({ category: "location", predicate: "本章所在位置", object: "边关" })).toEqual({ slot: "所在", category: "location", value: "边关" });
    expect(normalizeStateFact({ category: "character_state", predicate: "境界", object: "筑基" })).toBeNull();
  });

  it("同一属性不同写法落在同一个槽；持有按物品分槽", () => {
    expect(slotOf("location", "所在位置")).toBe(slotOf("location", "本章主要活动位置"));
    expect(slotOf("location", "所在位置")).toBe(slotOf("character_state", "抵达"));
    expect(slotOf("character_state", "修为境界")).toBe(slotOf("character_state", "当前境界"));
    expect(slotOf("character_state", "修为境界")).not.toBe(slotOf("character_state", "青元轮测试结果"));
    expect(slotOf("character_state", "获得", "青铜镜")).toBe(slotOf("character_state", "失去", "青铜镜"));
    expect(slotOf("character_state", "获得", "青铜镜")).not.toBe(slotOf("character_state", "获得", "掌天瓶"));
    expect(slotOf("character_state", "与墨大夫的关系")).not.toBe(slotOf("character_state", "与厉飞雨的关系"));
  });
});

describe("同一属性换写法：结算后只留一个当前值", () => {
  it("所在位置 / 本章所在位置 / 本章主要活动位置 依次结算，台账只剩最新地点", async () => {
    const storage = await createStorage();
    try {
      const events = [
        event({ id: "e1", chapterNumber: 3, eventType: "location_changed", subject: "韩立", predicate: "所在位置", object: "七玄门" }),
        event({ id: "e2", chapterNumber: 5, eventType: "location_changed", subject: "韩立", predicate: "本章所在位置", object: "神手谷" }),
        event({ id: "e3", chapterNumber: 8, eventType: "location_changed", subject: "韩立", predicate: "本章主要活动位置", object: "药园" }),
        event({ id: "e4", chapterNumber: 9, eventType: "character_state_changed", subject: "韩立", predicate: "修为", object: "炼气三层" }),
        event({ id: "e5", chapterNumber: 12, eventType: "character_state_changed", subject: "韩立", predicate: "当前修为境界", object: "炼气五层" }),
      ];
      persistNarrativeEvents(storage, events);
      expect(applyNarrativeEvents(storage, BOOK, events).appliedEventIds).toHaveLength(5);

      const current = queryCurrentNarrativeLedger(storage, { bookId: BOOK, limit: 50 }).items;
      expect(current.map((item) => [item.predicate, item.object]).sort()).toEqual([["境界", "炼气五层"], ["所在", "药园"]]);

      const rows = storage.sqlite.prepare<{ object: string; valid_until_chapter: number | null }>(
        "SELECT object, valid_until_chapter FROM narrative_fact WHERE category = 'location' ORDER BY valid_from_chapter",
      ).all();
      // 不删行，旧值止于接替值的起点章。
      expect(rows).toEqual([
        { object: "七玄门", valid_until_chapter: 5 },
        { object: "神手谷", valid_until_chapter: 8 },
        { object: "药园", valid_until_chapter: null },
      ]);
    } finally {
      storage.close();
    }
  });

  it("重结算旧章：旧章的值不会关掉更晚的当前值，自己写入后即被收尾", async () => {
    const storage = await createStorage();
    try {
      const later = event({ id: "late", chapterNumber: 10, eventType: "location_changed", subject: "韩立", predicate: "所在", object: "药园" });
      persistNarrativeEvents(storage, [later]);
      applyNarrativeEvents(storage, BOOK, [later]);
      const earlier = event({ id: "early", chapterNumber: 4, eventType: "location_changed", subject: "韩立", predicate: "本章所在位置", object: "七玄门" });
      persistNarrativeEvents(storage, [earlier]);
      applyNarrativeEvents(storage, BOOK, [earlier]);

      const current = queryCurrentNarrativeLedger(storage, { bookId: BOOK }).items;
      expect(current.map((item) => item.object)).toEqual(["药园"]);
      const early = storage.sqlite.prepare<{ valid_until_chapter: number | null }>(
        "SELECT valid_until_chapter FROM narrative_fact WHERE object = '七玄门'",
      ).get();
      expect(early?.valid_until_chapter).toBe(10);
    } finally {
      storage.close();
    }
  });
});

describe("抽取器台账上下文按本章相关度挑选", () => {
  it("本章出场的老角色即使不在最近 120 条里，也会进 prompt", async () => {
    const storage = await createStorage();
    try {
      upsertNarrativeFact(storage, fact({
        id: "old-mo", subject: "墨大夫", predicate: "境界", object: "炼气十层",
        validFromChapter: 2, updatedAt: "2026-01-01T00:00:00.000Z",
      }));
      for (let index = 0; index < 200; index += 1) {
        upsertNarrativeFact(storage, fact({
          id: `noise-${index}`, subject: `路人${index}`, predicate: "情绪", object: "平静",
          validFromChapter: 100, updatedAt: `2026-07-01T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
        }));
      }

      const content = "夜里，墨大夫推门而入，笑意阴冷。";
      const oldWindow = queryCurrentNarrativeLedger(storage, { bookId: BOOK, limit: 120 }).items;
      expect(oldWindow.some((item) => item.subject === "墨大夫")).toBe(false);

      const selected = selectExtractorLedgerContext(storage, { bookId: BOOK, chapterNumber: 120, content });
      expect(selected.length).toBeLessThanOrEqual(120);
      expect(selected[0]).toMatchObject({ subject: "墨大夫", predicate: "境界", object: "炼气十层" });
      // 最近值的尾巴仍在，用来兜住正文里没认出的名字。
      expect(selected.filter((item) => item.subject.startsWith("路人")).length).toBeGreaterThan(0);
    } finally {
      storage.close();
    }
  });

  it("已记出场（重结算）也算相关实体；旧谓词以规范写法给抽取器看；上限可调", async () => {
    const storage = await createStorage();
    try {
      upsertNarrativeFact(storage, fact({ id: "f-loc", category: "location", subject: "厉飞雨", predicate: "本章所在位置", object: "七玄门", validFromChapter: 1, updatedAt: "2026-01-01T00:00:00.000Z" }));
      for (let index = 0; index < 30; index += 1) {
        upsertNarrativeFact(storage, fact({ id: `n-${index}`, subject: `路人${index}`, predicate: "情绪", object: "平静", validFromChapter: 5, updatedAt: "2026-07-01T00:00:00.000Z" }));
      }
      replaceChapterMentions(storage, BOOK, 9, [{ name: "厉飞雨", position: 0, source: "llm" }]);

      const selected = selectExtractorLedgerContext(storage, { bookId: BOOK, chapterNumber: 9, content: "他提刀而来。", limit: 10, recentTail: 3 });
      expect(selected).toHaveLength(10);
      expect(selected[0]).toMatchObject({ subject: "厉飞雨", predicate: "所在", object: "七玄门" });
    } finally {
      storage.close();
    }
  });

  it("伏笔清单：本章正文提到的伏笔排在上限之内", () => {
    const states = Array.from({ length: 80 }, (_, index) => ({
      entryId: `fs-${index}`, label: `伏笔${String(index).padStart(3, "0")}号`, phase: "planted" as const, setupChapter: index + 1,
    }));
    const snapshots = toOpenForeshadowSnapshots(states, { chapterContent: "他想起了伏笔077号留下的线索。" });
    expect(snapshots).toHaveLength(60);
    expect(snapshots[0]?.key).toBe("伏笔077号");
    expect(toOpenForeshadowSnapshots(states).some((item) => item.key === "伏笔077号")).toBe(false);
  });

  it("抽取 prompt 带上受控谓词清单与沿用台账谓词的要求", async () => {
    let systemPrompt = "";
    const runtime = createRuntimeChapterEventExtractor(async (request) => {
      systemPrompt = request.messages[0]!.content;
      return { text: '{"events":[],"mentionedEntities":[]}' };
    });
    await runtime({ bookId: BOOK, chapterNumber: 1, content: "正文" });
    expect(systemPrompt).toContain("所在（地点）");
    expect(systemPrompt).toContain("境界（修为 / 等级）");
    expect(systemPrompt).toContain("沿用台账里的 predicate 原样写");
  });
});

describe("存量书状态槽重算", () => {
  async function fixture(): Promise<StorageDatabase> {
    const storage = await createStorage();
    const rows: NarrativeFact[] = [
      fact({ id: "loc-1", category: "location", subject: "韩立", predicate: "所在位置", object: "七玄门", validFromChapter: 3 }),
      fact({ id: "loc-2", category: "location", subject: "韩立", predicate: "本章所在位置", object: "神手谷", validFromChapter: 5 }),
      fact({ id: "loc-3", category: "location", subject: "韩立", predicate: "本章主要活动位置", object: "药园", validFromChapter: 8 }),
      fact({ id: "realm-manual", subject: "韩立", predicate: "修为境界", object: "炼气一层", validFromChapter: 1, sourceType: "manual" }),
      fact({ id: "realm-machine", subject: "韩立", predicate: "当前修为", object: "炼气三层", validFromChapter: 6 }),
      fact({ id: "test-result", subject: "韩立", predicate: "青元轮测试结果", object: "甲等", validFromChapter: 2 }),
      fact({ id: "other", category: "location", subject: "厉飞雨", predicate: "位置", object: "七玄门", validFromChapter: 4 }),
    ];
    for (const row of rows) upsertNarrativeFact(storage, row);
    // 模拟旧规则写下的 slot_key：每个原谓词各占一个槽。
    storage.sqlite.prepare("UPDATE narrative_fact SET slot_key = 'legacy:' || id").run();
    return storage;
  }

  function openIds(storage: StorageDatabase): string[] {
    return storage.sqlite.prepare<{ id: string }>("SELECT id FROM narrative_fact WHERE valid_until_chapter IS NULL ORDER BY id").all().map((row) => row.id);
  }

  it("dryRun 只统计不写库", async () => {
    const storage = await fixture();
    try {
      const result = recomputeNarrativeStateSlots(storage, BOOK, { dryRun: true });
      expect(result).toMatchObject({ dryRun: true, scanned: 7, rekeyed: 7, collapsedSlots: 1, closed: 2, skippedManual: 1 });
      expect(result.samples).toEqual([{ subject: "韩立", kept: "本章主要活动位置：药园", closed: ["本章所在位置：神手谷", "所在位置：七玄门"] }]);
      expect(openIds(storage)).toHaveLength(7);
      const legacy = storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact WHERE slot_key LIKE 'legacy:%'").get();
      expect(legacy?.count).toBe(7);
    } finally {
      storage.close();
    }
  });

  it("apply 重算槽键并关闭被取代的旧值，不删行、作者手动值不被机器值盖掉；再跑一次无变化", async () => {
    const storage = await fixture();
    try {
      const result = recomputeNarrativeStateSlots(storage, BOOK);
      expect(result).toMatchObject({ dryRun: false, rekeyed: 7, closed: 2, skippedManual: 1 });
      expect(openIds(storage)).toEqual(["loc-3", "other", "realm-machine", "realm-manual", "test-result"]);
      const closed = storage.sqlite.prepare<{ id: string; valid_until_chapter: number }>(
        "SELECT id, valid_until_chapter FROM narrative_fact WHERE valid_until_chapter IS NOT NULL ORDER BY id",
      ).all();
      expect(closed).toEqual([{ id: "loc-1", valid_until_chapter: 5 }, { id: "loc-2", valid_until_chapter: 8 }]);
      expect(storage.sqlite.prepare<{ count: number }>("SELECT COUNT(*) AS count FROM narrative_fact").get()?.count).toBe(7);

      const again = recomputeNarrativeStateSlots(storage, BOOK);
      expect(again).toMatchObject({ rekeyed: 0, closed: 0, collapsedSlots: 0 });
    } finally {
      storage.close();
    }
  });
});
