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

  it("bootstraps a new local repo/worktree before persisting the project init sidecar", async () => {
    initBookMock.mockImplementationOnce(async (bookConfig: { id: string }) => {
      const bookDir = join(root, "books", bookConfig.id);
      await mkdir(join(bookDir, "story"), { recursive: true });
      await writeFile(join(bookDir, "book.json"), JSON.stringify(bookConfig), "utf-8");
      await writeFile(join(bookDir, "story", "story_bible.md"), "# initialized", "utf-8");
    });

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Init Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
        projectInit: {
          repositorySource: "new",
          workflowMode: "serial-ops",
          templatePreset: "web-serial",
          gitBranch: "main",
          worktreeName: "serial-room",
        },
        initializationPlan: {
          phase: "project-create",
          nextStage: "book-create",
          readyToContinue: true,
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(access(join(root, ".git"))).resolves.toBeUndefined();
    await expect(access(join(root, ".novelfork-worktrees", "serial-room"))).resolves.toBeUndefined();

    await vi.waitFor(async () => {
      const sidecar = JSON.parse(
        await readFile(join(root, "books", "init-book", ".novelfork-project-init.json"), "utf-8"),
      );
      expect(sidecar).toMatchObject({
        title: "Init Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
        repositorySource: "new",
        workflowMode: "serial-ops",
        templatePreset: "web-serial",
        gitBranch: "main",
        worktreeName: "serial-room",
        initializationPlan: {
          phase: "project-create",
          nextStage: "book-create",
          readyToContinue: true,
        },
        bootstrap: {
          status: "prepared",
          repositoryRoot: root,
          baseBranch: "main",
          worktreePath: join(root, ".novelfork-worktrees", "serial-room"),
          repositoryCreated: true,
          worktreeCreated: true,
        },
      });
      expect(sidecar.bootstrap.worktreeBranch).toContain("worktree/");
    });
  });

  it("creates a worktree inside an existing repository path before running book scaffold creation", async () => {
    const existingRepo = await mkdtemp(join(tmpdir(), "novelfork-existing-repo-"));
    await createCommittedRepository(existingRepo, "story-base");
    initBookMock.mockImplementationOnce(async (bookConfig: { id: string }) => {
      const bookDir = join(root, "books", bookConfig.id);
      await mkdir(join(bookDir, "story"), { recursive: true });
      await writeFile(join(bookDir, "book.json"), JSON.stringify(bookConfig), "utf-8");
      await writeFile(join(bookDir, "story", "story_bible.md"), "# initialized", "utf-8");
    });

    try {
      const { createStudioServer } = await import("./server.js");
      const { app } = createStudioServer(cloneProjectConfig() as never, root);

      const response = await app.request("http://localhost/api/books/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Existing Repo Book",
          genre: "xuanhuan",
          platform: "qidian",
          language: "zh",
          projectInit: {
            repositorySource: "existing",
            repositoryPath: existingRepo,
            workflowMode: "outline-first",
            templatePreset: "genre-default",
            gitBranch: "main",
            worktreeName: "draft-existing-repo",
          },
          initializationPlan: {
            phase: "project-create",
            nextStage: "book-create",
            readyToContinue: true,
          },
        }),
      });

      expect(response.status).toBe(200);
      await expect(access(join(existingRepo, ".novelfork-worktrees", "draft-existing-repo"))).resolves.toBeUndefined();

      await vi.waitFor(async () => {
        const sidecar = JSON.parse(
          await readFile(join(root, "books", "existing-repo-book", ".novelfork-project-init.json"), "utf-8"),
        );
        expect(sidecar.bootstrap).toMatchObject({
          status: "prepared",
          repositoryRoot: existingRepo,
          baseBranch: "story-base",
          baseBranchFallback: true,
          repositoryCreated: false,
          worktreeCreated: true,
          worktreePath: join(existingRepo, ".novelfork-worktrees", "draft-existing-repo"),
        });
      });
    } finally {
      await rm(existingRepo, { recursive: true, force: true });
    }
  });

  it("rejects clone bootstrap requests explicitly instead of pretending they succeeded", async () => {
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
          cloneUrl: "https://github.com/vivy1024/novelfork.git",
          workflowMode: "serial-ops",
          templatePreset: "web-serial",
          gitBranch: "main",
          worktreeName: "serial-room",
        },
        initializationPlan: {
          phase: "project-create",
          nextStage: "book-create",
          readyToContinue: true,
        },
      }),
    });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PROJECT_BOOTSTRAP_CLONE_UNSUPPORTED",
        message: "Clone bootstrap is not implemented under the current fixed workspace root yet.",
      },
    });
    expect(initBookMock).not.toHaveBeenCalled();
  });

  it("rejects duplicate create requests while the same book is still initializing", async () => {
    let resolveInit: (() => void) | undefined;
    initBookMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        resolveInit = resolve;
      }),
    );

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);
    const payload = JSON.stringify({
      title: "Concurrent Book",
      genre: "xuanhuan",
      platform: "qidian",
      language: "zh",
      projectInit: {
        repositorySource: "new",
        workflowMode: "serial-ops",
        templatePreset: "web-serial",
        gitBranch: "main",
        worktreeName: "concurrent-room",
      },
      initializationPlan: {
        phase: "project-create",
        nextStage: "book-create",
        readyToContinue: true,
      },
    });

    const firstRequest = app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    await Promise.resolve();
    const secondResponse = await app.request("http://localhost/api/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    const firstResponse = await firstRequest;

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(409);
    await expect(secondResponse.json()).resolves.toMatchObject({
      error: 'Book "concurrent-book" is already being created',
    });

    resolveInit?.();
  });

  it("serves /api/worktree routes against the studio root instead of process.cwd()", async () => {
    await createCommittedRepository(root, "main");

    const { createStudioServer } = await import("./server.js");
    const { app } = createStudioServer(cloneProjectConfig() as never, root);

    const createResponse = await app.request("http://localhost/api/worktree/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ops-room" }),
    });

    expect(createResponse.status).toBe(200);
    await expect(createResponse.json()).resolves.toMatchObject({
      ok: true,
      path: join(root, ".novelfork-worktrees", "ops-room"),
    });

    const listResponse = await app.request("http://localhost/api/worktree/list");
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      worktrees: expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining("ops-room") }),
      ]),
    });
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
});
