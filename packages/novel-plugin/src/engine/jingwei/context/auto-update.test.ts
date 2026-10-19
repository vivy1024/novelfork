/**
 * B4：章后变化抽取的演变台账不能在冲突时留下「假的推进记录」。
 *
 * `applyChapterChanges` 原先的次序是：先无条件 `INSERT INTO jingwei_progressions`，
 * 再做带 `expectedVersion` 的乐观更新。作者在机器读取之后手改过条目时，更新会一行都不写
 * （T-24 的既定语义：机器不覆盖作者，冲突记进待处理队列），但演变台账那行**已经落下**了——
 * 作者回看「谁把什么字段从什么推进到什么」会看到一次从未发生的推进，而且它和冲突记录互相矛盾。
 *
 * 临时目录放在仓库内被忽略的 `packages/novel-plugin/tmp/`。
 */
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeStorageDatabase,
  initializeStorageDatabase,
  runStorageMigrations,
  type StorageDatabase,
} from "@vivy1024/novelfork-core/storage";

import { applyChapterChanges } from "./auto-update.js";
import { listLedgerConflicts } from "../ledger-conflict-store.js";
import { createBookRepository } from "../repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../repositories/section-repo.js";

const TMP_ROOT = join(process.cwd(), "tmp", "jingwei-auto-update");

let storage: StorageDatabase;
let tempDir: string;

function listProgressions(): Array<Record<string, unknown>> {
  return storage.sqlite.prepare(`SELECT * FROM "jingwei_progressions" ORDER BY created_at`).all() as Array<Record<string, unknown>>;
}

beforeEach(async () => {
  tempDir = join(TMP_ROOT, crypto.randomUUID());
  await mkdir(tempDir, { recursive: true });
  // applyChapterChanges 内部走 getStorageDatabase() 单例，所以这里也用同一个入口建库。
  storage = initializeStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  const now = new Date("2026-09-01T00:00:00.000Z");
  await createBookRepository(storage).create({
    id: "book-1",
    name: "章后变化抽取测试",
    jingweiMode: "dynamic",
    currentChapter: 1,
    createdAt: now,
    updatedAt: now,
  });
  await createStoryJingweiSectionRepository(storage).create({
    id: "sec-1",
    bookId: "book-1",
    key: "characters",
    name: "角色",
    description: "",
    icon: null,
    order: 0,
    enabled: true,
    showInSidebar: true,
    participatesInAi: true,
    defaultVisibility: "tracked",
    fieldsJson: [],
    builtinKind: null,
    sourceTemplate: null,
    createdAt: now,
    updatedAt: now,
  });
});

afterEach(async () => {
  closeStorageDatabase();
  await rm(tempDir, { recursive: true, force: true });
});

async function createEntry(id: string, title: string, fields: Record<string, unknown> = {}): Promise<void> {
  const now = new Date("2026-09-01T00:00:00.000Z");
  await createStoryJingweiEntryRepository(storage).create({
    id,
    bookId: "book-1",
    sectionId: "sec-1",
    title,
    contentMd: "初始正文",
    category: "characters",
    fields,
    customFields: fields,
    tags: [],
    aliases: [],
    relatedChapterNumbers: [],
    relatedEntryIds: [],
    visibilityRule: { type: "tracked" },
    participatesInAi: true,
    tokenBudget: null,
    layer: "dynamic",
    status: "confirmed",
    source: "user",
    createdAt: now,
    updatedAt: now,
  });
}

const realmChange = {
  type: "realm_change" as const,
  entityName: "韩立",
  fieldKey: "realm",
  oldValue: "炼气",
  newValue: "筑基",
  description: "第 12 章突破",
};

describe("章后变化抽取的演变台账（B4）", () => {
  it("正常推进：字段更新并留下一条演变记录", async () => {
    await createEntry("entry-1", "韩立", { realm: "炼气" });

    const result = await applyChapterChanges("book-1", 12, [realmChange]);

    expect(result).toEqual({ applied: 1, skipped: 0, conflicted: 0 });
    const entry = await createStoryJingweiEntryRepository(storage).getById("book-1", "entry-1");
    expect((entry?.fields as Record<string, unknown>).realm).toBe("筑基");
    expect(listProgressions()).toHaveLength(1);
  });

  it("更新没落库时不留演变记录（B4 的核心不变式）", async () => {
    await createEntry("entry-1", "韩立", { realm: "炼气" });
    // 让这次更新必然失败：fields_json 不是合法 JSON，内层 JSON.parse 抛错被 catch 吞掉。
    // 修复前的次序是「先 INSERT 台账，再走更新」，所以这条推进会在没落到任何字段的情况下
    // 留在台账里——作者回看演变史会看到一次从未发生的推进。
    storage.sqlite.prepare(`UPDATE "story_jingwei_entry" SET "fields_json" = ? WHERE "id" = ?`)
      .run("{ 不是 JSON", "entry-1");

    await applyChapterChanges("book-1", 12, [realmChange]);

    expect(listProgressions()).toEqual([]);
  });

  it("更新失败不改变条目的版本号，也不写台账", async () => {
    await createEntry("entry-1", "韩立", { realm: "炼气" });
    const before = await createStoryJingweiEntryRepository(storage).getById("book-1", "entry-1");
    storage.sqlite.prepare(`UPDATE "story_jingwei_entry" SET "fields_json" = ? WHERE "id" = ?`)
      .run("{ 不是 JSON", "entry-1");

    await applyChapterChanges("book-1", 12, [realmChange]);

    const after = await createStoryJingweiEntryRepository(storage).getById("book-1", "entry-1");
    expect(after?.version).toBe(before?.version);
    expect(listProgressions()).toEqual([]);
    // 也没有莫名其妙的冲突记录：这次失败与「作者手改撞车」无关。
    expect(listLedgerConflicts(storage, "book-1")).toEqual([]);
  });

  it("演变记录带上 book_id（迁移里它是 NOT NULL）", async () => {
    await createEntry("entry-1", "韩立", { realm: "炼气" });

    await applyChapterChanges("book-1", 12, [realmChange]);

    const rows = listProgressions();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.book_id).toBe("book-1");
    expect(rows[0]?.chapter_number).toBe(12);
    expect(rows[0]?.field_key).toBe("realm");
  });

  it("同一章多条变化各自记账，id 不互相覆盖", async () => {
    await createEntry("entry-1", "韩立", { realm: "炼气" });
    await createEntry("entry-2", "南宫婉", { realm: "筑基" });

    const result = await applyChapterChanges("book-1", 12, [
      realmChange,
      { ...realmChange, entityName: "南宫婉", oldValue: "筑基", newValue: "结丹" },
    ]);

    expect(result.applied).toBe(2);
    const rows = listProgressions();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  });

  it("条目不存在时只计入 skipped，不写台账", async () => {
    const result = await applyChapterChanges("book-1", 12, [realmChange]);

    expect(result).toEqual({ applied: 0, skipped: 1, conflicted: 0 });
    expect(listProgressions()).toEqual([]);
  });
});
