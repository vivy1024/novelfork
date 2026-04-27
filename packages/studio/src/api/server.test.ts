import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { execGit } from "./lib/git-utils.js";

const schedulerStartMock = vi.fn<() => Promise<void>>();
const initBookMock = vi.fn();
const runRadarMock = vi.fn();
const reviseDraftMock = vi.fn();
const resyncChapterArtifactsMock = vi.fn();
const writeNextChapterMock = vi.fn();
const rollbackToChapterMock = vi.fn();
const saveChapterIndexMock = vi.fn();
const loadChapterIndexMock = vi.fn();
const createLLMClientMock = vi.fn(() => ({}));
const chatCompletionMock = vi.fn();
const fetchUrlMock = vi.fn();
const loadProjectConfigMock = vi.fn();
const createStorageDatabaseMock = vi.fn(() => ({ close: vi.fn(), checkpoint: vi.fn() }));
const runStorageMigrationsMock = vi.fn(() => ({ applied: ["0001_initial.sql"] }));
const seedQuestionnaireTemplatesMock = vi.fn(async () => undefined);
const runJsonImportMigrationIfNeededMock = vi.fn(async () => ({
  status: "skipped",
  reason: "no-source",
  importedSessions: 0,
  importedMessages: 0,
  skippedSessions: 0,
}));
const startHttpServerMock = vi.fn(async (): Promise<unknown> => undefined);
const { setupAdminWebSocketMock, setupSessionChatWebSocketMock } = vi.hoisted(() => ({
  setupAdminWebSocketMock: vi.fn(),
  setupSessionChatWebSocketMock: vi.fn(),
}));
const startupOrchestratorMock = vi.fn(async () => ({
  bookCount: 0,
  migratedBooks: 0,
  indexedDocuments: 0,
  skippedBooks: 0,
  failures: [],
  delivery: {
    staticMode: "missing",
    indexHtmlReady: false,
    compileSmokeStatus: "failed",
  },
  recoveryReport: {
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(0).toISOString(),
    durationMs: 0,
    actions: [],
    counts: { success: 0, skipped: 0, failed: 0 },
  },
  healthChecks: [],
}));
const pipelineConfigs: unknown[] = [];
const builtinPresetLookup = new Map<string, { id: string; name: string; category: string; description: string; promptInjection: string }>([
  ["classical-imagery", {
    id: "classical-imagery",
    name: "古典意境",
    category: "tone",
    description: "以景写情、含蓄转折。",
    promptInjection: "tone:classical-imagery",
  }],
  ["sect-family-xianxia", {
    id: "sect-family-xianxia",
    name: "宗门家族修仙社会",
    category: "setting-base",
    description: "宗门、家族、资源稀缺与境界晋升。",
    promptInjection: "setting:sect-family-xianxia",
  }],
  ["information-flow", {
    id: "information-flow",
    name: "信息传播速度",
    category: "logic-risk",
    description: "检查消息传播和认知边界。",
    promptInjection: "logic:information-flow",
  }],
]);

const logger = {
  child: () => logger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("./start-http-server.js", () => ({
  startHttpServer: startHttpServerMock,
}));

vi.mock("./routes/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routes/index.js")>();
  return {
    ...actual,
    setupAdminWebSocket: setupAdminWebSocketMock,
  };
});

vi.mock("./lib/startup-orchestrator.js", () => ({
  runStartupOrchestrator: startupOrchestratorMock,
  resolveStartupFallbackChapter: vi.fn(async () => 0),
  buildStartupFailureDecisions: vi.fn(() => []),
}));

vi.mock("./lib/session-chat-service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/session-chat-service.js")>();
  return {
    ...actual,
    setupSessionChatWebSocket: setupSessionChatWebSocketMock,
  };
});

vi.mock("@vivy1024/novelfork-core", () => {
  class MockStateManager {
    constructor(private readonly root: string) {}

    async listBooks(): Promise<string[]> {
      const booksDir = join(this.root, "books");
      try {
        const entries = await readdir(booksDir, { withFileTypes: true });
        return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      } catch {
        return [];
      }
    }

    async loadBookConfig(bookId: string): Promise<Record<string, unknown>> {
      return JSON.parse(await readFile(join(this.bookDir(bookId), "book.json"), "utf-8")) as Record<string, unknown>;
    }

    async loadChapterIndex(bookId: string): Promise<any[]> {
      if (loadChapterIndexMock.mock.calls.length > 0) {
        return (await loadChapterIndexMock(bookId)) as any[];
      }
      try {
        return JSON.parse(await readFile(join(this.bookDir(bookId), "chapters", "index.json"), "utf-8")) as any[];
      } catch {
        return [];
      }
    }

    async saveChapterIndex(bookId: string, index: unknown): Promise<void> {
      await saveChapterIndexMock(bookId, index);
    }

    async rollbackToChapter(bookId: string, chapterNumber: number): Promise<number[]> {
      return (await rollbackToChapterMock(bookId, chapterNumber)) as number[];
    }

    async getNextChapterNumber(bookId: string): Promise<number> {
      const index = await this.loadChapterIndex(bookId);
      const maxChapter = index.reduce((max, chapter) => {
        const value = typeof chapter?.number === "number" ? chapter.number : 0;
        return value > max ? value : max;
      }, 0);
      return maxChapter + 1;
    }

    async ensureRuntimeState(): Promise<void> {
      return undefined;
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
  const kvRows = new Map<string, string>();
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

  function createKvRepositoryMock() {
    return {
      async get(key: string) {
        return kvRows.get(key) ?? null;
      },
      async set(key: string, value: string) {
        kvRows.set(key, value);
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
      async getById(bookId: string, id: string) {
        const row = storyJingweiSectionRows.get(id);
        return row && row.bookId === bookId && !row.deletedAt ? row : null;
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
    computeAnalytics: vi.fn(() => ({})),
    chatCompletion: chatCompletionMock,
    fetchUrl: fetchUrlMock,
    loadProjectConfig: loadProjectConfigMock,
    closeStorageDatabase: vi.fn(),
    createStorageDatabase: createStorageDatabaseMock,
    getStorageDatabase: vi.fn(() => storageDatabaseMock),
    initializeStorageDatabase: createStorageDatabaseMock,
    runJsonImportMigrationIfNeeded: runJsonImportMigrationIfNeededMock,
    runStorageMigrations: runStorageMigrationsMock,
    seedQuestionnaireTemplates: seedQuestionnaireTemplatesMock,
    createBookRepository: createBookRepositoryMock,
    createKvRepository: createKvRepositoryMock,
    createSessionMessageRepository: createSessionMessageRepositoryMock,
    createSessionRepository: createSessionRepositoryMock,
    createStoryJingweiSectionRepository: createStoryJingweiSectionRepositoryMock,
    GLOBAL_ENV_PATH: join(tmpdir(), "novelfork-global.env"),
    pipelineEvents: { on: vi.fn() },
    registerBuiltinPresets: vi.fn(),
    listPresets: vi.fn(() => []),
    listBundles: vi.fn(() => []),
    listBeatTemplates: vi.fn(() => []),
    getPreset: vi.fn((id: string) => builtinPresetLookup.get(id)),
    getBundle: vi.fn(() => undefined),
    getPresetsByGenre: vi.fn(() => []),
  };
});

const projectConfig = {
  name: "studio-test",
  version: "0.1.0",
  language: "zh",
  llm: {
    provider: "openai",
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "gpt-5.4",
    temperature: 0.7,
    maxTokens: 4096,
    stream: false,
  },
  daemon: {
    schedule: {
      radarCron: "0 */6 * * *",
      writeCron: "*/15 * * * *",
    },
    maxConcurrentBooks: 1,
    chaptersPerCycle: 1,
    retryDelayMs: 30000,
    cooldownAfterChapterMs: 0,
    maxChaptersPerDay: 50,
  },
  modelOverrides: {},
  notify: [],
} as const;

function cloneProjectConfig() {
  return structuredClone(projectConfig);
}

function mockMissingProjectLlmConfig() {
  loadProjectConfigMock.mockImplementation(async (_rootArg: string, options?: { readonly requireApiKey?: boolean }) => {
    if (options?.requireApiKey !== false) {
      throw new Error("NOVELFORK_LLM_API_KEY not set. Run 'novelfork config set-global' or add it to project .env file.");
    }

    const config = cloneProjectConfig();
    return {
      ...config,
      llm: {
        ...config.llm,
        apiKey: "",
      },
    };
  });
}

function getCapturedFetch(): typeof fetch {
  const calls = startHttpServerMock.mock.calls as unknown[];
  const lastCall = calls[calls.length - 1] as [{ fetch?: typeof fetch }] | undefined;
  const server = lastCall?.[0];
  if (!server?.fetch) {
    throw new Error("startHttpServer was not called with a fetch handler");
  }
  return server.fetch;
}

async function createCommittedRepository(repoRoot: string, branch = "main"): Promise<void> {
  await execGit(["init", `--initial-branch=${branch}`], repoRoot);
  await execGit(["config", "user.name", "Test User"], repoRoot);
  await execGit(["config", "user.email", "test@example.com"], repoRoot);
  await writeFile(join(repoRoot, "README.md"), "# test\n", "utf-8");
  await execGit(["add", "README.md"], repoRoot);
  await execGit(["commit", "-m", "Initial commit"], repoRoot);
}

async function waitForPath(targetPath: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await access(targetPath);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Path was not ready: ${targetPath}`);
}

describe("createStudioServer daemon lifecycle", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "novelfork-studio-server-"));
    process.env.NOVELFORK_SESSION_STORE_DIR = join(root, ".runtime", "sessions");
    await writeFile(join(root, "novelfork.json"), JSON.stringify(projectConfig, null, 2), "utf-8");
    schedulerStartMock.mockReset();
    initBookMock.mockReset();
    runRadarMock.mockReset();
    reviseDraftMock.mockReset();
    resyncChapterArtifactsMock.mockReset();
    writeNextChapterMock.mockReset();
    rollbackToChapterMock.mockReset();
    saveChapterIndexMock.mockReset();
    loadChapterIndexMock.mockReset();
    runRadarMock.mockResolvedValue({
      marketSummary: "Fresh market summary",
      recommendations: [],
    });
    reviseDraftMock.mockResolvedValue({
      chapterNumber: 3,
      wordCount: 1800,
      fixedIssues: ["focus restored"],
      applied: true,
      status: "ready-for-review",
    });
    resyncChapterArtifactsMock.mockResolvedValue({
      chapterNumber: 3,
      title: "Synced Chapter",
      wordCount: 1800,
      revised: false,
      status: "ready-for-review",
      auditResult: { passed: true, issues: [], summary: "synced" },
    });
    writeNextChapterMock.mockResolvedValue({
      chapterNumber: 3,
      title: "Rewritten Chapter",
      wordCount: 1800,
      revised: false,
      status: "ready-for-review",
      auditResult: { passed: true, issues: [], summary: "rewritten" },
    });
    createLLMClientMock.mockReset();
    createLLMClientMock.mockReturnValue({});
    chatCompletionMock.mockReset();
    chatCompletionMock.mockResolvedValue({
      content: "pong",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    fetchUrlMock.mockReset();
    fetchUrlMock.mockResolvedValue("示例网页素材正文。\n这里是第二段。");
    loadProjectConfigMock.mockReset();
    startHttpServerMock.mockClear();
    createStorageDatabaseMock.mockClear();
    createStorageDatabaseMock.mockReturnValue({ close: vi.fn(), checkpoint: vi.fn() });
    runStorageMigrationsMock.mockClear();
    runStorageMigrationsMock.mockReturnValue({ applied: ["0001_initial.sql"] });
    seedQuestionnaireTemplatesMock.mockClear();
    seedQuestionnaireTemplatesMock.mockResolvedValue(undefined);
    runJsonImportMigrationIfNeededMock.mockClear();
    runJsonImportMigrationIfNeededMock.mockResolvedValue({
      status: "skipped",
      reason: "no-source",
      importedSessions: 0,
      importedMessages: 0,
      skippedSessions: 0,
    });
    setupAdminWebSocketMock.mockReset();
    setupSessionChatWebSocketMock.mockReset();
    startupOrchestratorMock.mockClear();
    loadProjectConfigMock.mockImplementation(async () => {
      const raw = JSON.parse(await readFile(join(root, "novelfork.json"), "utf-8")) as Record<string, unknown>;
      return {
        ...cloneProjectConfig(),
        ...raw,
        llm: {
          ...cloneProjectConfig().llm,
          ...((raw.llm ?? {}) as Record<string, unknown>),
        },
        daemon: {
          ...cloneProjectConfig().daemon,
          ...((raw.daemon ?? {}) as Record<string, unknown>),
        },
        modelOverrides: (raw.modelOverrides ?? {}) as Record<string, unknown>,
        notify: (raw.notify ?? []) as unknown[],
      };
    });
    loadChapterIndexMock.mockResolvedValue([]);
    saveChapterIndexMock.mockResolvedValue(undefined);
    rollbackToChapterMock.mockResolvedValue([]);
    pipelineConfigs.length = 0;
  });

  afterEach(async () => {
    delete process.env.NOVELFORK_SESSION_STORE_DIR;
    await rm(root, { recursive: true, force: true });
  });

  it("returns from /api/daemon/start before the first write cycle finishes", async () => {
    let resolveStart: (() => void) | undefined;
    schedulerStartMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve;
        }),
    );

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const responseOrTimeout = await Promise.race([
      app.request("http://localhost/api/daemon/start", { method: "POST" }),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 30)),
    ]);

    expect(responseOrTimeout).not.toBe("timeout");

    const response = responseOrTimeout as Response;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, running: true });

    const status = await app.request("http://localhost/api/daemon");
    await expect(status.json()).resolves.toEqual({ running: true });

    resolveStart?.();
  });

  it("rejects book routes with path traversal ids", async () => {
    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/..%2Fetc%2Fpasswd", {
      method: "GET",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_BOOK_ID",
        message: 'Invalid book ID: "../etc/passwd"',
      },
    });
  });

  it("reflects project edits immediately without restarting the studio server", async () => {
    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const save = await app.request("http://localhost/api/project", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: "en",
        temperature: 0.2,
        maxTokens: 2048,
        stream: true,
      }),
    });

    expect(save.status).toBe(200);

    const project = await app.request("http://localhost/api/project");
    await expect(project.json()).resolves.toMatchObject({
      language: "en",
      temperature: 0.2,
      maxTokens: 2048,
      stream: true,
    });
  });

  it("reloads latest llm config for doctor checks without restarting the studio server", async () => {
    const startupConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "stale-model",
        baseUrl: "https://stale.example.com/v1",
      },
    };

    const freshConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "fresh-model",
        baseUrl: "https://fresh.example.com/v1",
      },
    };
    loadProjectConfigMock.mockResolvedValue(freshConfig);

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(startupConfig as never, root);

    const response = await app.request("http://localhost/api/doctor");

    expect(response.status).toBe(200);
    expect(createLLMClientMock).toHaveBeenCalledWith(expect.objectContaining({
      model: "fresh-model",
      baseUrl: "https://fresh.example.com/v1",
    }));
    expect(chatCompletionMock).toHaveBeenCalledWith(
      expect.anything(),
      "fresh-model",
      expect.any(Array),
      expect.objectContaining({ maxTokens: 5 }),
    );
  });

  it("reloads latest llm config for radar scans without restarting the studio server", async () => {
    const startupConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "stale-model",
        baseUrl: "https://stale.example.com/v1",
      },
    };

    const freshConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "fresh-model",
        baseUrl: "https://fresh.example.com/v1",
      },
    };
    loadProjectConfigMock.mockResolvedValue(freshConfig);

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(startupConfig as never, root);

    const response = await app.request("http://localhost/api/radar/scan", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(runRadarMock).toHaveBeenCalledTimes(1);
    expect(pipelineConfigs.at(-1)).toMatchObject({
      model: "fresh-model",
      defaultLLMConfig: expect.objectContaining({
        model: "fresh-model",
        baseUrl: "https://fresh.example.com/v1",
      }),
    });
  });

  it("returns structured radar config errors instead of leaking CLI text", async () => {
    runRadarMock.mockRejectedValueOnce(new Error("NOVELFORK_LLM_API_KEY not set. Run 'novelfork config set-global' or add it to project .env file."));

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/radar/scan", {
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "LLM_CONFIG_MISSING",
        message: "模型配置未完成，请先到管理中心配置 API Key 或选择可用网关。",
        hint: "打开管理中心 → 供应商，检查 API Key、Base URL 与模型配置。",
      },
    });
  });

  it("persists radar scan results into the author review area when a target book is provided", async () => {
    const bookDir = join(root, "books", "book-1", "story");
    await mkdir(bookDir, { recursive: true });
    await writeFile(join(root, "books", "book-1", "book.json"), JSON.stringify({ id: "book-1", title: "长夜书" }), "utf-8");

    runRadarMock.mockResolvedValueOnce({
      marketSummary: "番茄都市强势。",
      recommendations: [
        {
          confidence: 0.8,
          platform: "番茄",
          genre: "都市",
          concept: "债主追凶",
          reasoning: "强冲突。",
          benchmarkTitles: ["样书"],
        },
      ],
    });

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/radar/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: "book-1" }),
    });

    expect(response.status).toBe(200);
    const data = await response.json() as { persisted?: { path?: string } };
    expect(data.persisted?.path).toBe("books/book-1/story/market_radar.md");
    await expect(readFile(join(bookDir, "market_radar.md"), "utf-8")).resolves.toContain("作者可审阅结果");
  });

  it("captures web materials into the author review area instead of exposing a browser route", async () => {
    const bookDir = join(root, "books", "book-1", "story");
    await mkdir(bookDir, { recursive: true });
    await writeFile(join(root, "books", "book-1", "book.json"), JSON.stringify({ id: "book-1", title: "长夜书" }), "utf-8");

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/book-1/materials/web-capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com/topic",
        label: "题材采风",
        perspective: "genre",
      }),
    });

    expect(response.status).toBe(200);
    expect(fetchUrlMock).toHaveBeenCalledWith("https://example.com/topic", 8000);
    const data = await response.json() as { persisted?: { path?: string } };
    expect(data.persisted?.path).toBe("books/book-1/story/web_materials.md");
    await expect(readFile(join(bookDir, "web_materials.md"), "utf-8")).resolves.toContain("题材采风");
  });

  it("updates the first-run language immediately after the language selector saves", async () => {
    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const save = await app.request("http://localhost/api/project/language", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "en" }),
    });

    expect(save.status).toBe(200);

    const project = await app.request("http://localhost/api/project");
    await expect(project.json()).resolves.toMatchObject({
      language: "en",
      languageExplicit: true,
    });
  });

  it("creates a local book scaffold when project model config is missing", async () => {
    mockMissingProjectLlmConfig();

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Local Only Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "creating",
      bookId: "local-only-book",
      defaultSession: {
        title: "新书《Local Only Book》写作会话",
        projectId: "local-only-book",
      },
    });
    expect(initBookMock).not.toHaveBeenCalled();

    const bookJsonPath = join(root, "books", "local-only-book", "book.json");
    await expect(access(bookJsonPath)).resolves.toBeUndefined();
    await expect(access(join(root, "books", "local-only-book", "story", "story_bible.md"))).resolves.toBeUndefined();
    await expect(access(join(root, "books", "local-only-book", "chapters", "index.json"))).resolves.toBeUndefined();

    const bookJson = JSON.parse(await readFile(bookJsonPath, "utf-8")) as { title?: string };
    expect(bookJson.title).toBe("Local Only Book");

    const jingweiResponse = await app.request("http://localhost/api/books/local-only-book/jingwei/sections");
    expect(jingweiResponse.status).toBe(200);
    const jingweiPayload = await jingweiResponse.json() as { sections: Array<{ bookId: string; name: string }> };
    expect(jingweiPayload.sections.map((section) => section.bookId)).toEqual([
      "local-only-book",
      "local-only-book",
      "local-only-book",
      "local-only-book",
    ]);
    expect(jingweiPayload.sections.map((section) => section.name)).toEqual(["人物", "事件", "设定", "章节摘要"]);

    const deleteResponse = await app.request("http://localhost/api/books/local-only-book", { method: "DELETE" });
    expect(deleteResponse.status).toBe(200);
    const deletedJingweiResponse = await app.request("http://localhost/api/books/local-only-book/jingwei/sections");
    expect(deletedJingweiResponse.status).toBe(404);
  });

  it("writes preset-derived guide files when create requests enable writing presets", async () => {
    mockMissingProjectLlmConfig();

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Preset Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
        enabledPresetIds: ["classical-imagery", "sect-family-xianxia", "information-flow"],
      }),
    });

    expect(response.status).toBe(200);
    const bookJson = JSON.parse(await readFile(join(root, "books", "preset-book", "book.json"), "utf-8")) as { enabledPresetIds?: string[] };
    expect(bookJson.enabledPresetIds).toEqual(["classical-imagery", "sect-family-xianxia", "information-flow"]);

    const styleGuide = await readFile(join(root, "books", "preset-book", "story", "style_guide.md"), "utf-8");
    const settingGuide = await readFile(join(root, "books", "preset-book", "story", "setting_guide.md"), "utf-8");
    const bookRules = await readFile(join(root, "books", "preset-book", "story", "book_rules.md"), "utf-8");

    expect(styleGuide).toContain("古典意境");
    expect(settingGuide).toContain("宗门家族修仙社会");
    expect(bookRules).toContain("信息传播速度");
  });

  it("backfills SQLite book and jingwei sections for file-only books when listing books", async () => {
    const now = "2026-04-25T01:00:00.000Z";
    await mkdir(join(root, "books", "file-only-book", "story"), { recursive: true });
    await mkdir(join(root, "books", "file-only-book", "chapters"), { recursive: true });
    await writeFile(join(root, "books", "file-only-book", "book.json"), JSON.stringify({
      id: "file-only-book",
      title: "File Only Book",
      platform: "qidian",
      genre: "xuanhuan",
      status: "outlining",
      targetChapters: 10,
      chapterWordCount: 2000,
      language: "zh",
      createdAt: now,
      updatedAt: now,
    }, null, 2), "utf-8");
    await writeFile(join(root, "books", "file-only-book", "chapters", "index.json"), "[]", "utf-8");

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const listResponse = await app.request("http://localhost/api/books");
    expect(listResponse.status).toBe(200);
    const jingweiResponse = await app.request("http://localhost/api/books/file-only-book/jingwei/sections");
    expect(jingweiResponse.status).toBe(200);
    const jingweiPayload = await jingweiResponse.json() as { sections: Array<{ bookId: string; name: string }> };
    expect(jingweiPayload.sections.map((section) => section.bookId)).toEqual([
      "file-only-book",
      "file-only-book",
      "file-only-book",
      "file-only-book",
    ]);
    expect(jingweiPayload.sections.map((section) => section.name)).toEqual(["人物", "事件", "设定", "章节摘要"]);
  });

  it("rejects create requests when a complete book with the same id already exists", async () => {
    await mkdir(join(root, "books", "existing-book", "story"), { recursive: true });
    await writeFile(join(root, "books", "existing-book", "book.json"), JSON.stringify({ id: "existing-book" }), "utf-8");
    await writeFile(join(root, "books", "existing-book", "story", "story_bible.md"), "# existing", "utf-8");

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Existing Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('Book "existing-book" already exists'),
    });
    expect(initBookMock).not.toHaveBeenCalled();
    await expect(access(join(root, "books", "existing-book", "story", "story_bible.md"))).resolves.toBeUndefined();
  });

  it("rejects create requests when another book already owns the same repo worktree", async () => {
    const existingRepo = await mkdtemp(join(tmpdir(), "novelfork-studio-server-existing-repo-"));
    await createCommittedRepository(existingRepo, "main");
    await mkdir(join(root, "books", "occupied-book"), { recursive: true });
    await writeFile(
      join(root, "books", "occupied-book", ".novelfork-project-init.json"),
      `${JSON.stringify({
        title: "Occupied Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
        repositorySource: "existing",
        workflowMode: "outline-first",
        templatePreset: "genre-default",
        repositoryPath: existingRepo,
        gitBranch: "main",
        worktreeName: "draft-shared",
        initializationPlan: {
          phase: "project-create",
          nextStage: "book-create",
          readyToContinue: true,
        },
        createdAt: "2026-04-20T00:00:00.000Z",
        bootstrap: {
          status: "prepared",
          repositoryRoot: existingRepo,
          baseBranch: "main",
          worktreePath: join(existingRepo, ".novelfork-worktrees", "draft-shared"),
          worktreeBranch: "worktree/draft-shared-fixture",
          repositoryCreated: false,
          worktreeCreated: true,
        },
      }, null, 2)}\n`,
      "utf-8",
    );

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Conflicting Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
        projectInit: {
          repositorySource: "existing",
          repositoryPath: existingRepo,
          workflowMode: "outline-first",
          templatePreset: "genre-default",
          gitBranch: "main",
          worktreeName: "draft-shared",
        },
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PROJECT_BOOTSTRAP_WORKTREE_CONFLICT",
        message: expect.stringContaining("occupied-book"),
      },
    });
    expect(initBookMock).not.toHaveBeenCalled();

    await rm(existingRepo, { recursive: true, force: true });
  });

  it("creates a book from a cloned repository and persists the prepared bootstrap", async () => {
    const remoteRepo = await mkdtemp(join(tmpdir(), "novelfork-studio-server-clone-remote-"));

    try {
      await createCommittedRepository(remoteRepo, "story-base");
      initBookMock.mockResolvedValueOnce(undefined);

      const { createStudioServer } = await import("./server.js");
      const { app } = createStudioServer(cloneProjectConfig() as never, root);

      const response = await app.request("http://localhost/api/books/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Clone Book",
          genre: "xuanhuan",
          platform: "qidian",
          language: "zh",
          projectInit: {
            repositorySource: "clone",
            cloneUrl: remoteRepo,
            workflowMode: "serial-ops",
            templatePreset: "web-serial",
            gitBranch: "main",
            worktreeName: "draft-clone-book",
          },
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: "creating",
        bookId: "clone-book",
      });

      const persistedProjectInit = JSON.parse(
        await readFile(join(root, "books", "clone-book", ".novelfork-project-init.json"), "utf-8"),
      ) as { bootstrap?: { repositoryRoot?: string; baseBranch?: string; repositoryCreated?: boolean } };

      expect(persistedProjectInit.bootstrap).toMatchObject({
        baseBranch: "story-base",
        repositoryCreated: true,
      });
      await expect(access(join(persistedProjectInit.bootstrap!.repositoryRoot!, ".git"))).resolves.toBeUndefined();
      expect(initBookMock).toHaveBeenCalled();
    } finally {
      await rm(remoteRepo, { recursive: true, force: true });
    }
  });

  it("allows the same book to reuse its repo worktree when retrying after bootstrap", async () => {
    const existingRepo = await mkdtemp(join(tmpdir(), "novelfork-studio-server-retry-repo-"));
    await createCommittedRepository(existingRepo, "main");
    await mkdir(join(root, "books", "retry-book"), { recursive: true });
    await writeFile(
      join(root, "books", "retry-book", ".novelfork-project-init.json"),
      `${JSON.stringify({
        title: "Retry Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
        repositorySource: "existing",
        workflowMode: "outline-first",
        templatePreset: "genre-default",
        repositoryPath: existingRepo,
        gitBranch: "main",
        worktreeName: "draft-shared",
        initializationPlan: {
          phase: "project-create",
          nextStage: "book-create",
          readyToContinue: true,
        },
        createdAt: "2026-04-20T00:00:00.000Z",
        bootstrap: {
          status: "prepared",
          repositoryRoot: existingRepo,
          baseBranch: "main",
          worktreePath: join(existingRepo, ".novelfork-worktrees", "draft-shared"),
          worktreeBranch: "worktree/draft-shared-fixture",
          repositoryCreated: false,
          worktreeCreated: true,
        },
      }, null, 2)}\n`,
      "utf-8",
    );
    initBookMock.mockResolvedValueOnce(undefined);

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Retry Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
        projectInit: {
          repositorySource: "existing",
          repositoryPath: existingRepo,
          workflowMode: "outline-first",
          templatePreset: "genre-default",
          gitBranch: "main",
          worktreeName: "draft-shared",
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "creating",
      bookId: "retry-book",
    });
    expect(initBookMock).toHaveBeenCalled();

    await rm(existingRepo, { recursive: true, force: true });
  });

  it("scaffolds a default writer session and ready chat snapshot during book creation", async () => {
    initBookMock.mockResolvedValueOnce(undefined);

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Session Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
        projectInit: {
          repositorySource: "new",
          workflowMode: "outline-first",
          templatePreset: "genre-default",
          gitBranch: "main",
          worktreeName: "session-main",
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "creating",
      bookId: "session-book",
      defaultSession: {
        title: "新书《Session Book》写作会话",
        agentId: "writer",
        sessionMode: "chat",
        projectId: "session-book",
        worktree: "session-main",
      },
      defaultSessionSnapshot: {
        messages: [],
        cursor: { lastSeq: 0 },
      },
    });
    expect(body.defaultSessionSnapshot.session.id).toBe(body.defaultSession.id);

    const snapshotResponse = await app.request(`http://localhost/api/sessions/${body.defaultSession.id}/chat/state`);
    expect(snapshotResponse.status).toBe(200);
    await expect(snapshotResponse.json()).resolves.toMatchObject({
      session: {
        id: body.defaultSession.id,
        projectId: "session-book",
      },
      messages: [],
      cursor: { lastSeq: 0 },
    });
  });

  it("persists prepared bootstrap ownership even when async create later fails, so conflicts stay blocked", async () => {
    const existingRepo = await mkdtemp(join(tmpdir(), "novelfork-studio-server-persisted-bootstrap-repo-"));

    try {
      await createCommittedRepository(existingRepo, "main");
      initBookMock.mockRejectedValueOnce(new Error("NOVELFORK_LLM_API_KEY not set"));

      const { createStudioServer } = await import("./server.js");
      const { app } = createStudioServer(cloneProjectConfig() as never, root);

      const firstResponse = await app.request("http://localhost/api/books/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Retry Book",
          genre: "xuanhuan",
          platform: "qidian",
          language: "zh",
          projectInit: {
            repositorySource: "existing",
            repositoryPath: existingRepo,
            workflowMode: "outline-first",
            templatePreset: "genre-default",
            gitBranch: "main",
            worktreeName: "draft-shared",
          },
        }),
      });

      expect(firstResponse.status).toBe(200);
      const persistedProjectInit = JSON.parse(
        await readFile(join(root, "books", "retry-book", ".novelfork-project-init.json"), "utf-8"),
      ) as { bootstrap?: { repositoryRoot?: string; worktreeCreated?: boolean } };
      expect(persistedProjectInit).toMatchObject({
        repositorySource: "existing",
        worktreeName: "draft-shared",
        bootstrap: {
          repositoryRoot: existingRepo,
          worktreeCreated: true,
        },
      });

      await waitForPath(join(root, "books", "retry-book", "chapters", "index.json"));

      const conflictingResponse = await app.request("http://localhost/api/books/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Conflicting Book",
          genre: "xuanhuan",
          platform: "qidian",
          language: "zh",
          projectInit: {
            repositorySource: "existing",
            repositoryPath: existingRepo,
            workflowMode: "outline-first",
            templatePreset: "genre-default",
            gitBranch: "main",
            worktreeName: "draft-shared",
          },
        }),
      });

      expect(conflictingResponse.status).toBe(409);
      await expect(conflictingResponse.json()).resolves.toMatchObject({
        error: {
          code: "PROJECT_BOOTSTRAP_WORKTREE_CONFLICT",
          message: expect.stringContaining("retry-book"),
        },
      });
    } finally {
      await rm(existingRepo, { recursive: true, force: true });
    }
  });

  it("downgrades async model config failures to a local book scaffold", async () => {
    initBookMock.mockRejectedValueOnce(new Error("NOVELFORK_LLM_API_KEY not set"));

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Fallback Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
        jingweiTemplate: { templateId: "enhanced" },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "creating",
      bookId: "fallback-book",
    });
    expect(initBookMock).toHaveBeenCalled();

    const bookJsonPath = join(root, "books", "fallback-book", "book.json");
    const chapterIndexPath = join(root, "books", "fallback-book", "chapters", "index.json");
    await waitForPath(chapterIndexPath);
    await expect(access(bookJsonPath)).resolves.toBeUndefined();
    await expect(access(join(root, "books", "fallback-book", "story", "story_bible.md"))).resolves.toBeUndefined();
    await expect(access(chapterIndexPath)).resolves.toBeUndefined();

    const bookJson = JSON.parse(await readFile(bookJsonPath, "utf-8")) as { title?: string };
    expect(bookJson.title).toBe("Fallback Book");

    const sectionsJson = JSON.parse(
      await readFile(join(root, "books", "fallback-book", "story", "jingwei_sections.json"), "utf-8"),
    ) as { sections?: Array<{ key: string; name: string }> };
    expect(sectionsJson.sections?.map((section) => section.name)).toEqual(["人物", "事件", "设定", "章节摘要", "伏笔", "名场面", "核心记忆"]);
  });

  it("uses rollback semantics for chapter rejection instead of only flipping status", async () => {
    const chapterIndex = [
      {
        number: 3,
        title: "Broken Chapter",
        status: "ready-for-review",
        wordCount: 1800,
        createdAt: "2026-04-07T00:00:00.000Z",
        updatedAt: "2026-04-07T00:00:00.000Z",
        auditIssues: ["continuity"],
        lengthWarnings: [],
      },
      {
        number: 4,
        title: "Downstream Chapter",
        status: "ready-for-review",
        wordCount: 1900,
        createdAt: "2026-04-07T00:00:00.000Z",
        updatedAt: "2026-04-07T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
    ];
    await mkdir(join(root, "books", "demo-book", "chapters"), { recursive: true });
    await writeFile(
      join(root, "books", "demo-book", "chapters", "index.json"),
      JSON.stringify(chapterIndex, null, 2),
      "utf-8",
    );
    rollbackToChapterMock.mockResolvedValue([3, 4]);

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/demo-book/chapters/3/reject", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      chapterNumber: 3,
      status: "rejected",
      rolledBackTo: 2,
      discarded: [3, 4],
    });
    expect(rollbackToChapterMock).toHaveBeenCalledWith("demo-book", 2);
    expect(saveChapterIndexMock).not.toHaveBeenCalled();
  });

  it("passes one-off brief into revise requests through pipeline config", async () => {
    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/demo-book/revise/3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "rewrite", brief: "把注意力拉回师债主线。" }),
    });

    expect(response.status).toBe(200);
    expect(pipelineConfigs.at(-1)).toMatchObject({ externalContext: "把注意力拉回师债主线。" });
    expect(reviseDraftMock).toHaveBeenCalledWith("demo-book", 3, "rewrite");
  });

  it("exposes a resync endpoint for rebuilding latest chapter truth artifacts", async () => {
    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/demo-book/resync/3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief: "以师债线为准同步状态。" }),
    });

    expect(response.status).toBe(200);
    expect(pipelineConfigs.at(-1)).toMatchObject({ externalContext: "以师债线为准同步状态。" });
    expect(resyncChapterArtifactsMock).toHaveBeenCalledWith("demo-book", 3);
  });

  it("serves SPA index for app routes and static assets for dotted paths", async () => {
    const readAssetMock = vi.fn(async (requestPath: string) => {
      if (requestPath === "/assets/app.js") {
        return {
          content: new TextEncoder().encode("console.log('studio');"),
          contentType: "application/javascript",
        };
      }
      return null;
    });

    const { startStudioServer } = await import("./server.js");

    await startStudioServer(root, 4567, {
      staticProvider: {
        describe: () => ({ source: "embedded", assetCount: 0 }),
        hasIndexHtml: vi.fn(async () => true),
        readIndexHtml: vi.fn(async () => "<html><body>studio</body></html>"),
        readAsset: readAssetMock,
      },
      staticMode: "embedded",
    });

    const serverFetch = getCapturedFetch();

    const appRouteResponse = await serverFetch(new Request("http://localhost/workbench/runs/latest"));
    expect(appRouteResponse.status).toBe(200);
    await expect(appRouteResponse.text()).resolves.toContain("studio");

    const assetResponse = await serverFetch(new Request("http://localhost/assets/app.js"));
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("Content-Type")).toBe("application/javascript");
    await expect(assetResponse.text()).resolves.toContain("console.log");
    expect(readAssetMock).toHaveBeenCalledWith("/assets/app.js");
  });

  it("does not fall back to index for api routes or missing dotted assets", async () => {
    const readIndexHtmlMock = vi.fn(async () => "<html><body>studio</body></html>");

    const { startStudioServer } = await import("./server.js");

    await startStudioServer(root, 4567, {
      staticProvider: {
        describe: () => ({ source: "embedded", assetCount: 0 }),
        hasIndexHtml: vi.fn(async () => true),
        readIndexHtml: readIndexHtmlMock,
        readAsset: vi.fn(async () => null),
      },
      staticMode: "embedded",
    });

    const serverFetch = getCapturedFetch();

    const apiResponse = await serverFetch(new Request("http://localhost/api/unknown"));
    expect(apiResponse.status).toBe(404);

    const missingAssetResponse = await serverFetch(new Request("http://localhost/assets/missing.js"));
    expect(missingAssetResponse.status).toBe(404);

    expect(readIndexHtmlMock).not.toHaveBeenCalled();
  });

  it("initializes SQLite storage before starting the http server", async () => {
    process.env.NOVELFORK_SESSION_STORE_DIR = join(root, "runtime-store");
    const { startStudioServer } = await import("./server.js");

    await startStudioServer(root, 4567, {
      staticProvider: {
        describe: () => ({ source: "embedded", assetCount: 0 }),
        hasIndexHtml: vi.fn(async () => true),
        readIndexHtml: vi.fn(async () => "<html></html>"),
        readAsset: vi.fn(async () => null),
      },
      staticMode: "embedded",
    });

    expect(createStorageDatabaseMock).toHaveBeenCalledWith({
      databasePath: join(root, "runtime-store", "novelfork.db"),
    });
    expect(runStorageMigrationsMock).toHaveBeenCalledTimes(1);
    expect(runJsonImportMigrationIfNeededMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      storageDir: join(root, "runtime-store"),
    }));
    expect(startHttpServerMock).toHaveBeenCalledWith(expect.objectContaining({ port: 4567 }));
    expect(runStorageMigrationsMock.mock.invocationCallOrder[0]).toBeLessThan(
      startHttpServerMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(runJsonImportMigrationIfNeededMock.mock.invocationCallOrder[0]).toBeLessThan(
      startHttpServerMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("closes SQLite storage and does not listen when migration fails", async () => {
    const closeMock = vi.fn();
    createStorageDatabaseMock.mockReturnValueOnce({ close: closeMock, checkpoint: vi.fn() });
    runStorageMigrationsMock.mockImplementationOnce(() => {
      throw new Error("migration failed");
    });
    const { startStudioServer } = await import("./server.js");

    await expect(startStudioServer(root, 4567)).rejects.toThrow("migration failed");

    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(startHttpServerMock).not.toHaveBeenCalled();
  });

  it("runs startup orchestrator with delivery context before starting the http server", async () => {
    const { startStudioServer } = await import("./server.js");

    await startStudioServer(root, 4567, {
      staticProvider: {
        describe: () => ({ source: "embedded", assetCount: 0 }),
        hasIndexHtml: vi.fn(async () => true),
        readIndexHtml: vi.fn(async () => "<html></html>"),
        readAsset: vi.fn(async () => null),
      },
      staticMode: "embedded",
    });

    expect(startupOrchestratorMock).toHaveBeenCalledTimes(1);
    const startupOptions = (startupOrchestratorMock.mock.calls as unknown[])[0] as [unknown, {
      projectBootstrap: { status: string; reason: string };
      staticDelivery: { mode: string; hasIndexHtml: boolean };
      compileSmoke: { status: string; reason: string; note?: string };
    }] | undefined;
    expect(startupOptions?.[1].projectBootstrap.status).toBe("skipped");
    expect(startupOptions?.[1].projectBootstrap.reason).toBe("项目配置已存在，无需自动初始化");
    expect(startupOptions?.[1].staticDelivery.mode).toBe("embedded");
    expect(startupOptions?.[1].staticDelivery.hasIndexHtml).toBe(true);
    expect(startupOptions?.[1].compileSmoke.status).toBe("failed");
    expect(startupOptions?.[1].compileSmoke.reason).toBe("单文件产物缺失");
    expect(startupOptions?.[1].compileSmoke.note).toContain("dist");
    expect(startupOptions?.[1].compileSmoke.note).toContain("novelfork");
    expect(startHttpServerMock).toHaveBeenCalledWith(expect.objectContaining({ port: 4567 }));
  });

  it("logs structured runtime and static delivery facts at startup", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { startStudioServer } = await import("./server.js");

    await startStudioServer(root, 4567, {
      staticProvider: {
        describe: () => ({ source: "embedded", assetCount: 2 }),
        hasIndexHtml: vi.fn(async () => true),
        readIndexHtml: vi.fn(async () => "<html></html>"),
        readAsset: vi.fn(async () => null),
      },
      staticMode: "embedded",
    });

    const parsedLines = consoleLog.mock.calls
      .map(([line]) => typeof line === "string" ? line : "")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));

    expect(parsedLines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        component: "static.provider",
        ok: true,
        source: "embedded",
        assetCount: 2,
      }),
      expect.objectContaining({
        component: "server.listen",
        ok: true,
        url: "http://localhost:4567",
        assetSource: "embedded",
        runtime: expect.any(String),
        isCompiledBinary: expect.any(Boolean),
      }),
    ]));
    consoleLog.mockRestore();
  });

  it("passes startup repair diagnostics into the startup orchestrator", async () => {
    await mkdir(join(root, ".novelfork"), { recursive: true });
    await writeFile(join(root, ".novelfork", "running.pid"), JSON.stringify({ pid: 123 }), "utf-8");

    const { startStudioServer } = await import("./server.js");

    await startStudioServer(root, 4567, {
      staticProvider: {
        describe: () => ({ source: "embedded", assetCount: 1 }),
        hasIndexHtml: vi.fn(async () => true),
        readIndexHtml: vi.fn(async () => "<html></html>"),
        readAsset: vi.fn(async () => null),
      },
      staticMode: "embedded",
    });

    expect(startupOrchestratorMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            kind: "unclean-shutdown",
            status: "failed",
          }),
        ]),
      }),
    );
  });

  it("marks compile smoke as success only when the single-file artifact exists", async () => {
    const artifactPath = join(root, "dist", "novelfork.exe");
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(artifactPath, "binary", "utf-8");

    const { startStudioServer } = await import("./server.js");

    await startStudioServer(root, 4567, {
      staticProvider: {
        describe: () => ({ source: "embedded", assetCount: 0 }),
        hasIndexHtml: vi.fn(async () => true),
        readIndexHtml: vi.fn(async () => "<html></html>"),
        readAsset: vi.fn(async () => null),
      },
      staticMode: "embedded",
    });

    expect(startupOrchestratorMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        compileSmoke: expect.objectContaining({
          status: "success",
          reason: "单文件产物与静态入口均可用",
          note: expect.stringContaining("novelfork.exe"),
        }),
      }),
    );
  });

  it("reruns startup recovery from the admin route and refreshes the cached summary", async () => {
    const staleSummary = {
      bookCount: 0,
      migratedBooks: 0,
      indexedDocuments: 0,
      skippedBooks: 0,
      failures: [{ phase: "search-index", message: "stale failure" }],
      delivery: {
        staticMode: "embedded",
        indexHtmlReady: true,
        compileSmokeStatus: "success",
      },
      recoveryReport: {
        startedAt: "2026-04-20T10:00:00.000Z",
        finishedAt: "2026-04-20T10:00:01.000Z",
        durationMs: 1000,
        actions: [],
        counts: { success: 1, skipped: 0, failed: 1 },
      },
    };
    const refreshedSummary = {
      ...staleSummary,
      indexedDocuments: 5,
      failures: [],
      recoveryReport: {
        startedAt: "2026-04-20T10:05:00.000Z",
        finishedAt: "2026-04-20T10:05:01.000Z",
        durationMs: 1000,
        actions: [],
        counts: { success: 4, skipped: 0, failed: 0 },
      },
    };

    const { createStudioServer } = await import("./server.js");
    const { app, ctx } = createStudioServer(cloneProjectConfig() as never, root);
    const startupRecoveryRunner = vi.fn(async () => refreshedSummary);

    ctx.setStartupSummary(staleSummary as never);
    ctx.setStartupRecoveryRunner(startupRecoveryRunner as never);

    const beforeResponse = await app.request("http://localhost/api/admin/resources");
    expect(beforeResponse.status).toBe(200);
    const beforePayload = await beforeResponse.json();
    expect(beforePayload.startup.recoveryReport.startedAt).toBe("2026-04-20T10:00:00.000Z");
    expect(beforePayload.startup.recoveryReport.counts.failed).toBe(1);

    const rerunResponse = await app.request("http://localhost/api/admin/resources/recovery", {
      method: "POST",
    });
    expect(rerunResponse.status).toBe(200);
    const rerunPayload = await rerunResponse.json();
    expect(startupRecoveryRunner).toHaveBeenCalledTimes(1);
    expect(rerunPayload.recoveryTriggered).toBe(true);
    expect(rerunPayload.startup.recoveryReport.startedAt).toBe("2026-04-20T10:05:00.000Z");
    expect(rerunPayload.startup.recoveryReport.counts.failed).toBe(0);

    const afterResponse = await app.request("http://localhost/api/admin/resources");
    expect(afterResponse.status).toBe(200);
    const afterPayload = await afterResponse.json();
    expect(afterPayload.startup.recoveryReport.startedAt).toBe("2026-04-20T10:05:00.000Z");
    expect(afterPayload.startup.indexedDocuments).toBe(5);
  });

  it("logs structured startup health checks after recovery summary is generated", async () => {
    startupOrchestratorMock.mockResolvedValueOnce({
      bookCount: 0,
      migratedBooks: 0,
      indexedDocuments: 0,
      skippedBooks: 0,
      failures: [{ phase: "session-store", message: "orphan=demo-session" }],
      delivery: {
        staticMode: "filesystem",
        indexHtmlReady: true,
        compileSmokeStatus: "failed",
      },
      recoveryReport: {
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(0).toISOString(),
        durationMs: 0,
        actions: [],
        counts: { success: 1, skipped: 1, failed: 1 },
      },
      healthChecks: [
        {
          id: "session-store",
          category: "session",
          phase: "session-store",
          title: "会话存储",
          summary: "会话存储存在孤儿历史文件",
          status: "error",
          source: "diagnostic",
          detail: "orphan=demo-session",
          action: { kind: "cleanup-session-history", label: "清理孤儿会话历史", endpoint: "/api/admin/resources/recovery/session-store", method: "POST" },
        },
        {
          id: "static-delivery",
          category: "delivery",
          phase: "static-delivery",
          title: "静态资源模式",
          summary: "当前使用 filesystem 静态资源启动。",
          status: "warning",
          source: "delivery",
        },
      ],
    } as never);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { startStudioServer } = await import("./server.js");

    await startStudioServer(root, 4567, {
      staticProvider: {
        describe: () => ({ source: "filesystem", root: join(root, "dist") }),
        hasIndexHtml: vi.fn(async () => true),
        readIndexHtml: vi.fn(async () => "<html></html>"),
        readAsset: vi.fn(async () => null),
      },
      staticMode: "filesystem",
    });

    const parsedLines = consoleLog.mock.calls
      .map(([line]) => typeof line === "string" ? line : "")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));

    expect(parsedLines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        component: "startup.health.session-store",
        ok: false,
        category: "session",
        action: "cleanup-session-history",
      }),
      expect.objectContaining({
        component: "startup.health.static-delivery",
        skipped: true,
        category: "delivery",
      }),
    ]));
    consoleLog.mockRestore();
  });

  it("wires startup self-heal endpoints through the admin route", async () => {
    const cleanupRunner = vi.fn(async () => ({
      bookCount: 0,
      migratedBooks: 0,
      indexedDocuments: 0,
      skippedBooks: 0,
      failures: [],
      delivery: { staticMode: "embedded", indexHtmlReady: true, compileSmokeStatus: "success" },
      recoveryReport: {
        startedAt: "2026-04-20T10:00:00.000Z",
        finishedAt: "2026-04-20T10:00:01.000Z",
        durationMs: 1000,
        actions: [],
        counts: { success: 3, skipped: 0, failed: 0 },
      },
      healthChecks: [],
    } as never));
    const { createStudioServer } = await import("./server.js");
    const { app, ctx } = createStudioServer(cloneProjectConfig() as never, root);

    ctx.setStartupSummary({
      bookCount: 0,
      migratedBooks: 0,
      indexedDocuments: 0,
      skippedBooks: 0,
      failures: [{ phase: "session-store", message: "orphan=demo-session" }],
      delivery: { staticMode: "embedded", indexHtmlReady: true, compileSmokeStatus: "success" },
      recoveryReport: {
        startedAt: "2026-04-20T09:59:00.000Z",
        finishedAt: "2026-04-20T09:59:01.000Z",
        durationMs: 1000,
        actions: [],
        counts: { success: 1, skipped: 0, failed: 1 },
      },
      healthChecks: [],
    } as never);
    ctx.setStartupRecoveryRunner(cleanupRunner as never);

    const cleanupResponse = await app.request("http://localhost/api/admin/resources/recovery/session-store", { method: "POST" });
    expect(cleanupResponse.status).toBe(200);
    await expect(cleanupResponse.json()).resolves.toMatchObject({ sessionStoreCleanupTriggered: true });

    const ignoreResponse = await app.request("http://localhost/api/admin/resources/recovery/worktree-pollution", { method: "POST" });
    expect(ignoreResponse.status).toBe(200);
    await expect(ignoreResponse.json()).resolves.toMatchObject({ worktreeIgnoreTriggered: true });
    expect(cleanupRunner).toHaveBeenCalledTimes(2);
  });

  it("attaches websocket routes to the started http server", async () => {
    const startedServer = { kind: "started-http-server" };
    startHttpServerMock.mockResolvedValueOnce(startedServer);

    const { startStudioServer } = await import("./server.js");
    await startStudioServer(root, 4567);

    expect(startHttpServerMock).toHaveBeenCalledWith(expect.objectContaining({ port: 4567 }));
    expect(setupAdminWebSocketMock).toHaveBeenCalledWith(startedServer);
    expect(setupSessionChatWebSocketMock).toHaveBeenCalledWith(startedServer);
  });
});
