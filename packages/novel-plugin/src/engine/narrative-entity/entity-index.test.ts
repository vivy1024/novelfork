import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "../jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../jingwei/repositories/section-repo.js";
import { ensureNarrativeMemorySchema } from "../narrative-memory/storage.js";
import { rebuildNarrativeEntityIndex, splitCompositeSubject } from "./entity-index.js";

let storage: StorageDatabase;
let tempDir: string;
const now = new Date("2026-09-01T00:00:00.000Z");
const iso = now.toISOString();

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-entity-index-${crypto.randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  ensureNarrativeMemorySchema(storage);
  await createBookRepository(storage).create({ id: "book-1", name: "实体索引", jingweiMode: "dynamic", currentChapter: 1, createdAt: now, updatedAt: now });
  let order = 0;
  for (const key of ["characters", "locations", "foreshadowing"]) {
    await createStoryJingweiSectionRepository(storage).create({
      id: `sec-${key}`, bookId: "book-1", key, name: key, description: "", icon: null, order: order++, enabled: true,
      showInSidebar: true, participatesInAi: true, defaultVisibility: "tracked", fieldsJson: [], builtinKind: key,
      sourceTemplate: null, createdAt: now, updatedAt: now,
    });
  }
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

async function entry(title: string, category: string, aliases: string[] = []) {
  return createStoryJingweiEntryRepository(storage).create({
    id: crypto.randomUUID(), bookId: "book-1", sectionId: `sec-${category}`, title, contentMd: "", category,
    fields: {}, customFields: {}, tags: [], aliases, relatedChapterNumbers: [], relatedEntryIds: [],
    visibilityRule: { type: "tracked" }, participatesInAi: true, tokenBudget: null, layer: "dynamic",
    status: "confirmed", createdAt: now, updatedAt: now,
  });
}

function event(id: string, chapter: number, subject: string, object: string, status = "applied", subjectEntryId: string | null = null, eventType = "relationship_changed") {
  storage.sqlite.prepare(`
    INSERT INTO narrative_event (id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text,
      confidence, source, status, risk_level, subject_entry_id, object_entry_id, created_at)
    VALUES (?, 'book-1', ?, ?, ?, '相遇', ?, '证据', 0.9, 'settle', ?, 'low', ?, NULL, ?)
  `).run(id, chapter, eventType, subject, object, status, subjectEntryId, iso);
}

function fact(id: string, chapter: number, subject: string, predicate: string, object: string, category: string, validUntil: number | null = null) {
  storage.sqlite.prepare(`
    INSERT INTO narrative_fact (id, book_id, subject, predicate, object, category, layer, confidence, source_type,
      source_chapter, evidence_text, valid_from_chapter, valid_until_chapter, created_at, updated_at)
    VALUES (?, 'book-1', ?, ?, ?, ?, 'dynamic', 0.8, 'event', ?, '原文证据', ?, ?, ?, ?)
  `).run(id, subject, predicate, object, category, chapter, chapter, validUntil, iso, iso);
}

const count = (table: string) => storage.sqlite.prepare<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE book_id = 'book-1'`).get()!.n;

describe("splitCompositeSubject", () => {
  it("拆开「甲与乙」，描述性短语整体保留", () => {
    expect(splitCompositeSubject("薛行之与方工")).toEqual({ names: ["薛行之", "方工"], composite: true });
    expect(splitCompositeSubject("薛行之（主角）")).toEqual({ names: ["薛行之（主角）"], composite: false });
    expect(splitCompositeSubject("旧城与新城之间的封锁风险")).toMatchObject({ composite: false });
  });
});

describe("rebuildNarrativeEntityIndex", () => {
  it("实体只来自经纬条目；复合主体拆成两个参与者，不造复合实体", async () => {
    const xue = await entry("薛行之（主角权威版）", "characters", ["薛小爷"]);
    const fang = await entry("方工", "characters");
    await entry("青云山", "locations");
    await entry("铜戒指", "foreshadowing");
    event("ev-1", 3, "薛行之与方工", "青云山");
    event("ev-2", 4, "薛小爷", "铜戒指");
    event("ev-3", 5, "路人甲", "方工", "rejected");

    const result = rebuildNarrativeEntityIndex(storage, "book-1", { now: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entities).toBe(3);

    const names = storage.sqlite.prepare<{ canonical_name: string; entry_id: string; id: string }>(
      "SELECT canonical_name, entry_id, id FROM narrative_entity WHERE book_id = 'book-1' ORDER BY canonical_name",
    ).all();
    expect(names.map((row) => row.canonical_name).sort()).toEqual(["方工", "薛行之", "青云山"].sort());
    expect(names.find((row) => row.canonical_name === "薛行之")!.id).toBe(`ent:book-1:${xue.id}`);
    // 没有「薛行之与方工」这种复合实体
    expect(names.some((row) => row.canonical_name.includes("与"))).toBe(false);

    const participants = storage.sqlite.prepare<{ event_id: string; entity_id: string; role: string }>(
      "SELECT event_id, entity_id, role FROM narrative_event_participant WHERE book_id = 'book-1' ORDER BY event_id, role, entity_id",
    ).all();
    const ev1 = participants.filter((row) => row.event_id === "ev-1");
    // 主体「薛行之与方工」拆成两个 agent，客体「青云山」一个 patient
    expect(ev1.filter((row) => row.role === "agent").map((row) => row.entity_id).sort())
      .toEqual([`ent:book-1:${xue.id}`, `ent:book-1:${fang.id}`].sort());
    expect(ev1.filter((row) => row.role === "patient")).toHaveLength(1);
    // 别名「薛小爷」归到同一人；伏笔称呼不当实体
    expect(participants.filter((row) => row.event_id === "ev-2")).toEqual([{ event_id: "ev-2", entity_id: `ent:book-1:${xue.id}`, role: "agent" }]);
    expect(result.foreshadowMentions).toBe(1);
    // 驳回的事件不产生参与者
    expect(participants.some((row) => row.event_id === "ev-3")).toBe(false);

    const xueRow = storage.sqlite.prepare<{ first_chapter: number; last_chapter: number }>(
      "SELECT first_chapter, last_chapter FROM narrative_entity WHERE id = ?",
    ).get(`ent:book-1:${xue.id}`)!;
    expect(xueRow).toEqual({ first_chapter: 3, last_chapter: 4 });
  });

  it("关系事实按实体 id 建边并带有效期；状态事实写状态流水；未归并称呼如实列出", async () => {
    const xue = await entry("薛行之", "characters");
    const fang = await entry("方工", "characters");
    fact("f-1", 2, "薛行之与方工", "结盟", "按项目结算的协作", "relationship", 9);
    fact("f-2", 6, "薛行之", "境界", "筑基", "character_state");
    fact("f-3", 7, "陌生人", "位置", "码头", "location");

    const result = rebuildNarrativeEntityIndex(storage, "book-1");
    if (!result.ok) throw new Error("rebuild failed");
    const relation = storage.sqlite.prepare<{ subject_id: string; object_id: string; predicate: string; valid_from: number; valid_to: number }>(
      "SELECT subject_id, object_id, predicate, valid_from, valid_to FROM narrative_relation WHERE book_id = 'book-1'",
    ).all();
    expect(relation).toEqual([{ subject_id: `ent:book-1:${xue.id}`, object_id: `ent:book-1:${fang.id}`, predicate: "结盟", valid_from: 2, valid_to: 9 }]);

    const state = storage.sqlite.prepare<{ entity_id: string; fluent: string; new_value: string; chapter_number: number }>(
      "SELECT entity_id, fluent, new_value, chapter_number FROM narrative_state_change WHERE book_id = 'book-1'",
    ).all();
    expect(state).toEqual([{ entity_id: `ent:book-1:${xue.id}`, fluent: "境界", new_value: "筑基", chapter_number: 6 }]);
    expect(result.unresolvedSamples).toContain("陌生人");
  });

  it("重复重建幂等；改名后实体 id 不变；dryRun 不写库", async () => {
    const xue = await entry("薛行之", "characters");
    event("ev-1", 1, "薛行之", "薛行之");
    rebuildNarrativeEntityIndex(storage, "book-1");
    rebuildNarrativeEntityIndex(storage, "book-1");
    expect(count("narrative_entity")).toBe(1);
    expect(count("narrative_event_participant")).toBe(2);

    await createStoryJingweiEntryRepository(storage).update("book-1", xue.id, { title: "薛行舟", aliases: ["薛行之"] });
    rebuildNarrativeEntityIndex(storage, "book-1");
    const row = storage.sqlite.prepare<{ id: string; canonical_name: string }>("SELECT id, canonical_name FROM narrative_entity WHERE book_id = 'book-1'").get()!;
    expect(row).toEqual({ id: `ent:book-1:${xue.id}`, canonical_name: "薛行舟" });
    // 旧名作为别名仍能归并
    expect(count("narrative_event_participant")).toBe(2);

    storage.sqlite.prepare("DELETE FROM narrative_entity_alias WHERE book_id = 'book-1'").run();
    const dry = rebuildNarrativeEntityIndex(storage, "book-1", { dryRun: true });
    expect(dry).toMatchObject({ ok: true, applied: false, entities: 1 });
    expect(count("narrative_entity_alias")).toBe(0);
  });

  it("同名条目只收一个并报告，不静默合并两个人", async () => {
    await entry("林舟", "characters");
    const dup = await entry("林舟（配角）", "characters");
    const result = rebuildNarrativeEntityIndex(storage, "book-1");
    if (!result.ok) throw new Error("rebuild failed");
    expect(result.entities).toBe(1);
    expect(result.duplicateEntryIds).toEqual([dup.id]);
  });

  it("状态类事件的对象是状态值，不参与称呼归并（2026-09-30 真模型基准）", async () => {
    await entry("阿Q", "characters");
    await entry("小D", "characters");
    event("ev-state", 5, "阿Q", "被未庄排斥", "applied", null, "character_state_changed");
    event("ev-rel", 5, "阿Q", "小D");

    const result = rebuildNarrativeEntityIndex(storage, "book-1", { now: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unresolvedSamples).not.toContain("被未庄排斥");
    expect(result.resolvedMentions).toBe(result.totalMentions);
    expect(result.totalMentions).toBe(3);
    const roles = storage.sqlite.prepare<{ event_id: string; role: string }>("SELECT event_id, role FROM narrative_event_participant WHERE book_id = 'book-1' ORDER BY event_id, role").all();
    expect(roles).toEqual([
      { event_id: "ev-rel", role: "agent" },
      { event_id: "ev-rel", role: "patient" },
      { event_id: "ev-state", role: "agent" },
    ]);
  });

  it("没有 0032 表时跳过并说明原因", () => {
    const bare = createStorageDatabase({ databasePath: join(tempDir, "bare.db") });
    ensureNarrativeMemorySchema(bare);
    const result = rebuildNarrativeEntityIndex(bare, "book-1");
    expect(result).toMatchObject({ ok: false, reason: "schema-missing" });
    bare.close();
  });
});
