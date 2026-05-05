import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStorageWriteService, type StorageWriteServiceState } from "./storage-write-service";

function buildBook(overrides: Record<string, unknown> = {}) {
  return {
    id: "book-1",
    title: "测试书",
    platform: "qidian" as const,
    genre: "xuanhuan",
    status: "active" as const,
    targetChapters: 80,
    chapterWordCount: 2600,
    language: "zh" as const,
    createdAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z",
    ...overrides,
  };
}

function buildChapter(number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    title: `第${number}章`,
    status: "drafting" as const,
    wordCount: 0,
    createdAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z",
    auditIssues: [],
    lengthWarnings: [],
    ...overrides,
  };
}

describe("storage write service", () => {
  let root: string;
  let index: ReturnType<typeof buildChapter>[];
  let book: ReturnType<typeof buildBook>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "novelfork-storage-write-service-"));
    index = [];
    book = buildBook();
    await mkdir(join(root, "books", "book-1", "chapters"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function createService() {
    const state = {
      bookDir: (bookId: string) => join(root, "books", bookId),
      loadBookConfig: vi.fn(async () => book),
      saveBookConfig: vi.fn(async (_bookId: string, updated: typeof book) => {
        book = updated;
      }),
      loadChapterIndex: vi.fn(async () => index),
      saveChapterIndex: vi.fn(async (_bookId: string, nextIndex: typeof index) => {
        index = [...nextIndex];
        await mkdir(join(root, "books", "book-1", "chapters"), { recursive: true });
        await writeFile(join(root, "books", "book-1", "chapters", "index.json"), JSON.stringify(index, null, 2), "utf-8");
      }),
      getNextChapterNumber: vi.fn(async () => Math.max(0, ...index.map((chapter) => chapter.number)) + 1),
    };
    return { state, service: createStorageWriteService({ state: state as StorageWriteServiceState, now: () => "2026-05-05T12:00:00.000Z" }) };
  }

  it("updates book config while preserving existing fields", async () => {
    const { service, state } = createService();

    await expect(service.updateBook("book-1", { targetChapters: 120, language: "en" })).resolves.toMatchObject({
      ok: true,
      book: { id: "book-1", title: "测试书", targetChapters: 120, language: "en", updatedAt: "2026-05-05T12:00:00.000Z" },
    });
    expect(state.saveBookConfig).toHaveBeenCalledWith("book-1", expect.objectContaining({ targetChapters: 120, language: "en" }));
  });

  it("creates a chapter file and keeps the index sorted", async () => {
    const { service } = createService();
    index = [buildChapter(2, { title: "第二章", wordCount: 20 })];

    await expect(service.createChapter("book-1", { title: "第一章", afterChapterNumber: 0 })).resolves.toMatchObject({
      chapter: { number: 3, title: "第一章", status: "drafting", fileName: "0003_第一章.md" },
    });
    await expect(readFile(join(root, "books", "book-1", "chapters", "0003_第一章.md"), "utf-8")).resolves.toBe("# 第一章\n\n");
    expect(index.map((chapter) => chapter.number)).toEqual([2, 3]);
  });

  it("updates an existing chapter file and reports missing chapters", async () => {
    const { service } = createService();
    await writeFile(join(root, "books", "book-1", "chapters", "0001_first.md"), "old", "utf-8");

    await expect(service.updateChapterContent("book-1", 1, "new content")).resolves.toEqual({ ok: true, chapterNumber: 1 });
    await expect(readFile(join(root, "books", "book-1", "chapters", "0001_first.md"), "utf-8")).resolves.toBe("new content");
    await expect(service.updateChapterContent("book-1", 99, "missing")).resolves.toEqual({ error: "Chapter not found" });
  });

  it("writes truth files through the story directory and rejects invalid truth files", async () => {
    const { service } = createService();

    await expect(service.writeTruthFile("book-1", "story_bible.md", "# Bible")).resolves.toEqual({ ok: true });
    await expect(readFile(join(root, "books", "book-1", "story", "story_bible.md"), "utf-8")).resolves.toBe("# Bible");
    await expect(service.writeTruthFile("book-1", "evil_file.md", "bad")).resolves.toEqual({ error: "Invalid truth file" });
  });

  it("builds export payloads from saved chapter files", async () => {
    const { service } = createService();
    index = [
      buildChapter(1, { status: "approved", fileName: "0001_first.md" }),
      buildChapter(2, { status: "drafting", fileName: "0002_second.md" }),
    ];
    await writeFile(join(root, "books", "book-1", "chapters", "0001_first.md"), "# 第一章\n\n甲乙", "utf-8");
    await writeFile(join(root, "books", "book-1", "chapters", "0002_second.md"), "# 第二章\n\n丙丁", "utf-8");

    await expect(service.buildExport("book-1", { format: "markdown" })).resolves.toMatchObject({
      fileName: "book-1.md",
      contentType: "text/markdown; charset=utf-8",
      content: expect.stringContaining("---"),
      chapterCount: 2,
    });
    await expect(service.buildExport("book-1", { format: "txt", approvedOnly: true })).resolves.toMatchObject({
      fileName: "book-1.txt",
      content: "# 第一章\n\n甲乙",
      chapterCount: 1,
    });
    await expect(service.buildExport("book-1", { format: "pdf" })).resolves.toEqual({ error: "Unsupported export format: pdf" });
  });
});
