import { describe, expect, it } from "vitest";
import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { searchJingwei } from "./search-jingwei.js";
import { createBookRepository } from "../repositories/book-repo.js";
import { createStoryJingweiSectionRepository } from "../repositories/section-repo.js";
import { createStoryJingweiEntryRepository } from "../repositories/entry-repo.js";
import { rebuildBookFts } from "../search/fts-index.js";

describe("searchJingwei", () => {
  it("P0.5 supports entryKey exact match and ignores unconfirmed by default", async () => {
    const storage = createStorageDatabase({ databasePath: ":memory:" });
    storage.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS "book" ("id" TEXT PRIMARY KEY NOT NULL, "title" TEXT, "name" TEXT, "current_chapter" INTEGER, "jingwei_mode" TEXT, "created_at" INTEGER, "updated_at" INTEGER);
      CREATE TABLE IF NOT EXISTS "story_jingwei_section" ("id" TEXT PRIMARY KEY NOT NULL, "book_id" TEXT NOT NULL, "key" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT, "icon" TEXT, "source_template" TEXT, "fields_json" TEXT NOT NULL DEFAULT '{}', "order" INTEGER NOT NULL, "enabled" INTEGER NOT NULL, "participates_in_ai" INTEGER NOT NULL, "builtin_kind" TEXT, "show_in_sidebar" INTEGER NOT NULL DEFAULT 1, "default_visibility" TEXT NOT NULL DEFAULT 'tracked', "created_at" INTEGER NOT NULL, "updated_at" INTEGER NOT NULL, "deleted_at" INTEGER);
      CREATE TABLE IF NOT EXISTS "story_jingwei_entry" (
        "id" TEXT PRIMARY KEY NOT NULL, "book_id" TEXT NOT NULL, "section_id" TEXT NOT NULL,
        "title" TEXT NOT NULL, "content_md" TEXT NOT NULL DEFAULT '', "summary_md" TEXT,
        "category" TEXT, "fields_json" TEXT, "custom_fields_json" TEXT NOT NULL DEFAULT '{}',
        "parent_id" TEXT, "sort_order" INTEGER, "lifecycle" TEXT, "status" TEXT,
        "version" INTEGER, "tags_json" TEXT NOT NULL DEFAULT '[]', "aliases_json" TEXT NOT NULL DEFAULT '[]',
        "related_chapter_numbers_json" TEXT NOT NULL DEFAULT '[]', "related_entry_ids_json" TEXT NOT NULL DEFAULT '[]',
        "visibility_rule_json" TEXT NOT NULL DEFAULT '{"type":"tracked"}', "participates_in_ai" INTEGER NOT NULL DEFAULT 1,
        "token_budget" INTEGER, "priority_tier" TEXT, "layer" TEXT, "importance" INTEGER,
        "summary_l0" TEXT, "entry_key" TEXT, "source_refs_json" TEXT NOT NULL DEFAULT '[]', "source" TEXT, "revision_history" TEXT, "conflict_status" TEXT,
        "conflict_detail" TEXT, "created_at" INTEGER NOT NULL, "updated_at" INTEGER NOT NULL, "deleted_at" INTEGER
      );
      CREATE TABLE IF NOT EXISTS "jingwei_revision" (
        "id" TEXT PRIMARY KEY NOT NULL, "entry_id" TEXT NOT NULL, "book_id" TEXT NOT NULL,
        "content_md" TEXT, "category" TEXT, "layer" TEXT, "snapshot_json" TEXT,
        "reason" TEXT, "changed_by" TEXT, "created_at" INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS "jingwei_entry_fts" USING fts5(
        "title_g",
        "alias_g",
        "tag_g",
        "keyword_g",
        "summary_g",
        "content_g"
      );
      CREATE TABLE IF NOT EXISTS "jingwei_fts_doc" (
        "doc_id" INTEGER PRIMARY KEY,
        "book_id" TEXT,
        "entry_id" TEXT,
        "entry_status" TEXT,
        "entry_updated_at" INTEGER,
        "indexed_at" INTEGER
      );
      INSERT INTO "book" ("id", "title", "current_chapter") VALUES ('b1', 'Test Book', 1);
      INSERT INTO "story_jingwei_section" ("id", "book_id", "key", "name", "order", "enabled", "participates_in_ai", "created_at", "updated_at") VALUES ('sec1', 'b1', 'characters', 'Characters', 1, 1, 1, 0, 0);
    `);

    const repo = createStoryJingweiEntryRepository(storage);
    const ts = new Date(1_700_000_000_000);
    await repo.create({
      id: "e1", bookId: "b1", sectionId: "sec1", title: "Alice", contentMd: "Hero", category: "characters", lifecycle: "active", status: "confirmed", tags: [], aliases: ["Ali"], relatedChapterNumbers: [], relatedEntryIds: [], visibilityRule: { type: "tracked" }, participatesInAi: true, layer: "dynamic", priorityTier: "auto", importance: 40, source: "user", createdAt: ts, updatedAt: ts, entryKey: "characters:alice"
    });
    await repo.create({
      id: "e2", bookId: "b1", sectionId: "sec1", title: "Bob", contentMd: "Friend", category: "characters", lifecycle: "active", status: "confirmed", tags: [], aliases: [], relatedChapterNumbers: [], relatedEntryIds: [], visibilityRule: { type: "tracked" }, participatesInAi: true, layer: "dynamic", priorityTier: "auto", importance: 40, source: "user", createdAt: ts, updatedAt: ts, entryKey: "characters:bob"
    });
    await repo.create({
      id: "e3", bookId: "b1", sectionId: "sec1", title: "BobUnconfirmed", contentMd: "Unknown", category: "characters", lifecycle: "active", status: "draft", tags: [], aliases: [], relatedChapterNumbers: [], relatedEntryIds: [], visibilityRule: { type: "tracked" }, participatesInAi: true, layer: "dynamic", priorityTier: "auto", importance: 40, source: "user", createdAt: ts, updatedAt: ts, entryKey: "characters:bobunconfirmed"
    });

    rebuildBookFts(storage, "b1");

    const result1 = await searchJingwei({ bookId: "b1", query: "Ali", storage });
    expect(result1.returnedCount).toBe(1);
    expect(result1.items[0]?.entryId).toBe("e1");

    const result2 = await searchJingwei({ bookId: "b1", query: "Alice", entryKey: "characters:bob", storage });
    expect(result2.returnedCount).toBe(0); // entryKey mismatch

    const result3 = await searchJingwei({ bookId: "b1", query: "Bob", storage });
    expect(result3.returnedCount).toBe(1);
    expect(result3.items.length).toBe(1);
    expect(result3.items[0]?.entryId).toBe("e2");

    const result4 = await searchJingwei({ bookId: "b1", query: "Bob", storage, includeUnconfirmed: true });
    // Due to limited memory sqlite implementation, we use LIKE fallback which respects includeUnconfirmed correctly!
    // Oh wait, maybe LIKE fallback gets both?
    expect(result4.returnedCount).toBe(2); // Should match both e2 and e3 now
    expect(result4.items.map(i => i.entryId).sort()).toEqual(["e2", "e3"]);
  });
});
