import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createBookRepository } from "./book-repo.js";
import { createStoryJingweiEntryRepository } from "./entry-repo.js";
import { createStoryJingweiSectionRepository } from "./section-repo.js";

const tempDirs: string[] = [];
const storages: StorageDatabase[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-jingwei-entry-repo-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storages.push(storage);
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  await createBookRepository(storage).create({
    id: "book-1",
    name: "测试书",
    jingweiMode: "dynamic",
    currentChapter: 1,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  await createStoryJingweiSectionRepository(storage).create({
    id: "section-1",
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
    builtinKind: "characters",
    sourceTemplate: "test",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  return storage;
}

afterEach(async () => {
  for (const storage of storages.splice(0)) storage.close();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("story jingwei entry fields merge semantics", () => {
  async function createForeshadowingEntry(storage: StorageDatabase) {
    return createStoryJingweiEntryRepository(storage).create({
      id: "entry-foreshadowing",
      bookId: "book-1",
      sectionId: "section-1",
      title: "血仇伏笔",
      contentMd: "韩立的血仇伏笔",
      tags: [],
      aliases: [],
      fields: {
        name: "血仇伏笔",
        description: "墨大夫夺舍之恨",
        plantedChapter: 3,
        targetChapter: 40,
        status: "已埋设",
      },
      customFields: {
        name: "血仇伏笔",
        description: "墨大夫夺舍之恨",
        plantedChapter: 3,
        targetChapter: 40,
        status: "已埋设",
      },
      relatedChapterNumbers: [],
      relatedEntryIds: [],
      visibilityRule: { type: "tracked" },
      participatesInAi: true,
      tokenBudget: null,
      createdAt: new Date("2026-08-01T01:00:00.000Z"),
      updatedAt: new Date("2026-08-01T01:00:00.000Z"),
    });
  }

  it("fieldsPatch 只增量合并传入键，保留其余 fields（伏笔拖拽改状态不丢数据）", async () => {
    const storage = await createStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await createForeshadowingEntry(storage);

    await repo.update("book-1", "entry-foreshadowing", {
      fieldsPatch: { status: "已回收" },
      source: "user",
    });

    const entry = await repo.getById("book-1", "entry-foreshadowing");
    expect(entry?.fields).toEqual({
      name: "血仇伏笔",
      description: "墨大夫夺舍之恨",
      plantedChapter: 3,
      targetChapter: 40,
      status: "已回收",
    });
    const row = storage.sqlite.prepare<{ fields_json: string; custom_fields_json: string }>(`
      SELECT fields_json, custom_fields_json FROM story_jingwei_entry WHERE id = ?
    `).get("entry-foreshadowing");
    expect(JSON.parse(row!.fields_json)).toEqual(entry!.fields);
    expect(JSON.parse(row!.custom_fields_json)).toEqual(entry!.fields);
  });

  it("customFields-only 更新同样是合并而非整体替换", async () => {
    const storage = await createStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await createForeshadowingEntry(storage);

    await repo.update("book-1", "entry-foreshadowing", {
      customFields: { status: "已废弃" },
      source: "user",
    });

    const entry = await repo.getById("book-1", "entry-foreshadowing");
    expect(entry?.fields).toEqual({
      name: "血仇伏笔",
      description: "墨大夫夺舍之恨",
      plantedChapter: 3,
      targetChapter: 40,
      status: "已废弃",
    });
  });

  it("fields 显式提供时仍整体替换（编辑器全量提交语义不变）", async () => {
    const storage = await createStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await createForeshadowingEntry(storage);

    await repo.update("book-1", "entry-foreshadowing", {
      fields: { status: "已回收", note: "只保留这两个键" },
      source: "user",
    });

    const entry = await repo.getById("book-1", "entry-foreshadowing");
    expect(entry?.fields).toEqual({ status: "已回收", note: "只保留这两个键" });
  });
});

describe("story jingwei entry authority and revisions", () => {
  async function createEntry(storage: StorageDatabase) {
    return createStoryJingweiEntryRepository(storage).create({
      id: "entry-1",
      bookId: "book-1",
      sectionId: "section-1",
      title: "旧标题",
      contentMd: "旧正文",
      tags: [],
      aliases: [],
      customFields: { category: "characters", phase: "初始" },
      relatedChapterNumbers: [],
      relatedEntryIds: [],
      visibilityRule: { type: "tracked" },
      participatesInAi: true,
      tokenBudget: null,
      createdAt: new Date("2026-08-01T01:00:00.000Z"),
      updatedAt: new Date("2026-08-01T01:00:00.000Z"),
    });
  }

  it("promotes legacy customFields input into canonical fields and category", async () => {
    const storage = await createStorage();
    const created = await createEntry(storage);

    expect(created.category).toBe("characters");
    expect(created.fields).toEqual({ category: "characters", phase: "初始" });
    const row = storage.sqlite.prepare<{ fields_json: string; custom_fields_json: string }>(`
      SELECT fields_json, custom_fields_json FROM story_jingwei_entry WHERE id = ?
    `).get("entry-1");
    expect(JSON.parse(row!.fields_json)).toEqual(created.fields);
    expect(JSON.parse(row!.custom_fields_json)).toEqual(created.fields);
  });

  it("records the complete previous snapshot in jingwei_revision only", async () => {
    const storage = await createStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await createEntry(storage);

    await repo.update("book-1", "entry-1", {
      contentMd: "新正文",
      fields: { category: "characters", phase: "变化" },
      source: "user",
      revisionReason: "manual-edit",
    });

    const revisions = await repo.listRevisions("book-1", "entry-1");
    expect(revisions[0]).toMatchObject({
      contentMd: "旧正文",
      changedBy: "user",
      reason: "manual-edit",
      snapshot: {
        title: "旧标题",
        contentMd: "旧正文",
        category: "characters",
        fields: { category: "characters", phase: "初始" },
      },
    });

    const entry = await repo.getById("book-1", "entry-1");
    expect(entry?.revisionHistory).toEqual([]);
    expect(entry?.fields.phase).toBe("变化");
  });

  it("reverts all editable fields and saves the current state as a new revision", async () => {
    const storage = await createStorage();
    const repo = createStoryJingweiEntryRepository(storage);
    await createEntry(storage);
    await repo.update("book-1", "entry-1", {
      title: "新标题",
      contentMd: "新正文",
      category: "relationships",
      fields: { phase: "变化" },
      priorityTier: "core",
      source: "user",
    });
    const target = (await repo.listRevisions("book-1", "entry-1"))[0]!;

    const reverted = await repo.revertToRevision("book-1", "entry-1", target.id, { updatedAt: new Date("2026-08-02T00:00:00.000Z") });

    expect(reverted).toMatchObject({
      title: "旧标题",
      contentMd: "旧正文",
      category: "characters",
      fields: { category: "characters", phase: "初始" },
      priorityTier: "auto",
      version: 3,
    });
    expect(await repo.listRevisions("book-1", "entry-1")).toHaveLength(2);
  });
});
