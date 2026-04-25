import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  createBibleChapterSummaryRepository,
  createBookRepository,
  createStorageDatabase,
  runStorageMigrations,
  type StorageDatabase,
} from "@vivy1024/novelfork-core";

import { createFilterRouter } from "./filter.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-filter-api-${crypto.randomUUID()}`);
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
    metadataJson: JSON.stringify({ pgi_answers: { q: "a" } }),
    createdAt: new Date("2026-04-25T01:00:00.000Z"),
    updatedAt: new Date("2026-04-25T01:00:00.000Z"),
  });
  return storage;
}

async function postJson(router: ReturnType<typeof createFilterRouter>, path: string, body: unknown) {
  return router.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("filter API routes", () => {
  it("scans text, stores chapter report, returns trend report, and suggests seven tactics", async () => {
    const storage = await createStorage();
    try {
      const router = createFilterRouter({ storage });

      const scan = await postJson(router, "/api/filter/scan", {
        bookId: "book-1",
        chapterNumber: 1,
        text: "首先，值得注意的是，以下是为您生成的内容。最后，这非常开心。".repeat(20),
        persist: true,
      });
      expect(scan.status).toBe(200);
      const scanJson = await scan.json();
      expect(scanJson.report).toMatchObject({ level: "severe", pgiUsed: true, filterReportId: expect.any(String) });

      const report = await router.request("http://localhost/api/books/book-1/filter/report?groupByPgi=true");
      expect(report.status).toBe(200);
      expect(await report.json()).toMatchObject({ overall: { totalChapters: 1 }, pgiUsed: { count: 1 } });

      const chapter = await router.request("http://localhost/api/books/book-1/filter/report/1");
      expect(chapter.status).toBe(200);
      expect(await chapter.json()).toMatchObject({ report: { chapterNumber: 1, details: { pgiUsed: true } } });

      const suggest = await postJson(router, "/api/filter/suggest-rewrite", { text: "测试", ruleIds: ["r03", "r11"] });
      expect(suggest.status).toBe(200);
      expect(await suggest.json()).toMatchObject({ suggestions: expect.arrayContaining([expect.objectContaining({ tacticId: 2 }), expect.objectContaining({ tacticId: 4 })]) });
    } finally {
      storage.close();
    }
  });
});
