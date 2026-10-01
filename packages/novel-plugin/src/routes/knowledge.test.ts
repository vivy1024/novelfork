/**
 * 知情边界路由：按实体 id / 经纬条目 id 回答「第 N 章时他知道什么、还不知道什么」。
 */

import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../engine/jingwei/repositories/section-repo.js";
import { rebuildNarrativeEntityIndex } from "../engine/narrative-entity/entity-index.js";
import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
import { createKnowledgeRouter } from "./knowledge.js";

let storage: StorageDatabase;
let tempDir: string;
const now = new Date("2026-09-01T00:00:00.000Z");
const iso = now.toISOString();
const base = "/api/books/book-1/narrative-memory/knowledge";

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-knowledge-route-${crypto.randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  ensureNarrativeMemorySchema(storage);
  await createBookRepository(storage).create({ id: "book-1", name: "知情路由", jingweiMode: "dynamic", currentChapter: 1, createdAt: now, updatedAt: now });
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

function event(id: string, chapter: number, subject: string, object: string, status = "applied") {
  storage.sqlite.prepare(`
    INSERT INTO narrative_event (id, book_id, chapter_number, event_type, subject, predicate, object, evidence_text,
      confidence, source, status, risk_level, subject_entry_id, object_entry_id, created_at)
    VALUES (?, 'book-1', ?, 'character_state_changed', ?, '变化', ?, '证据', 0.9, 'settle', ?, 'low', NULL, NULL, ?)
  `).run(id, chapter, subject, object, status, iso);
}

function fact(id: string, subject: string, predicate: string, object: string, category: string, chapter: number, sourceId: string | null = null) {
  storage.sqlite.prepare(`
    INSERT INTO narrative_fact (id, book_id, subject, predicate, object, category, layer, confidence, source_type,
      source_id, source_chapter, evidence_text, valid_from_chapter, valid_until_chapter, created_at, updated_at)
    VALUES (?, 'book-1', ?, ?, ?, ?, 'dynamic', 0.85, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(id, subject, predicate, object, category, sourceId ? "event" : "manual", sourceId, chapter, `证据-${id}`, chapter, iso, iso);
}

async function get(path: string) {
  const res = await createKnowledgeRouter({ storage }).request(`${base}${path}`);
  return { status: res.status, body: await res.json() as any };
}

describe("知情边界路由", () => {
  it("参数校验：缺实体参数 400、非法章号 400", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("?entityId=ent:book-1:x&chapter=0")).status).toBe(400);
    expect((await get("?entityId=ent:book-1:x&chapter=abc")).status).toBe(400);
  });

  it("索引为空与实体不存在时给带 explanation 的空状态", async () => {
    const empty = await get("?entityId=ent:book-1:x");
    expect(empty.body).toMatchObject({ ok: true, status: "empty", reason: "index-empty" });
    expect(empty.body.explanation.suggestedAction).toContain("结算");

    await character("薛行之");
    const fang = await character("方工");
    rebuildNarrativeEntityIndex(storage, "book-1");
    const notFound = await get("?entityId=ent:book-1:ghost");
    expect(notFound.body).toMatchObject({ status: "empty", reason: "entity-not-found" });

    const xue = await get(`?entryId=${fang}`);
    expect(xue.body.status).toBe("ok");
    expect(xue.body.notice.whatHappened).toContain("方工");
    expect(xue.body.knows).toEqual([]);
  });

  it("按实体与经纬条目 id 出「知道 / 不知道 / 现状」，按章截断", async () => {
    const xue = await character("薛行之", ["薛小爷"]);
    const fang = await character("方工");
    event("ev-1", 3, "薛行之", "筑基");
    event("ev-2", 6, "方工", "金丹", "pending");
    fact("f-state", "薛行之", "境界", "筑基", "character_state", 3, "ev-1");
    fact("f-secret", "方工", "身份", "内鬼", "world_fact", 5);
    fact("f-pending", "方工", "境界", "金丹", "character_state", 6, "ev-2");
    rebuildNarrativeEntityIndex(storage, "book-1");

    const at4 = await get(`?entityId=${encodeURIComponent(`ent:book-1:${xue}`)}&chapter=4`);
    expect(at4.body).toMatchObject({ ok: true, status: "ok", chapter: 4 });
    expect(at4.body.entity.id).toBe(`ent:book-1:${xue}`);
    expect(at4.body.knows.map((row: any) => row.factId)).toEqual(["f-state"]);
    expect(at4.body.state).toEqual([{ fluent: "境界", value: "筑基", chapter: 3 }]);
    expect(at4.body.unaware).toEqual([]);

    const at7 = await get(`?entityId=${encodeURIComponent(`ent:book-1:${xue}`)}&chapter=7`);
    // 薛行之不知道「方工是内鬼」；pending 事件不是已确认事实，既不算他知道、也不算禁忌候选
    expect(at7.body.unaware.map((row: any) => row.factId)).toEqual(["f-secret"]);

    const byEntry = await get(`?entryId=${fang}&chapter=7`);
    // 方工本人知道自己是内鬼（manual 事实在场）；「薛行之筑基」他不在场；pending 事实两列都不出现
    expect(byEntry.body.knows.map((row: any) => row.factId)).toEqual(["f-secret"]);
    expect(byEntry.body.unaware.map((row: any) => row.factId)).toEqual(["f-state"]);
  });

  it("「至今」缺省不带 chapter 上限", async () => {
    const xue = await character("薛行之");
    event("ev-1", 3, "薛行之", "筑基");
    fact("f-state", "薛行之", "境界", "筑基", "character_state", 3, "ev-1");
    fact("f-later", "薛行之", "境界", "金丹", "character_state", 12);
    rebuildNarrativeEntityIndex(storage, "book-1");

    const latest = await get(`?entityId=${encodeURIComponent(`ent:book-1:${xue}`)}`);
    expect(latest.body.chapter).toBeNull();
    expect(latest.body.knows.map((row: any) => row.factId)).toEqual(["f-state", "f-later"]);
    expect(latest.body.state).toEqual([{ fluent: "境界", value: "金丹", chapter: 12 }]);
  });
});
