import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Hono } from "hono";
import type { RouterContext } from "./context";
import { createStorageRouter } from "./storage";
import { createChapterCandidatesRouter } from "./chapter-candidates";
import { createProviderAdapterRegistry, type RuntimeAdapter } from "../lib/provider-adapters";
import { ProviderRuntimeStore, type RuntimeModelInput } from "../lib/provider-runtime-store";
import { createProvidersRouter } from "./providers";
import { createWritingModesRouter } from "./writing-modes";
import sessionRouter from "./session";

const coreMocks = vi.hoisted(() => {
  const sessionRows = new Map<string, any>();
  const messageRows = new Map<string, any[]>();
  const cursorRows = new Map<string, any>();
  return {
    chatCompletion: vi.fn(() => Promise.resolve({ content: "模型生成内容", usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 } })),
    buildContinuationPrompt: vi.fn(() => "continuation-prompt"),
    buildExpansionPrompt: vi.fn(() => "expansion-prompt"),
    buildBridgePrompt: vi.fn(() => "bridge-prompt"),
    buildDialoguePrompt: vi.fn(() => "dialogue-prompt"),
    buildVariantPrompts: vi.fn((_input: unknown, _context: unknown, count: number) => Array.from({ length: count }, (_, index) => `variant-prompt-${index}`)),
    buildBranchPrompt: vi.fn(() => "branch-prompt"),
    detectStyleDrift: vi.fn(() => ({ overallDrift: 0, isSignificant: false })),
    mergeStyleProfiles: vi.fn(() => ({ mergedFrom: 1 })),
    parseFile: vi.fn(() => ({ chapters: [] })),
    normalizeBookStatus: vi.fn((value: unknown) => value ?? "drafting"),
    normalizeChapterStatus: vi.fn((value: unknown) => value ?? "drafting"),
    registerBuiltinPresets: vi.fn(),
    getPreset: vi.fn(() => undefined),
    applyJingweiTemplate: vi.fn(() => ({ templateId: "basic", sections: [] })),
    createBookRepository: vi.fn(() => ({ getById: vi.fn(() => Promise.resolve(null)), create: vi.fn(() => Promise.resolve()), update: vi.fn(() => Promise.resolve()) })),
    createStoryJingweiSectionRepository: vi.fn(() => ({ listByBook: vi.fn(() => Promise.resolve([])), create: vi.fn(() => Promise.resolve()) })),
    getStorageDatabase: vi.fn(() => ({ databasePath: "mock-session.db", sqlite: { prepare: vi.fn(() => ({ run: vi.fn(() => ({ changes: 0 })) })) } })),
    initializeStorageDatabase: vi.fn(() => ({ databasePath: "mock-session.db", sqlite: { prepare: vi.fn(() => ({ run: vi.fn(() => ({ changes: 0 })) })) } })),
    runStorageMigrations: vi.fn(),
    closeStorageDatabase: vi.fn(() => sessionRows.clear()),
    createSessionRepository: vi.fn(() => ({
      create: vi.fn(async (input: any) => {
        sessionRows.set(input.id, { ...input, deletedAt: null });
        return sessionRows.get(input.id);
      }),
      getById: vi.fn(async (id: string) => {
        const row = sessionRows.get(id);
        return row && !row.deletedAt ? row : null;
      }),
      list: vi.fn(async () => [...sessionRows.values()].filter((row) => !row.deletedAt)),
      update: vi.fn(async (id: string, updates: any) => {
        const row = sessionRows.get(id);
        if (!row || row.deletedAt) return null;
        const next = { ...row, ...updates };
        sessionRows.set(id, next);
        return next;
      }),
      softDelete: vi.fn(async (id: string) => {
        const row = sessionRows.get(id);
        if (!row || row.deletedAt) return false;
        sessionRows.set(id, { ...row, deletedAt: new Date() });
        return true;
      }),
    })),
    createSessionMessageRepository: vi.fn(() => ({
      loadAll: vi.fn(async (sessionId: string) => messageRows.get(sessionId) ?? []),
      replaceAll: vi.fn(async (sessionId: string, messages: any[]) => {
        messageRows.set(sessionId, messages.map((message) => ({ ...message, timestamp: message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp) })));
      }),
      appendMessages: vi.fn(async (sessionId: string, messages: any[], seedMessages: any[]) => {
        const existing = messageRows.get(sessionId) ?? seedMessages;
        const stored = [...existing, ...messages].map((message, index) => ({
          ...message,
          seq: typeof message.seq === "number" ? message.seq : index + 1,
          timestamp: message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp),
        }));
        messageRows.set(sessionId, stored);
        cursorRows.set(sessionId, { lastSeq: stored.at(-1)?.seq ?? 0, lastAckedSeq: 0, availableFromSeq: stored.length > 0 ? stored[0].seq : 0, recoveryJson: null });
        return stored;
      }),
      getCursor: vi.fn(async (sessionId: string) => cursorRows.get(sessionId) ?? { lastSeq: 0, lastAckedSeq: 0, availableFromSeq: 0, recoveryJson: null }),
      updateAckedSeq: vi.fn(async (sessionId: string, ackedSeq: number, recoveryJson?: string) => {
        const cursor = { ...(cursorRows.get(sessionId) ?? { lastSeq: 0, availableFromSeq: 0 }), lastAckedSeq: ackedSeq, recoveryJson: recoveryJson ?? null };
        cursorRows.set(sessionId, cursor);
        return cursor;
      }),
      updateRecoveryJson: vi.fn(async (sessionId: string, recoveryJson: string) => {
        const cursor = { ...(cursorRows.get(sessionId) ?? { lastSeq: 0, lastAckedSeq: 0, availableFromSeq: 0 }), recoveryJson };
        cursorRows.set(sessionId, cursor);
        return cursor;
      }),
      deleteAllBySession: vi.fn(async (sessionId: string) => {
        messageRows.delete(sessionId);
        cursorRows.delete(sessionId);
      }),
    })),
    PipelineRunner: vi.fn(() => ({ initBook: vi.fn(() => Promise.resolve()) })),
    loadProjectConfig: vi.fn(() => Promise.resolve({ llm: { provider: "custom", apiKey: "sk-test", baseUrl: "https://example.test/v1", model: "gpt-test" } })),
    createLLMClient: vi.fn(() => ({ provider: "custom" })),
    computeAnalytics: vi.fn(() => ({ totalWords: 0, chapterCount: 0 })),
  };
});

vi.mock("@vivy1024/novelfork-core", () => ({
  ...coreMocks,
}));

function okAdapter(models: RuntimeModelInput[] = []): RuntimeAdapter {
  return {
    listModels: vi.fn(async () => ({ success: true as const, models })),
    testModel: vi.fn(async () => ({ success: true as const, latency: 5 })),
    generate: vi.fn(async () => ({ success: true as const, type: "message" as const, content: "ok" })),
  };
}

function buildStorageState(root: string) {
  return {
    listBooks: vi.fn(async () => ["book-1"]),
    loadBookConfig: vi.fn(async (bookId: string) => {
      if (bookId !== "book-1") throw new Error("missing");
      return {
        id: "book-1",
        title: "灵潮纪元",
        status: "drafting",
        platform: "qidian",
        genre: "xianxia",
        targetChapters: 120,
        chapterWordCount: 3000,
        language: "zh" as const,
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T00:00:00.000Z",
      };
    }),
    loadChapterIndex: vi.fn(async (bookId: string) => {
      if (bookId !== "book-1") throw new Error("missing");
      return [
        {
          number: 1,
          title: "第一章",
          status: "approved",
          wordCount: 4,
          auditIssueCount: 0,
          auditIssues: [],
          updatedAt: "2026-05-05T00:00:00.000Z",
          fileName: "0001-first.md",
        },
      ];
    }),
    saveChapterIndex: vi.fn(async () => undefined),
    saveBookConfig: vi.fn(async () => undefined),
    getNextChapterNumber: vi.fn(async () => 2),
    bookDir: (bookId: string) => join(root, "books", bookId),
  };
}

function buildStorageContext(root: string): RouterContext {
  return {
    state: buildStorageState(root) as unknown as RouterContext["state"],
    root,
    broadcast: vi.fn(),
    buildPipelineConfig: vi.fn(async () => ({ client: { provider: "custom" }, model: "gpt-test", projectRoot: root } as never)),
    getSessionLlm: vi.fn(async () => ({ apiKey: "sk-test", baseUrl: "https://example.test/v1", model: "gpt-test", provider: "custom" })),
    runStore: {} as never,
    providerStore: undefined,
    getStartupSummary: vi.fn(() => null),
    setStartupSummary: vi.fn(),
    setStartupRecoveryRunner: vi.fn(),
  };
}

function buildWritingContext(root: string, sessionLlm: Awaited<ReturnType<RouterContext["getSessionLlm"]>>): RouterContext {
  return {
    ...buildStorageContext(root),
    getSessionLlm: vi.fn(async () => sessionLlm),
  };
}

async function json(response: Response): Promise<Record<string, any>> {
  return await response.json() as Record<string, any>;
}

async function seedBookFiles(root: string): Promise<void> {
  await mkdir(join(root, "books", "book-1", "chapters"), { recursive: true });
  await writeFile(join(root, "books", "book-1", "chapters", "0001-first.md"), "# 第一章\n\n正式正文", "utf-8");
  await writeFile(join(root, "books", "book-1", "chapters", "index.json"), JSON.stringify([{ number: 1, title: "第一章", status: "approved", wordCount: 4, auditIssueCount: 0, updatedAt: "2026-05-05T00:00:00.000Z", fileName: "0001-first.md" }], null, 2), "utf-8");
}

describe("backend core contract regression", () => {
  let root: string;
  let providerRuntimeDir: string;
  let sessionStoreDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "novelfork-contract-regression-"));
    providerRuntimeDir = await mkdtemp(join(tmpdir(), "novelfork-contract-providers-"));
    sessionStoreDir = await mkdtemp(join(tmpdir(), "novelfork-contract-sessions-"));
    process.env.NOVELFORK_SESSION_STORE_DIR = sessionStoreDir;
    await seedBookFiles(root);
    coreMocks.chatCompletion.mockClear();
  });

  afterEach(async () => {
    const { __testing } = await import("../lib/session-service");
    __testing.resetSessionStoreMutationQueue();
    delete process.env.NOVELFORK_SESSION_STORE_DIR;
    await rm(root, { recursive: true, force: true });
    await rm(providerRuntimeDir, { recursive: true, force: true });
    await rm(sessionStoreDir, { recursive: true, force: true });
  });

  it("protects books and chapter resource success plus 404 envelopes", async () => {
    const app = createStorageRouter(buildStorageContext(root));

    const books = await app.request("http://localhost/api/books");
    expect(books.status).toBe(200);
    expect((await json(books)).books).toEqual([expect.objectContaining({ id: "book-1", title: "灵潮纪元", chapterCount: 1 })]);

    const detail = await app.request("http://localhost/api/books/book-1");
    expect(detail.status).toBe(200);
    expect(await json(detail)).toMatchObject({ book: { id: "book-1" }, chapters: [expect.objectContaining({ number: 1 })], nextChapter: 2 });

    const chapter = await app.request("http://localhost/api/books/book-1/chapters/1");
    expect(chapter.status).toBe(200);
    expect(await json(chapter)).toMatchObject({ chapterNumber: 1, filename: "0001-first.md", content: "# 第一章\n\n正式正文" });

    const missingBook = await app.request("http://localhost/api/books/missing");
    expect(missingBook.status).toBe(404);
    expect(await json(missingBook)).toMatchObject({ error: 'Book "missing" not found' });

    const missingChapter = await app.request("http://localhost/api/books/book-1/chapters/99");
    expect(missingChapter.status).toBe(404);
    expect(await json(missingChapter)).toMatchObject({ error: "Chapter not found" });
  });

  it("protects candidate and draft success plus explicit 400/404 boundaries", async () => {
    const app = createChapterCandidatesRouter(root, { now: () => new Date("2026-05-05T00:00:00.000Z"), createId: () => "cand-1" });

    const badCandidate = await app.request("http://localhost/api/books/book-1/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "缺 source", content: "正文" }),
    });
    expect(badCandidate.status).toBe(400);
    expect(await json(badCandidate)).toMatchObject({ error: "Candidate source is required" });

    const created = await app.request("http://localhost/api/books/book-1/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "候选", content: "候选正文", source: "write-next" }),
    });
    expect(created.status).toBe(200);

    const invalidAccept = await app.request("http://localhost/api/books/book-1/candidates/cand-1/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "overwrite" }),
    });
    expect(invalidAccept.status).toBe(400);
    expect(await json(invalidAccept)).toMatchObject({ error: "Accept action must be merge, replace, or draft" });

    const asDraft = await app.request("http://localhost/api/books/book-1/candidates/cand-1/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "draft" }),
    });
    expect(asDraft.status).toBe(200);
    expect(await json(asDraft)).toMatchObject({ candidate: { status: "accepted" }, draft: { id: "draft-cand-1", content: "候选正文" } });
    await expect(readFile(join(root, "books", "book-1", "chapters", "0001-first.md"), "utf-8")).resolves.toBe("# 第一章\n\n正式正文");

    const missingDraft = await app.request("http://localhost/api/books/book-1/drafts/missing");
    expect(missingDraft.status).toBe(404);
    expect(await json(missingDraft)).toMatchObject({ error: "Draft not found" });
  });

  it("protects session CRUD, binding filters, chat snapshot and missing-session 404", async () => {
    const created = await sessionRouter.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "写作会话", agentId: "writer", kind: "standalone", projectId: "book-1", sessionMode: "chat" }),
    });
    expect(created.status).toBe(201);
    const session = await json(created);
    expect(session).toMatchObject({ title: "写作会话", agentId: "writer", projectId: "book-1", status: "active" });

    const list = await sessionRouter.request("http://localhost/?binding=book&projectId=book-1&status=active&sort=recent");
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([expect.objectContaining({ id: session.id, projectId: "book-1" })]);

    const snapshot = await sessionRouter.request(`http://localhost/${session.id}/chat/state`);
    expect(snapshot.status).toBe(200);
    expect(await json(snapshot)).toMatchObject({ session: { id: session.id }, messages: [], cursor: { lastSeq: 0 } });

    const missingSnapshot = await sessionRouter.request("http://localhost/missing/chat/state");
    expect(missingSnapshot.status).toBe(404);
    expect(await json(missingSnapshot)).toMatchObject({ error: "Session not found" });
  });

  it("protects provider model pool, sanitized summary and unsupported adapter envelopes", async () => {
    const store = new ProviderRuntimeStore({ storagePath: join(providerRuntimeDir, "providers.json") });
    await store.createProvider({ id: "sub2api", name: "Sub2API", type: "custom", enabled: true, priority: 1, apiKeyRequired: true, compatibility: "openai-compatible", config: { apiKey: "sk-secret" }, models: [{ id: "gpt-5", name: "GPT-5", contextWindow: 128000, maxOutputTokens: 8192, source: "detected" }] });
    await store.createProvider({ id: "anthropic", name: "Anthropic", type: "anthropic", enabled: true, priority: 2, apiKeyRequired: true, compatibility: "anthropic-compatible", config: { apiKey: "sk-ant" }, models: [] });
    const app = createProvidersRouter({ store, adapters: createProviderAdapterRegistry({ "openai-compatible": okAdapter([{ id: "gpt-5.1", name: "GPT-5.1", contextWindow: 128000, maxOutputTokens: 8192, source: "detected" }]) }) });

    const list = await app.request("http://localhost/");
    expect(list.status).toBe(200);
    const listBody = await json(list);
    expect(JSON.stringify(listBody)).not.toContain("sk-secret");
    expect(JSON.stringify(listBody)).not.toContain("sk-ant");
    expect(listBody.providers[0].config).toMatchObject({ apiKeyConfigured: true });

    const models = await app.request("http://localhost/models");
    expect(models.status).toBe(200);
    expect((await json(models)).models).toEqual([expect.objectContaining({ modelId: "sub2api:gpt-5", providerId: "sub2api", enabled: true })]);

    const unsupported = await app.request("http://localhost/anthropic/models/refresh", { method: "POST" });
    expect(unsupported.status).toBe(501);
    expect(await json(unsupported)).toMatchObject({ success: false, code: "unsupported" });
  });

  it("protects writing actions prompt-preview and safe apply boundaries", async () => {
    const previewApp = createWritingModesRouter(buildWritingContext(root, undefined));
    const preview = await previewApp.request("http://localhost/api/books/book-1/inline-write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "continuation", selectedText: "他拔剑。", beforeText: "前文" }),
    });
    expect(preview.status).toBe(200);
    expect(await json(preview)).toMatchObject({ mode: "prompt-preview", promptPreview: "continuation-prompt", reason: "no-session-llm" });

    const applyApp = createWritingModesRouter(buildWritingContext(root, { apiKey: "sk-test", baseUrl: "https://example.test/v1", model: "gpt-test", provider: "custom" }));
    const invalidApply = await applyApp.request("http://localhost/api/books/book-1/writing-modes/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "formal", content: "正文" }),
    });
    expect(invalidApply.status).toBe(400);

    const applied = await applyApp.request("http://localhost/api/books/book-1/writing-modes/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "candidate", title: "续写候选", content: "候选正文", sourceMode: "inline-continuation", chapterNumber: 2, provider: "custom", model: "gpt-test" }),
    });
    expect(applied.status).toBe(201);
    const body = await json(applied);
    expect(body).toMatchObject({ target: "candidate", status: "candidate", metadata: { bookId: "book-1", sourceMode: "inline-continuation", chapterNumber: 2, provider: "custom", model: "gpt-test" } });
    expect(body.target).not.toBe("chapter-replace");
  });
});
