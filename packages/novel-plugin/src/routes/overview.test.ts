import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createOverviewRouter } from "./overview.js";

let storage: StorageDatabase;
let tempDir: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-overview-route-${crypto.randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("overview-stats", () => {
  it("章数与字数取章节索引：写了正文、还没做章后结算也照实显示", async () => {
    const app = createOverviewRouter({
      storage,
      loadChapterIndex: async (bookId) => (bookId === "book-1" ? [{ wordCount: 3120 }, { wordCount: 101 }] : []),
    });
    const stats = await (await app.request("/api/books/book-1/overview-stats")).json() as { chapterCount: number; wordCount: { total: number }; volumeProgress: { current: number } };
    expect(stats.chapterCount).toBe(2);
    expect(stats.wordCount.total).toBe(3221);
    expect(stats.volumeProgress.current).toBe(2);

    const empty = await (await app.request("/api/books/book-2/overview-stats")).json() as { chapterCount: number; wordCount: { total: number } };
    expect(empty).toMatchObject({ chapterCount: 0, wordCount: { total: 0 } });
  });
});
