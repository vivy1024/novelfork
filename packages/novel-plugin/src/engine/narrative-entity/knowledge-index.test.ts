/**
 * 人物知情边界索引：由实体索引整本重建同步刷新（推导规则与归并与实体索引同源）。
 *
 * 本组测试盯住任务约定：
 * 1. 知情来源只取已确认 / 已应用事实——待审事件不算；
 * 2. 参与者缺失（subject / object 归并不到经纬实体）的事实不算「他知道」；
 * 3. 关系事实双方都知道；
 * 4. 「第 N 章时他知道什么 / 还不知道什么」的查询语义（章截断、作废过滤、现状流水）。
 */

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "../jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../jingwei/repositories/section-repo.js";
import { ensureNarrativeMemorySchema } from "../narrative-memory/storage.js";
import { rebuildNarrativeEntityIndex } from "./entity-index.js";
import {
  explainKnowledgeEmpty,
  isKnowledgeConfirmed,
  knowledgeRowsForFact,
  queryEntityKnowledge,
  resolveKnowledgeEntitiesByNames,
} from "./knowledge-index.js";

let storage: StorageDatabase;
let tempDir: string;
const now = new Date("2026-09-01T00:00:00.000Z");
const iso = now.toISOString();

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-knowledge-${crypto.randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  ensureNarrativeMemorySchema(storage);
  await createBookRepository(storage).create({ id: "book-1", name: "知情边界", jingweiMode: "dynamic", currentChapter: 1, createdAt: now, updatedAt: now });
  await createStoryJingweiSectionRepository(storage).create({
    id: "sec-characters", bookId: "book-1", key: "characters", name: "角色", description: "", icon: null, order: 0, enabled: true,
    showInSidebar: true, participatesInAi: true, defaultVisibility: "tracked", fieldsJson: [], builtinKind: "characters",
    sourceTemplate: null, createdAt: now, updatedAt: now,
  });
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

async function character(title: string, aliases: string[] = []): Promise<string> {
  const created = await createStoryJingweiEntryRepository(storage).create({
    id: crypto.randomUUID(), bookId: "book-1", sectionId: "sec-characters", title, contentMd: "", category: "characters",
    fields: {}, customFields: {}, tags: [], aliases, relatedChapterNumbers: [], relatedEntryIds: [],
    visibilityRule: { type: "tracked" }, participatesInAi: true, tokenBudget: null, layer: "dynamic",
    status: "confirmed", createdAt: now, updatedAt: now,
  });
  return created.id;
}

function event(id: string, chapter: number, subject: string, object: string, status: "applied" | "pending" | "rejected" = "applied") {
  storage.sqlite.prepare(`
    INSERT INTO narrative_event (id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text,
      confidence, source, status, risk_level, subject_entry_id, object_entry_id, created_at)
    VALUES (?, 'book-1', ?, 'relationship_changed', ?, '相交', ?, '证据', 0.9, 'settle', ?, 'low', NULL, NULL, ?)
  `).run(id, chapter, subject, object, status, iso);
}

interface FactOptions {
  readonly category?: string;
  readonly sourceType?: string;
  readonly sourceId?: string | null;
  readonly chapter?: number | null;
  readonly validUntil?: number | null;
  readonly confidence?: number;
}

function fact(id: string, subject: string, predicate: string, object: string, options: FactOptions = {}) {
  const chapter = options.chapter === undefined ? 3 : options.chapter;
  storage.sqlite.prepare(`
    INSERT INTO narrative_fact (id, book_id, subject, predicate, object, category, layer, confidence, source_type,
      source_id, source_chapter, evidence_text, valid_from_chapter, valid_until_chapter, created_at, updated_at)
    VALUES (?, 'book-1', ?, ?, ?, ?, 'dynamic', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, subject, predicate, object,
    options.category ?? "character_state",
    options.confidence ?? 0.8,
    options.sourceType ?? "manual",
    options.sourceId ?? null,
    chapter,
    `证据-${id}`,
    chapter,
    options.validUntil ?? null,
    iso, iso,
  );
}

const knowledgeRows = () => storage.sqlite.prepare<{ knower_id: string; fact_ref: string; knows_from: number }>(
  "SELECT knower_id, fact_ref, knows_from FROM narrative_knowledge WHERE book_id = 'book-1' ORDER BY fact_ref, knower_id",
).all();

describe("纯规则：isKnowledgeConfirmed / knowledgeRowsForFact", () => {
  const applied = new Set(["ev-1"]);

  it("event 来源只认 applied；作者权威来源直接算", () => {
    expect(isKnowledgeConfirmed("event", "ev-1", applied)).toBe(true);
    expect(isKnowledgeConfirmed("event", "ev-2", applied)).toBe(false);
    expect(isKnowledgeConfirmed("event", null, applied)).toBe(false);
    expect(isKnowledgeConfirmed("manual", null, applied)).toBe(true);
    expect(isKnowledgeConfirmed("import", null, applied)).toBe(true);
    expect(isKnowledgeConfirmed("jingwei", null, applied)).toBe(true);
  });

  it("章号缺失不产生行；知情人去重", () => {
    expect(knowledgeRowsForFact({ factId: "f", sourceType: "manual", sourceId: null, chapter: null, evidence: null, confidence: 1 }, ["e1"])).toEqual([]);
    const rows = knowledgeRowsForFact({ factId: "f", sourceType: "manual", sourceId: null, chapter: 5, evidence: "x".repeat(500), confidence: 1 }, ["e1", "e2", "e1"]);
    expect(rows.map((row) => [row.entityId, row.knowsFrom])).toEqual([["e1", 5], ["e2", 5]]);
    expect(rows[0]!.evidence).toHaveLength(400);
    expect(rows[0]!.id).toBe("know:f:e1");
  });
});

describe("rebuildNarrativeEntityIndex 同步刷新知情账", () => {
  it("已应用事件的事实计入；待审事件不算；参与者缺失不算；关系事实双方都知道", async () => {
    const xue = await character("薛行之");
    const fang = await character("方工");
    const xueId = `ent:book-1:${xue}`;
    const fangId = `ent:book-1:${fang}`;

    event("ev-ok", 4, "薛行之", "方工");
    event("ev-pending", 5, "方工", "薛行之", "pending");
    fact("f-applied", "薛行之", "境界", "筑基", { category: "character_state", sourceType: "event", sourceId: "ev-ok", chapter: 4 });
    fact("f-pending", "方工", "境界", "金丹", { category: "character_state", sourceType: "event", sourceId: "ev-pending", chapter: 5 });
    fact("f-relation", "薛行之与方工", "决裂", "两人公开翻脸", { category: "relationship", sourceType: "manual", chapter: 6 });
    fact("f-stranger", "陌生人", "境界", "炼气", { category: "character_state", sourceType: "manual", chapter: 7 });
    fact("f-no-chapter", "薛行之", "习惯", "夜跑", { category: "character_state", sourceType: "manual", chapter: null });

    const result = rebuildNarrativeEntityIndex(storage, "book-1");
    if (!result.ok) throw new Error("rebuild failed");
    expect(result.knowledge).toBe(3);

    const rows = knowledgeRows();
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(expect.arrayContaining([
      { knower_id: xueId, fact_ref: "f-applied", knows_from: 4 },
      { knower_id: fangId, fact_ref: "f-relation", knows_from: 6 },
      { knower_id: xueId, fact_ref: "f-relation", knows_from: 6 },
    ]));

    // 重复重建幂等，不产生重复行
    rebuildNarrativeEntityIndex(storage, "book-1");
    expect(knowledgeRows()).toHaveLength(3);
  });

  it("location 事实的 object 是地点实体时也计知情；状态类 object 是状态值不当知情人", async () => {
    const xue = await character("薛行之");
    const yun = await character("青云观");
    const xueId = `ent:book-1:${xue}`;
    const yunId = `ent:book-1:${yun}`;

    event("ev-loc", 8, "薛行之", "青云观");
    fact("f-loc", "薛行之", "位置", "青云观", { category: "location", sourceType: "event", sourceId: "ev-loc", chapter: 8 });
    fact("f-state", "薛行之", "伤势", "左臂重伤", { category: "character_state", sourceType: "event", sourceId: "ev-loc", chapter: 8 });

    rebuildNarrativeEntityIndex(storage, "book-1");
    const rows = knowledgeRows();
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(expect.arrayContaining([
      { knower_id: xueId, fact_ref: "f-loc", knows_from: 8 },
      { knower_id: yunId, fact_ref: "f-loc", knows_from: 8 },
      { knower_id: xueId, fact_ref: "f-state", knows_from: 8 },
    ]));
    // 「左臂重伤」是状态值，不产生额外的知情人行
    expect(rows.filter((row) => row.fact_ref === "f-state")).toHaveLength(1);
  });
});

describe("queryEntityKnowledge", () => {
  async function seedBook(): Promise<{ xueId: string; fangId: string; shenId: string }> {
    const xue = await character("薛行之", ["薛小爷"]);
    const fang = await character("方工");
    const shen = await character("沈遥");
    event("ev-1", 3, "薛行之", "方工");
    event("ev-2", 6, "沈遥", "方工");
    fact("f-state-xue", "薛行之", "境界", "炼气", { category: "character_state", sourceType: "event", sourceId: "ev-1", chapter: 3, validUntil: 9 });
    fact("f-state-xue-2", "薛行之", "境界", "筑基", { category: "character_state", sourceType: "manual", chapter: 9 });
    fact("f-rel", "沈遥与方工", "决裂", "两人翻脸", { category: "relationship", sourceType: "manual", chapter: 6 });
    fact("f-secret", "方工", "身份", "内鬼", { category: "world_fact", sourceType: "manual", chapter: 7 });
    fact("f-hook", "铜戒指", "伏笔", "第三章回收", { category: "hook", sourceType: "manual", chapter: 3 });
    fact("f-later", "沈遥", "境界", "金丹", { category: "character_state", sourceType: "manual", chapter: 12 });
    rebuildNarrativeEntityIndex(storage, "book-1");
    return { xueId: `ent:book-1:${xue}`, fangId: `ent:book-1:${fang}`, shenId: `ent:book-1:${shen}` };
  }

  it("「他知道」按章截断并过滤已作废事实；关系事实双方在账", async () => {
    const { xueId, fangId, shenId } = await seedBook();

    const at5 = queryEntityKnowledge(storage, "book-1", { entityId: xueId, chapter: 5 });
    expect(at5.knows.map((row) => row.factId)).toEqual(["f-state-xue"]);

    const at10 = queryEntityKnowledge(storage, "book-1", { entityId: xueId, chapter: 10 });
    // 旧境界第 9 章起作废不再算「他知道」，新境界第 9 章起知道
    expect(at10.knows.map((row) => row.factId)).toEqual(["f-state-xue-2"]);

    const shen = queryEntityKnowledge(storage, "book-1", { entryId: shenId.replace("ent:book-1:", ""), chapter: 10 });
    expect(shen.knows.map((row) => row.factId)).toEqual(["f-rel"]);
    const fang = queryEntityKnowledge(storage, "book-1", { entityId: fangId, chapter: 10 });
    expect(fang.knows.map((row) => row.factId)).toEqual(["f-rel", "f-secret"]);
  });

  it("「他还不知道」= 截至该章已发生、仍有效、他不在场的关键事实；章节未发生与伏笔类不出现", async () => {
    const { xueId } = await seedBook();

    const at8 = queryEntityKnowledge(storage, "book-1", { entityId: xueId, chapter: 8 });
    // 第 6 章沈遥决裂、第 7 章方工是内鬼，薛行之都不在场；hook 类与他无关不算；第 12 章的事还没发生
    expect(at8.unaware.map((row) => [row.factId, row.chapter])).toEqual([
      ["f-secret", 7],
      ["f-rel", 6],
    ]);
    // 章号降序（最近的秘密在前）
    expect(at8.unaware[0]!.factId).toBe("f-secret");

    const at13 = queryEntityKnowledge(storage, "book-1", { entityId: xueId, chapter: 13 });
    expect(at13.unaware.map((row) => row.factId)).toContain("f-later");
    // 「至今」不过滤上限
    const latest = queryEntityKnowledge(storage, "book-1", { entityId: xueId });
    expect(latest.unaware.map((row) => row.factId)).toEqual(["f-later", "f-secret", "f-rel"]);
  });

  it("现状 = 每方面取该章前最后一条状态流水；出场名单按别名归并实体", async () => {
    const { xueId, shenId } = await seedBook();

    const at5 = queryEntityKnowledge(storage, "book-1", { entityId: xueId, chapter: 5 });
    // 状态流水是历史回放：即使事实后来被取代，第 5 章时的最新值仍是当时的「炼气」
    expect(at5.state).toEqual([{ fluent: "境界", value: "炼气", chapter: 3 }]);
    const at10 = queryEntityKnowledge(storage, "book-1", { entityId: xueId, chapter: 10 });
    expect(at10.state).toEqual([{ fluent: "境界", value: "筑基", chapter: 9 }]);

    // 别名「薛小爷」与规范名归并到同一实体且去重
    const resolved = resolveKnowledgeEntitiesByNames(storage, "book-1", ["薛小爷", "薛行之", "沈遥", "不存在的人"]);
    expect(resolved.map((row) => row.id)).toHaveLength(2);
    expect(resolved.map((row) => row.id)).toContain(xueId);
    expect(resolved.map((row) => row.id)).toContain(shenId);
  });

  it("空态分层解释：schema 缺失 / 索引为空 / 实体不存在 / 无知情记录", async () => {
    const bare = createStorageDatabase({ databasePath: join(tempDir, "bare.db") });
    ensureNarrativeMemorySchema(bare);
    const missing = queryEntityKnowledge(bare, "book-1", { entityId: "ent:book-1:x" });
    expect(missing.schemaMissing).toBe(true);
    expect(explainKnowledgeEmpty("schema-missing").suggestedAction).toContain("迁移");
    bare.close();

    await character("林舟");
    rebuildNarrativeEntityIndex(storage, "book-1");
    const nobody = queryEntityKnowledge(storage, "book-1", { entityId: "ent:book-1:ghost" });
    expect(nobody.entity).toBeNull();
    expect(explainKnowledgeEmpty("entity-not-found", { name: "林舟" }).whatHappened).toContain("林舟");

    const rows = knowledgeRows();
    expect(rows).toHaveLength(0);
    expect(explainKnowledgeEmpty("no-knowledge", { name: "林舟", chapter: 3 }).whatHappened).toContain("林舟");
    expect(explainKnowledgeEmpty("no-knowledge", { name: "林舟", chapter: 3 }).suggestedAction).toContain("结算");
  });

  it("「不知道」限量：默认 8 条，章号降序截断", async () => {
    const xue = await character("薛行之");
    const fang = await character("方工");
    for (let i = 1; i <= 12; i += 1) {
      fact(`f-many-${i}`, "方工", `秘密${i}`, `第${i}桩`, { category: "world_fact", chapter: i });
    }
    rebuildNarrativeEntityIndex(storage, "book-1");

    const answer = queryEntityKnowledge(storage, "book-1", { entityId: `ent:book-1:${xue}` });
    expect(answer.unaware).toHaveLength(8);
    expect(answer.unaware.map((row) => row.chapter)).toEqual([12, 11, 10, 9, 8, 7, 6, 5]);

    // 方工本人全在场/是主体，没有「不知道」
    const fangAnswer = queryEntityKnowledge(storage, "book-1", { entityId: `ent:book-1:${fang}` });
    expect(fangAnswer.unaware).toHaveLength(0);
    expect(fangAnswer.knows).toHaveLength(12);
  });
});
