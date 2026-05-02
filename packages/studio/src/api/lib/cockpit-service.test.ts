import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { StateManager } from "@vivy1024/novelfork-core";
import { ProviderRuntimeStore } from "./provider-runtime-store.js";
import { createCockpitService } from "./cockpit-service.js";

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "novelfork-cockpit-service-"));
  const state = new StateManager(root);
  const providerStore = new ProviderRuntimeStore({ storagePath: join(root, "provider-runtime.json") });
  const service = createCockpitService({ state, providerStore, now: () => new Date("2026-05-02T00:00:00.000Z") });
  return { root, state, providerStore, service, cleanup: () => rm(root, { recursive: true, force: true }) };
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
        expect.objectContaining({ text: "第1章：青铜铃为何自鸣", status: "open", sourceFile: "pending_hooks.md" }),
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
