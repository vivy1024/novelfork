/**
 * 轻量场景校验 S1：谓词归一、两个确定性检测器、「忽略此条」持久化、迁移 0041 双路径。
 *
 * 夹具全部走真实落库路径：经纬条目 → 事件（applyNarrativeEvents 派生事实）→ 实体索引刷新 → 检测。
 * 检测器只读刷新后的实体索引，与结算后自动检测同一条路径。
 */
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../jingwei/repositories/section-repo.js";
import { refreshNarrativeEntityIndex, rebuildNarrativeEntityIndex } from "../narrative-entity/entity-index.js";
import { runChapterSceneCheck, runConsistencyCheck } from "./consistency-detect.js";
import { applyNarrativeEvents } from "./reducer.js";
import { addConsistencyIgnore, firstSentenceMentioning, listConsistencyIgnores, removeConsistencyIgnore, runSceneChecks } from "./scene-check.js";
import { createScene } from "./scene-store.js";
import { narrativeFactSlotKey } from "./slot-key.js";
import { normalizeStateFact } from "./state-predicate.js";
import { ensureNarrativeMemorySchema, insertNarrativeEvent, queryNarrativeFactSlotHeads } from "./storage.js";
import type { NarrativeEvent, NarrativeEventType } from "./types.js";

const MIGRATIONS = { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") };
const BOOK = "book-1";
const now = new Date("2026-10-20T00:00:00.000Z");

let storage: StorageDatabase;
let tempDir: string;
const entryIds = new Map<string, string>();
let eventSeq = 0;

async function createStorage(): Promise<StorageDatabase> {
  tempDir = join(tmpdir(), `novelfork-scene-check-${crypto.randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  return createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
}

beforeEach(async () => {
  storage = await createStorage();
  runStorageMigrations(storage, MIGRATIONS);
  ensureNarrativeMemorySchema(storage);
  await createBookRepository(storage).create({ id: BOOK, name: "场景校验", jingweiMode: "dynamic", currentChapter: 3, createdAt: now, updatedAt: now });
  let order = 0;
  for (const key of ["characters", "locations"]) {
    await createStoryJingweiSectionRepository(storage).create({
      id: `sec-${key}`, bookId: BOOK, key, name: key, description: "", icon: null, order: order++, enabled: true,
      showInSidebar: true, participatesInAi: true, defaultVisibility: "tracked", fieldsJson: [], builtinKind: key,
      sourceTemplate: null, createdAt: now, updatedAt: now,
    });
  }
  entryIds.clear();
  eventSeq = 0;
  await entry("甲", "characters");
  await entry("乙", "characters");
  await entry("京城", "locations", ["京师"]);
  await entry("边关", "locations");
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

async function entry(title: string, category: string, aliases: string[] = []): Promise<void> {
  const created = await createStoryJingweiEntryRepository(storage).create({
    id: crypto.randomUUID(), bookId: BOOK, sectionId: `sec-${category}`, title, contentMd: "", category,
    fields: {}, customFields: {}, tags: [], aliases, relatedChapterNumbers: [], relatedEntryIds: [],
    visibilityRule: { type: "tracked" }, participatesInAi: true, tokenBudget: null, layer: "dynamic",
    status: "confirmed", createdAt: now, updatedAt: now,
  });
  entryIds.set(title, created.id);
}

/** 写一条事件并按结算的规则应用（status=pending 时只入库不应用）。 */
function event(chapter: number, eventType: NarrativeEventType, subject: string, predicate: string, object: string, evidence: string, status: "applied" | "pending" = "applied"): NarrativeEvent {
  eventSeq += 1;
  const record: NarrativeEvent = {
    id: `ev-${eventSeq}`,
    bookId: BOOK,
    chapterNumber: chapter,
    eventType,
    subject,
    predicate,
    object,
    evidenceText: evidence,
    confidence: 0.9,
    source: "settle",
    status: status === "applied" ? "applied" : "pending",
    riskLevel: "low",
    ...(entryIds.get(subject) ? { subjectEntryId: entryIds.get(subject) } : {}),
    createdAt: now.toISOString(),
  };
  insertNarrativeEvent(storage, record);
  if (status === "applied") {
    const result = applyNarrativeEvents(storage, BOOK, [record]);
    expect(result.failedEvents).toEqual([]);
  }
  return record;
}

function scene(chapter: number, location: string, characters: string[]): void {
  const created = createScene(storage, {
    bookId: BOOK, chapterNumber: chapter, summary: `[地点: ${location}] 场景`, characters, source: "workflow", status: "needs-review",
  });
  expect(created.ok).toBe(true);
}

function refresh(): void {
  const result = refreshNarrativeEntityIndex(storage, BOOK, { incremental: true });
  expect(result.ok).toBe(true);
}

const CH3_DEAD = "夜色沉沉。甲一掌拍碎了石桌，震得乙连退三步。";

describe("谓词归一", () => {
  it("同义谓词归到 生死 / 去向 / 所在 三个固定槽位", () => {
    for (const predicate of ["身亡", "阵亡", "殒命", "毙命", "死去", "断气", "死亡了"]) {
      expect(normalizeStateFact({ category: "character_state", predicate, object: "被一剑穿心" })).toEqual({ slot: "生死", category: "character_state", value: "死亡" });
    }
    expect(normalizeStateFact({ category: "character_state", predicate: "复活", object: "" })?.value).toBe("复活");
    expect(normalizeStateFact({ category: "character_state", predicate: "生死", object: "身亡" })?.value).toBe("死亡");
    for (const predicate of ["离开", "出走", "远行"]) {
      expect(normalizeStateFact({ category: "character_state", predicate, object: "京城" })).toEqual({ slot: "去向", category: "character_state", value: "离场" });
    }
    for (const predicate of ["归来", "返回"]) {
      expect(normalizeStateFact({ category: "character_state", predicate, object: "" })?.value).toBe("回归");
    }
    for (const predicate of ["位于", "身在", "到达", "抵达", "所在"]) {
      expect(normalizeStateFact({ category: "location", predicate, object: "边关" })).toEqual({ slot: "所在", category: "location", value: "边关" });
    }
    // 人物状态里写的「抵达」也归到位置类的「所在」槽，与 location_changed 互相覆盖。
    expect(normalizeStateFact({ category: "character_state", predicate: "抵达", object: "边关" })?.category).toBe("location");
    // 其余谓词不动。
    expect(normalizeStateFact({ category: "character_state", predicate: "境界", object: "筑基" })).toBeNull();
    expect(normalizeStateFact({ category: "relationship", predicate: "离开", object: "乙" })).toBeNull();
  });

  it("「复活」覆盖「身亡」：同一槽位，当前视图只剩新值", () => {
    const dead = { bookId: BOOK, category: "character_state", subject: "甲", predicate: "身亡", object: "" };
    const revived = { ...dead, predicate: "复活" };
    expect(narrativeFactSlotKey(dead)).toBe(narrativeFactSlotKey(revived));
    expect(narrativeFactSlotKey({ ...dead, category: "location", predicate: "位于", object: "京城" }))
      .toBe(narrativeFactSlotKey({ ...dead, category: "location", predicate: "抵达", object: "边关" }));

    event(2, "character_state_changed", "甲", "身亡", "死亡", "甲倒在血泊里，断了气。");
    event(4, "character_state_changed", "甲", "复活", "复活", "甲猛地睁开眼。");
    const heads = queryNarrativeFactSlotHeads(storage, { bookId: BOOK, categories: ["character_state"] });
    expect(heads.map((fact) => fact.predicate)).toEqual(["复活"]);
  });

  it("旧库存量事实：slot_key 按归一规则重算，状态流水方面与取值归一", () => {
    event(2, "character_state_changed", "甲", "阵亡", "死亡", "甲阵亡于城下。");
    // 模拟旧规则写下的 slot_key（主体 + 原谓词）。
    storage.sqlite.prepare("UPDATE narrative_fact SET slot_key = 'legacy' WHERE book_id = ?").run(BOOK);
    storage.close();
    storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
    ensureNarrativeMemorySchema(storage);
    const row = storage.sqlite.prepare<{ slot_key: string; category: string; subject: string; predicate: string; object: string }>(
      "SELECT slot_key, category, subject, predicate, object FROM narrative_fact WHERE book_id = ?",
    ).get(BOOK)!;
    expect(row.slot_key).toBe(narrativeFactSlotKey({ bookId: BOOK, ...row }));

    rebuildNarrativeEntityIndex(storage, BOOK);
    const state = storage.sqlite.prepare<{ fluent: string; new_value: string }>("SELECT fluent, new_value FROM narrative_state_change WHERE book_id = ?").all(BOOK);
    expect(state).toEqual([{ fluent: "生死", new_value: "死亡" }]);
  });
});

describe("死亡 / 离场后又行动", () => {
  it("正例：甲第 2 章身亡，第 3 章作为行动方出手", async () => {
    event(2, "character_state_changed", "甲", "身亡", "死亡", "甲倒在血泊里，断了气。");
    refresh();
    event(3, "relationship_changed", "甲", "击退", "乙", "甲一掌拍碎了石桌，震得乙连退三步。");
    refresh();

    const findings = await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => CH3_DEAD });
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding).toMatchObject({
      kind: "scene-dead-acts",
      entity: "甲",
      entityId: `ent:${BOOK}:${entryIds.get("甲")}`,
      chapterNumber: 3,
      evidenceText: "甲一掌拍碎了石桌，震得乙连退三步。",
      memoryChapter: 2,
      memoryValue: "死亡",
    });
    expect(finding!.factId).toMatch(/^event-fact:/u);
    expect(finding!.explanation.whatHappened).toContain("第 2 章");
    expect(finding!.explanation.whyItMatters).toBeTruthy();
    expect(finding!.explanation.suggestedAction).toContain("忽略此条");
  });

  it("「去向 = 离场」不触发：日常离开现场后再出手不报（离场不作为 S1 判据）", async () => {
    event(2, "character_state_changed", "甲", "出走", "离场", "甲连夜出走。");
    event(3, "relationship_changed", "甲", "击退", "乙", "甲一掌拍碎了石桌，震得乙连退三步。");
    refresh();
    expect(await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => CH3_DEAD })).toEqual([]);
  });

  it("死后被记为「存活」不算交代：本章「生死 = 存活」本身就是矛盾证据", async () => {
    event(2, "character_state_changed", "甲", "生死", "死亡", "甲倒在血泊里，断了气。");
    refresh();
    event(3, "character_state_changed", "甲", "生死", "存活", "甲一掌拍碎了石桌，震得乙连退三步。");
    refresh();
    const findings = await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => CH3_DEAD });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "scene-dead-acts", entity: "甲", memoryChapter: 2, evidenceText: "甲一掌拍碎了石桌，震得乙连退三步。" });
    expect(findings[0]!.explanation.whatHappened).toContain("存活");
  });

  it("「存活」之后下一章仍按死亡算：存活不解除死亡，只有复活解除", async () => {
    event(2, "character_state_changed", "甲", "生死", "死亡", "甲倒在血泊里，断了气。");
    event(3, "character_state_changed", "甲", "生死", "存活", "甲睁开眼。");
    event(4, "relationship_changed", "甲", "击退", "乙", "甲一掌拍碎了石桌，震得乙连退三步。");
    refresh();
    const findings = await runSceneChecks(storage, { bookId: BOOK, chapters: [4], loadChapterText: () => CH3_DEAD });
    expect(findings.map((finding) => [finding.chapterNumber, finding.memoryChapter])).toEqual([[4, 2]]);

    // 对照：第 3 章记的是「复活」，第 4 章出手不报。
    event(2, "character_state_changed", "乙", "生死", "死亡", "乙倒下。");
    event(3, "character_state_changed", "乙", "生死", "复活", "乙睁开眼。");
    event(4, "relationship_changed", "乙", "偷袭", "甲", "乙从背后偷袭。");
    refresh();
    const second = await runSceneChecks(storage, { bookId: BOOK, chapters: [4], loadChapterText: () => `${CH3_DEAD}乙从背后偷袭。` });
    expect(second.map((finding) => finding.entity)).toEqual(["甲"]);
  });

  it("证据只取行动类事件：以死者为主体的死因、状态、位置事件不算行动", async () => {
    event(2, "character_state_changed", "甲", "生死", "死亡", "甲倒在血泊里，断了气。");
    refresh();
    // 第 3 章：仵作验尸——死因（状态）、尸身运走（位置）、被动谓词的关系事件，都不是甲在行动。
    const ch3 = "仵作验过甲的尸身，说是一刀封喉。甲的尸身被抬去义庄。甲被乙追认为义兄。";
    event(3, "character_state_changed", "甲", "死因", "一刀封喉", "仵作验过甲的尸身，说是一刀封喉。");
    event(3, "location_changed", "甲", "所在", "京城", "甲的尸身被抬去义庄。");
    event(3, "relationship_changed", "甲", "被追认为义兄", "乙", "甲被乙追认为义兄。");
    refresh();
    expect(await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => ch3 })).toEqual([]);

    // 证据句里没有这个人，也不算他在行动。
    event(4, "relationship_changed", "甲", "击退", "乙", "震得乙连退三步。");
    refresh();
    expect(await runSceneChecks(storage, { bookId: BOOK, chapters: [4], loadChapterText: () => "震得乙连退三步。" })).toEqual([]);
  });

  it("反例：只被提及（回忆，乙是行动方）不报", async () => {
    event(2, "character_state_changed", "甲", "身亡", "死亡", "甲倒在血泊里，断了气。");
    event(3, "relationship_changed", "乙", "怀念", "甲", "乙想起甲生前的笑。");
    refresh();
    expect(await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => "乙想起甲生前的笑。" })).toEqual([]);
  });

  it("反例：本章有复活交代不报", async () => {
    event(2, "character_state_changed", "甲", "身亡", "死亡", "甲倒在血泊里，断了气。");
    event(3, "character_state_changed", "甲", "复活", "复活", "夜色沉沉。");
    event(3, "relationship_changed", "甲", "击退", "乙", "甲一掌拍碎了石桌，震得乙连退三步。");
    refresh();
    expect(await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => CH3_DEAD })).toEqual([]);
  });

  it("反例：待审事件不算（死亡待审、或行动待审）", async () => {
    event(2, "character_state_changed", "甲", "身亡", "死亡", "甲倒在血泊里，断了气。", "pending");
    event(3, "relationship_changed", "甲", "击退", "乙", "甲一掌拍碎了石桌，震得乙连退三步。");
    refresh();
    expect(await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => CH3_DEAD })).toEqual([]);

    event(2, "character_state_changed", "乙", "毙命", "死亡", "乙毙命。");
    event(3, "relationship_changed", "乙", "偷袭", "甲", "乙从背后偷袭。", "pending");
    refresh();
    expect(await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => "乙从背后偷袭。" })).toEqual([]);
  });

  it("反例：证据不是本章原文（核对不上）不报", async () => {
    event(2, "character_state_changed", "甲", "身亡", "死亡", "甲倒在血泊里，断了气。");
    event(3, "relationship_changed", "甲", "击退", "乙", "模型编造的一句话。");
    refresh();
    expect(await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => CH3_DEAD })).toEqual([]);
  });
});

describe("地点跳变无过渡", () => {
  const CH3 = "风沙扑面。甲站在城头，望着远处的烽烟。乙在一旁。";

  it("正例：第 2 章末在京城，第 3 章蓝图场景直接在边关", async () => {
    event(2, "location_changed", "甲", "抵达", "京城", "甲抵达京城。");
    scene(3, "边关", ["甲"]);
    refresh();
    const findings = await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => CH3 });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "scene-location-jump",
      entity: "甲",
      chapterNumber: 3,
      evidenceText: "甲站在城头，望着远处的烽烟。",
      memoryChapter: 2,
      memoryValue: "京城",
      sceneLocation: "边关",
    });
  });

  it("地点按实体字典归并：上一章写「京师」、本章场景「京城」不报", async () => {
    event(2, "location_changed", "甲", "位于", "京师", "甲身在京师。");
    scene(3, "京城", ["甲"]);
    refresh();
    expect(await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => CH3 })).toEqual([]);
  });

  it("反例：本章写明「三日后抵达」（有位置变化事件）不报，待审的位置变化也算交代", async () => {
    event(2, "location_changed", "甲", "抵达", "京城", "甲抵达京城。");
    scene(3, "边关", ["甲"]);
    event(3, "location_changed", "甲", "抵达", "边关", "三日后，甲抵达边关。");
    refresh();
    expect(await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => `三日后，甲抵达边关。${CH3}` })).toEqual([]);

    event(2, "location_changed", "乙", "抵达", "京城", "乙抵达京城。");
    scene(3, "边关", ["乙"]);
    event(3, "location_changed", "乙", "抵达", "边关", "乙也赶到了。", "pending");
    refresh();
    expect(await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => CH3 })).toEqual([]);
  });

  it("本章有「所在」记录但没有过渡标记照样报：那条记录就是跳变本身", async () => {
    event(2, "location_changed", "甲", "抵达", "京城", "甲抵达京城。");
    scene(3, "边关", ["甲"]);
    event(3, "location_changed", "甲", "所在", "边关", "甲站在城头，望着远处的烽烟。");
    refresh();
    const findings = await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => CH3 });
    expect(findings.map((finding) => [finding.kind, finding.entity, finding.memoryValue, finding.sceneLocation])).toEqual([["scene-location-jump", "甲", "京城", "边关"]]);
  });

  it("过渡标记写在位置记录前后（不在证据句里）也算过渡", async () => {
    event(2, "location_changed", "甲", "抵达", "京城", "甲抵达京城。");
    scene(3, "边关", ["甲"]);
    event(3, "location_changed", "甲", "所在", "边关", "甲站在城头，望着远处的烽烟。");
    refresh();
    expect(await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => `一路风沙，半月方至。${CH3}` })).toEqual([]);
  });

  it("没有带人物的场景时退回出场名单 + 本章首个「所在」判定章际跳变", async () => {
    // 正例：上一章京城，本章首个所在为边关，无过渡。
    event(2, "location_changed", "甲", "所在", "京城", "甲身在京城。");
    event(3, "location_changed", "甲", "所在", "边关", "甲站在城头，望着远处的烽烟。");
    refresh();
    const findings = await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => CH3 });
    expect(findings.map((finding) => [finding.kind, finding.entity, finding.memoryValue, finding.sceneLocation])).toEqual([["scene-location-jump", "甲", "京城", "边关"]]);
    expect(findings[0]!.detail).toContain("第 3 章记下 甲 在「边关」");

    // 反例：写了「三日后」；本章地点归并不到实体；没有场景也没有本章所在记录。
    const withTransition = await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => `三日后。${CH3}` });
    expect(withTransition).toEqual([]);
    event(2, "location_changed", "乙", "所在", "京城", "乙身在京城。");
    event(3, "location_changed", "乙", "所在", "某个小镇", "乙在一旁。");
    refresh();
    expect((await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => CH3 })).map((finding) => finding.entity)).toEqual(["甲"]);
  });

  it("不确定不报：上一章地点归并不到实体、正文里找不到人物、拿不到正文", async () => {
    event(2, "location_changed", "甲", "抵达", "某个小镇", "甲到了某个小镇。");
    scene(3, "边关", ["甲"]);
    refresh();
    expect(await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => CH3 })).toEqual([]);

    event(2, "location_changed", "乙", "抵达", "京城", "乙抵达京城。");
    scene(3, "边关", ["乙"]);
    refresh();
    expect(await runSceneChecks(storage, { bookId: BOOK, chapters: [3], loadChapterText: () => "风沙扑面。" })).toEqual([]);
    expect(await runSceneChecks(storage, { bookId: BOOK, chapters: [3] })).toEqual([]);
  });

  it("首句取人物任一称呼出现的第一句", () => {
    expect(firstSentenceMentioning("风起。\n小甲推门而入！随后甲坐下。", ["甲", "小甲"])).toBe("小甲推门而入！");
    expect(firstSentenceMentioning("风起。", ["甲"])).toBeNull();
  });
});

/**
 * 2026-10 真模型复验夹具（5 章，逐章结算，死亡事件已批准）。状态序列照抄当时模型实际抽出的结果：
 *   第 1 章 韩烈「去向 = 离场」（只是回宅子）；第 2 章「生死 = 死亡」，仵作验尸；
 *   第 3 章 韩烈「生死 = 存活」+「去向 = 离场」（死后拔剑出手，无复活交代）；
 *   第 4 章 卫青锋开头直接在雁门关（上章在京城、无过渡），回忆韩烈；
 *   第 5 章 韩烈「生死 = 复活」且有交代，卫青锋「三日后抵达京城」。
 */
describe("复验夹具：5 章真模型状态序列", () => {
  const TEXT: Record<number, string> = {
    1: "卫青锋在京城与韩烈分别。韩烈转身回了城南的宅子。",
    2: "韩烈死在宅中。仵作验过韩烈的尸身，说是一刀封喉。卫青锋在京城守了一夜灵。",
    3: "夜半，韩烈拔剑而起，一剑刺穿了刺客的咽喉。韩烈推门而去。卫青锋仍在京城。",
    4: "卫青锋立在雁门关的城楼上，看着关外的黄沙。卫青锋想起韩烈生前教他练剑的样子。",
    5: "原来韩烈当日服了假死药，被药王谷救回，复活后养了半月伤。韩烈提剑拦住了追兵。三日后，卫青锋抵达京城。",
  };

  async function seedFixture(withScenes: boolean): Promise<void> {
    await entry("韩烈", "characters");
    await entry("卫青锋", "characters");
    await entry("雁门关", "locations");
    // 第 1 章
    event(1, "character_state_changed", "韩烈", "去向", "离场", "韩烈转身回了城南的宅子。");
    event(1, "location_changed", "卫青锋", "所在", "京城", "卫青锋在京城与韩烈分别。");
    // 第 2 章：死亡（高风险，已批准即 applied），仵作验尸——以死者为主体的死因事件
    event(2, "character_state_changed", "韩烈", "生死", "死亡", "韩烈死在宅中。");
    event(2, "character_state_changed", "韩烈", "死因", "一刀封喉", "仵作验过韩烈的尸身，说是一刀封喉。");
    event(2, "location_changed", "卫青锋", "所在", "京城", "卫青锋在京城守了一夜灵。");
    // 第 3 章：模型把死后出手记成「存活」+「离场」
    event(3, "character_state_changed", "韩烈", "生死", "存活", "夜半，韩烈拔剑而起，一剑刺穿了刺客的咽喉。");
    event(3, "character_state_changed", "韩烈", "去向", "离场", "韩烈推门而去。");
    event(3, "location_changed", "卫青锋", "所在", "京城", "卫青锋仍在京城。");
    // 第 4 章：直接在雁门关；回忆韩烈（卫青锋是行动方）
    event(4, "location_changed", "卫青锋", "所在", "雁门关", "卫青锋立在雁门关的城楼上，看着关外的黄沙。");
    event(4, "relationship_changed", "卫青锋", "怀念", "韩烈", "卫青锋想起韩烈生前教他练剑的样子。");
    // 第 5 章：复活有交代，复活后出手；三日后抵达京城
    event(5, "character_state_changed", "韩烈", "生死", "复活", "原来韩烈当日服了假死药，被药王谷救回，复活后养了半月伤。");
    event(5, "relationship_changed", "韩烈", "拦截", "追兵", "韩烈提剑拦住了追兵。");
    event(5, "location_changed", "卫青锋", "所在", "京城", "三日后，卫青锋抵达京城。");
    if (withScenes) {
      scene(4, "雁门关", ["卫青锋"]);
      scene(5, "京城", ["卫青锋", "韩烈"]);
    }
    refresh();
  }

  async function findingsByChapter(): Promise<Array<[number, string, string]>> {
    const findings = await runSceneChecks(storage, { bookId: BOOK, loadChapterText: (chapter) => TEXT[chapter] });
    return findings.map((finding) => [finding.chapterNumber, finding.kind, finding.entity]);
  }

  for (const withScenes of [false, true]) {
    it(`7 行全部符合期望（${withScenes ? "带人物的蓝图场景" : "无场景，走出场名单 + 所在"}）`, async () => {
      await seedFixture(withScenes);
      const got = await findingsByChapter();
      // 行 1：第 3 章韩烈死后出手 → 报；行 2：第 3→4 章京城直接到雁门关 → 报。
      expect(got).toContainEqual([3, "scene-dead-acts", "韩烈"]);
      expect(got).toContainEqual([4, "scene-location-jump", "卫青锋"]);
      // 行 3：第 4 章回忆韩烈 → 不报；行 4：第 5 章复活且有交代 → 不报；
      // 行 5：第 5 章「三日后抵达京城」→ 不报；行 6/7：第 2 章仵作验尸、第 1 章回宅离场 → 不报。
      expect(got.filter(([chapter, kind]) => chapter === 4 && kind === "scene-dead-acts")).toEqual([]);
      expect(got.filter(([chapter]) => chapter === 5)).toEqual([]);
      expect(got.filter(([chapter]) => chapter <= 2)).toEqual([]);
      // 合起来恰好两处。
      expect(got).toHaveLength(2);
    });
  }
});

describe("过渡标记", () => {
  it("旅途 / 时间跨度标记命中，平常叙述不命中", async () => {
    const { hasTransitionMarker, transitionNear } = await import("./scene-check.js");
    for (const text of ["三日后，抵达边关。", "一路向北。", "他连夜出城。", "半月过去", "数日跋涉"]) expect(hasTransitionMarker(text)).toBe(true);
    for (const text of ["甲站在城头，望着远处的烽烟。", "风沙扑面。", "他想了三日。"]) expect(hasTransitionMarker(text)).toBe(false);
    expect(transitionNear("快马加鞭。甲站在城头。", "甲站在城头。")).toBe(true);
    // 标记远在窗口之外（前 80 字 / 后 40 字）不算。
    expect(transitionNear(`三日后。${"风".repeat(100)}甲站在城头。${"沙".repeat(60)}一路向北。`, "甲站在城头。")).toBe(false);
  });
});

describe("忽略此条", () => {
  async function seedDeadActs(): Promise<void> {
    event(2, "character_state_changed", "甲", "身亡", "死亡", "甲倒在血泊里，断了气。");
    event(3, "relationship_changed", "甲", "击退", "乙", "甲一掌拍碎了石桌，震得乙连退三步。");
    refresh();
  }

  it("忽略后体检与结算后检测都不再计入；撤销后恢复", async () => {
    await seedDeadActs();
    const loadChapterText = () => CH3_DEAD;
    const first = await runConsistencyCheck(storage, { bookId: BOOK, loadChapterText });
    expect(first.findings.map((finding) => finding.kind)).toEqual(["scene-dead-acts"]);
    const key = first.findings[0]!.ignoreKey!;
    expect(key).toEqual({ kind: "scene-dead-acts", entityId: `ent:${BOOK}:${entryIds.get("甲")}`, chapterNumber: 3, factId: first.findings[0]!.factId });
    expect((await runChapterSceneCheck(storage, { bookId: BOOK, chapterNumber: 3, content: CH3_DEAD })).summary).toBe("场景校验：发现 1 处可能矛盾，详见叙事体检。");

    addConsistencyIgnore(storage, BOOK, key);
    addConsistencyIgnore(storage, BOOK, key); // 幂等
    expect(listConsistencyIgnores(storage, BOOK)).toHaveLength(1);
    const after = await runConsistencyCheck(storage, { bookId: BOOK, loadChapterText });
    expect(after.findings).toEqual([]);
    expect(after.ignored).toHaveLength(1);
    expect(after.summary).toContain("另有 1 处已被你标为忽略");
    const settled = await runChapterSceneCheck(storage, { bookId: BOOK, chapterNumber: 3, content: CH3_DEAD });
    expect(settled).toMatchObject({ found: 0, ignored: 1 });

    expect(removeConsistencyIgnore(storage, BOOK, key)).toBe(true);
    expect((await runConsistencyCheck(storage, { bookId: BOOK, loadChapterText })).findings).toHaveLength(1);
  });

  it("他书的忽略记录不影响本书", async () => {
    await seedDeadActs();
    await createBookRepository(storage).create({ id: "book-2", name: "他书", jingweiMode: "dynamic", currentChapter: 1, createdAt: now, updatedAt: now });
    const key = (await runConsistencyCheck(storage, { bookId: BOOK, loadChapterText: () => CH3_DEAD })).findings[0]!.ignoreKey!;
    addConsistencyIgnore(storage, "book-2", key);
    expect((await runConsistencyCheck(storage, { bookId: BOOK, loadChapterText: () => CH3_DEAD })).findings).toHaveLength(1);
  });
});

describe("迁移 0041 双路径", () => {
  it("新库从零：0041 建出忽略表，主键与外键齐全", async () => {
    const fresh = createStorageDatabase({ databasePath: join(tempDir, "fresh.db") });
    try {
      expect(runStorageMigrations(fresh, MIGRATIONS).applied).toContain("0041_narrative_consistency_ignore.sql");
      expect(runStorageMigrations(fresh, MIGRATIONS).applied).toEqual([]);
      const columns = fresh.sqlite.prepare<{ name: string; pk: number }>("PRAGMA table_info(narrative_consistency_ignore)").all();
      expect(columns.filter((column) => column.pk > 0).map((column) => column.name)).toEqual(["book_id", "kind", "entity_id", "chapter_number", "fact_id"]);
      const fks = fresh.sqlite.prepare<{ table: string }>("PRAGMA foreign_key_list(narrative_consistency_ignore)").all();
      expect(fks.map((fk) => fk.table)).toEqual(["book"]);
    } finally {
      fresh.close();
    }
  });

  it("旧库升级（0040 时代、无忽略表）：只应用 0041，旧数据不动，之后可写入忽略", async () => {
    const old = createStorageDatabase({ databasePath: join(tempDir, "old.db") });
    try {
      runStorageMigrations(old, MIGRATIONS);
      await createBookRepository(old).create({ id: "b-old", name: "旧书", jingweiMode: "dynamic", currentChapter: 1, createdAt: now, updatedAt: now });
      old.sqlite.exec("DROP TABLE narrative_consistency_ignore");
      old.sqlite.prepare("DELETE FROM drizzle_migrations WHERE name = '0041_narrative_consistency_ignore.sql'").run();

      expect(runStorageMigrations(old, MIGRATIONS).applied).toEqual(["0041_narrative_consistency_ignore.sql"]);
      expect(old.sqlite.prepare<{ n: number }>("SELECT COUNT(*) AS n FROM book WHERE id = 'b-old'").get()!.n).toBe(1);
      addConsistencyIgnore(old, "b-old", { kind: "scene-location-jump", entityId: "ent:b-old:x", chapterNumber: 2, factId: "f" });
      expect(listConsistencyIgnores(old, "b-old")).toHaveLength(1);
      // 删书级联清掉裁决（外键 ON DELETE CASCADE）。
      old.sqlite.exec("PRAGMA foreign_keys = ON");
      old.sqlite.prepare("DELETE FROM book WHERE id = 'b-old'").run();
      expect(listConsistencyIgnores(old, "b-old")).toEqual([]);
    } finally {
      old.close();
    }
  });

  it("只走 ensureNarrativeMemorySchema 的库也有忽略表", async () => {
    const bare = createStorageDatabase({ databasePath: join(tempDir, "bare.db") });
    try {
      ensureNarrativeMemorySchema(bare);
      addConsistencyIgnore(bare, "b", { kind: "realm-drift", entityId: "", chapterNumber: 0, factId: "" });
      expect(listConsistencyIgnores(bare, "b")).toHaveLength(1);
    } finally {
      bare.close();
    }
  });
});
