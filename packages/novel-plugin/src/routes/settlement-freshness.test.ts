import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNarrativeMemoryRouter } from "./narrative-memory.js";
import { chapterContentFingerprint, ensureSettlementLedgerSchema } from "../engine/narrative-memory/settlement-idempotency.js";
import { chapterRelativePath, writeChapterIndex } from "../engine/writing-resource/chapter-layout.js";
import type { HostTextGenerationAvailability } from "./context.js";

let storage: StorageDatabase;
let bookRoot: string;
let tempDir: string;

const chapterOne = "雨落在旧站台上。她把信封放进外套。";
const chapterTwo = "天亮之前，他终于走进了那座城。";

async function writeChapter(number: number, title: string, content: string, contentHash?: string) {
  const relative = chapterRelativePath("卷01", number, title);
  await mkdir(join(bookRoot, "chapters", "卷01"), { recursive: true });
  await writeFile(join(bookRoot, "chapters", relative), content, "utf8");
  return { number, title, fileName: relative, wordCount: content.length, updatedAt: "2026-09-29T00:00:00.000Z", ...(contentHash ? { contentHash } : {}) };
}

function recordSettlement(chapterNumber: number, content: string) {
  ensureSettlementLedgerSchema(storage);
  storage.sqlite.prepare(`
    INSERT INTO narrative_chapter_settlement (book_id, chapter_number, content_fingerprint, settled_at, settlement_count, event_ids_json)
    VALUES ('book-1', ?, ?, '2026-09-28T00:00:00.000Z', 1, '[]')
  `).run(chapterNumber, chapterContentFingerprint(content));
}

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-settlement-freshness-${crypto.randomUUID()}`);
  bookRoot = join(tempDir, "book-1");
  await mkdir(bookRoot, { recursive: true });
  await writeFile(join(bookRoot, "book.json"), JSON.stringify({ id: "book-1", title: "新鲜度" }), "utf8");
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

function app(resolveTextGeneration?: (c: unknown) => Promise<HostTextGenerationAvailability>) {
  return createNarrativeMemoryRouter({
    storage,
    resolveBookRoot: () => bookRoot,
    ...(resolveTextGeneration ? { resolveTextGeneration } : {}),
  });
}

describe("结算新鲜度", () => {
  it("按正文指纹区分新鲜 / 过期 / 未结算 / 未知，并给出解释", async () => {
    const edited = `${chapterTwo}又补了一句。`;
    await writeChapterIndex(bookRoot, [
      await writeChapter(1, "雨夜", chapterOne, chapterContentFingerprint(chapterOne)),
      await writeChapter(2, "入城", edited, chapterContentFingerprint(edited)),
      await writeChapter(3, "空章", "还没结算的章。", chapterContentFingerprint("还没结算的章。")),
      await writeChapter(4, "旧索引", "旧索引没有指纹。"),
    ]);
    recordSettlement(1, chapterOne);
    recordSettlement(2, chapterTwo);
    recordSettlement(4, "旧索引没有指纹。");

    const response = await app().request("/api/books/book-1/narrative-memory/settlement-freshness");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.chapters.map((chapter: { chapterNumber: number; status: string }) => [chapter.chapterNumber, chapter.status]))
      .toEqual([[1, "fresh"], [2, "stale"], [3, "unsettled"], [4, "unknown"]]);
    expect(body.staleChapters).toEqual([2]);
    expect(body.unsettledChapters).toEqual([3]);
    expect(body.explanation).toMatchObject({ whatHappened: expect.stringContaining("第 2 章"), suggestedAction: expect.any(String) });
  });

  it("没有过期章节时不带解释", async () => {
    await writeChapterIndex(bookRoot, [await writeChapter(1, "雨夜", chapterOne, chapterContentFingerprint(chapterOne))]);
    recordSettlement(1, chapterOne);
    const body = await (await app().request("/api/books/book-1/narrative-memory/settlement-freshness")).json();
    expect(body.staleChapters).toEqual([]);
    expect(body.explanation).toBeUndefined();
  });
});

describe("网页端重新结算", () => {
  it("没有可用模型时返回 422 与解释，不用规则兜底冒充结算", async () => {
    const response = await app(async () => ({
      available: false, code: "MODEL_NOT_CONFIGURED", message: "Runtime 还没有设置默认模型。", suggestedAction: "到设置里选择默认模型。",
    })).request("/api/books/book-1/narrative-memory/chapters/1/resettle", { method: "POST" });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, code: "MODEL_NOT_CONFIGURED", explanation: { suggestedAction: "到设置里选择默认模型。" } });
  });

  it("有模型时经宿主生成调用结算；章号非法返回 400", async () => {
    await writeChapterIndex(bookRoot, [await writeChapter(1, "雨夜", chapterOne, chapterContentFingerprint(chapterOne))]);
    const generateText = vi.fn(async () => ({ text: JSON.stringify({ events: [] }) }));
    const server = app(async () => ({ available: true, generateText }));
    expect((await server.request("/api/books/book-1/narrative-memory/chapters/abc/resettle", { method: "POST" })).status).toBe(400);
    const response = await server.request("/api/books/book-1/narrative-memory/chapters/1/resettle", { method: "POST" });
    const body = await response.json();
    expect(generateText).toHaveBeenCalled();
    expect(body.chapterNumber).toBe(1);
  });
});

describe("新建事件接口", () => {
  it("未知事件类型返回 400 并列出可接受的取值，不写入", async () => {
    const response = await app().request("/api/books/book-1/narrative-memory/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chapterNumber: 1, eventType: "not_a_type", subject: "林舟", predicate: "到达", object: "青云山", evidenceText: "证据" }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("NARRATIVE_EVENT_TYPE_INVALID");
    expect(body.explanation.suggestedAction).toContain("relationship_changed");
  });
});
