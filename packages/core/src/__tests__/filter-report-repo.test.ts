import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createFilterReportRepository, createStorageDatabase, runStorageMigrations, type StorageDatabase } from "../index.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-filter-report-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("filter_report storage", () => {
  it("applies the 0005 filter migration and creates filter_report", async () => {
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

      expect(migrationNames).toContain("0005_filter_v1.sql");
      expect(tableNames).toContain("filter_report");
    } finally {
      storage.close();
    }
  });

  it("inserts reports and returns book/chapter/latest queries", async () => {
    const storage = await createStorage();
    try {
      const repo = createFilterReportRepository(storage);
      const first = await repo.insert({
        id: "report-1",
        bookId: "book-1",
        chapterNumber: 1,
        aiTasteScore: 72,
        level: "severe",
        hitCountsJson: JSON.stringify({ r03: 2 }),
        zhuqueScore: null,
        zhuqueStatus: "not-configured",
        details: JSON.stringify({ pgiUsed: false }),
        engineVersion: "filter-v1",
        scannedAt: new Date("2026-04-25T01:00:00.000Z"),
      });
      await repo.insert({
        ...first,
        id: "report-2",
        aiTasteScore: 24,
        level: "clean",
        scannedAt: new Date("2026-04-25T02:00:00.000Z"),
      });

      expect(await repo.listByBook("book-1")).toHaveLength(2);
      expect(await repo.listByChapter("book-1", 1)).toHaveLength(2);
      expect(await repo.latestByChapter("book-1", 1)).toMatchObject({ id: "report-2", level: "clean", aiTasteScore: 24 });
    } finally {
      storage.close();
    }
  });
});
