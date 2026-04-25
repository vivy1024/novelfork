import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../bible/repositories/book-repo.js";
import { createStorageDatabase, type StorageDatabase } from "../storage/db.js";
import { runStorageMigrations } from "../storage/migrations-runner.js";
import { createStoryJingweiEntryRepository } from "../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../jingwei/repositories/section-repo.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-jingwei-repo-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function seedBooks(storage: StorageDatabase): Promise<void> {
  const books = createBookRepository(storage);
  const createdAt = new Date("2026-04-25T01:00:00.000Z");
  await books.create({
    id: "book-1",
    name: "凡人修仙录",
    bibleMode: "dynamic",
    currentChapter: 3,
    createdAt,
    updatedAt: createdAt,
  });
  await books.create({
    id: "book-2",
    name: "隔壁小说",
    bibleMode: "dynamic",
    currentChapter: 1,
    createdAt,
    updatedAt: createdAt,
  });
}

describe("Story Jingwei repositories", () => {
  it("applies the 0006 generic story jingwei migration", async () => {
    const storage = await createStorage();
    try {
      const migrationNames = storage.sqlite
        .prepare(`SELECT name FROM "drizzle_migrations" ORDER BY name`)
        .all()
        .map((row) => (row as { name: string }).name);
      const tableNames = storage.sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
        .all()
        .map((row) => (row as { name: string }).name);

      expect(migrationNames).toContain("0006_story_jingwei.sql");
      expect(tableNames).toEqual(expect.arrayContaining([
        "story_jingwei_section",
        "story_jingwei_entry",
      ]));
    } finally {
      storage.close();
    }
  });

  it("stores editable sections with book isolation, soft delete, ordering, and AI eligibility", async () => {
    const storage = await createStorage();
    try {
      await seedBooks(storage);
      const sections = createStoryJingweiSectionRepository(storage);
      const now = new Date("2026-04-25T02:00:00.000Z");

      await sections.create({
        id: "section-events",
        bookId: "book-1",
        key: "events",
        name: "事件",
        description: "关键事件",
        icon: "calendar",
        order: 2,
        enabled: true,
        showInSidebar: true,
        participatesInAi: true,
        defaultVisibility: "tracked",
        fieldsJson: [{ id: "field-state", key: "state", label: "状态", type: "select", required: false, options: ["埋设", "回收"] }],
        builtinKind: "events",
        sourceTemplate: "basic",
        createdAt: now,
        updatedAt: now,
      });
      await sections.create({
        id: "section-people",
        bookId: "book-1",
        key: "people",
        name: "人物",
        description: "人物关系",
        icon: null,
        order: 1,
        enabled: false,
        showInSidebar: true,
        participatesInAi: true,
        defaultVisibility: "global",
        fieldsJson: [],
        builtinKind: "people",
        sourceTemplate: "basic",
        createdAt: now,
        updatedAt: now,
      });
      await sections.create({
        id: "section-other-book",
        bookId: "book-2",
        key: "people",
        name: "隔壁人物",
        description: "不应出现在 book-1",
        icon: null,
        order: 1,
        enabled: true,
        showInSidebar: true,
        participatesInAi: true,
        defaultVisibility: "global",
        fieldsJson: [],
        builtinKind: "people",
        sourceTemplate: "basic",
        createdAt: now,
        updatedAt: now,
      });

      expect((await sections.listByBook("book-1")).map((section) => section.id)).toEqual(["section-people", "section-events"]);
      expect((await sections.listEnabledForAi("book-1")).map((section) => section.id)).toEqual(["section-events"]);

      const renamed = await sections.update("book-1", "section-people", {
        name: "角色",
        enabled: true,
        order: 3,
        fieldsJson: [{ id: "field-alias", key: "alias", label: "别名", type: "text", required: false }],
        updatedAt: new Date("2026-04-25T03:00:00.000Z"),
      });
      expect(renamed).toMatchObject({ name: "角色", enabled: true, order: 3 });
      expect(renamed?.fieldsJson[0]?.label).toBe("别名");
      expect((await sections.listByBook("book-1")).map((section) => section.id)).toEqual(["section-events", "section-people"]);

      await sections.softDelete("book-1", "section-events", new Date("2026-04-25T04:00:00.000Z"));
      expect(await sections.getById("book-1", "section-events")).toBeNull();
      expect((await sections.listByBook("book-1")).map((section) => section.id)).toEqual(["section-people"]);
      expect((await sections.listByBook("book-2")).map((section) => section.id)).toEqual(["section-other-book"]);
    } finally {
      storage.close();
    }
  });

  it("stores generic entries with custom fields, relations, visibility rules, and section queries", async () => {
    const storage = await createStorage();
    try {
      await seedBooks(storage);
      const sections = createStoryJingweiSectionRepository(storage);
      const entries = createStoryJingweiEntryRepository(storage);
      const now = new Date("2026-04-25T02:00:00.000Z");
      await sections.create({
        id: "section-people",
        bookId: "book-1",
        key: "people",
        name: "人物",
        description: "人物关系",
        icon: null,
        order: 1,
        enabled: true,
        showInSidebar: true,
        participatesInAi: true,
        defaultVisibility: "tracked",
        fieldsJson: [],
        builtinKind: "people",
        sourceTemplate: "basic",
        createdAt: now,
        updatedAt: now,
      });
      await sections.create({
        id: "section-other-book",
        bookId: "book-2",
        key: "people",
        name: "隔壁人物",
        description: "不应出现在 book-1",
        icon: null,
        order: 1,
        enabled: true,
        showInSidebar: true,
        participatesInAi: true,
        defaultVisibility: "tracked",
        fieldsJson: [],
        builtinKind: "people",
        sourceTemplate: "basic",
        createdAt: now,
        updatedAt: now,
      });

      await entries.create({
        id: "entry-1",
        bookId: "book-1",
        sectionId: "section-people",
        title: "韩立",
        contentMd: "谨慎求长生。",
        tags: ["主角", "凡人流"],
        aliases: ["韩老魔"],
        customFields: { realm: "练气" },
        relatedChapterNumbers: [1, 2],
        relatedEntryIds: ["entry-2"],
        visibilityRule: { type: "tracked", visibleAfterChapter: 1, keywords: ["小瓶"] },
        participatesInAi: true,
        tokenBudget: 512,
        createdAt: now,
        updatedAt: now,
      });
      await entries.create({
        id: "entry-2",
        bookId: "book-1",
        sectionId: "section-people",
        title: "小瓶",
        contentMd: "催熟资源。",
        tags: ["法宝"],
        aliases: [],
        customFields: {},
        relatedChapterNumbers: [1],
        relatedEntryIds: [],
        visibilityRule: { type: "nested", parentEntryIds: ["entry-1"] },
        participatesInAi: true,
        tokenBudget: null,
        createdAt: now,
        updatedAt: now,
      });
      await entries.create({
        id: "entry-other-book",
        bookId: "book-2",
        sectionId: "section-other-book",
        title: "隔壁主角",
        contentMd: "不应出现在 book-1。",
        tags: [],
        aliases: [],
        customFields: {},
        relatedChapterNumbers: [],
        relatedEntryIds: [],
        visibilityRule: { type: "global" },
        participatesInAi: true,
        tokenBudget: null,
        createdAt: now,
        updatedAt: now,
      });

      const entryRows = await entries.listBySection("book-1", "section-people");
      const first = entryRows.find((entry) => entry.id === "entry-1");
      expect(first).toMatchObject({
        id: "entry-1",
        title: "韩立",
        tags: ["主角", "凡人流"],
        aliases: ["韩老魔"],
        customFields: { realm: "练气" },
        relatedChapterNumbers: [1, 2],
        relatedEntryIds: ["entry-2"],
        visibilityRule: { type: "tracked", visibleAfterChapter: 1, keywords: ["小瓶"] },
        tokenBudget: 512,
      });

      const updated = await entries.update("book-1", "entry-1", {
        relatedEntryIds: ["entry-2", "entry-3"],
        participatesInAi: false,
        updatedAt: new Date("2026-04-25T03:00:00.000Z"),
      });
      expect(updated).toMatchObject({ relatedEntryIds: ["entry-2", "entry-3"], participatesInAi: false });

      await entries.softDelete("book-1", "entry-2", new Date("2026-04-25T04:00:00.000Z"));
      expect((await entries.listByBook("book-1")).map((entry) => entry.id)).toEqual(["entry-1"]);
      expect((await entries.listByBook("book-2")).map((entry) => entry.id)).toEqual(["entry-other-book"]);
      expect(await entries.getById("book-1", "entry-2")).toBeNull();
    } finally {
      storage.close();
    }
  });
});
