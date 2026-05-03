import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderRuntimeStore } from "../lib/provider-runtime-store.js";
import { createWritingToolsRouter } from "./writing-tools.js";

const coreMocks = vi.hoisted(() => {
  const kv = new Map<string, string>();
  const storage = { id: "storage" };
  return {
    kv,
    storage,
    analyzeDialogue: vi.fn(() => ({ dialogueRatio: 0.5, isHealthy: true })),
    analyzeRhythm: vi.fn(() => ({ rhythmScore: 80, sentenceHistogram: [] })),
    analyzeSensitiveWords: vi.fn((content: string) => ({
      issues: [],
      found: content.includes("肢解") ? [{ word: "肢解", count: 1, severity: "warn" }] : [],
    })),
    buildConflictMap: vi.fn(() => [{ id: "c-1", name: "主线冲突", state: "escalating", dialectic: null, lastAdvancedChapter: 5 }]),
    buildPovDashboard: vi.fn(() => ({ characters: [{ name: "林月", totalChapters: 1, lastAppearanceChapter: 1, gapSinceLastAppearance: 1, chapterNumbers: [1] }], currentChapter: 2, warnings: [] })),
    detectToneDrift: vi.fn(() => ({ declaredTone: "冷峻质朴", detectedTone: "冷峻质朴", driftScore: 0.1, driftDirection: "一致", isSignificant: false, consecutiveDriftChapters: 0 })),
    generateChapterHooks: vi.fn(() => Promise.resolve([{ id: "hook-1", style: "suspense", text: "门外传来第三个人的脚步声。", rationale: "制造新问题", retentionEstimate: "high" }])),
    getDailyProgress: vi.fn((_storage: unknown, config: unknown) => Promise.resolve({ today: { written: 3000, target: (config as { dailyTarget: number }).dailyTarget, completed: false }, thisWeek: { written: 3000, target: 42000 }, streak: 0, last30Days: [] })),
    getProgressTrend: vi.fn(() => Promise.resolve([{ date: "2026-04-26", wordCount: 3000 }])),
    getStorageDatabase: vi.fn(() => storage),
    conflictRecords: [] as unknown[],
    filterReportRecords: [] as Array<{ aiTasteScore: number; chapterNumber: number }>,
    createKvRepository: vi.fn(() => ({
      get: vi.fn((key: string) => Promise.resolve(kv.get(key) ?? null)),
      set: vi.fn((key: string, value: string) => {
        kv.set(key, value);
        return Promise.resolve();
      }),
    })),
    createBibleConflictRepository: vi.fn(() => ({
      listByBook: vi.fn(() => Promise.resolve(coreMocks.conflictRecords)),
    })),
    createFilterReportRepository: vi.fn(() => ({
      listByBook: vi.fn(() => Promise.resolve(coreMocks.filterReportRecords)),
    })),
    createBibleCharacterArcRepository: vi.fn(() => ({
      listByBook: vi.fn(() => Promise.resolve([{ id: "arc-1", characterId: "char-1", arcType: "positive-growth" }])),
    })),
  };
});

vi.mock("@vivy1024/novelfork-core", () => ({
  analyzeDialogue: coreMocks.analyzeDialogue,
  analyzeRhythm: coreMocks.analyzeRhythm,
  analyzeSensitiveWords: coreMocks.analyzeSensitiveWords,
  buildConflictMap: coreMocks.buildConflictMap,
  buildPovDashboard: coreMocks.buildPovDashboard,
  createBibleCharacterArcRepository: coreMocks.createBibleCharacterArcRepository,
  createBibleConflictRepository: coreMocks.createBibleConflictRepository,
  createFilterReportRepository: coreMocks.createFilterReportRepository,
  createKvRepository: coreMocks.createKvRepository,
  detectToneDrift: coreMocks.detectToneDrift,
  generateChapterHooks: coreMocks.generateChapterHooks,
  getDailyProgress: coreMocks.getDailyProgress,
  getProgressTrend: coreMocks.getProgressTrend,
  getStorageDatabase: coreMocks.getStorageDatabase,
}));

const tempDirs: string[] = [];

async function createRoute(options: { readonly sessionLlm?: boolean; readonly providerStore?: ProviderRuntimeStore } = {}) {
  const root = join(tmpdir(), `novelfork-writing-tools-route-${crypto.randomUUID()}`);
  tempDirs.push(root);
  const bookDir = join(root, "books", "book-1");
  const chaptersDir = join(bookDir, "chapters");
  const storyDir = join(bookDir, "story");
  await mkdir(chaptersDir, { recursive: true });
  await mkdir(storyDir, { recursive: true });
  await writeFile(join(bookDir, "book.json"), JSON.stringify({
    id: "book-1",
    title: "写作工具测试书",
    platform: "qidian",
    genre: "xianxia",
    status: "active",
    targetChapters: 10,
    chapterWordCount: 3000,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
  }), "utf-8");
  await writeFile(join(chaptersDir, "index.json"), JSON.stringify([{ number: 1, title: "开始" }, { number: 2, title: "继续" }]), "utf-8");
  await writeFile(join(chaptersDir, "0001_start.md"), "# 第1章\n\n林月说道：“我们不能回头。”夜色很短。她在卷宗边看到肢解二字。", "utf-8");
  await writeFile(join(storyDir, "pending_hooks.md"), "| hook_id | status |\n| old-hook | open |", "utf-8");
  await writeFile(join(storyDir, "character_matrix.md"), "| 角色 | POV |\n| 林月 | 是 |\n| 沈舟 | 是 |", "utf-8");
  await writeFile(join(storyDir, "chapter_summaries.md"), "| chapter | title | pov |\n| 1 | 开始 | 林月 |", "utf-8");
  await writeFile(join(storyDir, "style_profile.json"), JSON.stringify({ avgSentenceLength: 20, sentenceLengthStdDev: 8 }), "utf-8");

  const state = {
    bookDir(id: string) {
      return join(root, "books", id);
    },
    async loadBookConfig(id: string) {
      if (id !== "book-1") throw new Error("missing book");
      const raw = await import("node:fs/promises").then((fs) => fs.readFile(join(bookDir, "book.json"), "utf-8"));
      return JSON.parse(raw) as Record<string, unknown>;
    },
    async loadChapterIndex(id: string) {
      if (id !== "book-1") throw new Error("missing book");
      const raw = await import("node:fs/promises").then((fs) => fs.readFile(join(chaptersDir, "index.json"), "utf-8"));
      return JSON.parse(raw) as Array<{ number: number; title: string }>;
    },
  };

  const app = createWritingToolsRouter({
    state,
    root,
    broadcast: vi.fn(),
    buildPipelineConfig: vi.fn(() => Promise.resolve({ client: {}, model: "mock-model" })),
    getSessionLlm: vi.fn(() => Promise.resolve(options.sessionLlm ? { apiKey: "test", baseUrl: "https://example.test", model: "mock-model", provider: "custom" } : undefined)),
    runStore: {} as never,
    providerStore: options.providerStore ?? new ProviderRuntimeStore({ storagePath: join(root, ".runtime", "provider-runtime.json") }),
    getStartupSummary: () => null,
    setStartupSummary: vi.fn(),
    setStartupRecoveryRunner: vi.fn(),
  } as never);

  return { app, bookDir };
}

async function postJson(app: { request: (url: string, init?: RequestInit) => Response | Promise<Response> }, path: string, body: unknown = {}) {
  return app.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createUsableProviderStore() {
  const runtimeDir = join(tmpdir(), `novelfork-writing-tools-runtime-${crypto.randomUUID()}`);
  tempDirs.push(runtimeDir);
  const providerStore = new ProviderRuntimeStore({ storagePath: join(runtimeDir, "provider-runtime.json") });
  await providerStore.createProvider({
    id: "sub2api",
    name: "Sub2API",
    type: "custom",
    enabled: true,
    priority: 1,
    apiKeyRequired: true,
    baseUrl: "https://api.example.com/v1",
    compatibility: "openai-compatible",
    config: { apiKey: "sk-test" },
    models: [{ id: "gpt-5-codex", name: "GPT-5 Codex", contextWindow: 192000, maxOutputTokens: 8192, enabled: true, source: "detected" }],
  });
  return providerStore;
}

beforeEach(() => {
  coreMocks.kv.clear();
  coreMocks.conflictRecords.length = 0;
  coreMocks.filterReportRecords.length = 0;
  vi.clearAllMocks();
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("writing tools routes", () => {
  it("returns AI gate result when hook generation has no usable model", async () => {
    const { app } = await createRoute();

    const response = await postJson(app, "/api/books/book-1/hooks/generate", { chapterNumber: 1 });

    expect(response.status).toBe(409);
    const json = await response.json() as { gate: { ok: boolean; reason: string } };
    expect(json.gate.ok).toBe(false);
    expect(json.gate.reason).toBe("model-not-configured");
    expect(coreMocks.generateChapterHooks).not.toHaveBeenCalled();
  });

  it("generates chapter hooks when the runtime provider store has a usable model", async () => {
    const providerStore = await createUsableProviderStore();
    const { app } = await createRoute({ providerStore });

    const response = await postJson(app, "/api/books/book-1/hooks/generate", { chapterNumber: 1, nextChapterIntent: "追查脚步声" });

    expect(response.status).toBe(200);
    const json = await response.json() as { hooks: Array<{ id: string; text: string }> };
    expect(json.hooks[0]?.id).toBe("hook-1");
    expect(coreMocks.generateChapterHooks).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        chapterNumber: 1,
        pendingHooks: expect.stringContaining("old-hook"),
        chapterContent: expect.stringContaining("林月说道"),
        bookGenre: "xianxia",
      }),
      model: "mock-model",
    }));
  });

  it("generates chapter hooks when session LLM is available", async () => {
    const { app } = await createRoute({ sessionLlm: true });

    const response = await postJson(app, "/api/books/book-1/hooks/generate", { chapterNumber: 1, nextChapterIntent: "追查脚步声" });

    expect(response.status).toBe(200);
    const json = await response.json() as { hooks: Array<{ id: string; text: string }> };
    expect(json.hooks[0]?.id).toBe("hook-1");
    expect(coreMocks.generateChapterHooks).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        chapterNumber: 1,
        pendingHooks: expect.stringContaining("old-hook"),
        chapterContent: expect.stringContaining("林月说道"),
        bookGenre: "xianxia",
      }),
      model: "mock-model",
    }));
  });

  it("persists an applied hook to pending_hooks.md", async () => {
    const { app, bookDir } = await createRoute();

    const response = await postJson(app, "/api/books/book-1/hooks/apply", {
      chapterNumber: 1,
      hook: {
        id: "hook-new",
        style: "suspense",
        text: "门外传来第三个人的脚步声。",
        rationale: "制造新问题",
        retentionEstimate: "high",
        relatedHookIds: ["old-hook"],
      },
    });

    expect(response.status).toBe(200);
    const json = await response.json() as { persisted: boolean; file: string };
    expect(json.persisted).toBe(true);
    expect(json.file).toBe("pending_hooks.md");
    const pendingHooks = await readFile(join(bookDir, "story", "pending_hooks.md"), "utf-8");
    expect(pendingHooks).toContain("old-hook");
    expect(pendingHooks).toContain("hook-new");
    expect(pendingHooks).toContain("门外传来第三个人的脚步声。");
    expect(pendingHooks).toContain("chapter: 1");
  });

  it("returns POV dashboard from story truth files", async () => {
    const { app } = await createRoute();

    const response = await app.request("http://localhost/api/books/book-1/pov?currentChapter=2&gapWarningThreshold=3");

    expect(response.status).toBe(200);
    const json = await response.json() as { dashboard: { currentChapter: number } };
    expect(json.dashboard.currentChapter).toBe(2);
    expect(coreMocks.buildPovDashboard).toHaveBeenCalledWith(expect.objectContaining({
      characterMatrix: expect.stringContaining("沈舟"),
      chapterSummaries: expect.stringContaining("林月"),
      currentChapter: 2,
      gapWarningThreshold: 3,
    }));
  });

  it("returns progress and persists progress config", async () => {
    const { app } = await createRoute();

    const putResponse = await app.request("http://localhost/api/progress/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyTarget: 7000, weeklyTarget: 42000 }),
    });
    expect(putResponse.status).toBe(200);
    const putJson = await putResponse.json() as { config: { dailyTarget: number } };
    expect(putJson.config.dailyTarget).toBe(7000);

    const getResponse = await app.request("http://localhost/api/progress?today=2026-04-26&days=7");
    expect(getResponse.status).toBe(200);
    const getJson = await getResponse.json() as { config: { dailyTarget: number }; trend: Array<{ wordCount: number }> };
    expect(getJson.config.dailyTarget).toBe(7000);
    expect(getJson.trend[0]?.wordCount).toBe(3000);
    expect(coreMocks.getDailyProgress).toHaveBeenCalledWith(coreMocks.storage, expect.objectContaining({ dailyTarget: 7000 }), expect.objectContaining({ today: "2026-04-26" }));
    expect(coreMocks.getProgressTrend).toHaveBeenCalledWith(coreMocks.storage, 7, "2026-04-26");
  });

  it("analyzes rhythm for chapter content", async () => {
    const { app } = await createRoute();

    const response = await postJson(app, "/api/books/book-1/chapters/1/rhythm");

    expect(response.status).toBe(200);
    const json = await response.json() as { analysis: { rhythmScore: number } };
    expect(json.analysis.rhythmScore).toBe(80);
    expect(coreMocks.analyzeRhythm).toHaveBeenCalledWith(expect.stringContaining("夜色很短"), expect.objectContaining({ avgSentenceLength: 20 }));
  });

  it("analyzes dialogue for chapter content", async () => {
    const { app } = await createRoute();

    const response = await postJson(app, "/api/books/book-1/chapters/1/dialogue", { chapterType: "daily" });

    expect(response.status).toBe(200);
    const json = await response.json() as { analysis: { dialogueRatio: number } };
    expect(json.analysis.dialogueRatio).toBe(0.5);
    expect(coreMocks.analyzeDialogue).toHaveBeenCalledWith(expect.stringContaining("我们不能回头"), "daily");
  });

  it("returns measured health facts and null for unavailable quality metrics", async () => {
    coreMocks.conflictRecords.push({ id: "conflict-main" });
    const { app } = await createRoute();

    const response = await app.request("http://localhost/api/books/book-1/health");

    expect(response.status).toBe(200);
    const json = await response.json() as {
      health: {
        totalChapters: { status: string; value: number };
        totalWords: { status: string; value: number };
        dailyWords: { status: string; value: number };
        sensitiveWordCount: { status: string; value: number };
        knownConflictCount: { status: string; value: number };
        consistencyScore: { status: string; value?: number } | null;
        hookRecoveryRate: { status: string; value?: number } | null;
        aiTasteMean: { status: string; value?: number } | null;
        rhythmDiversity: { status: string; value?: number } | null;
      };
    };
    expect(json.health.totalChapters).toMatchObject({ status: "measured", value: 1 });
    expect(json.health.totalWords.status).toBe("measured");
    expect(json.health.totalWords.value).toBeGreaterThan(0);
    expect(json.health.dailyWords).toMatchObject({ status: "measured", value: 3000 });
    expect(json.health.sensitiveWordCount).toMatchObject({ status: "measured", value: 1 });
    expect(json.health.knownConflictCount).toMatchObject({ status: "measured", value: 1 });
    // No audit data in chapter index → null
    expect(json.health.consistencyScore).toBeNull();
    // pending_hooks.md has no ## sections with status → null
    expect(json.health.hookRecoveryRate).toBeNull();
    // No filter reports → null
    expect(json.health.aiTasteMean).toBeNull();
    // Only 1 chapter → insufficient for rhythm diversity → null
    expect(json.health.rhythmDiversity).toBeNull();
  });

  it("returns measured consistencyScore when chapter index has audit data", async () => {
    const { app, bookDir } = await createRoute();
    const chaptersDir = join(bookDir, "chapters");
    await writeFile(join(chaptersDir, "index.json"), JSON.stringify([
      { number: 1, title: "开始", auditIssues: ["[warning] 人物年龄矛盾"] },
      { number: 2, title: "继续", auditIssues: [] },
    ]), "utf-8");

    const response = await app.request("http://localhost/api/books/book-1/health");

    expect(response.status).toBe(200);
    const json = await response.json() as { health: { consistencyScore: { status: string; value: number; source: string } } };
    expect(json.health.consistencyScore.status).toBe("measured");
    expect(json.health.consistencyScore.source).toBe("chapter-audit-issues");
    // 1 issue across 2 chapters → 1 - (1/2) = 0.5
    expect(json.health.consistencyScore.value).toBe(0.5);
  });

  it("returns measured hookRecoveryRate from pending_hooks.md", async () => {
    const { app, bookDir } = await createRoute();
    const storyDir = join(bookDir, "story");
    await writeFile(join(storyDir, "pending_hooks.md"), [
      "# 伏笔清单",
      "",
      "## hook-001",
      "- status: open",
      "- chapter: 1",
      "- text: 门外传来脚步声",
      "",
      "## hook-002",
      "- status: resolved",
      "- chapter: 2",
      "- text: 神秘信件",
      "",
      "## hook-003",
      "- status: open",
      "- chapter: 3",
      "- text: 消失的钥匙",
    ].join("\n"), "utf-8");

    const response = await app.request("http://localhost/api/books/book-1/health");

    expect(response.status).toBe(200);
    const json = await response.json() as { health: { hookRecoveryRate: { status: string; value: number; source: string } } };
    expect(json.health.hookRecoveryRate.status).toBe("measured");
    expect(json.health.hookRecoveryRate.source).toBe("pending-hooks-md");
    // 1 resolved out of 3 → 0.333
    expect(json.health.hookRecoveryRate.value).toBeCloseTo(0.333, 2);
  });

  it("returns measured aiTasteMean from filter reports", async () => {
    coreMocks.filterReportRecords.push(
      { aiTasteScore: 60, chapterNumber: 1 },
      { aiTasteScore: 80, chapterNumber: 2 },
    );
    const { app } = await createRoute();

    const response = await app.request("http://localhost/api/books/book-1/health");

    expect(response.status).toBe(200);
    const json = await response.json() as { health: { aiTasteMean: { status: string; value: number; source: string } } };
    expect(json.health.aiTasteMean.status).toBe("measured");
    expect(json.health.aiTasteMean.source).toBe("filter-reports");
    expect(json.health.aiTasteMean.value).toBe(70);
  });

  it("returns conflict map", async () => {
    const { app } = await createRoute();

    const response = await app.request("http://localhost/api/books/book-1/conflicts/map");

    expect(response.status).toBe(200);
    const json = await response.json() as { conflicts: Array<{ id: string }> };
    expect(json.conflicts).toBeDefined();
    expect(coreMocks.buildConflictMap).toHaveBeenCalled();
  });

  it("returns character arcs", async () => {
    const { app } = await createRoute();

    const response = await app.request("http://localhost/api/books/book-1/arcs");

    expect(response.status).toBe(200);
    const json = await response.json() as { arcs: Array<{ id: string }> };
    expect(json.arcs).toBeDefined();
  });

  it("performs tone check on chapter", async () => {
    const { app } = await createRoute();

    const response = await postJson(app, "/api/books/book-1/chapters/1/tone-check", { declaredTone: "冷峻质朴" });

    expect(response.status).toBe(200);
    const json = await response.json() as { result: { declaredTone: string; driftScore: number } };
    expect(json.result.declaredTone).toBe("冷峻质朴");
    expect(coreMocks.detectToneDrift).toHaveBeenCalled();
  });
});
