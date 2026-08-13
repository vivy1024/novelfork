import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { handleLoreProgress, handleLoreRelate } from "./lore-story-progress.js";
import { upsertLedgerEntry } from "./jingwei-ledger-store.js";

const tempDirs: string[] = [];
const storages: StorageDatabase[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-lore-progress-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storages.push(storage);
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  const now = new Date();
  await createBookRepository(storage).create({
    id: "book-1",
    name: "测试书",
    jingweiMode: "dynamic",
    currentChapter: 12,
    createdAt: now,
    updatedAt: now,
  });
  return storage;
}

afterEach(async () => {
  for (const storage of storages.splice(0)) storage.close();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("handleLoreRelate", () => {
  it("writes a relationship entry with stable A×B key and needs-review status", async () => {
    const storage = await createStorage();
    const result = handleLoreRelate({
      bookId: "book-1",
      sourceName: "林渊",
      targetName: "苏晴",
      relationType: "结盟",
      description: "在坊市共度一劫后结为盟友。",
      chapterNumber: 12,
      reason: "第 12 章正文",
      storage,
    });

    expect(result.ok).toBe(true);
    expect(result.title).toBe("林渊 × 苏晴");
    expect(result.status).toBe("needs-review");
    expect(result.layer).toBe("dynamic");

    const row = storage.sqlite.prepare<{ layer: string; status: string; fieldsJson: string }>(
      "SELECT layer, status, fields_json AS fieldsJson FROM story_jingwei_entry WHERE book_id = ? AND title = ?",
    ).get("book-1", "林渊 × 苏晴");
    expect(row?.layer).toBe("dynamic");
    expect(row?.status).toBe("needs-review");
    expect(JSON.parse(row!.fieldsJson)).toEqual({
      sourceName: "林渊",
      targetName: "苏晴",
      relationType: "结盟",
      description: "在坊市共度一劫后结为盟友。",
      lastChangedChapter: 12,
    });
  });

  it("upserts the same A×B entry instead of creating duplicates per chapter", async () => {
    const storage = await createStorage();
    handleLoreRelate({
      bookId: "book-1", sourceName: "林渊", targetName: "苏晴", relationType: "结盟",
      chapterNumber: 12, reason: "第 12 章", storage,
    });
    const updated = handleLoreRelate({
      bookId: "book-1", sourceName: "林渊", targetName: "苏晴", relationType: "情侣",
      chapterNumber: 20, reason: "第 20 章关系升温", storage,
    });

    expect(updated.ok).toBe(true);
    const count = storage.sqlite.prepare<{ count: number }>(
      "SELECT COUNT(*) AS count FROM story_jingwei_entry WHERE book_id = ? AND category = 'relationships'",
    ).get("book-1")?.count;
    expect(count).toBe(1);
    const fields = JSON.parse(
      storage.sqlite.prepare<{ fieldsJson: string }>(
        "SELECT fields_json AS fieldsJson FROM story_jingwei_entry WHERE book_id = ? AND title = '林渊 × 苏晴'",
      ).get("book-1")!.fieldsJson,
    ) as Record<string, unknown>;
    expect(fields.relationType).toBe("情侣");
    expect(fields.lastChangedChapter).toBe(20);
  });

  it("rejects missing names or unknown books", async () => {
    const storage = await createStorage();
    expect(handleLoreRelate({ bookId: "book-1", sourceName: " ", targetName: "苏晴", relationType: "结盟", storage }).ok).toBe(false);
    expect(handleLoreRelate({ bookId: "book-1", sourceName: "林渊", targetName: "苏晴", relationType: "", storage }).ok).toBe(false);
    expect(handleLoreRelate({ bookId: "book-404", sourceName: "林渊", targetName: "苏晴", relationType: "结盟", storage }))
      .toMatchObject({ ok: false, error: "book-not-found" });
  });
});

describe("handleLoreProgress", () => {
  function seedForeshadowing(storage: StorageDatabase, fields: Record<string, unknown>): string {
    const entry = upsertLedgerEntry(storage, {
      bookId: "book-1",
      category: "foreshadowing",
      title: "小瓶秘密",
      contentMd: "小瓶能催熟药草，来历不明。",
      fields,
      status: "confirmed",
      changedBy: "test",
    });
    return entry.id;
  }

  it("advances a dynamic-category field and records the progression ledger", async () => {
    const storage = await createStorage();
    const entryId = seedForeshadowing(storage, { status: "已埋设", plantedChapter: 3 });

    const result = handleLoreProgress({
      bookId: "book-1",
      entryId,
      fieldKey: "status",
      newValue: "部分揭示",
      chapterNumber: 12,
      description: "韩立当众催熟药草，秘密暴露一角。",
      reason: "第 12 章正文",
      storage,
    });

    expect(result.ok).toBe(true);
    expect(result.oldValue).toBe("已埋设");
    expect(result.newValue).toBe("部分揭示");
    expect(result.progressionId).toBeTruthy();

    // 字段真的更新了，且原状态保留（progression 不冒充确认）。
    const fields = JSON.parse(
      storage.sqlite.prepare<{ fieldsJson: string }>("SELECT fields_json AS fieldsJson FROM story_jingwei_entry WHERE id = ?").get(entryId)!.fieldsJson,
    ) as Record<string, unknown>;
    expect(fields.status).toBe("部分揭示");
    expect(fields.plantedChapter).toBe(3);

    const progression = storage.sqlite.prepare<{ oldValue: string; newValue: string; chapterNumber: number }>(
      "SELECT old_value AS oldValue, new_value AS newValue, chapter_number AS chapterNumber FROM jingwei_progressions WHERE entry_id = ?",
    ).get(entryId);
    expect(progression).toMatchObject({ oldValue: "已埋设", newValue: "部分揭示", chapterNumber: 12 });
  });

  it("rejects field progression on canon-category entries and points to lore.write", async () => {
    const storage = await createStorage();
    // characters 分类 defaultLayer=canon：机器不得推进字段。
    const id = crypto.randomUUID();
    const sectionId = crypto.randomUUID();
    storage.sqlite.prepare(`
      INSERT INTO story_jingwei_section (id, book_id, key, name, description, "order", enabled, show_in_sidebar, participates_in_ai, default_visibility, fields_json, created_at, updated_at)
      VALUES (?, 'book-1', 'characters', '角色', '', 0, 1, 1, 1, 'tracked', '[]', 1, 1)
    `).run(sectionId);
    storage.sqlite.prepare(`
      INSERT INTO story_jingwei_entry (id, book_id, section_id, category, title, content_md, fields_json, layer, status, lifecycle, sort_order, created_at, updated_at)
      VALUES (?, 'book-1', ?, 'characters', '林渊', '人设正文', '{"realm":"筑基"}', 'canon', 'confirmed', 'active', 0, 1, 1)
    `).run(id, sectionId);

    const result = handleLoreProgress({
      bookId: "book-1",
      entryId: id,
      fieldKey: "realm",
      newValue: "结丹",
      chapterNumber: 12,
      reason: "第 12 章突破",
      storage,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("canon-entry-protected");
    expect(result.summary).toContain("lore.write");
  });

  it("resolves entries by title when entryId is omitted", async () => {
    const storage = await createStorage();
    const entryId = seedForeshadowing(storage, { status: "已埋设" });

    const result = handleLoreProgress({
      bookId: "book-1",
      title: "小瓶秘密",
      fieldKey: "status",
      newValue: "已兑现",
      chapterNumber: 30,
      reason: "第 30 章回收",
      storage,
    });

    expect(result.ok).toBe(true);
    expect(result.entryId).toBe(entryId);
  });
});
