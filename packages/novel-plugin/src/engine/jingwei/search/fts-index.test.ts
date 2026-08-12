import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createStoryJingweiEntryRepository } from "../repositories/entry-repo.js";
import { ensureBookFtsFresh, rebuildBookFts, removeEntryFts, searchFtsCandidates, syncEntryFts } from "./fts-index.js";
import type { FtsSyncFields } from "./fts-index.js";

function makeStorage(): { storage: StorageDatabase; bookId: string } {
  const dir = mkdtempSync(join(tmpdir(), "jw-fts-"));
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  // 建表（模拟迁移后的 schema）
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "story_jingwei_section" (
      "id" TEXT PRIMARY KEY NOT NULL, "book_id" TEXT NOT NULL, "key" TEXT NOT NULL,
      "name" TEXT NOT NULL DEFAULT '', "description" TEXT NOT NULL DEFAULT '',
      "icon" TEXT, "order" INTEGER NOT NULL DEFAULT 0, "enabled" INTEGER NOT NULL DEFAULT 1,
      "show_in_sidebar" INTEGER NOT NULL DEFAULT 1, "participates_in_ai" INTEGER NOT NULL DEFAULT 1,
      "default_visibility" TEXT NOT NULL DEFAULT 'tracked', "fields_json" TEXT NOT NULL DEFAULT '[]',
      "builtin_kind" TEXT, "source_template" TEXT, "created_at" INTEGER NOT NULL,
      "updated_at" INTEGER NOT NULL, "deleted_at" INTEGER
    );
    CREATE TABLE IF NOT EXISTS "story_jingwei_entry" (
      "id" TEXT PRIMARY KEY NOT NULL, "book_id" TEXT NOT NULL, "section_id" TEXT NOT NULL,
      "title" TEXT NOT NULL, "content_md" TEXT NOT NULL DEFAULT '', "summary_md" TEXT,
      "category" TEXT, "fields_json" TEXT, "custom_fields_json" TEXT NOT NULL DEFAULT '{}',
      "parent_id" TEXT, "sort_order" INTEGER, "lifecycle" TEXT, "status" TEXT,
      "version" INTEGER, "tags_json" TEXT NOT NULL DEFAULT '[]', "aliases_json" TEXT NOT NULL DEFAULT '[]',
      "related_chapter_numbers_json" TEXT NOT NULL DEFAULT '[]', "related_entry_ids_json" TEXT NOT NULL DEFAULT '[]',
      "visibility_rule_json" TEXT NOT NULL DEFAULT '{"type":"tracked"}', "participates_in_ai" INTEGER NOT NULL DEFAULT 1,
      "token_budget" INTEGER, "priority_tier" TEXT, "layer" TEXT, "importance" INTEGER,
      "summary_l0" TEXT, "source" TEXT, "revision_history" TEXT, "conflict_status" TEXT,
      "conflict_detail" TEXT, "created_at" INTEGER NOT NULL, "updated_at" INTEGER NOT NULL, "deleted_at" INTEGER
    );
    CREATE TABLE IF NOT EXISTS "jingwei_revision" (
      "id" TEXT PRIMARY KEY NOT NULL, "entry_id" TEXT NOT NULL, "book_id" TEXT NOT NULL,
      "content_md" TEXT, "category" TEXT, "layer" TEXT, "snapshot_json" TEXT,
      "reason" TEXT, "changed_by" TEXT, "created_at" INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "jingwei_fts_doc" (
      "doc_id" INTEGER PRIMARY KEY AUTOINCREMENT, "entry_id" TEXT NOT NULL UNIQUE,
      "book_id" TEXT NOT NULL, "indexed_at" INTEGER NOT NULL, "entry_updated_at" INTEGER NOT NULL,
      "entry_status" TEXT NOT NULL DEFAULT 'confirmed'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS "jingwei_entry_fts" USING fts5(
      "title_g", "alias_g", "tag_g", "keyword_g", "summary_g", "content_g",
      content='', contentless_delete=1
    );
    CREATE TABLE IF NOT EXISTS "book" ("id" TEXT PRIMARY KEY NOT NULL, "title" TEXT, "current_chapter" INTEGER, "jingwei_mode" TEXT);
  `);
  storage.sqlite.prepare(`INSERT INTO "book" ("id", "title", "current_chapter") VALUES ('book-1', '测试书', 1)`).run();
  storage.sqlite.prepare(`INSERT INTO "story_jingwei_section" ("id", "book_id", "key", "name", "order", "enabled", "participates_in_ai", "created_at", "updated_at") VALUES ('sec-1', 'book-1', 'characters', '角色', 0, 1, 1, 0, 0)`).run();
  return { storage, bookId: "book-1" };
}

function fields(overrides: Partial<FtsSyncFields> & { entryId: string }): FtsSyncFields {
  return {
    bookId: "book-1",
    title: "韩立",
    aliases: ["韩老魔 小韩"],
    tags: ["主角"],
    keywords: [],
    summaryMd: "太清门修士",
    contentMd: "韩立在太清门修炼寒焰诀，与南宫婉同行。",
    updatedAt: new Date(1_700_000_000_000),
    status: "confirmed",
    ...overrides,
  };
}

describe("syncEntryFts / searchFtsCandidates", () => {
  it("upsert 后能按 2 字人名命中", () => {
    const { storage } = makeStorage();
    syncEntryFts(storage, fields({ entryId: "e1" }));
    const hits = searchFtsCandidates(storage, "book-1", '"韩立"', 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.entryId).toBe("e1");
  });

  it("多词 AND 查询命中", () => {
    const { storage } = makeStorage();
    syncEntryFts(storage, fields({ entryId: "e1" }));
    const hits = searchFtsCandidates(storage, "book-1", '"韩立" AND "太清 清门"', 10);
    expect(hits.map((h) => h.entryId)).toEqual(["e1"]);
  });

  it("别名可被反查（搜「韩老魔」命中条目）", () => {
    const { storage } = makeStorage();
    syncEntryFts(storage, fields({ entryId: "e1" }));
    const hits = searchFtsCandidates(storage, "book-1", '"韩老 老魔"', 10);
    expect(hits.map((h) => h.entryId)).toEqual(["e1"]);
  });

  it("更新后索引反映新内容", () => {
    const { storage } = makeStorage();
    syncEntryFts(storage, fields({ entryId: "e1", contentMd: "黄枫谷七大长老齐聚一堂" }));
    expect(searchFtsCandidates(storage, "book-1", '"黄枫 枫谷"', 10)).toHaveLength(1);
    syncEntryFts(storage, fields({ entryId: "e1", contentMd: "青蛟岛外海面掀起狂澜" }));
    expect(searchFtsCandidates(storage, "book-1", '"黄枫 枫谷"', 10)).toHaveLength(0);
    expect(searchFtsCandidates(storage, "book-1", '"青蛟 蛟岛"', 10)).toHaveLength(1);
  });

  it("标题命中分高于正文命中", () => {
    const { storage } = makeStorage();
    syncEntryFts(storage, fields({ entryId: "title-hit", title: "太清门秘史", contentMd: "正文不含目标词" }));
    syncEntryFts(storage, fields({ entryId: "content-hit", title: "杂记", contentMd: "太清门建于千年前" }));
    const hits = searchFtsCandidates(storage, "book-1", '"太清 清门"', 10);
    expect(hits[0]!.entryId).toBe("title-hit");
  });

  it("空表达式返回空候选", () => {
    const { storage } = makeStorage();
    expect(searchFtsCandidates(storage, "book-1", "", 10)).toEqual([]);
  });
});

describe("removeEntryFts", () => {
  it("删除后不再命中", () => {
    const { storage } = makeStorage();
    syncEntryFts(storage, fields({ entryId: "e1" }));
    removeEntryFts(storage, "e1");
    expect(searchFtsCandidates(storage, "book-1", '"韩立"', 10)).toHaveLength(0);
  });
});

describe("ensureBookFtsFresh / rebuildBookFts", () => {
  it("repo.create 同步索引后检查通过；直写才触发重建", async () => {
    const { storage, bookId } = makeStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await repo.create({
      id: "e1", bookId, sectionId: "sec-1", title: "韩立", contentMd: "韩立在太清门修炼",
      category: "characters", lifecycle: "active", status: "confirmed", tags: [], aliases: [],
      relatedChapterNumbers: [], relatedEntryIds: [], visibilityRule: { type: "tracked" },
      participatesInAi: true, layer: "dynamic", priorityTier: "auto", importance: 40,
      source: "user", createdAt: new Date(1_700_000_000_000), updatedAt: new Date(1_700_000_000_000),
    });
    // repo 写入已同步 FTS，一致性检查直接通过
    expect(ensureBookFtsFresh(storage, bookId)).toBe(false);
    const hits = searchFtsCandidates(storage, bookId, '"韩立"', 10);
    expect(hits).toHaveLength(1);
  });

  it("绕过 repo 的直写（直接 SQL INSERT）也能被自愈兜住", () => {
    const { storage, bookId } = makeStorage();
    storage.sqlite
      .prepare(
        `INSERT INTO "story_jingwei_entry" ("id", "book_id", "section_id", "title", "content_md", "created_at", "updated_at", "tags_json", "aliases_json", "custom_fields_json", "related_chapter_numbers_json", "related_entry_ids_json", "visibility_rule_json") VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', '{}', '[]', '[]', '{"type":"tracked"}')`,
      )
      .run("e-raw", bookId, "sec-1", "南宫婉", "南宫婉与韩立同门", 1_700_000_000_000, 1_700_000_000_000);
    expect(ensureBookFtsFresh(storage, bookId)).toBe(true);
    const hits = searchFtsCandidates(storage, bookId, '"南宫 宫婉"', 10);
    expect(hits.map((h) => h.entryId)).toEqual(["e-raw"]);
  });

  it("混合文本与整数时间戳只触发一次自愈重建", () => {
    const { storage, bookId } = makeStorage();
    storage.sqlite
      .prepare(
        `INSERT INTO "story_jingwei_entry" ("id", "book_id", "section_id", "title", "content_md", "created_at", "updated_at", "tags_json", "aliases_json", "custom_fields_json", "related_chapter_numbers_json", "related_entry_ids_json", "visibility_rule_json", "status") VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', '{}', '[]', '[]', '{"type":"tracked"}', 'confirmed')`,
      )
      .run("legacy-text-time", bookId, "sec-1", "旧格式条目", "文本时间戳也应稳定索引", 1_700_000_000_000, "2026-07-22 10:33:44");
    storage.sqlite
      .prepare(
        `INSERT INTO "story_jingwei_entry" ("id", "book_id", "section_id", "title", "content_md", "created_at", "updated_at", "tags_json", "aliases_json", "custom_fields_json", "related_chapter_numbers_json", "related_entry_ids_json", "visibility_rule_json", "status") VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', '{}', '[]', '[]', '{"type":"tracked"}', 'confirmed')`,
      )
      .run("modern-integer-time", bookId, "sec-1", "新格式条目", "整数时间戳应与旧格式共同参与比较", 1_700_000_000_000, 1_700_000_000_000);

    // 文本时间是全书最新值。重建时必须沿用 SQLite 的 UTC 解析结果，
    // 不能用 new Date("YYYY-MM-DD HH:mm:ss") 按宿主本地时区解析，否则会反复自愈。
    expect(ensureBookFtsFresh(storage, bookId)).toBe(true);
    const expected = storage.sqlite.prepare(`
      SELECT CAST(ROUND(unixepoch("updated_at", 'subsec') * 1000) AS INTEGER) AS "updatedAtMs"
      FROM "story_jingwei_entry" WHERE "id" = 'legacy-text-time'
    `).get() as { updatedAtMs: number };
    const indexed = storage.sqlite.prepare(`
      SELECT "entry_updated_at" AS "updatedAtMs"
      FROM "jingwei_fts_doc" WHERE "entry_id" = 'legacy-text-time'
    `).get() as { updatedAtMs: number };
    expect(indexed.updatedAtMs).toBe(expected.updatedAtMs);
    expect(ensureBookFtsFresh(storage, bookId)).toBe(false);
  });

  it("rebuildBookFts 返回重建条数", async () => {
    const { storage, bookId } = makeStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await repo.create({
      id: "e1", bookId, sectionId: "sec-1", title: "韩立", contentMd: "韩立", category: "characters",
      lifecycle: "active", status: "confirmed", tags: [], aliases: [], relatedChapterNumbers: [],
      relatedEntryIds: [], visibilityRule: { type: "tracked" }, participatesInAi: true,
      layer: "dynamic", priorityTier: "auto", importance: 40, source: "user",
      createdAt: new Date(1_700_000_000_000), updatedAt: new Date(1_700_000_000_000),
    });
    expect(rebuildBookFts(storage, bookId)).toBe(1);
  });
});
