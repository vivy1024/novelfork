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
    ensureRuntimeState: vi.fn(async (_bookId: string, _fallbackChapter?: number): Promise<void> => undefined),
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
      recoveryReport: {
        counts: {
          success: 3,
          skipped: 0,
          failed: 0,
        },
      },
    });
    expect(summary.indexedDocuments).toBe(0);
    expect(summary.recoveryReport.startedAt).toEqual(expect.any(String));
    expect(summary.recoveryReport.finishedAt).toEqual(expect.any(String));
    expect(summary.recoveryReport.actions).toHaveLength(3);
    expect(summary.recoveryReport.actions[0]).toMatchObject({
      kind: "runtime-state",
      scope: "book",
      bookId: "alpha",
      status: "success",
      reason: "运行态已补建",
      note: "fallbackChapter=2",
    });
    expect(summary.recoveryReport.actions[1]).toMatchObject({
      kind: "runtime-state",
      scope: "book",
      bookId: "beta",
      status: "success",
      reason: "运行态已补建",
      note: "fallbackChapter=3",
    });
    expect(summary.recoveryReport.actions[2]).toMatchObject({
      kind: "search-index",
      scope: "library",
      status: "success",
      reason: "内存搜索索引已重建",
      note: "bookCount=2, indexedDocuments=0, skippedBooks=0",
    });
  });

  it("records failed and skipped recovery steps in the report", async () => {
    const state = createState();
    state.loadChapterIndex.mockImplementation(async (bookId: string) => {
      if (bookId === "beta") {
        throw new Error("missing chapter index");
      }
      return [
        { number: 1, title: "第一章" },
        { number: 2, title: "第二章" },
      ];
    });
    state.ensureRuntimeState.mockImplementation(async (bookId: string): Promise<void> => {
      if (bookId === "beta") {
        throw new Error("runtime repair failed");
      }
    });

    const summary = await runStartupOrchestrator(state);

    expect(summary).toMatchObject({
      bookCount: 2,
      migratedBooks: 1,
      skippedBooks: 1,
      failures: [
        {
          bookId: "beta",
          phase: "migration",
          message: "runtime repair failed",
        },
      ],
      recoveryReport: {
        counts: {
          success: 2,
          skipped: 1,
          failed: 1,
        },
      },
    });
    expect(summary.recoveryReport.actions).toHaveLength(4);
    expect(summary.recoveryReport.actions[0]).toMatchObject({
      kind: "runtime-state",
      scope: "book",
      bookId: "alpha",
      status: "success",
    });
    expect(summary.recoveryReport.actions[1]).toMatchObject({
      kind: "runtime-state",
      scope: "book",
      bookId: "beta",
      status: "failed",
      reason: "运行态补建失败",
      note: "runtime repair failed",
    });
    expect(summary.recoveryReport.actions[2]).toMatchObject({
      kind: "search-index",
      scope: "library",
      status: "success",
      reason: "内存搜索索引已重建",
      note: "bookCount=2, indexedDocuments=0, skippedBooks=1",
    });
    expect(summary.recoveryReport.actions[3]).toMatchObject({
      kind: "search-index",
      scope: "library",
      status: "skipped",
      reason: "部分书籍在索引重建中被跳过",
      note: "skippedBooks=1",
    });
  });

  it("records delivery and compile smoke actions when startup packaging context is provided", async () => {
    const state = createState();

    const summary = await runStartupOrchestrator(state, {
      projectBootstrap: {
        status: "success",
        reason: "项目配置已自动初始化",
        note: "novelfork.json created",
      },
      staticDelivery: {
        mode: "embedded",
        hasIndexHtml: true,
        reason: "使用内嵌静态资源启动",
      },
      compileSmoke: {
        status: "success",
        reason: "编译产物检查通过",
        note: "embedded-index-ready",
      },
    });

    expect(summary.recoveryReport.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "project-bootstrap",
          scope: "library",
          status: "success",
          reason: "项目配置已自动初始化",
          note: "novelfork.json created",
        }),
        expect.objectContaining({
          kind: "static-delivery",
          scope: "library",
          status: "success",
          reason: "使用内嵌静态资源启动",
          note: "mode=embedded, indexHtml=true",
        }),
        expect.objectContaining({
          kind: "compile-smoke",
          scope: "library",
          status: "success",
          reason: "编译产物检查通过",
          note: "embedded-index-ready",
        }),
      ]),
    );
    expect(summary.delivery).toMatchObject({
      staticMode: "embedded",
      indexHtmlReady: true,
      compileSmokeStatus: "success",
      compileCommand: "pnpm bun:compile",
      expectedArtifactPath: "dist/novelfork",
      embeddedAssetsReady: true,
      singleFileReady: true,
      excludedDeliveryScopes: ["installer", "signing", "auto-update", "first-launch UX"],
    });
  });

  it("keeps filesystem startup separate from the single-file delivery signal", async () => {
    const state = createState();

    const summary = await runStartupOrchestrator(state, {
      staticDelivery: {
        mode: "filesystem",
        hasIndexHtml: true,
        reason: "使用文件系统静态资源启动",
      },
      compileSmoke: {
        status: "success",
        reason: "静态资源入口可用",
      },
    });

    expect(summary.delivery).toMatchObject({
      staticMode: "filesystem",
      indexHtmlReady: true,
      compileSmokeStatus: "success",
      embeddedAssetsReady: false,
      singleFileReady: false,
    });
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
