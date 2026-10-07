import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createChapterTimelineRouter } from "./chapter-timeline.js";
import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { chapterContentFingerprint, ensureSettlementLedgerSchema } from "../engine/narrative-memory/settlement-idempotency.js";
import { ensureNarrativeMemorySchema, replaceChapterMentions } from "../engine/narrative-memory/storage.js";
import { chapterRelativePath, writeChapterIndex } from "../engine/writing-resource/chapter-layout.js";

let storage: StorageDatabase;
let bookRoot: string;
let tempDir: string;

const chapterOne = "雨落在旧站台上。她把信封放进外套。";
const chapterTwo = "天亮之前，他终于走进了那座城。";

beforeEach(async () => {
  tempDir = join(tmpdir(), `novelfork-chapter-timeline-route-${crypto.randomUUID()}`);
  bookRoot = join(tempDir, "book-1");
  await mkdir(bookRoot, { recursive: true });
  await writeFile(join(bookRoot, "book.json"), JSON.stringify({ id: "book-1", title: "走势" }), "utf8");
  storage = createStorageDatabase({ databasePath: join(tempDir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  // 出场提及表对 book 有外键：造数据前先把书落位。
  await createBookRepository(storage).create({
    id: "book-1",
    name: "走势",
    jingweiMode: "dynamic",
    currentChapter: 0,
    createdAt: new Date("2026-09-28T00:00:00.000Z"),
    updatedAt: new Date("2026-09-28T00:00:00.000Z"),
  });
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

function app() {
  return createChapterTimelineRouter({
    storage,
    resolveBookRoot: () => bookRoot,
  });
}

describe("chapter-timeline 路由", () => {
  it("GET /chapter-timeline 返回按章时间线与已结算进度", async () => {
    await writeChapterIndex(bookRoot, [
      { number: 1, title: "雨夜", fileName: chapterRelativePath("卷01", 1, "雨夜"), wordCount: 3200, updatedAt: "2026-09-28T00:00:00.000Z", contentHash: chapterContentFingerprint(chapterOne) },
      { number: 2, title: "入城", fileName: chapterRelativePath("卷01", 2, "入城"), wordCount: 3560, updatedAt: "2026-09-29T00:00:00.000Z", contentHash: chapterContentFingerprint(chapterTwo) },
    ]);
    ensureSettlementLedgerSchema(storage);
    storage.sqlite.prepare(`
      INSERT INTO narrative_chapter_settlement (book_id, chapter_number, content_fingerprint, settled_at, settlement_count, event_ids_json)
      VALUES ('book-1', 1, ?, '2026-09-28T00:00:00.000Z', 1, '[]')
    `).run(chapterContentFingerprint(chapterOne));
    ensureNarrativeMemorySchema(storage);
    replaceChapterMentions(storage, "book-1", 1, [
      { name: "林舟", entryId: "entry-linzhou", position: 1, source: "dictionary" },
    ]);

    const response = await app().request("/api/books/book-1/narrative-memory/chapter-timeline");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.settledThrough).toBe(1);
    expect(body.chapters).toHaveLength(2);
    expect(body.chapters[0]).toMatchObject({
      number: 1,
      title: "雨夜",
      volume: "卷01",
      chars: 3200,
      summary: null,
      summaryStale: false,
      eventCount: 0,
      cast: [{ name: "林舟", entryId: "entry-linzhou" }],
      moreCast: 0,
    });
    expect(body.chapters[1]).toMatchObject({ number: 2, summaryStale: false });
  });

  it("没有章节与记忆数据时返回空骨架而不是 500", async () => {
    const response = await app().request("/api/books/book-1/narrative-memory/chapter-timeline");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ chapters: [], settledThrough: null });
  });
});
