import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createBibleChapterSummaryRepository } from "../bible/repositories/chapter-summary-repo.js";
import { createBibleCharacterRepository } from "../bible/repositories/character-repo.js";
import { createBibleEventRepository } from "../bible/repositories/event-repo.js";
import { createBibleSettingRepository } from "../bible/repositories/setting-repo.js";
import { createBookRepository } from "../bible/repositories/book-repo.js";
import { createLegacyBibleJingweiAdapter } from "../jingwei/context/section-adapter.js";
import { createStoryJingweiSectionRepository } from "../jingwei/repositories/section-repo.js";
import { createStorageDatabase, type StorageDatabase } from "../storage/db.js";
import { runStorageMigrations } from "../storage/migrations-runner.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-jingwei-legacy-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function seedBook(storage: StorageDatabase): Promise<void> {
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
}

async function seedLegacyBible(storage: StorageDatabase): Promise<void> {
  const createdAt = new Date("2026-04-25T02:00:00.000Z");
  await createBibleCharacterRepository(storage).create({
    id: "char-1",
    bookId: "book-1",
    name: "韩立",
    aliasesJson: JSON.stringify(["韩老魔"]),
    roleType: "protagonist",
    summary: "谨慎求长生。",
    traitsJson: JSON.stringify({ realm: "练气" }),
    visibilityRuleJson: JSON.stringify({ type: "tracked", visibleAfterChapter: 1 }),
    firstChapter: 1,
    lastChapter: null,
    createdAt,
    updatedAt: createdAt,
  });
  await createBibleEventRepository(storage).create({
    id: "event-1",
    bookId: "book-1",
    name: "小瓶现世",
    eventType: "foreshadow",
    chapterStart: 1,
    chapterEnd: 3,
    summary: "小瓶成为长线伏笔。",
    relatedCharacterIdsJson: JSON.stringify(["char-1"]),
    visibilityRuleJson: JSON.stringify({ type: "tracked", visibleAfterChapter: 1, keywords: ["小瓶"] }),
    foreshadowState: "buried",
    createdAt,
    updatedAt: createdAt,
  });
  await createBibleSettingRepository(storage).create({
    id: "setting-1",
    bookId: "book-1",
    category: "power-system",
    name: "练气体系",
    content: "以灵根与资源驱动晋升。",
    visibilityRuleJson: JSON.stringify({ type: "global" }),
    nestedRefsJson: JSON.stringify(["event-1"]),
    createdAt,
    updatedAt: createdAt,
  });
  await createBibleChapterSummaryRepository(storage).upsert({
    id: "summary-1",
    bookId: "book-1",
    chapterNumber: 1,
    title: "初入山门",
    summary: "主角发现小瓶。",
    wordCount: 3200,
    keyEventsJson: JSON.stringify(["event-1"]),
    appearingCharacterIdsJson: JSON.stringify(["char-1"]),
    pov: "韩立",
    metadataJson: JSON.stringify({ source: "legacy" }),
    createdAt,
    updatedAt: createdAt,
  });
}

describe("legacy Bible to story jingwei adapter", () => {
  it("creates non-destructive default jingwei sections when legacy Bible rows exist", async () => {
    const storage = await createStorage();
    try {
      await seedBook(storage);
      await seedLegacyBible(storage);
      const adapter = createLegacyBibleJingweiAdapter(storage);
      const sections = await adapter.ensureLegacySections("book-1", new Date("2026-04-25T03:00:00.000Z"));
      const sectionRepo = createStoryJingweiSectionRepository(storage);

      expect(sections.map((section) => section.name)).toEqual(["人物", "事件", "设定", "章节摘要"]);
      expect(sections.map((section) => section.sourceTemplate)).toEqual(["legacy-bible", "legacy-bible", "legacy-bible", "legacy-bible"]);
      expect((await sectionRepo.listByBook("book-1")).map((section) => section.key)).toEqual(["people", "events", "settings", "chapter-summary"]);

      const secondRun = await adapter.ensureLegacySections("book-1", new Date("2026-04-25T04:00:00.000Z"));
      expect(secondRun.map((section) => section.id)).toEqual(sections.map((section) => section.id));
      expect(await createBibleCharacterRepository(storage).getById("book-1", "char-1")).toMatchObject({ name: "韩立" });
    } finally {
      storage.close();
    }
  });

  it("adapts legacy characters, events, settings and chapter summaries into generic jingwei entries", async () => {
    const storage = await createStorage();
    try {
      await seedBook(storage);
      await seedLegacyBible(storage);
      const adapter = createLegacyBibleJingweiAdapter(storage);
      await adapter.ensureLegacySections("book-1", new Date("2026-04-25T03:00:00.000Z"));

      const entries = await adapter.listLegacyEntries("book-1");
      expect(entries.map((entry) => [entry.sectionId, entry.title])).toEqual([
        ["legacy-bible:book-1:people", "韩立"],
        ["legacy-bible:book-1:events", "小瓶现世"],
        ["legacy-bible:book-1:settings", "练气体系"],
        ["legacy-bible:book-1:chapter-summary", "初入山门"],
      ]);
      expect(entries[0]).toMatchObject({
        id: "legacy-bible:character:char-1",
        aliases: ["韩老魔"],
        customFields: { roleType: "protagonist", traits: { realm: "练气" }, firstChapter: 1, lastChapter: null },
        visibilityRule: { type: "tracked", visibleAfterChapter: 1 },
      });
      expect(entries[1]).toMatchObject({
        id: "legacy-bible:event:event-1",
        relatedEntryIds: ["legacy-bible:character:char-1"],
        relatedChapterNumbers: [1, 3],
        visibilityRule: { type: "tracked", visibleAfterChapter: 1, keywords: ["小瓶"] },
      });
      expect(entries[2]).toMatchObject({
        id: "legacy-bible:setting:setting-1",
        tags: ["power-system"],
        relatedEntryIds: ["legacy-bible:event:event-1"],
        visibilityRule: { type: "global" },
      });
      expect(entries[3]).toMatchObject({
        id: "legacy-bible:chapter-summary:summary-1",
        relatedChapterNumbers: [1],
        customFields: { wordCount: 3200, pov: "韩立", metadata: { source: "legacy" } },
      });
    } finally {
      storage.close();
    }
  });
});
