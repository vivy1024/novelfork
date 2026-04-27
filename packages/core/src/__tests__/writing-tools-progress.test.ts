import crypto from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createStorageDatabase, type StorageDatabase } from "../storage/db.js";
import { runStorageMigrations } from "../storage/migrations-runner.js";
import { getDailyProgress, getProgressTrend, recordChapterCompletion } from "../tools/progress/daily-tracker.js";

const tempDirs: string[] = [];

async function createTestStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-progress-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  return storage;
}

async function seedBook(storage: StorageDatabase, bookId: string): Promise<void> {
  storage.sqlite.exec(
    `INSERT INTO "book" ("id", "name", "bible_mode", "current_chapter", "created_at", "updated_at")
     VALUES ('${bookId}', 'test', 'static', 0, ${Date.now()}, ${Date.now()})`,
  );
}

afterEach(() => {
  tempDirs.length = 0;
});

describe("daily-tracker", () => {
  it("records and queries chapter completion", async () => {
    const storage = await createTestStorage();
    await seedBook(storage, "book-1");

    await recordChapterCompletion(storage, {
      date: "2026-04-26",
      bookId: "book-1",
      chapterNumber: 1,
      wordCount: 3000,
      completedAt: "2026-04-26T10:00:00.000Z",
    });

    const progress = await getDailyProgress(storage, { dailyTarget: 3000 }, { today: "2026-04-26" });

    expect(progress.today.written).toBe(3000);
    expect(progress.today.completed).toBe(true);
  });

  it("calculates streak across consecutive days", async () => {
    const storage = await createTestStorage();
    await seedBook(storage, "book-1");

    for (let i = 0; i < 5; i += 1) {
      const day = `2026-04-${String(22 + i).padStart(2, "0")}`;
      await recordChapterCompletion(storage, {
        date: day,
        bookId: "book-1",
        chapterNumber: i + 1,
        wordCount: 3500,
        completedAt: `${day}T10:00:00.000Z`,
      });
    }

    const progress = await getDailyProgress(storage, { dailyTarget: 3000 }, { today: "2026-04-26" });

    expect(progress.streak).toBe(5);
  });

  it("breaks streak when a day is below target", async () => {
    const storage = await createTestStorage();
    await seedBook(storage, "book-1");

    await recordChapterCompletion(storage, {
      date: "2026-04-24",
      bookId: "book-1",
      chapterNumber: 1,
      wordCount: 3500,
      completedAt: "2026-04-24T10:00:00.000Z",
    });
    await recordChapterCompletion(storage, {
      date: "2026-04-25",
      bookId: "book-1",
      chapterNumber: 2,
      wordCount: 1000,
      completedAt: "2026-04-25T10:00:00.000Z",
    });
    await recordChapterCompletion(storage, {
      date: "2026-04-26",
      bookId: "book-1",
      chapterNumber: 3,
      wordCount: 3500,
      completedAt: "2026-04-26T10:00:00.000Z",
    });

    const progress = await getDailyProgress(storage, { dailyTarget: 3000 }, { today: "2026-04-26" });

    expect(progress.streak).toBe(1);
  });

  it("returns zero progress for empty database", async () => {
    const storage = await createTestStorage();

    const progress = await getDailyProgress(storage, { dailyTarget: 3000 }, { today: "2026-04-26" });

    expect(progress.today.written).toBe(0);
    expect(progress.today.completed).toBe(false);
    expect(progress.streak).toBe(0);
    expect(progress.last30Days).toEqual([]);
  });

  it("returns progress trend for requested days", async () => {
    const storage = await createTestStorage();
    await seedBook(storage, "book-1");

    await recordChapterCompletion(storage, {
      date: "2026-04-25",
      bookId: "book-1",
      chapterNumber: 1,
      wordCount: 2000,
      completedAt: "2026-04-25T10:00:00.000Z",
    });
    await recordChapterCompletion(storage, {
      date: "2026-04-26",
      bookId: "book-1",
      chapterNumber: 2,
      wordCount: 4000,
      completedAt: "2026-04-26T10:00:00.000Z",
    });

    const trend = await getProgressTrend(storage, 7, "2026-04-26");

    expect(trend).toEqual([
      { date: "2026-04-25", wordCount: 2000 },
      { date: "2026-04-26", wordCount: 4000 },
    ]);
  });

  it("aggregates multiple logs on the same day", async () => {
    const storage = await createTestStorage();
    await seedBook(storage, "book-1");

    await recordChapterCompletion(storage, {
      date: "2026-04-26",
      bookId: "book-1",
      chapterNumber: 1,
      wordCount: 2000,
      completedAt: "2026-04-26T08:00:00.000Z",
    });
    await recordChapterCompletion(storage, {
      date: "2026-04-26",
      bookId: "book-1",
      chapterNumber: 2,
      wordCount: 2000,
      completedAt: "2026-04-26T14:00:00.000Z",
    });

    const progress = await getDailyProgress(storage, { dailyTarget: 3000 }, { today: "2026-04-26" });

    expect(progress.today.written).toBe(4000);
    expect(progress.today.completed).toBe(true);
  });
});
