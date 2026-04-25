import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { buildBibleContext } from "../bible/context/build-bible-context.js";
import { createBookRepository } from "../bible/repositories/book-repo.js";
import { createBibleCharacterRepository } from "../bible/repositories/character-repo.js";
import { createBibleEventRepository } from "../bible/repositories/event-repo.js";
import { createBibleSettingRepository } from "../bible/repositories/setting-repo.js";
import { createStorageDatabase, type StorageDatabase } from "../storage/db.js";
import { runStorageMigrations } from "../storage/migrations-runner.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-bible-context-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("buildBibleContext", () => {
  it("uses only global timeline-visible entries in static mode", async () => {
    const storage = await createStorage();
    try {
      await seedBook(storage, "static");

      const result = await buildBibleContext({
        storage,
        bookId: "book-1",
        currentChapter: 5,
        sceneText: "韩老魔发现小瓶现世。",
        tokenBudget: 8000,
      });

      expect(result.mode).toBe("static");
      expect(result.items.map((item) => item.id)).toEqual(["setting-global"]);
      expect(result.items[0]?.content).toBe("【设定-power-system】修炼体系：修炼依赖灵根、功法与资源。");
    } finally {
      storage.close();
    }
  });

  it("uses global, tracked alias hits, and nested references in dynamic mode", async () => {
    const storage = await createStorage();
    try {
      await seedBook(storage, "dynamic");

      const result = await buildBibleContext({
        storage,
        bookId: "book-1",
        currentChapter: 5,
        sceneText: "韩老魔发现小瓶现世，却不知道未来秘辛。",
        tokenBudget: 8000,
      });

      expect(result.mode).toBe("dynamic");
      expect(result.items.map((item) => item.id)).toEqual([
        "setting-global",
        "event-nested-secret",
        "character-hanli",
        "event-bottle",
      ]);
      expect(result.items.map((item) => item.source)).toEqual(["global", "nested", "tracked", "tracked"]);
    } finally {
      storage.close();
    }
  });

  it("falls back to global-only dynamic output when scene text is missing", async () => {
    const storage = await createStorage();
    try {
      await seedBook(storage, "dynamic");

      const result = await buildBibleContext({ storage, bookId: "book-1", currentChapter: 5 });

      expect(result.items.map((item) => item.id)).toEqual(["setting-global"]);
    } finally {
      storage.close();
    }
  });

  it("deduplicates entries and applies token budget after merging", async () => {
    const storage = await createStorage();
    try {
      await seedBook(storage, "dynamic");

      const result = await buildBibleContext({
        storage,
        bookId: "book-1",
        currentChapter: 5,
        sceneText: "韩立韩老魔小瓶现世",
        tokenBudget: 15,
      });

      expect(new Set(result.items.map((item) => item.id)).size).toBe(result.items.length);
      expect(result.droppedIds).toContain("character-hanli");
      expect(result.items.map((item) => item.id)).toEqual(["setting-global", "event-nested-secret"]);
    } finally {
      storage.close();
    }
  });

  it("can build context from a 30+ entry fixture without leaking other books", async () => {
    const storage = await createStorage();
    try {
      await seedBook(storage, "dynamic");
      await seedBulkEntries(storage);

      const result = await buildBibleContext({
        storage,
        bookId: "book-1",
        currentChapter: 5,
        sceneText: "批量角色17与批量设定8都提到了韩立。隔壁角色不该出现。",
        tokenBudget: 8000,
      });

      expect(result.items.some((item) => item.name === "批量角色17")).toBe(true);
      expect(result.items.some((item) => item.name === "批量设定8")).toBe(true);
      expect(result.items.some((item) => item.name === "隔壁角色")).toBe(false);
    } finally {
      storage.close();
    }
  });
});

async function seedBook(storage: StorageDatabase, bibleMode: "static" | "dynamic") {
  const books = createBookRepository(storage);
  const characters = createBibleCharacterRepository(storage);
  const events = createBibleEventRepository(storage);
  const settings = createBibleSettingRepository(storage);
  const now = new Date("2026-04-25T01:00:00.000Z");

  await books.create({ id: "book-1", name: "凡人修仙录", bibleMode, currentChapter: 5, createdAt: now, updatedAt: now });
  await books.create({ id: "book-2", name: "隔壁书", bibleMode: "dynamic", currentChapter: 5, createdAt: now, updatedAt: now });
  await characters.create({
    id: "character-hanli",
    bookId: "book-1",
    name: "韩立",
    aliasesJson: JSON.stringify(["韩老魔"]),
    roleType: "protagonist",
    summary: "谨慎求长生。",
    traitsJson: "{}",
    visibilityRuleJson: JSON.stringify({ type: "tracked" }),
    firstChapter: 1,
    lastChapter: null,
    createdAt: now,
    updatedAt: new Date("2026-04-25T01:03:00.000Z"),
  });
  await characters.create({
    id: "other-character",
    bookId: "book-2",
    name: "隔壁角色",
    aliasesJson: "[]",
    roleType: "protagonist",
    summary: "不能泄漏。",
    traitsJson: "{}",
    visibilityRuleJson: JSON.stringify({ type: "global" }),
    firstChapter: 1,
    lastChapter: null,
    createdAt: now,
    updatedAt: now,
  });
  await events.create({
    id: "event-bottle",
    bookId: "book-1",
    name: "小瓶现世",
    eventType: "foreshadow",
    chapterStart: 1,
    chapterEnd: null,
    summary: "小瓶成为长线伏笔。",
    relatedCharacterIdsJson: JSON.stringify(["character-hanli"]),
    visibilityRuleJson: JSON.stringify({ type: "tracked" }),
    foreshadowState: "buried",
    createdAt: now,
    updatedAt: new Date("2026-04-25T01:02:00.000Z"),
  });
  await events.create({
    id: "event-future",
    bookId: "book-1",
    name: "未来秘辛",
    eventType: "key",
    chapterStart: 99,
    chapterEnd: null,
    summary: "第 99 章才揭示，不能提前泄漏。",
    relatedCharacterIdsJson: "[]",
    visibilityRuleJson: JSON.stringify({ type: "tracked", visibleAfterChapter: 99 }),
    foreshadowState: null,
    createdAt: now,
    updatedAt: now,
  });
  await events.create({
    id: "event-nested-secret",
    bookId: "book-1",
    name: "瓶中秘源",
    eventType: "background",
    chapterStart: 1,
    chapterEnd: null,
    summary: "小瓶力量来自隐秘源头。",
    relatedCharacterIdsJson: "[]",
    visibilityRuleJson: JSON.stringify({ type: "nested", parentIds: ["setting-global"] }),
    foreshadowState: null,
    createdAt: now,
    updatedAt: new Date("2026-04-25T01:04:00.000Z"),
  });
  await settings.create({
    id: "setting-global",
    bookId: "book-1",
    category: "power-system",
    name: "修炼体系",
    content: "修炼依赖灵根、功法与资源。",
    visibilityRuleJson: JSON.stringify({ type: "global" }),
    nestedRefsJson: JSON.stringify(["event-nested-secret"]),
    createdAt: now,
    updatedAt: new Date("2026-04-25T01:05:00.000Z"),
  });
}

async function seedBulkEntries(storage: StorageDatabase) {
  const characters = createBibleCharacterRepository(storage);
  const settings = createBibleSettingRepository(storage);
  const now = new Date("2026-04-25T02:00:00.000Z");

  for (let index = 0; index < 20; index += 1) {
    await characters.create({
      id: `bulk-character-${index}`,
      bookId: "book-1",
      name: `批量角色${index}`,
      aliasesJson: "[]",
      roleType: "minor",
      summary: `批量角色${index}摘要。`,
      traitsJson: "{}",
      visibilityRuleJson: JSON.stringify({ type: "tracked" }),
      firstChapter: 1,
      lastChapter: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (let index = 0; index < 11; index += 1) {
    await settings.create({
      id: `bulk-setting-${index}`,
      bookId: "book-1",
      category: "other",
      name: `批量设定${index}`,
      content: `批量设定${index}内容。`,
      visibilityRuleJson: JSON.stringify({ type: "tracked" }),
      nestedRefsJson: "[]",
      createdAt: now,
      updatedAt: now,
    });
  }
}
