import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Hono } from "hono";

// ----------------------------------------------------------------
// Mock setup — mirrors the pattern from server.test.ts
// ----------------------------------------------------------------

const initBookMock = vi.fn();
const runRadarMock = vi.fn();
const reviseDraftMock = vi.fn();
const resyncChapterArtifactsMock = vi.fn();
const writeNextChapterMock = vi.fn();
const writeDraftMock = vi.fn();
const rollbackToChapterMock = vi.fn();
const saveChapterIndexMock = vi.fn();
const loadChapterIndexMock = vi.fn();
const saveBookConfigMock = vi.fn();
const loadBookConfigMock = vi.fn();
const listBooksMock = vi.fn();
const getNextChapterNumberMock = vi.fn();
const createLLMClientMock = vi.fn(() => ({}));
const chatCompletionMock = vi.fn();
const loadProjectConfigMock = vi.fn();
const computeAnalyticsMock = vi.fn(() => ({ totalWords: 0, chapterCount: 0 }));
const analyzeAITellsMock = vi.fn(() => ({
  score: 0.3,
  issues: [],
  summary: "ok",
}));
const schedulerStartMock = vi.fn<() => Promise<void>>();
const pipelineConfigs: unknown[] = [];

const logger = {
  child: () => logger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@vivy1024/novelfork-core", () => {
  class MockStateManager {
    constructor(private readonly root: string) {}

    async listBooks(): Promise<string[]> {
      return listBooksMock();
    }

    async loadBookConfig(bookId: string): Promise<Record<string, unknown>> {
      return loadBookConfigMock(bookId);
    }

    async loadChapterIndex(bookId: string): Promise<unknown[]> {
      return loadChapterIndexMock(bookId);
    }

    async saveChapterIndex(bookId: string, index: unknown): Promise<void> {
      await saveChapterIndexMock(bookId, index);
    }

    async saveBookConfig(bookId: string, config: unknown): Promise<void> {
      await saveBookConfigMock(bookId, config);
    }

    async rollbackToChapter(
      bookId: string,
      chapterNumber: number,
    ): Promise<number[]> {
      return (await rollbackToChapterMock(bookId, chapterNumber)) as number[];
    }

    async getNextChapterNumber(bookId: string): Promise<number> {
      return getNextChapterNumberMock(bookId);
    }

    bookDir(id: string): string {
      return join(this.root, "books", id);
    }
  }

  class MockPipelineRunner {
    constructor(config: unknown) {
      pipelineConfigs.push(config);
    }

    initBook = initBookMock;
    runRadar = runRadarMock;
    reviseDraft = reviseDraftMock;
    resyncChapterArtifacts = resyncChapterArtifactsMock;
    writeNextChapter = writeNextChapterMock;
    writeDraft = writeDraftMock;
  }

  class MockScheduler {
    private running = false;

    constructor(_config: unknown) {}

    async start(): Promise<void> {
      this.running = true;
      await schedulerStartMock();
    }

    stop(): void {
      this.running = false;
    }

    get isRunning(): boolean {
      return this.running;
    }
  }

  const sessionRows = new Map<string, any>();
  const messageRows = new Map<string, any[]>();
  const bookRows = new Map<string, any>();
  const storyJingweiSectionRows = new Map<string, any>();
  const storageDatabaseMock = {
    close: vi.fn(),
    checkpoint: vi.fn(),
    sqlite: {
      prepare(sql: string) {
        return {
          run(id: string) {
            if (sql.includes('DELETE FROM "book"')) {
              const deleted = bookRows.delete(id);
              for (const [sectionId, section] of storyJingweiSectionRows.entries()) {
                if (section.bookId === id) storyJingweiSectionRows.delete(sectionId);
              }
              return { changes: deleted ? 1 : 0 };
            }
            return { changes: 0 };
          },
        };
      },
    },
  };

  function applyJingweiTemplateMock(selection: { templateId: string }) {
    const basicSections = ["人物", "事件", "设定", "章节摘要"].map((name, order) => ({ key: `section-${order}`, name, order }));
    const enhancedSections = ["伏笔", "名场面", "核心记忆"].map((name, index) => ({ key: `enhanced-${index}`, name, order: basicSections.length + index }));
    return {
      templateId: selection.templateId,
      sections: selection.templateId === "enhanced" ? [...basicSections, ...enhancedSections] : basicSections,
      availableCandidates: [],
    };
  }

  function createSessionRepositoryMock() {
    return {
      async create(input: any) {
        const row = { ...input, deletedAt: null };
        sessionRows.set(input.id, row);
        return row;
      },
      async getById(id: string) {
        const row = sessionRows.get(id);
        return row && !row.deletedAt ? row : null;
      },
      async list() {
        return [...sessionRows.values()].filter((row) => !row.deletedAt);
      },
      async update(id: string, updates: any) {
        const row = sessionRows.get(id);
        if (!row || row.deletedAt) return null;
        const next = { ...row, ...updates };
        sessionRows.set(id, next);
        return next;
      },
      async softDelete(id: string) {
        const row = sessionRows.get(id);
        if (!row || row.deletedAt) return false;
        sessionRows.set(id, { ...row, deletedAt: new Date() });
        return true;
      },
    };
  }

  function createSessionMessageRepositoryMock() {
    return {
      async appendMessages(sessionId: string, messages: any[], seedMessages: any[] = []) {
        const existing = messageRows.get(sessionId) ?? [];
        const next = existing.length > 0 ? [...existing] : seedMessages.map((message, index) => ({ ...message, sessionId, seq: message.seq ?? index + 1 }));
        for (const message of messages) {
          next.push({ ...message, sessionId, seq: message.seq ?? next.length + 1 });
        }
        messageRows.set(sessionId, next);
        return next;
      },
      async loadAll(sessionId: string) {
        return messageRows.get(sessionId) ?? [];
      },
      async loadSinceSeq(sessionId: string, sinceSeq: number) {
        return (messageRows.get(sessionId) ?? []).filter((message) => (message.seq ?? 0) > sinceSeq);
      },
      async loadRecent(sessionId: string, limit = 50) {
        return (messageRows.get(sessionId) ?? []).slice(-limit);
      },
      async replaceAll(sessionId: string, messages: any[]) {
        const next = messages.map((message, index) => ({ ...message, sessionId, seq: message.seq ?? index + 1 }));
        messageRows.set(sessionId, next);
        return next;
      },
      async deleteAllBySession(sessionId: string) {
        messageRows.delete(sessionId);
      },
      async updateAckedSeq(sessionId: string, ackedSeq: number, recoveryJson = "{}") {
        const rows = messageRows.get(sessionId) ?? [];
        return { lastSeq: rows.at(-1)?.seq ?? 0, availableFromSeq: rows[0]?.seq ?? 0, ackedSeq, recoveryJson };
      },
      async updateRecoveryJson(sessionId: string, recoveryJson: string) {
        const rows = messageRows.get(sessionId) ?? [];
        return { lastSeq: rows.at(-1)?.seq ?? 0, availableFromSeq: rows[0]?.seq ?? 0, ackedSeq: 0, recoveryJson };
      },
      async getCursor(sessionId: string) {
        const rows = messageRows.get(sessionId) ?? [];
        return { lastSeq: rows.at(-1)?.seq ?? 0, availableFromSeq: rows[0]?.seq ?? 0, ackedSeq: 0, recoveryJson: "{}" };
      },
    };
  }

  function createBookRepositoryMock() {
    return {
      async create(input: any) {
        const row = { ...input };
        bookRows.set(input.id, row);
        return row;
      },
      async getById(id: string) {
        return bookRows.get(id) ?? null;
      },
      async update(id: string, updates: any) {
        const row = bookRows.get(id);
        if (!row) return null;
        const next = { ...row, ...updates };
        bookRows.set(id, next);
        return next;
      },
      async list() {
        return [...bookRows.values()];
      },
    };
  }

  function createStoryJingweiSectionRepositoryMock() {
    return {
      async create(input: any) {
        const row = { ...input, deletedAt: null };
        storyJingweiSectionRows.set(input.id, row);
        return row;
      },
      async listByBook(bookId: string) {
        return [...storyJingweiSectionRows.values()]
          .filter((row) => row.bookId === bookId && !row.deletedAt)
          .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
      },
    };
  }

  return {
    StateManager: MockStateManager,
    PipelineRunner: MockPipelineRunner,
    Scheduler: MockScheduler,
    applyJingweiTemplate: applyJingweiTemplateMock,
    createLLMClient: createLLMClientMock,
    createLogger: vi.fn(() => logger),
    computeAnalytics: computeAnalyticsMock,
    chatCompletion: chatCompletionMock,
    loadProjectConfig: loadProjectConfigMock,
    analyzeAITells: analyzeAITellsMock,
    registerBuiltinPresets: vi.fn(),
    listAvailableGenres: vi.fn(async () => [
      { id: "xuanhuan", name: "玄幻" },
      { id: "xianxia", name: "仙侠" },
    ]),
    readGenreProfile: vi.fn(async (_root: string, genreId: string) => ({
      profile: { language: "zh", name: genreId },
      body: "# Genre body",
    })),
    GLOBAL_ENV_PATH: join(tmpdir(), "novelfork-global.env"),
    splitChapters: vi.fn(function* (text: string) {
      yield { title: "Chapter 1", content: text };
    }),
    loadDetectionHistory: vi.fn(async () => []),
    analyzeDetectionInsights: vi.fn(() => ({
      avgScore: 0,
      totalScans: 0,
    })),
    analyzeStyle: vi.fn((_text: string, _name: string) => ({
      vocabulary: [],
      sentencePatterns: [],
    })),
    getBuiltinGenresDir: vi.fn(() => join(tmpdir(), "novelfork-builtin-genres")),
    closeStorageDatabase: vi.fn(),
    getStorageDatabase: vi.fn(() => storageDatabaseMock),
    initializeStorageDatabase: vi.fn(() => storageDatabaseMock),
    runStorageMigrations: vi.fn(() => ({ applied: [] })),
    createBookRepository: createBookRepositoryMock,
    createStoryJingweiSectionRepository: createStoryJingweiSectionRepositoryMock,
    createSessionMessageRepository: createSessionMessageRepositoryMock,
    createSessionRepository: createSessionRepositoryMock,
    pipelineEvents: { on: vi.fn() },
  };
});

// ----------------------------------------------------------------
// Shared config & helpers
// ----------------------------------------------------------------

const projectConfig = {
  name: "integration-test",
  version: "0.1.0",
  language: "zh",
  llm: {
    provider: "openai",
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "gpt-test",
    temperature: 0.7,
    maxTokens: 4096,
    stream: false,
  },
  daemon: {
    schedule: { radarCron: "0 */6 * * *", writeCron: "*/15 * * * *" },
    maxConcurrentBooks: 1,
    chaptersPerCycle: 1,
    retryDelayMs: 30000,
    cooldownAfterChapterMs: 0,
    maxChaptersPerDay: 50,
  },
  modelOverrides: {},
  notify: [],
} as const;

function cloneConfig() {
  return structuredClone(projectConfig);
}

// ----------------------------------------------------------------
// Test suite
// ----------------------------------------------------------------

describe("server integration — core 20 endpoints", () => {
  let root: string;
  let app: Hono;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "novelfork-integ-"));
    await mkdir(join(root, "books"), { recursive: true });
    await writeFile(
      join(root, "novelfork.json"),
      JSON.stringify(projectConfig, null, 2),
      "utf-8",
    );

    // Reset all mocks
    initBookMock.mockReset();
    runRadarMock.mockReset();
    reviseDraftMock.mockReset();
    resyncChapterArtifactsMock.mockReset();
    writeNextChapterMock.mockReset();
    writeDraftMock.mockReset();
    rollbackToChapterMock.mockReset();
    saveChapterIndexMock.mockReset();
    loadChapterIndexMock.mockReset();
    saveBookConfigMock.mockReset();
    loadBookConfigMock.mockReset();
    listBooksMock.mockReset();
    getNextChapterNumberMock.mockReset();
    createLLMClientMock.mockReset();
    chatCompletionMock.mockReset();
    loadProjectConfigMock.mockReset();
    computeAnalyticsMock.mockReset();
    analyzeAITellsMock.mockReset();
    schedulerStartMock.mockReset();
    pipelineConfigs.length = 0;

    // Default mock implementations
    createLLMClientMock.mockReturnValue({});
    chatCompletionMock.mockResolvedValue({
      content: "pong",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    computeAnalyticsMock.mockReturnValue({
      totalWords: 5000,
      chapterCount: 2,
    });
    analyzeAITellsMock.mockReturnValue({
      score: 0.2,
      issues: [],
      summary: "clean",
    });
    listBooksMock.mockResolvedValue([]);
    getNextChapterNumberMock.mockResolvedValue(1);
    loadChapterIndexMock.mockResolvedValue([]);
    saveChapterIndexMock.mockResolvedValue(undefined);
    rollbackToChapterMock.mockResolvedValue([]);
    saveBookConfigMock.mockResolvedValue(undefined);
    initBookMock.mockResolvedValue(undefined);
    writeNextChapterMock.mockResolvedValue({
      chapterNumber: 1,
      title: "Chapter 1",
      wordCount: 3000,
      revised: false,
      status: "ready-for-review",
    });
    writeDraftMock.mockResolvedValue({
      chapterNumber: 1,
      title: "Draft 1",
      wordCount: 3000,
    });

    loadProjectConfigMock.mockImplementation(async () => {
      const raw = JSON.parse(
        await readFile(join(root, "novelfork.json"), "utf-8"),
      ) as Record<string, unknown>;
      return {
        ...cloneConfig(),
        ...raw,
        llm: {
          ...cloneConfig().llm,
          ...((raw.llm ?? {}) as Record<string, unknown>),
        },
        daemon: {
          ...cloneConfig().daemon,
          ...((raw.daemon ?? {}) as Record<string, unknown>),
        },
        modelOverrides: (raw.modelOverrides ?? {}) as Record<string, unknown>,
        notify: (raw.notify ?? []) as unknown[],
      };
    });

    const { createStudioServer } = await import("../server.js");
    const { app: honoApp } = createStudioServer(cloneConfig() as never, root);
    app = honoApp;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // ----------------------------------------------------------------
  // Helper
  // ----------------------------------------------------------------

  function req(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    return Promise.resolve(app.request(`http://localhost${path}`, init));
  }

  function jsonReq(
    path: string,
    method: string,
    body: unknown,
  ): Promise<Response> {
    return req(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // ================================================================
  // 1. POST /api/auth/launch — requires valid JWT
  // ================================================================

  describe("POST /api/auth/launch", () => {
    it("rejects missing token with 400", async () => {
      const res = await jsonReq("/api/auth/launch", "POST", {});

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe("TOKEN_REQUIRED");
      expect(data.error.message).toContain("Launch token is required");
    });
  });

  // ================================================================
  // 5. POST /api/books/create — create book
  // ================================================================

  describe("POST /api/books/create", () => {
    it("accepts a valid create request and returns creating status", async () => {
      const res = await jsonReq("/api/books/create", "POST", {
        title: "New Novel",
        genre: "xuanhuan",
        language: "zh",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("creating");
      expect(data.bookId).toBeTruthy();
    });

    it("returns 409 when book already exists with full initialization", async () => {
      const bookId = "existing-book";
      const bookDir = join(root, "books", bookId);
      await mkdir(join(bookDir, "story"), { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({ id: bookId }),
        "utf-8",
      );
      await writeFile(
        join(bookDir, "story", "story_bible.md"),
        "# Existing",
        "utf-8",
      );

      const res = await jsonReq("/api/books/create", "POST", {
        title: "Existing Book",
        genre: "xuanhuan",
      });

      expect(res.status).toBe(409);
    });
  });

  // ================================================================
  // 6. GET /api/books/:id/chapters/:num — chapter content
  // ================================================================

  describe("GET /api/books/:id/chapters/:num", () => {
    it("returns chapter content from markdown file", async () => {
      const chaptersDir = join(root, "books", "test-book", "chapters");
      await mkdir(chaptersDir, { recursive: true });
      await writeFile(
        join(chaptersDir, "0001_first-chapter.md"),
        "# Chapter 1\n\nThe story begins.",
        "utf-8",
      );

      const res = await req("/api/books/test-book/chapters/1");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.chapterNumber).toBe(1);
      expect(data.filename).toBe("0001_first-chapter.md");
      expect(data.content).toContain("The story begins.");
    });

    it("returns 404 when chapter does not exist", async () => {
      const chaptersDir = join(root, "books", "test-book", "chapters");
      await mkdir(chaptersDir, { recursive: true });

      const res = await req("/api/books/test-book/chapters/99");

      expect(res.status).toBe(404);
    });

    it("returns 404 when chapters directory does not exist", async () => {
      // Book dir exists but no chapters dir
      await mkdir(join(root, "books", "empty-book"), { recursive: true });

      const res = await req("/api/books/empty-book/chapters/1");

      expect(res.status).toBe(404);
    });
  });

  // ================================================================
  // 6b. POST /api/books/:id/chapters — create chapter
  // ================================================================

  describe("POST /api/books/:id/chapters", () => {
    async function scaffoldBook(bookId = "test-book", language: "zh" | "en" = "zh") {
      const bookDir = join(root, "books", bookId);
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await writeFile(join(bookDir, "book.json"), JSON.stringify({ id: bookId, title: "测试书", language }, null, 2), "utf-8");
      await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");
    }

    function useFileBackedChapterState() {
      loadBookConfigMock.mockImplementation(async (bookId: string) => JSON.parse(
        await readFile(join(root, "books", bookId, "book.json"), "utf-8"),
      ));
      loadChapterIndexMock.mockImplementation(async (bookId: string) => JSON.parse(
        await readFile(join(root, "books", bookId, "chapters", "index.json"), "utf-8").catch(() => "[]"),
      ));
      saveChapterIndexMock.mockImplementation(async (bookId: string, index: unknown) => {
        const chaptersDir = join(root, "books", bookId, "chapters");
        await mkdir(chaptersDir, { recursive: true });
        await writeFile(join(chaptersDir, "index.json"), JSON.stringify(index, null, 2), "utf-8");
      });
      getNextChapterNumberMock.mockImplementation(async (bookId: string) => {
        const index = await loadChapterIndexMock(bookId) as Array<{ number: number }>;
        return Math.max(0, ...index.map((chapter) => chapter.number)) + 1;
      });
    }

    it("creates the first chapter with a default title and persists content plus index", async () => {
      await scaffoldBook();
      useFileBackedChapterState();

      const res = await jsonReq("/api/books/test-book/chapters", "POST", {});

      expect(res.status).toBe(201);
      const data = await res.json() as { chapter: { number: number; title: string; status: string; fileName: string | null } };
      expect(data.chapter).toMatchObject({
        number: 1,
        title: "第 1 章",
        status: "drafting",
        fileName: "0001_第_1_章.md",
      });
      await expect(readFile(join(root, "books", "test-book", "chapters", "0001_第_1_章.md"), "utf-8"))
        .resolves.toContain("# 第 1 章");
      const index = JSON.parse(await readFile(join(root, "books", "test-book", "chapters", "index.json"), "utf-8")) as Array<{ number: number; title: string }>;
      expect(index).toEqual([expect.objectContaining({ number: 1, title: "第 1 章" })]);
    });

    it("creates the next chapter with a custom title", async () => {
      await scaffoldBook();
      useFileBackedChapterState();
      await saveChapterIndexMock("test-book", [
        { number: 1, title: "第一章", status: "approved", wordCount: 10, createdAt: "2026-04-28T00:00:00.000Z", updatedAt: "2026-04-28T00:00:00.000Z", auditIssues: [], lengthWarnings: [] },
        { number: 2, title: "第二章", status: "drafted", wordCount: 20, createdAt: "2026-04-28T00:00:00.000Z", updatedAt: "2026-04-28T00:00:00.000Z", auditIssues: [], lengthWarnings: [] },
      ]);

      const res = await jsonReq("/api/books/test-book/chapters", "POST", { title: "风起青萍" });

      expect(res.status).toBe(201);
      const data = await res.json() as { chapter: { number: number; title: string; fileName: string | null } };
      expect(data.chapter).toMatchObject({ number: 3, title: "风起青萍", fileName: "0003_风起青萍.md" });
      await expect(readFile(join(root, "books", "test-book", "chapters", "0003_风起青萍.md"), "utf-8"))
        .resolves.toContain("# 风起青萍");
    });

    it("keeps the created chapter readable after recreating the server app", async () => {
      await scaffoldBook();
      useFileBackedChapterState();
      const createRes = await jsonReq("/api/books/test-book/chapters", "POST", { title: "重启后仍在" });
      expect(createRes.status).toBe(201);

      const { createStudioServer } = await import("../server.js");
      app = createStudioServer(cloneConfig() as never, root).app;

      const res = await req("/api/books/test-book/chapters/1");

      expect(res.status).toBe(200);
      const data = await res.json() as { chapterNumber: number; content: string };
      expect(data.chapterNumber).toBe(1);
      expect(data.content).toContain("重启后仍在");
    });
  });

  // ================================================================
  // 7. PUT /api/books/:id/chapters/:num — update chapter
  // ================================================================

  describe("PUT /api/books/:id/chapters/:num", () => {
    it("updates an existing chapter file", async () => {
      const chaptersDir = join(root, "books", "test-book", "chapters");
      await mkdir(chaptersDir, { recursive: true });
      await writeFile(
        join(chaptersDir, "0001_first-chapter.md"),
        "# Old content",
        "utf-8",
      );

      const res = await jsonReq(
        "/api/books/test-book/chapters/1",
        "PUT",
        { content: "# Updated content\n\nNew text here." },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.chapterNumber).toBe(1);

      // Verify file was actually written
      const written = await readFile(
        join(chaptersDir, "0001_first-chapter.md"),
        "utf-8",
      );
      expect(written).toBe("# Updated content\n\nNew text here.");
    });

    it("returns 404 when the chapter file does not exist", async () => {
      const chaptersDir = join(root, "books", "test-book", "chapters");
      await mkdir(chaptersDir, { recursive: true });

      const res = await jsonReq(
        "/api/books/test-book/chapters/99",
        "PUT",
        { content: "# Missing" },
      );

      expect(res.status).toBe(404);
    });
  });

  // ================================================================
  // 8. GET /api/books/:id/truth/:file — truth file read
  // ================================================================

  describe("GET /api/books/:id/truth/:file", () => {
    it("returns truth file content when it exists", async () => {
      const storyDir = join(root, "books", "test-book", "story");
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        join(storyDir, "story_bible.md"),
        "# Story Bible\n\nCore setting.",
        "utf-8",
      );

      const res = await req("/api/books/test-book/truth/story_bible.md");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.file).toBe("story_bible.md");
      expect(data.content).toContain("Core setting.");
    });

    it("lists truth files through the dedicated truth-files route", async () => {
      const storyDir = join(root, "books", "test-book", "story");
      await mkdir(storyDir, { recursive: true });
      await writeFile(join(storyDir, "pending_hooks.md"), "# hooks", "utf-8");
      await writeFile(join(storyDir, "chapter_summaries.md"), "# summaries", "utf-8");

      const res = await req("/api/books/test-book/truth-files");

      expect(res.status).toBe(200);
      const data = await res.json() as { files: Array<{ name: string }> };
      expect(data.files.map((file) => file.name)).toEqual(expect.arrayContaining(["pending_hooks.md", "chapter_summaries.md"]));
    });

    it("reads truth files through the dedicated truth-files route", async () => {
      const storyDir = join(root, "books", "test-book", "story");
      await mkdir(storyDir, { recursive: true });
      await writeFile(join(storyDir, "pending_hooks.md"), "# hooks\n\n待处理伏笔", "utf-8");

      const res = await req("/api/books/test-book/truth-files/pending_hooks.md");

      expect(res.status).toBe(200);
      const data = await res.json() as { file: string; content: string | null };
      expect(data.file).toBe("pending_hooks.md");
      expect(data.content).toContain("待处理伏笔");
    });

    it("lists story files through the dedicated story-files route", async () => {
      const storyDir = join(root, "books", "test-book", "story");
      await mkdir(storyDir, { recursive: true });
      await writeFile(join(storyDir, "pending_hooks.md"), "# hooks", "utf-8");
      await writeFile(join(storyDir, "style_profile.json"), '{"tone":"稳"}', "utf-8");

      const res = await req("/api/books/test-book/story-files");

      expect(res.status).toBe(200);
      const data = await res.json() as { files: Array<{ name: string }> };
      expect(data.files.map((file) => file.name)).toEqual(expect.arrayContaining(["pending_hooks.md", "style_profile.json"]));
    });

    it("reads story files through the dedicated story-files route", async () => {
      const storyDir = join(root, "books", "test-book", "story");
      await mkdir(storyDir, { recursive: true });
      await writeFile(join(storyDir, "chapter_summaries.md"), "# chapter_summaries", "utf-8");

      const res = await req("/api/books/test-book/story-files/chapter_summaries.md");

      expect(res.status).toBe(200);
      const data = await res.json() as { file: string; content: string | null };
      expect(data.file).toBe("chapter_summaries.md");
      expect(data.content).toContain("chapter_summaries");
    });

    it("returns null content when truth file does not exist", async () => {
      await mkdir(join(root, "books", "test-book", "story"), {
        recursive: true,
      });

      const res = await req("/api/books/test-book/truth/story_bible.md");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.file).toBe("story_bible.md");
      expect(data.content).toBeNull();
    });

    it("rejects invalid truth file names with 400", async () => {
      const res = await req("/api/books/test-book/truth/evil_file.md");

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid truth file");
    });
  });

  // ================================================================
  // 9. PUT /api/books/:id/truth/:file — update truth file
  // ================================================================

  describe("PUT /api/books/:id/truth/:file", () => {
    it("writes truth file content to the story directory", async () => {
      const res = await jsonReq(
        "/api/books/test-book/truth/story_bible.md",
        "PUT",
        { content: "# Updated Bible\n\nNew world-building." },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      // Verify file was written
      const written = await readFile(
        join(root, "books", "test-book", "story", "story_bible.md"),
        "utf-8",
      );
      expect(written).toBe("# Updated Bible\n\nNew world-building.");
    });

    it("creates the story directory if it does not exist", async () => {
      const res = await jsonReq(
        "/api/books/new-book/truth/current_state.md",
        "PUT",
        { content: "# Current State" },
      );

      expect(res.status).toBe(200);
      const written = await readFile(
        join(root, "books", "new-book", "story", "current_state.md"),
        "utf-8",
      );
      expect(written).toBe("# Current State");
    });

    it("rejects invalid truth file names with 400", async () => {
      const res = await jsonReq(
        "/api/books/test-book/truth/../../etc/passwd",
        "PUT",
        { content: "hacked" },
      );

      expect([400, 404]).toContain(res.status);
    });
  });

  // ================================================================
  // 10. GET /api/project — project config
  // ================================================================

  describe("GET /api/project", () => {
    it("returns project configuration from novelfork.json", async () => {
      const res = await req("/api/project");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.name).toBe("integration-test");
      expect(data.language).toBe("zh");
      expect(data.model).toBe("gpt-test");
      expect(data.provider).toBe("openai");
    });

    it("reports whether language was explicitly set", async () => {
      // Default config has language: "zh" explicitly
      const res = await req("/api/project");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(typeof data.languageExplicit).toBe("boolean");
    });
  });

  // ================================================================
  // 11. PUT /api/project — update project config
  // ================================================================

  describe("PUT /api/project", () => {
    it("updates temperature and maxTokens in novelfork.json", async () => {
      const res = await jsonReq("/api/project", "PUT", {
        temperature: 0.3,
        maxTokens: 2048,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      // Verify persisted changes
      const raw = JSON.parse(
        await readFile(join(root, "novelfork.json"), "utf-8"),
      );
      expect(raw.llm.temperature).toBe(0.3);
      expect(raw.llm.maxTokens).toBe(2048);
    });

    it("updates language to valid value", async () => {
      const res = await jsonReq("/api/project", "PUT", { language: "en" });

      expect(res.status).toBe(200);

      const raw = JSON.parse(
        await readFile(join(root, "novelfork.json"), "utf-8"),
      );
      expect(raw.language).toBe("en");
    });

    it("ignores invalid language values", async () => {
      const res = await jsonReq("/api/project", "PUT", { language: "fr" });

      expect(res.status).toBe(200);

      const raw = JSON.parse(
        await readFile(join(root, "novelfork.json"), "utf-8"),
      );
      // Should still be original value since "fr" is not zh|en
      expect(raw.language).toBe("zh");
    });

    it("updates stream setting", async () => {
      const res = await jsonReq("/api/project", "PUT", { stream: true });

      expect(res.status).toBe(200);

      const raw = JSON.parse(
        await readFile(join(root, "novelfork.json"), "utf-8"),
      );
      expect(raw.llm.stream).toBe(true);
    });
  });

  // ================================================================
  // 12. GET /api/events — SSE connection
  // ================================================================

  describe("GET /api/events", () => {
    it("establishes an SSE stream connection", async () => {
      const res = await req("/api/events");

      // SSE endpoints return 200 with text/event-stream content type
      expect(res.status).toBe(200);
      const contentType = res.headers.get("content-type");
      expect(contentType).toContain("text/event-stream");
    });
  });

  // ================================================================
  // 13. GET /api/genres — genre list
  // ================================================================

  describe("GET /api/genres", () => {
    it("returns available genres with language info", async () => {
      const res = await req("/api/genres");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.genres).toBeInstanceOf(Array);
      expect(data.genres.length).toBeGreaterThan(0);
      // Each genre should have a language field
      for (const g of data.genres) {
        expect(g).toHaveProperty("language");
      }
    });
  });

  // ================================================================
  // 14. GET /api/daemon — daemon status
  // ================================================================

  describe("GET /api/daemon", () => {
    it("returns running: false when daemon is not started", async () => {
      const res = await req("/api/daemon");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.running).toBe(false);
    });

    it("returns running: true after daemon is started", async () => {
      schedulerStartMock.mockImplementation(
        () => new Promise<void>(() => {}), // Never resolves — daemon runs indefinitely
      );

      const start = await req("/api/daemon/start", { method: "POST" });
      expect(start.status).toBe(200);

      const status = await req("/api/daemon");
      expect(status.status).toBe(200);
      const data = await status.json();
      expect(data.running).toBe(true);
    });
  });

  // ================================================================
  // 15. GET /api/logs — log entries
  // ================================================================

  describe("GET /api/logs", () => {
    it("returns empty entries when no log file exists", async () => {
      const res = await req("/api/logs");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toEqual([]);
    });

    it("returns parsed log entries from novelfork.log", async () => {
      const logLines = [
        JSON.stringify({
          level: "info",
          tag: "studio",
          message: "Server started",
        }),
        JSON.stringify({
          level: "warn",
          tag: "pipeline",
          message: "Rate limited",
        }),
      ].join("\n");

      await writeFile(join(root, "novelfork.log"), logLines, "utf-8");

      const res = await req("/api/logs");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toHaveLength(2);
      expect(data.entries[0].level).toBe("info");
      expect(data.entries[1].message).toBe("Rate limited");
    });

    it("handles non-JSON log lines gracefully", async () => {
      await writeFile(
        join(root, "novelfork.log"),
        "plain text log line\n",
        "utf-8",
      );

      const res = await req("/api/logs");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toHaveLength(1);
      expect(data.entries[0].message).toBe("plain text log line");
    });
  });

  // ================================================================
  // 16. POST /api/books/:id/approve/:chapter — approve chapter
  // ================================================================

  describe("POST /api/books/:id/chapters/:num/approve", () => {
    it("approves a chapter by updating its status in the index", async () => {
      loadChapterIndexMock.mockResolvedValue([
        {
          number: 1,
          title: "Chapter One",
          status: "ready-for-review",
          wordCount: 3000,
        },
        {
          number: 2,
          title: "Chapter Two",
          status: "ready-for-review",
          wordCount: 2800,
        },
      ]);

      const res = await req("/api/books/test-book/chapters/1/approve", {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.chapterNumber).toBe(1);
      expect(data.status).toBe("approved");

      // Verify saveChapterIndex was called with updated data
      expect(saveChapterIndexMock).toHaveBeenCalledWith(
        "test-book",
        expect.arrayContaining([
          expect.objectContaining({ number: 1, status: "approved" }),
          expect.objectContaining({ number: 2, status: "ready-for-review" }),
        ]),
      );
    });
  });

  // ================================================================
  // 17. POST /api/books/:id/reject/:chapter — reject chapter
  // ================================================================

  describe("POST /api/books/:id/chapters/:num/reject", () => {
    it("rejects a chapter with rollback semantics", async () => {
      loadChapterIndexMock.mockResolvedValue([
        {
          number: 3,
          title: "Bad Chapter",
          status: "ready-for-review",
          wordCount: 1800,
        },
      ]);
      rollbackToChapterMock.mockResolvedValue([3]);

      const res = await req("/api/books/test-book/chapters/3/reject", {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.chapterNumber).toBe(3);
      expect(data.status).toBe("rejected");
      expect(data.rolledBackTo).toBe(2);
      expect(data.discarded).toEqual([3]);
      expect(rollbackToChapterMock).toHaveBeenCalledWith("test-book", 2);
    });

    it("returns 404 when rejecting a chapter that does not exist", async () => {
      loadChapterIndexMock.mockResolvedValue([]);

      const res = await req("/api/books/test-book/chapters/99/reject", {
        method: "POST",
      });

      expect(res.status).toBe(404);
    });
  });

  // ================================================================
  // 18. DELETE /api/books/:id — delete book
  // ================================================================

  describe("DELETE /api/books/:id", () => {
    it("deletes a book directory and returns success", async () => {
      const bookDir = join(root, "books", "deletable-book");
      await mkdir(bookDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({ id: "deletable-book" }),
        "utf-8",
      );

      const res = await req("/api/books/deletable-book", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.bookId).toBe("deletable-book");
    });

    it("succeeds even when book directory does not exist (rm force)", async () => {
      const res = await req("/api/books/nonexistent-book", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it("rejects path traversal in delete", async () => {
      const res = await req("/api/books/..%2Fetc", { method: "DELETE" });

      expect([400, 404]).toContain(res.status);
      const data = await res.json();
      expect(data.error.code).toBe("INVALID_BOOK_ID");
    });
  });

  // ================================================================
  // 19. GET /api/doctor — system diagnostics
  // ================================================================

  describe("GET /api/doctor", () => {
    it("returns health check results", async () => {
      const res = await req("/api/doctor");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(typeof data.projectConfig).toBe("boolean");
      expect(data.projectConfig).toBe(true); // We wrote novelfork.json in beforeEach
      expect(typeof data.booksDir).toBe("boolean");
      expect(data.booksDir).toBe(true); // We created books/ in beforeEach
      expect(typeof data.llmConnected).toBe("boolean");
      expect(typeof data.bookCount).toBe("number");
    });

    it("reports llmConnected as true when chatCompletion succeeds", async () => {
      chatCompletionMock.mockResolvedValue({
        content: "pong",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });

      const res = await req("/api/doctor");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.llmConnected).toBe(true);
    });

    it("reports llmConnected as false when chatCompletion throws", async () => {
      chatCompletionMock.mockRejectedValue(new Error("API key invalid"));

      const res = await req("/api/doctor");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.llmConnected).toBe(false);
    });
  });

  // ================================================================
  // 20. GET /api/project/model-overrides — model routing
  // ================================================================

  describe("GET /api/project/model-overrides", () => {
    it("returns empty overrides when none are configured", async () => {
      const res = await req("/api/project/model-overrides");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.overrides).toEqual({});
    });

    it("returns configured model overrides from novelfork.json", async () => {
      const config = JSON.parse(
        await readFile(join(root, "novelfork.json"), "utf-8"),
      );
      config.modelOverrides = {
        outline: "claude-sonnet-4-20250514",
        audit: { model: "gpt-4o", provider: "openai" },
      };
      await writeFile(
        join(root, "novelfork.json"),
        JSON.stringify(config, null, 2),
        "utf-8",
      );

      const res = await req("/api/project/model-overrides");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.overrides.outline).toBe("claude-sonnet-4-20250514");
      expect(data.overrides.audit).toMatchObject({
        model: "gpt-4o",
        provider: "openai",
      });
    });
  });

  // ================================================================
  // Additional cross-cutting integration tests
  // ================================================================

  describe("PUT /api/project/model-overrides", () => {
    it("persists model override changes to novelfork.json", async () => {
      const res = await jsonReq("/api/project/model-overrides", "PUT", {
        overrides: { write: "claude-sonnet-4-20250514" },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      // Verify persisted
      const raw = JSON.parse(
        await readFile(join(root, "novelfork.json"), "utf-8"),
      );
      expect(raw.modelOverrides.write).toBe("claude-sonnet-4-20250514");
    });
  });

  describe("book ID validation middleware", () => {
    it("blocks null byte injection in book IDs", async () => {
      const res = await req("/api/books/test%00evil");

      expect([400, 404]).toContain(res.status);
      const data = await res.json();
      expect(data.error.code).toBe("INVALID_BOOK_ID");
    });

    it("blocks backslash paths in book IDs", async () => {
      const res = await req("/api/books/..\\etc\\passwd");

      expect([400, 404]).toContain(res.status);
    });

    it("allows valid book IDs with CJK characters", async () => {
      loadBookConfigMock.mockResolvedValue({
        id: "修仙小说",
        title: "修仙小说",
      });
      loadChapterIndexMock.mockResolvedValue([]);
      getNextChapterNumberMock.mockResolvedValue(1);

      const res = await req(
        `/api/books/${encodeURIComponent("修仙小说")}`,
      );

      expect(res.status).toBe(200);
    });

    it("allows valid book IDs with hyphens and alphanumeric chars", async () => {
      loadBookConfigMock.mockResolvedValue({
        id: "my-great-novel-2024",
        title: "My Great Novel",
      });
      loadChapterIndexMock.mockResolvedValue([]);
      getNextChapterNumberMock.mockResolvedValue(1);

      const res = await req("/api/books/my-great-novel-2024");

      expect(res.status).toBe(200);
    });
  });

  describe("error handler", () => {
    it("converts ApiError instances to structured JSON responses", async () => {
      // Path traversal triggers ApiError(400, INVALID_BOOK_ID, ...)
      const res = await req("/api/books/../traversal");

      expect([400, 404]).toContain(res.status);
      if (res.status === 400) {
        const data = await res.json();
        expect(data.error).toHaveProperty("code");
        expect(data.error).toHaveProperty("message");
      }
    });
  });
});
