import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  ensureNarrativeMemorySchema,
  insertNarrativeEvent,
  insertNarrativeFact,
} from "../engine/narrative-memory/storage.js";
import type { NarrativeEvent, NarrativeFact } from "../engine/narrative-memory/types.js";
import { handleChapterDiscardRange } from "./chapter-discard-range.js";

const tempDirs: string[] = [];

async function createBook(chapters: number[]): Promise<{ bookRoot: string; storage: StorageDatabase }> {
  const dir = join(tmpdir(), `novelfork-discard-range-${crypto.randomUUID()}`);
  await mkdir(join(dir, "chapters"), { recursive: true });
  await mkdir(join(dir, "story"), { recursive: true });
  tempDirs.push(dir);
  await writeFile(join(dir, "book.json"), JSON.stringify({ id: "book-1", title: "测试书" }), "utf8");
  const index = [];
  for (const number of chapters) {
    const fileName = `${String(number).padStart(4, "0")}-ch.md`;
    await writeFile(join(dir, "chapters", fileName), `第${number}章正文`, "utf8");
    index.push({ number, title: `第${number}章`, fileName, wordCount: 10, status: "accepted" });
  }
  await writeFile(join(dir, "chapters", "index.json"), JSON.stringify(index), "utf8");
  await writeFile(join(dir, "story", "pending_hooks.md"), `# 伏笔\n- 第1章埋下的伏笔\n- 第5章埋下的伏笔\n`, "utf8");

  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS story_jingwei_entry (
      id TEXT PRIMARY KEY NOT NULL,
      book_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content_md TEXT,
      fields_json TEXT,
      related_chapter_numbers_json TEXT,
      category TEXT,
      lifecycle TEXT,
      sort_order INTEGER DEFAULT 0,
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  ensureNarrativeMemorySchema(storage);
  return { bookRoot: dir, storage };
}

function event(id: string, chapterNumber: number): NarrativeEvent {
  return {
    id,
    bookId: "book-1",
    chapterNumber,
    eventType: "timeline_advanced",
    subject: "主角",
    predicate: "完成",
    object: `事件${chapterNumber}`,
    evidenceText: `第${chapterNumber}章事件`,
    confidence: 0.9,
    source: "settle",
    status: "applied",
    riskLevel: "low",
    createdAt: "2026-06-22T00:00:00.000Z",
    appliedAt: "2026-06-22T00:00:00.000Z",
  };
}

function fact(id: string, sourceChapter: number): NarrativeFact {
  return {
    id,
    bookId: "book-1",
    subject: "主角",
    predicate: "位于",
    object: `地点${sourceChapter}`,
    category: "character_state",
    layer: "dynamic",
    confidence: 0.9,
    sourceType: "event",
    sourceId: `e-${sourceChapter}`,
    sourceChapter,
    validFromChapter: sourceChapter,
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z",
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("chapter.discard_range", () => {
  it("requires confirm=true", async () => {
    const { bookRoot, storage } = await createBook([1]);
    try {
      const result = await handleChapterDiscardRange({
        bookId: "book-1",
        bookRoot,
        fromChapter: 1,
        toChapter: 1,
        confirm: false as unknown as true,
        storage,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("confirm-required");
    } finally {
      storage.close();
    }
  });

  it("clears only in-range memory and archives chapter files", async () => {
    const { bookRoot, storage } = await createBook([1, 2, 5]);
    try {
      insertNarrativeEvent(storage, event("e-1", 1));
      insertNarrativeEvent(storage, event("e-2", 2));
      insertNarrativeEvent(storage, event("e-5", 5));
      insertNarrativeFact(storage, fact("f-1", 1));
      insertNarrativeFact(storage, fact("f-5", 5));

      storage.sqlite.prepare(`
        INSERT INTO story_jingwei_entry (id, book_id, title, content_md, fields_json, related_chapter_numbers_json, category, lifecycle, updated_at, deleted_at)
        VALUES ('hook-1', 'book-1', '第1章伏笔', '内容', '{}', '[1]', 'foreshadowing', 'active', '2026-06-22T00:00:00.000Z', NULL)
      `).run();

      const result = await handleChapterDiscardRange({
        bookId: "book-1",
        bookRoot,
        fromChapter: 1,
        toChapter: 2,
        confirm: true,
        storage,
      });

      expect(result.ok).toBe(true);
      expect(result.deletedEvents).toBe(2);
      expect(result.deletedFacts).toBe(1);
      expect(result.deletedChapterFiles).toBe(2);
      expect(result.hooksReset).toBeGreaterThanOrEqual(1);

      const remainingEvents = storage.sqlite.prepare(
        "SELECT chapter_number AS n FROM narrative_event WHERE book_id = ? ORDER BY chapter_number",
      ).all("book-1") as Array<{ n: number }>;
      expect(remainingEvents).toEqual([{ n: 5 }]);

      const remainingFacts = storage.sqlite.prepare(
        "SELECT source_chapter AS n FROM narrative_fact WHERE book_id = ?",
      ).all("book-1") as Array<{ n: number }>;
      expect(remainingFacts).toEqual([{ n: 5 }]);

      const index = JSON.parse(await readFile(join(bookRoot, "chapters", "index.json"), "utf8")) as Array<{ number: number }>;
      expect(index.map((item) => item.number)).toEqual([5]);

      const hooks = await readFile(join(bookRoot, "story", "pending_hooks.md"), "utf8");
      expect(hooks).not.toContain("第1章");
      expect(hooks).toContain("第5章");
    } finally {
      storage.close();
    }
  });
});
