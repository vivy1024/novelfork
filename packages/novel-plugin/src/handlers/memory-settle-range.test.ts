import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { handleMemorySettleRange } from "./memory-settle-range.js";

const tempDirs: string[] = [];

async function createBookWithChapters(chapters: Array<{ number: number; content: string }>): Promise<{
  bookRoot: string;
  storage: StorageDatabase;
}> {
  const dir = join(tmpdir(), `novelfork-settle-range-${crypto.randomUUID()}`);
  await mkdir(join(dir, "chapters"), { recursive: true });
  tempDirs.push(dir);
  await writeFile(join(dir, "book.json"), JSON.stringify({
    id: "book-1",
    title: "测试书",
    chapterWordCount: 3000,
    language: "zh",
  }), "utf8");
  const index = [];
  for (const chapter of chapters) {
    const padded = String(chapter.number).padStart(4, "0");
    const fileName = `${padded}-ch.md`;
    await writeFile(join(dir, "chapters", fileName), chapter.content, "utf8");
    index.push({
      number: chapter.number,
      title: `第${chapter.number}章`,
      fileName,
      wordCount: chapter.content.length,
      status: "accepted",
    });
  }
  await writeFile(join(dir, "chapters", "index.json"), JSON.stringify(index), "utf8");
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  return { bookRoot: dir, storage };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("memory.settle_range", () => {
  it("dryRun reports chapters with body without writing events", async () => {
    const { bookRoot, storage } = await createBookWithChapters([
      { number: 1, content: "【地点】韩立抵达药园" },
      { number: 2, content: "【地点】韩立回到洞府" },
    ]);
    try {
      const result = await handleMemorySettleRange({
        bookId: "book-1",
        bookRoot,
        fromChapter: 1,
        toChapter: 2,
        dryRun: true,
        storage,
      });
      expect(result.ok).toBe(true);
      expect(result.chaptersSettled).toBe(0);
      expect(result.results.every((item) => item.skipped)).toBe(true);
      // dryRun 不写入；表可能尚未创建，故只断言结果形态
      expect(result.summary).toContain("dryRun");
    } finally {
      storage.close();
    }
  });

  it("settles existing chapters and is idempotent on second run", async () => {
    const { bookRoot, storage } = await createBookWithChapters([
      { number: 1, content: "【地点】韩立抵达药园" },
    ]);
    try {
      const first = await handleMemorySettleRange({
        bookId: "book-1",
        bookRoot,
        fromChapter: 1,
        toChapter: 1,
        storage,
      });
      expect(first.ok).toBe(true);
      expect(first.chaptersSettled).toBe(1);
      expect(first.totalExtracted).toBeGreaterThan(0);

      const countAfterFirst = (storage.sqlite.prepare("SELECT COUNT(*) AS c FROM narrative_event WHERE book_id = ?").get("book-1") as { c: number }).c;

      const second = await handleMemorySettleRange({
        bookId: "book-1",
        bookRoot,
        fromChapter: 1,
        toChapter: 1,
        storage,
      });
      expect(second.ok).toBe(true);
      const countAfterSecond = (storage.sqlite.prepare("SELECT COUNT(*) AS c FROM narrative_event WHERE book_id = ?").get("book-1") as { c: number }).c;
      expect(countAfterSecond).toBe(countAfterFirst);
    } finally {
      storage.close();
    }
  });

  it("skips missing chapters without failing the whole range", async () => {
    const { bookRoot, storage } = await createBookWithChapters([
      { number: 1, content: "【地点】韩立抵达药园" },
    ]);
    try {
      const result = await handleMemorySettleRange({
        bookId: "book-1",
        bookRoot,
        fromChapter: 1,
        toChapter: 3,
        storage,
      });
      expect(result.ok).toBe(true);
      expect(result.chaptersSettled).toBe(1);
      expect(result.chaptersSkipped).toBe(2);
    } finally {
      storage.close();
    }
  });
});
