import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { StateManager, createBookRepository, createStorageDatabase, runStorageMigrations } from "@vivy1024/novelfork-core";

import { createNarrativeLineRouter } from "./narrative-line.js";

const tempDirs: string[] = [];

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "novelfork-narrative-route-"));
  tempDirs.push(root);
  const state = new StateManager(root);
  const storage = createStorageDatabase({ databasePath: join(root, "novelfork.db") });
  runStorageMigrations(storage);
  await createBookRepository(storage).create({
    id: "book-1",
    name: "天墟试炼",
    bibleMode: "dynamic",
    currentChapter: 2,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
  });
  const bookDir = join(root, "books", "book-1");
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await mkdir(join(bookDir, "story"), { recursive: true });
  await writeFile(join(bookDir, "book.json"), JSON.stringify({ id: "book-1", title: "天墟试炼", platform: "qidian", genre: "玄幻", status: "active" }), "utf-8");
  await writeFile(join(bookDir, "chapters", "index.json"), JSON.stringify([
    { number: 1, title: "入山", status: "approved", wordCount: 3000, auditIssues: [], lengthWarnings: [] },
  ]), "utf-8");
  const router = createNarrativeLineRouter({ state, storage, now: () => new Date("2026-05-03T00:00:00.000Z") });
  return { storage, router };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("narrative line route", () => {
  it("returns the read-only narrative line snapshot for a book", async () => {
    const harness = await createHarness();
    try {
      const response = await harness.router.request("http://localhost/api/books/book-1/narrative-line");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        snapshot: {
          bookId: "book-1",
          generatedAt: "2026-05-03T00:00:00.000Z",
          nodes: [expect.objectContaining({ id: "chapter:book-1:1", type: "chapter" })],
          edges: [],
          warnings: expect.any(Array),
        },
      });
    } finally {
      harness.storage.close();
    }
  });
});
