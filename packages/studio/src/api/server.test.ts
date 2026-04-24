import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const loadProjectConfigMock = vi.fn();
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
}));
const pipelineConfigs: unknown[] = [];

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
      return [];
    }

    async loadBookConfig(): Promise<never> {
      throw new Error("not implemented");
    }

    async loadChapterIndex(bookId: string): Promise<[]> {
      return (await loadChapterIndexMock(bookId)) as [];
    }

    async saveChapterIndex(bookId: string, index: unknown): Promise<void> {
      await saveChapterIndexMock(bookId, index);
    }

    async rollbackToChapter(bookId: string, chapterNumber: number): Promise<number[]> {
      return (await rollbackToChapterMock(bookId, chapterNumber)) as number[];
    }

    async getNextChapterNumber(): Promise<number> {
      return 1;
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

  return {
    StateManager: MockStateManager,
    PipelineRunner: MockPipelineRunner,
    Scheduler: MockScheduler,
    createLLMClient: createLLMClientMock,
    createLogger: vi.fn(() => logger),
    computeAnalytics: vi.fn(() => ({})),
    chatCompletion: chatCompletionMock,
    loadProjectConfig: loadProjectConfigMock,
    GLOBAL_ENV_PATH: join(tmpdir(), "novelfork-global.env"),
    pipelineEvents: { on: vi.fn() },
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
    loadProjectConfigMock.mockReset();
    startHttpServerMock.mockClear();
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

      await Promise.resolve();

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

  it("reports async create failures through the create-status endpoint", async () => {
    initBookMock.mockRejectedValueOnce(new Error("NOVELFORK_LLM_API_KEY not set"));

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Broken Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
      }),
    });

    expect(response.status).toBe(200);
    await Promise.resolve();

    const status = await app.request("http://localhost/api/books/broken-book/create-status");
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      status: "error",
      error: "NOVELFORK_LLM_API_KEY not set",
    });
  });

  it("uses rollback semantics for chapter rejection instead of only flipping status", async () => {
    loadChapterIndexMock.mockResolvedValue([
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
    ]);
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

  it("runs startup orchestrator with delivery context before starting the http server", async () => {
    const { startStudioServer } = await import("./server.js");

    await startStudioServer(root, 4567, {
      staticProvider: {
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

  it("marks compile smoke as success only when the single-file artifact exists", async () => {
    const artifactPath = join(root, "dist", "novelfork.exe");
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(artifactPath, "binary", "utf-8");

    const { startStudioServer } = await import("./server.js");

    await startStudioServer(root, 4567, {
      staticProvider: {
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
