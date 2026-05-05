import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStorageDestructiveService, type StorageDestructiveServiceState } from "./storage-destructive-service";

function buildChapter(number: number, fileName?: string) {
  return {
    number,
    title: `第${number}章`,
    status: "drafting" as const,
    wordCount: 0,
    createdAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z",
    auditIssues: [],
    lengthWarnings: [],
    ...(fileName ? { fileName } : {}),
  };
}

describe("storage destructive service", () => {
  let root: string;
  let index: ReturnType<typeof buildChapter>[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "novelfork-storage-destructive-service-"));
    index = [];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function createService() {
    const deleteBookRecord = vi.fn(() => ({ changes: 1 }));
    const state = {
      bookDir: (bookId: string) => join(root, "books", bookId),
      loadChapterIndex: vi.fn(async () => index),
      saveChapterIndex: vi.fn(async (_bookId: string, nextIndex: typeof index) => {
        index = [...nextIndex];
      }),
    };
    return { deleteBookRecord, state, service: createStorageDestructiveService({ state: state as StorageDestructiveServiceState, deleteBookRecord }) };
  }

  it("hard-deletes a book directory and removes its sqlite row", async () => {
    const { service, deleteBookRecord } = createService();
    const bookDir = join(root, "books", "book-1");
    await mkdir(bookDir, { recursive: true });
    await writeFile(join(bookDir, "book.json"), "{}", "utf-8");

    await expect(service.deleteBook("book-1")).resolves.toEqual({ ok: true, bookId: "book-1", mode: "hard-delete" });
    await expect(access(bookDir)).rejects.toThrow();
    expect(deleteBookRecord).toHaveBeenCalledWith("book-1");
  });

  it("keeps force-delete semantics for missing books", async () => {
    const { service } = createService();

    await expect(service.deleteBook("missing-book")).resolves.toMatchObject({ ok: true, bookId: "missing-book" });
  });

  it("deletes a chapter file and removes the chapter index entry", async () => {
    const { service } = createService();
    const chaptersDir = join(root, "books", "book-1", "chapters");
    await mkdir(chaptersDir, { recursive: true });
    await writeFile(join(chaptersDir, "0001_first.md"), "# 第一章", "utf-8");
    index = [buildChapter(1), buildChapter(2)];

    await expect(service.deleteChapter("book-1", 1)).resolves.toEqual({ ok: true, chapterNumber: 1, mode: "hard-delete" });
    await expect(access(join(chaptersDir, "0001_first.md"))).rejects.toThrow();
    expect(index.map((chapter) => chapter.number)).toEqual([2]);
  });

  it("reports missing chapter deletes without changing the index", async () => {
    const { service } = createService();
    await mkdir(join(root, "books", "book-1", "chapters"), { recursive: true });
    index = [buildChapter(1)];

    await expect(service.deleteChapter("book-1", 99)).resolves.toEqual({ error: "Chapter not found" });
    expect(index.map((chapter) => chapter.number)).toEqual([1]);
  });

  it("deletes story files and rejects unsafe names", async () => {
    const { service } = createService();
    const storyDir = join(root, "books", "book-1", "story");
    await mkdir(storyDir, { recursive: true });
    await writeFile(join(storyDir, "note.md"), "note", "utf-8");

    await expect(service.deleteStoryFile("book-1", "note.md")).resolves.toEqual({ ok: true, file: "note.md", mode: "hard-delete" });
    await expect(access(join(storyDir, "note.md"))).rejects.toThrow();
    await expect(service.deleteStoryFile("book-1", "../secret.md")).resolves.toEqual({ error: "Invalid file name" });
  });
});
