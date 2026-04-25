import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  analyzeCoreShiftImpact,
  createBibleChapterSummaryRepository,
  createBiblePremiseRepository,
  createBookRepository,
  createCoreShiftRepository,
  createStorageDatabase,
  proposeCoreShift,
  rejectCoreShift,
  acceptCoreShift,
  runStorageMigrations,
  type StorageDatabase,
} from "../index.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-core-shift-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CoreShift protocol", () => {
  it("creates proposed shifts with affected chapter impact analysis", async () => {
    const storage = await createStorage();
    try {
      await seedBook(storage);
      await seedSummaries(storage);

      const impact = await analyzeCoreShiftImpact(storage, {
        bookId: "book-1",
        targetType: "premise",
        targetId: "premise-1",
        snapshot: { logline: "资源差改变命运" },
      });
      const shift = await proposeCoreShift(storage, {
        id: "shift-1",
        bookId: "book-1",
        targetType: "premise",
        targetId: "premise-1",
        fromSnapshot: { logline: "凡人谨慎求长生" },
        toSnapshot: { logline: "资源差改变命运" },
        triggeredBy: "author",
        chapterAt: 3,
        createdAt: new Date("2026-04-25T05:00:00.000Z"),
      });

      expect(impact.affectedChapters).toEqual([1, 3]);
      expect(shift.status).toBe("proposed");
      expect(JSON.parse(shift.affectedChaptersJson)).toEqual([1, 3]);
    } finally {
      storage.close();
    }
  });

  it("accepts and rejects premise shifts transactionally", async () => {
    const storage = await createStorage();
    try {
      await seedBook(storage);
      await seedSummaries(storage);
      await createBiblePremiseRepository(storage).upsert({
        id: "premise-1",
        bookId: "book-1",
        logline: "旧基线",
        themeJson: JSON.stringify(["旧主题"]),
        tone: "稳健",
        targetReaders: "老读者",
        uniqueHook: "旧钩子",
        genreTagsJson: JSON.stringify(["修仙"]),
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
        updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      });

      await proposeCoreShift(storage, {
        id: "shift-accept",
        bookId: "book-1",
        targetType: "premise",
        targetId: "premise-1",
        fromSnapshot: { logline: "旧基线", tone: "稳健" },
        toSnapshot: { logline: "新基线", tone: "热血" },
        triggeredBy: "author",
        chapterAt: 3,
        createdAt: new Date("2026-04-25T05:00:00.000Z"),
      });

      const accepted = await acceptCoreShift(storage, "book-1", "shift-accept", new Date("2026-04-25T06:00:00.000Z"));
      const premise = await createBiblePremiseRepository(storage).getByBook("book-1");
      const summary = await createBibleChapterSummaryRepository(storage).getByChapter("book-1", 1);
      expect(accepted?.status).toBe("applied");
      expect(premise).toMatchObject({ logline: "新基线", tone: "热血" });
      expect(JSON.parse(summary?.metadataJson ?? "{}").coreShiftReviewRequired).toEqual(["shift-accept"]);

      await proposeCoreShift(storage, {
        id: "shift-reject",
        bookId: "book-1",
        targetType: "premise",
        targetId: "premise-1",
        fromSnapshot: { logline: "新基线", tone: "热血" },
        toSnapshot: { logline: "被拒绝基线", tone: "黑暗" },
        triggeredBy: "author",
        chapterAt: 4,
      });
      const rejected = await rejectCoreShift(storage, "book-1", "shift-reject", new Date("2026-04-25T07:00:00.000Z"));
      expect(rejected?.status).toBe("rejected");
      expect(await createBiblePremiseRepository(storage).getByBook("book-1")).toMatchObject({ logline: "新基线", tone: "热血" });
      expect(await createCoreShiftRepository(storage).listByBook("book-1", "rejected")).toHaveLength(1);
    } finally {
      storage.close();
    }
  });
});

async function seedBook(storage: StorageDatabase) {
  await createBookRepository(storage).create({
    id: "book-1",
    name: "凡人修仙录",
    bibleMode: "dynamic",
    currentChapter: 3,
    createdAt: new Date("2026-04-25T01:00:00.000Z"),
    updatedAt: new Date("2026-04-25T01:00:00.000Z"),
  });
}

async function seedSummaries(storage: StorageDatabase) {
  const summaries = createBibleChapterSummaryRepository(storage);
  await summaries.upsert({
    id: "summary-1",
    bookId: "book-1",
    chapterNumber: 1,
    title: "第一章",
    summary: "旧基线里，凡人谨慎求长生。",
    wordCount: 3000,
    keyEventsJson: JSON.stringify(["premise-1"]),
    appearingCharacterIdsJson: "[]",
    pov: "韩立",
    metadataJson: JSON.stringify({ refs: ["premise-1"] }),
    createdAt: new Date("2026-04-25T01:00:00.000Z"),
    updatedAt: new Date("2026-04-25T01:00:00.000Z"),
  });
  await summaries.upsert({
    id: "summary-3",
    bookId: "book-1",
    chapterNumber: 3,
    title: "第三章",
    summary: "资源差改变命运的伏笔出现。",
    wordCount: 3000,
    keyEventsJson: "[]",
    appearingCharacterIdsJson: "[]",
    pov: "韩立",
    metadataJson: "{}",
    createdAt: new Date("2026-04-25T03:00:00.000Z"),
    updatedAt: new Date("2026-04-25T03:00:00.000Z"),
  });
}
