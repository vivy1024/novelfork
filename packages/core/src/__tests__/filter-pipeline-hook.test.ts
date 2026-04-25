import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  createBibleChapterSummaryRepository,
  createBookRepository,
  createFilterReportRepository,
  createStorageDatabase,
  runStorageMigrations,
  scanChapterAndStoreFilterReport,
  type StorageDatabase,
} from "../index.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-filter-hook-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  await createBookRepository(storage).create({
    id: "book-1",
    name: "凡人修仙录",
    bibleMode: "dynamic",
    currentChapter: 1,
    createdAt: new Date("2026-04-25T01:00:00.000Z"),
    updatedAt: new Date("2026-04-25T01:00:00.000Z"),
  });
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("filter pipeline hook", () => {
  it("stores filter report and writes filterReportId to chapter metadata with PGI flag", async () => {
    const storage = await createStorage();
    try {
      await createBibleChapterSummaryRepository(storage).upsert({
        id: "summary-1",
        bookId: "book-1",
        chapterNumber: 1,
        title: "第一章",
        summary: "旧摘要",
        wordCount: 3000,
        keyEventsJson: "[]",
        appearingCharacterIdsJson: "[]",
        pov: "韩立",
        metadataJson: JSON.stringify({ pgi_answers: { "conflict-escalate:1": "推到 climax" } }),
        createdAt: new Date("2026-04-25T01:00:00.000Z"),
        updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      });

      const report = await scanChapterAndStoreFilterReport(storage, {
        bookId: "book-1",
        chapterNumber: 1,
        text: "首先，值得注意的是，以下是为您生成的内容。最后，这非常开心。".repeat(20),
      });

      const stored = await createFilterReportRepository(storage).latestByChapter("book-1", 1);
      const summary = await createBibleChapterSummaryRepository(storage).getByChapter("book-1", 1);
      expect(stored).toMatchObject({ id: report.filterReportId, chapterNumber: 1, level: report.level });
      expect(JSON.parse(stored?.details ?? "{}")).toMatchObject({ pgiUsed: true });
      expect(JSON.parse(summary?.metadataJson ?? "{}")).toMatchObject({ filterReportId: report.filterReportId });
    } finally {
      storage.close();
    }
  });
});
