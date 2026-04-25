import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createStorageDatabase, type StorageDatabase } from "../storage/db.js";
import { runStorageMigrations } from "../storage/migrations-runner.js";
import { createBibleChapterSummaryRepository } from "../bible/repositories/chapter-summary-repo.js";
import { createBibleCharacterRepository } from "../bible/repositories/character-repo.js";
import { createBibleEventRepository } from "../bible/repositories/event-repo.js";
import { createBibleSettingRepository } from "../bible/repositories/setting-repo.js";
import { createBookRepository } from "../bible/repositories/book-repo.js";
import { createBibleCharacterArcRepository } from "../bible/repositories/character-arc-repo.js";
import { createBibleConflictRepository } from "../bible/repositories/conflict-repo.js";
import { createBiblePremiseRepository } from "../bible/repositories/premise-repo.js";
import { createBibleWorldModelRepository } from "../bible/repositories/world-model-repo.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-bible-repo-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Novel Bible Phase A repositories", () => {
  it("applies the 0002 Bible migration with book-scoped tables", async () => {
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

      expect(migrationNames).toContain("0002_bible_v1.sql");
      expect(tableNames).toEqual(expect.arrayContaining([
        "book",
        "bible_character",
        "bible_event",
        "bible_setting",
        "bible_chapter_summary",
      ]));
    } finally {
      storage.close();
    }
  });

  it("stores books with bible mode and current chapter settings", async () => {
    const storage = await createStorage();
    try {
      const books = createBookRepository(storage);
      await books.create({
        id: "book-1",
        name: "凡人修仙录",
        bibleMode: "static",
        currentChapter: 3,
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
        updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      });

      const updated = await books.update("book-1", {
        bibleMode: "dynamic",
        currentChapter: 5,
        updatedAt: new Date("2026-04-25T02:00:00.000Z"),
      });

      expect(updated).toMatchObject({
        id: "book-1",
        name: "凡人修仙录",
        bibleMode: "dynamic",
        currentChapter: 5,
      });
      expect(updated?.updatedAt.toISOString()).toBe("2026-04-25T02:00:00.000Z");
    } finally {
      storage.close();
    }
  });

  it("keeps characters isolated by book and filters soft-deleted rows", async () => {
    const storage = await createStorage();
    try {
      const books = createBookRepository(storage);
      const characters = createBibleCharacterRepository(storage);
      await seedBooks(books);

      await characters.create({
        id: "char-1",
        bookId: "book-1",
        name: "韩立",
        aliasesJson: JSON.stringify(["韩老魔"]),
        roleType: "protagonist",
        summary: "谨慎求长生。",
        traitsJson: JSON.stringify({ careful: true }),
        visibilityRuleJson: JSON.stringify({ type: "tracked" }),
        firstChapter: 1,
        lastChapter: null,
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
        updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      });
      await characters.create({
        id: "char-2",
        bookId: "book-2",
        name: "隔壁主角",
        aliasesJson: "[]",
        roleType: "protagonist",
        summary: "不应出现在 book-1。",
        traitsJson: "{}",
        visibilityRuleJson: JSON.stringify({ type: "global" }),
        firstChapter: null,
        lastChapter: null,
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
        updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      });

      await characters.softDelete("book-1", "char-1", new Date("2026-04-25T03:00:00.000Z"));

      expect(await characters.getById("book-1", "char-1")).toBeNull();
      expect(await characters.listByBook("book-1")).toEqual([]);
      expect((await characters.listByBook("book-2")).map((row) => row.id)).toEqual(["char-2"]);
    } finally {
      storage.close();
    }
  });

  it("round-trips events, settings, and chapter summaries with book isolation", async () => {
    const storage = await createStorage();
    try {
      const books = createBookRepository(storage);
      const events = createBibleEventRepository(storage);
      const settings = createBibleSettingRepository(storage);
      const summaries = createBibleChapterSummaryRepository(storage);
      await seedBooks(books);

      await events.create({
        id: "event-1",
        bookId: "book-1",
        name: "小瓶现世",
        eventType: "foreshadow",
        chapterStart: 1,
        chapterEnd: 3,
        summary: "神秘小瓶成为长线伏笔。",
        relatedCharacterIdsJson: JSON.stringify(["char-1"]),
        visibilityRuleJson: JSON.stringify({ type: "tracked" }),
        foreshadowState: "buried",
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
        updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      });
      await settings.create({
        id: "setting-1",
        bookId: "book-1",
        category: "power-system",
        name: "练气体系",
        content: "以灵根与资源驱动晋升。",
        visibilityRuleJson: JSON.stringify({ type: "global" }),
        nestedRefsJson: JSON.stringify(["event-1"]),
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
        updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      });
      await summaries.upsert({
        id: "summary-1",
        bookId: "book-1",
        chapterNumber: 1,
        title: "初入山门",
        summary: "主角发现小瓶。",
        wordCount: 3200,
        keyEventsJson: JSON.stringify(["event-1"]),
        appearingCharacterIdsJson: JSON.stringify(["char-1"]),
        pov: "韩立",
        metadataJson: JSON.stringify({ filterReport: null }),
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
        updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      });
      await summaries.upsert({
        id: "summary-2",
        bookId: "book-2",
        chapterNumber: 1,
        title: "隔壁第一章",
        summary: "不应出现在 book-1。",
        wordCount: 1000,
        keyEventsJson: "[]",
        appearingCharacterIdsJson: "[]",
        pov: "",
        metadataJson: "{}",
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
        updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      });

      expect((await events.listByBook("book-1")).map((row) => row.name)).toEqual(["小瓶现世"]);
      expect((await settings.listByBook("book-1")).map((row) => row.name)).toEqual(["练气体系"]);
      expect((await summaries.listByBook("book-1")).map((row) => row.title)).toEqual(["初入山门"]);
      expect(await summaries.getByChapter("book-2", 1)).toMatchObject({ id: "summary-2", title: "隔壁第一章" });
    } finally {
      storage.close();
    }
  });

  it("applies the 0003 Phase B migration with cognitive-layer tables", async () => {
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

      expect(migrationNames).toContain("0003_bible_phaseB.sql");
      expect(tableNames).toEqual(expect.arrayContaining([
        "bible_conflict",
        "bible_world_model",
        "bible_premise",
        "bible_character_arc",
      ]));
    } finally {
      storage.close();
    }
  });

  it("enforces one premise and one world model per book", async () => {
    const storage = await createStorage();
    try {
      const books = createBookRepository(storage);
      const premises = createBiblePremiseRepository(storage);
      const worldModels = createBibleWorldModelRepository(storage);
      await seedBooks(books);

      await premises.upsert({
        id: "premise-1",
        bookId: "book-1",
        logline: "凡人靠谨慎与小瓶求长生。",
        themeJson: JSON.stringify(["谨慎", "长生"]),
        tone: "稳健",
        targetReaders: "凡人流读者",
        uniqueHook: "小瓶催熟资源",
        genreTagsJson: JSON.stringify(["玄幻", "修仙"]),
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
        updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      });
      const updatedPremise = await premises.upsert({
        id: "premise-2",
        bookId: "book-1",
        logline: "凡人以资源差撬动阶层跃迁。",
        themeJson: JSON.stringify(["阶层", "资源"]),
        tone: "现实",
        targetReaders: "升级流读者",
        uniqueHook: "低调经营",
        genreTagsJson: JSON.stringify(["玄幻"]),
        createdAt: new Date("2026-04-25T02:00:00.000Z"),
        updatedAt: new Date("2026-04-25T02:00:00.000Z"),
      });
      const savedWorldModel = await worldModels.upsert({
        id: "world-1",
        bookId: "book-1",
        economyJson: JSON.stringify({ currency: "灵石" }),
        societyJson: "{}",
        geographyJson: "{}",
        powerSystemJson: JSON.stringify({ levelTiers: ["练气", "筑基"] }),
        cultureJson: "{}",
        timelineJson: "{}",
        updatedAt: new Date("2026-04-25T03:00:00.000Z"),
      });
      const updatedWorldModel = await worldModels.upsert({
        id: "world-2",
        bookId: "book-1",
        economyJson: JSON.stringify({ currency: "贡献点" }),
        societyJson: "{}",
        geographyJson: "{}",
        powerSystemJson: "{}",
        cultureJson: "{}",
        timelineJson: "{}",
        updatedAt: new Date("2026-04-25T04:00:00.000Z"),
      });

      expect(updatedPremise).toMatchObject({ id: "premise-2", bookId: "book-1", logline: "凡人以资源差撬动阶层跃迁。" });
      expect((await premises.listByBook("book-1"))).toHaveLength(1);
      expect(savedWorldModel.bookId).toBe("book-1");
      expect(updatedWorldModel).toMatchObject({ id: "world-2", economyJson: JSON.stringify({ currency: "贡献点" }) });
      expect(await worldModels.getByBook("book-1")).toMatchObject({ id: "world-2" });
    } finally {
      storage.close();
    }
  });

  it("supports multiple character arcs per character and filters soft-deleted arcs", async () => {
    const storage = await createStorage();
    try {
      const books = createBookRepository(storage);
      const characters = createBibleCharacterRepository(storage);
      const arcs = createBibleCharacterArcRepository(storage);
      await seedBooks(books);
      await characters.create({
        id: "char-1",
        bookId: "book-1",
        name: "韩立",
        aliasesJson: "[]",
        roleType: "protagonist",
        summary: "谨慎求长生。",
        traitsJson: "{}",
        visibilityRuleJson: JSON.stringify({ type: "tracked" }),
        firstChapter: 1,
        lastChapter: null,
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
        updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      });

      await arcs.create({
        id: "arc-1",
        bookId: "book-1",
        characterId: "char-1",
        arcType: "成长",
        startingState: "凡人杂役",
        endingState: "独当一面的修士",
        keyTurningPointsJson: JSON.stringify([{ chapter: 5, summary: "首次独自脱险" }]),
        currentPosition: "学会保命",
        visibilityRuleJson: JSON.stringify({ type: "global" }),
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
        updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      });
      await arcs.create({
        id: "arc-2",
        bookId: "book-1",
        characterId: "char-1",
        arcType: "反转",
        startingState: "信任师门",
        endingState: "看清师门利益逻辑",
        keyTurningPointsJson: "[]",
        currentPosition: "开始怀疑",
        visibilityRuleJson: JSON.stringify({ type: "global" }),
        createdAt: new Date("2026-04-25T02:00:00.000Z"),
        updatedAt: new Date("2026-04-25T02:00:00.000Z"),
      });

      expect((await arcs.listByCharacter("book-1", "char-1")).map((row) => row.id)).toEqual(["arc-2", "arc-1"]);
      await arcs.softDelete("book-1", "arc-2", new Date("2026-04-25T03:00:00.000Z"));
      expect((await arcs.listByCharacter("book-1", "char-1")).map((row) => row.id)).toEqual(["arc-1"]);
    } finally {
      storage.close();
    }
  });

  it("returns active conflicts by chapter while excluding resolved and deferred conflicts", async () => {
    const storage = await createStorage();
    try {
      const books = createBookRepository(storage);
      const conflicts = createBibleConflictRepository(storage);
      await seedBooks(books);

      await conflicts.create({
        id: "conflict-main",
        bookId: "book-1",
        name: "资源稀缺",
        type: "system-scarcity",
        scope: "main",
        priority: 1,
        protagonistSideJson: JSON.stringify(["散修"]),
        antagonistSideJson: JSON.stringify(["宗门"]),
        stakes: "主角必须突破资源封锁。",
        rootCauseJson: JSON.stringify({ scarcity: "灵石" }),
        evolutionPathJson: JSON.stringify([{ chapter: 3, state: "brewing", summary: "被克扣资源", movedBy: "author", at: "2026-04-25T01:00:00.000Z" }]),
        resolutionState: "escalating",
        resolutionChapter: 20,
        relatedConflictIdsJson: "[]",
        visibilityRuleJson: JSON.stringify({ type: "global" }),
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
        updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      });
      await conflicts.create({
        id: "conflict-side",
        bookId: "book-1",
        name: "同门误会",
        type: "external-character",
        scope: "arc",
        priority: 3,
        protagonistSideJson: "[]",
        antagonistSideJson: "[]",
        stakes: "影响主角在外门立足。",
        rootCauseJson: "{}",
        evolutionPathJson: JSON.stringify([{ chapter: 8, state: "erupted", summary: "当众冲突", movedBy: "author" }]),
        resolutionState: "resolved",
        resolutionChapter: 12,
        relatedConflictIdsJson: "[]",
        visibilityRuleJson: JSON.stringify({ type: "tracked" }),
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
        updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      });

      expect((await conflicts.getActiveConflictsAtChapter("book-1", 2)).map((row) => row.id)).toEqual([]);
      expect((await conflicts.getActiveConflictsAtChapter("book-1", 10)).map((row) => row.id)).toEqual(["conflict-main"]);
      await conflicts.update("book-1", "conflict-main", { resolutionState: "deferred", updatedAt: new Date("2026-04-25T05:00:00.000Z") });
      expect(await conflicts.getActiveConflictsAtChapter("book-1", 10)).toEqual([]);
    } finally {
      storage.close();
    }
  });
});

async function seedBooks(books: ReturnType<typeof createBookRepository>) {
  await books.create({
    id: "book-1",
    name: "凡人修仙录",
    bibleMode: "static",
    currentChapter: 1,
    createdAt: new Date("2026-04-25T01:00:00.000Z"),
    updatedAt: new Date("2026-04-25T01:00:00.000Z"),
  });
  await books.create({
    id: "book-2",
    name: "隔壁书",
    bibleMode: "dynamic",
    currentChapter: 1,
    createdAt: new Date("2026-04-25T01:00:00.000Z"),
    updatedAt: new Date("2026-04-25T01:00:00.000Z"),
  });
}
