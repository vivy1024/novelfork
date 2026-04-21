import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { globalSearchIndex } from "../search-index.js";
import { rebuildSearchIndex } from "../search-index-rebuild.js";
import { runStartupOrchestrator } from "../startup-orchestrator.js";

let tempRoot = "";

function createState() {
  return {
    listBooks: vi.fn(async () => ["alpha", "beta"]),
    bookDir: vi.fn((bookId: string) => `/workspace/books/${bookId}`),
    loadChapterIndex: vi.fn(async (bookId: string) => {
      if (bookId === "alpha") {
        return [
          { number: 1, title: "第一章" },
          { number: 2, title: "第二章" },
        ];
      }
      return [{ number: 3, title: "第三章" }];
    }),
    ensureRuntimeState: vi.fn(async () => undefined),
  };
}

describe("startup orchestrator", () => {
  beforeEach(() => {
    globalSearchIndex.clear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    globalSearchIndex.clear();
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = "";
    }
  });

  it("bootstraps runtime state for every book before rebuilding search index", async () => {
    const state = createState();

    const summary = await runStartupOrchestrator(state);

    expect(state.ensureRuntimeState).toHaveBeenNthCalledWith(1, "alpha", 2);
    expect(state.ensureRuntimeState).toHaveBeenNthCalledWith(2, "beta", 3);
    expect(summary).toMatchObject({
      bookCount: 2,
      migratedBooks: 2,
      skippedBooks: 0,
      failures: [],
    });
    expect(summary.indexedDocuments).toBe(0);
  });

  it("rebuilds the in-memory search index from current book files", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "novelfork-search-rebuild-"));
    const bookDir = join(tempRoot, "books", "alpha");
    await mkdir(join(bookDir, "story"), { recursive: true });
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "book.json"), JSON.stringify({ id: "alpha" }), "utf-8");
    await writeFile(join(bookDir, "chapters", "0001_hello.md"), "# 第一章\n内容", "utf-8");
    await writeFile(join(bookDir, "chapters", "index.json"), JSON.stringify([
      { number: 1, title: "第一章" },
    ]), "utf-8");
    await writeFile(join(bookDir, "story", "story_bible.md"), "世界观设定", "utf-8");

    const state = {
      listBooks: vi.fn(async () => ["alpha"]),
      bookDir: vi.fn((bookId: string) => join(tempRoot, "books", bookId)),
      loadChapterIndex: vi.fn(async () => [{ number: 1, title: "第一章" }]),
    };

    const summary = await rebuildSearchIndex(state);

    expect(summary).toMatchObject({
      bookCount: 1,
      indexedDocuments: 2,
      skippedBooks: 0,
    });
    expect(globalSearchIndex.size()).toBe(2);
    expect(globalSearchIndex.search("第一章", "chapter")).toHaveLength(1);
  });

  it("falls back to chapter filenames when the chapter index is missing", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "novelfork-search-fallback-"));
    const bookDir = join(tempRoot, "books", "alpha");
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "book.json"), JSON.stringify({ id: "alpha" }), "utf-8");
    await writeFile(join(bookDir, "chapters", "0001_hello.md"), "# 第一章\n内容", "utf-8");
    await writeFile(join(bookDir, "chapters", "0002_world.md"), "# 第二章\n更多内容", "utf-8");

    const state = {
      listBooks: vi.fn(async () => ["alpha"]),
      bookDir: vi.fn((bookId: string) => join(tempRoot, "books", bookId)),
      loadChapterIndex: vi.fn(async () => []),
    };

    const summary = await rebuildSearchIndex(state);

    expect(summary).toMatchObject({
      bookCount: 1,
      indexedDocuments: 2,
      skippedBooks: 0,
    });
    expect(globalSearchIndex.size()).toBe(2);
    expect(globalSearchIndex.get("chapter:alpha:1")).toBeDefined();
    expect(globalSearchIndex.get("chapter:alpha:2")).toBeDefined();
  });
});
