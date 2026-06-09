import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { StateManager, initializeStorageDatabase, closeStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core";
import { ProviderRuntimeStore } from "./provider-runtime-store.js";
import { createCockpitService } from "@vivy1024/novelfork-novel-plugin/handlers";

let activeStorage: StorageDatabase | null = null;

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "novelfork-cockpit-service-"));
  const state = new StateManager(root);
  const providerStore = new ProviderRuntimeStore({ storagePath: join(root, "provider-runtime.json") });
  const service = createCockpitService({ state, providerStore, now: () => new Date("2026-05-02T00:00:00.000Z") });
  // 初始化真实 SQLite 存储（焦点/章节摘要/伏笔现从经纬库读取）
  const storage = initializeStorageDatabase({ databasePath: join(root, "novelfork.db") });
  runStorageMigrations(storage);
  activeStorage = storage;
  return { root, state, providerStore, service, storage, cleanup: async () => { closeStorageDatabase(); activeStorage = null; await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } };
}

const SEED_TS = new Date("2026-05-02T00:00:00.000Z").getTime();

/** 在经纬库中插入 book + section 行（满足外键约束） */
function seedJingweiBase(storage: StorageDatabase, bookId: string): string {
  storage.sqlite.prepare(`INSERT OR IGNORE INTO "book" ("id", "name", "created_at", "updated_at") VALUES (?, ?, ?, ?)`)
    .run(bookId, "天墟试炼", SEED_TS, SEED_TS);
  const sectionId = `${bookId}-section`;
  storage.sqlite.prepare(`INSERT OR IGNORE INTO "story_jingwei_section" ("id", "book_id", "key", "name", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?)`)
    .run(sectionId, bookId, "default", "默认", SEED_TS, SEED_TS);
  return sectionId;
}

/** 插入一条经纬条目 */
function seedJingweiEntry(storage: StorageDatabase, params: {
  id: string; bookId: string; sectionId: string; title: string; contentMd: string;
  category: string; lifecycle?: string; sortOrder?: number; relatedChapters?: number[]; fields?: Record<string, unknown>;
}): void {
  storage.sqlite.prepare(`
    INSERT INTO "story_jingwei_entry" (
      "id", "book_id", "section_id", "title", "content_md", "category", "lifecycle", "sort_order",
      "fields_json", "related_chapter_numbers_json", "created_at", "updated_at", "deleted_at"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    params.id, params.bookId, params.sectionId, params.title, params.contentMd,
    params.category, params.lifecycle ?? "active", params.sortOrder ?? 0,
    JSON.stringify(params.fields ?? {}), JSON.stringify(params.relatedChapters ?? []), SEED_TS, SEED_TS,
  );
}

/** 为某本书铺设焦点/章节摘要/伏笔的经纬数据 */
function seedJingweiCockpitData(storage: StorageDatabase, bookId: string, options: { focus?: boolean; summaries?: boolean; hooks?: boolean } = {}) {
  const { focus = true, summaries = true, hooks = true } = options;
  const sectionId = seedJingweiBase(storage, bookId);
  if (focus) {
    seedJingweiEntry(storage, { id: `${bookId}-focus`, bookId, sectionId, title: "当前聚焦", contentMd: "# 当前聚焦\n\n推进主角拜入外门。\n", category: "focus" });
  }
  if (summaries) {
    seedJingweiEntry(storage, { id: `${bookId}-sum-1`, bookId, sectionId, title: "第1章摘要", contentMd: "主角入山，青铜铃异动。", category: "chapter-summary", sortOrder: 1, relatedChapters: [1], fields: { chapterNumber: 1 } });
    seedJingweiEntry(storage, { id: `${bookId}-sum-2`, bookId, sectionId, title: "第2章摘要", contentMd: "问心阵失败，师兄递来线索。", category: "chapter-summary", sortOrder: 2, relatedChapters: [2], fields: { chapterNumber: 2 } });
  }
  if (hooks) {
    seedJingweiEntry(storage, { id: `${bookId}-hook-1`, bookId, sectionId, title: "第1章", contentMd: "青铜铃为何自鸣", category: "foreshadowing", lifecycle: "active", sortOrder: 1, relatedChapters: [1] });
  }
}

async function createBook(root: string, bookId = "book-1") {
  const bookDir = join(root, "books", bookId);
  await mkdir(join(bookDir, "story"), { recursive: true });
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await writeFile(join(bookDir, "book.json"), JSON.stringify({
    id: bookId,
    title: "天墟试炼",
    platform: "qidian",
    genre: "玄幻",
    status: "active",
    targetChapters: 100,
    chapterWordCount: 3000,
    language: "zh",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
  }, null, 2), "utf-8");
  await writeFile(join(bookDir, "chapters", "index.json"), JSON.stringify([
    { number: 1, title: "入山", status: "approved", wordCount: 3200, createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T01:00:00.000Z", auditIssues: [], lengthWarnings: [] },
    { number: 2, title: "问心", status: "audit-failed", wordCount: 2800, createdAt: "2026-05-02T00:00:00.000Z", updatedAt: "2026-05-02T01:00:00.000Z", auditIssues: ["伏笔断线"], lengthWarnings: [] },
  ], null, 2), "utf-8");
  await writeFile(join(bookDir, "story", "current_focus.md"), "# 当前聚焦\n\n推进主角拜入外门。\n", "utf-8");
  await writeFile(join(bookDir, "story", "pending_hooks.md"), "# 待处理伏笔\n\n- [ ] 第1章：青铜铃为何自鸣\n- [x] 第2章：师兄身份误导\n", "utf-8");
  await writeFile(join(bookDir, "story", "chapter_summaries.md"), "# 章节摘要\n\n- 第1章：主角入山，青铜铃异动。\n- 第2章：问心阵失败，师兄递来线索。\n", "utf-8");
  await mkdir(join(bookDir, "generated-candidates"), { recursive: true });
  await writeFile(join(bookDir, "generated-candidates", "index.json"), JSON.stringify([
    { id: "candidate-old", bookId, title: "旧候选", source: "write-next", createdAt: "2026-05-01T10:00:00.000Z", updatedAt: "2026-05-01T10:00:00.000Z", status: "archived", contentFileName: "candidate-old.md" },
    { id: "candidate-new", bookId, title: "第三章候选", source: "write-next", createdAt: "2026-05-02T10:00:00.000Z", updatedAt: "2026-05-02T10:30:00.000Z", status: "candidate", contentFileName: "candidate-new.md", metadata: { provider: "sub2api", model: "gpt-5.4" } },
  ], null, 2), "utf-8");
  await writeFile(join(bookDir, "generated-candidates", "candidate-new.md"), "候选正文", "utf-8");
  return bookDir;
}

describe("cockpit-service", () => {
  afterEach(() => {
    // 兜底：若某测试未走 cleanup（异常等），仍关闭存储避免锁库
    if (activeStorage) {
      closeStorageDatabase();
      activeStorage = null;
    }
  });

  it("returns missing status for an empty book instead of fake cockpit data", async () => {
    const harness = await createHarness();
    try {
      const snapshot = await harness.service.getSnapshot({ bookId: "missing-book", includeModelStatus: true });

      expect(snapshot.status).toBe("missing");
      expect(snapshot.book).toBeNull();
      expect(snapshot.progress.status).toBe("missing");
      expect(snapshot.currentFocus.status).toBe("missing");
      expect(snapshot.openHooks.items).toEqual([]);
      expect(snapshot.recentCandidates.items).toEqual([]);
      expect(snapshot.modelStatus).toMatchObject({ status: "missing", hasUsableModel: false });
    } finally {
      await harness.cleanup();
    }
  });

  it("builds a real cockpit snapshot from book files, candidates and provider runtime state", async () => {
    const harness = await createHarness();
    try {
      await createBook(harness.root);
      seedJingweiCockpitData(harness.storage, "book-1");
      await harness.providerStore.createProvider({
        id: "sub2api",
        name: "Sub2API",
        type: "custom",
        apiKeyRequired: true,
        enabled: true,
        priority: 1,
        config: { apiKey: "sk-test", endpoint: "https://api.example.test/v1" },
        models: [{ id: "gpt-5.4", name: "GPT 5.4", contextWindow: 128000, maxOutputTokens: 8192, enabled: true, source: "manual", lastTestStatus: "success", supportsFunctionCalling: true }],
      });

      const snapshot = await harness.service.getSnapshot({ bookId: "book-1", includeModelStatus: true });

      expect(snapshot).toMatchObject({
        status: "available",
        generatedAt: "2026-05-02T00:00:00.000Z",
        book: { id: "book-1", title: "天墟试炼", genre: "玄幻", platform: "qidian" },
        progress: { status: "available", chapterCount: 2, targetChapters: 100, totalWords: 6000, approvedChapters: 1, failedChapters: 1 },
        currentFocus: { status: "available", content: expect.stringContaining("推进主角拜入外门") },
        modelStatus: { status: "available", hasUsableModel: true, defaultProvider: "sub2api", defaultModel: "gpt-5.4", supportsToolUse: true },
      });
      expect(snapshot.recentChapterSummaries.items).toEqual([
        expect.objectContaining({ number: 1, summary: "主角入山，青铜铃异动。" }),
        expect.objectContaining({ number: 2, summary: "问心阵失败，师兄递来线索。" }),
      ]);
      expect(snapshot.openHooks.items).toEqual([
        expect.objectContaining({ text: "第1章：青铜铃为何自鸣", status: "open", sourceFile: "jingwei:foreshadowing" }),
      ]);
      expect(snapshot.riskCards.items).toEqual([
        expect.objectContaining({ kind: "audit-failure", chapterNumber: 2, level: "danger" }),
      ]);
      expect(snapshot.recentCandidates.items).toEqual([
        expect.objectContaining({ id: "candidate-new", title: "第三章候选", artifact: expect.objectContaining({ kind: "candidate", openInCanvas: true }) }),
      ]);
    } finally {
      await harness.cleanup();
    }
  });

  it("lists open hooks and recent candidates with empty states when optional data is absent", async () => {
    const harness = await createHarness();
    try {
      await createBook(harness.root);
      await rm(join(harness.root, "books", "book-1", "story", "pending_hooks.md"), { force: true });
      await rm(join(harness.root, "books", "book-1", "generated-candidates"), { recursive: true, force: true });

      await expect(harness.service.listOpenHooks({ bookId: "book-1", limit: 5 })).resolves.toMatchObject({
        status: "empty",
        items: [],
        reason: "pending_hooks.md 不存在或没有未回收伏笔。",
      });
      await expect(harness.service.listRecentCandidates({ bookId: "book-1", limit: 5 })).resolves.toMatchObject({
        status: "empty",
        items: [],
        reason: "暂无候选稿。",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("marks missing current_focus.md without blocking other real snapshot data", async () => {
    const harness = await createHarness();
    try {
      await createBook(harness.root);
      await rm(join(harness.root, "books", "book-1", "story", "current_focus.md"), { force: true });

      const snapshot = await harness.service.getSnapshot({ bookId: "book-1" });

      expect(snapshot.currentFocus).toMatchObject({
        status: "missing",
        content: null,
        sourceFile: "current_focus.md",
        reason: "current_focus.md 不存在或为空。",
      });
      expect(snapshot.progress).toMatchObject({ status: "available", chapterCount: 2 });
      expect(snapshot.recentCandidates.items).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });
});
