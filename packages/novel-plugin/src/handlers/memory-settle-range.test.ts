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

/** mock LLM 抽取器：把【地点】标记翻译成事件草案（结算只接受 LLM 抽取）。 */
function markerExtractor(content: string) {
  return async () => {
    const drafts: Array<Record<string, unknown>> = [];
    for (const line of content.split("\n")) {
      const match = line.trim().match(/^【地点】(.+?)(?:抵达|来到|进入|到达)(.+)$/u);
      if (match) {
        drafts.push({
          eventType: "location_changed",
          subject: match[1]!.trim(),
          predicate: "抵达",
          object: match[2]!.trim(),
          evidenceText: line.trim(),
          confidence: 0.88,
          source: "settle",
        });
      }
    }
    return drafts;
  };
}

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
      const run = () => handleMemorySettleRange({
        bookId: "book-1",
        bookRoot,
        fromChapter: 1,
        toChapter: 1,
        storage,
        llmExtractor: markerExtractor("【地点】韩立抵达药园"),
      });
      const first = await run();
      expect(first.ok).toBe(true);
      expect(first.chaptersSettled).toBe(1);
      expect(first.totalExtracted).toBeGreaterThan(0);

      const countAfterFirst = (storage.sqlite.prepare("SELECT COUNT(*) AS c FROM narrative_event WHERE book_id = ?").get("book-1") as { c: number }).c;

      const second = await run();
      expect(second.ok).toBe(true);
      expect(second.chaptersSkipped).toBe(1);
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
        llmExtractor: markerExtractor("【地点】韩立抵达药园"),
      });
      expect(result.ok).toBe(true);
      expect(result.chaptersSettled).toBe(1);
      expect(result.chaptersSkipped).toBe(2);
    } finally {
      storage.close();
    }
  });

  /**
   * 抽取失败不再降级为规则兜底：失败的章保持未结算，
   * 重跑同一范围时幂等门跳过已结算章、只补失败章。
   */
  it("marks extraction failures per chapter and keeps them retryable", async () => {
    const { bookRoot, storage } = await createBookWithChapters([
      { number: 1, content: "韩立抵达药园。" },
      { number: 2, content: "韩立回到洞府。" },
    ]);
    try {
      const failing = await handleMemorySettleRange({
        bookId: "book-1",
        bookRoot,
        fromChapter: 1,
        toChapter: 2,
        storage,
        // 没有 LLM 抽取器 → 每章都失败。
      });
      expect(failing.ok).toBe(true);
      expect(failing.chaptersSettled).toBe(0);
      expect(failing.chaptersFailed).toBe(2);
      expect(failing.summary).toContain("失败 2 章");

      // 注入抽取器重跑：两章补结算成功。
      const retried = await handleMemorySettleRange({
        bookId: "book-1",
        bookRoot,
        fromChapter: 1,
        toChapter: 2,
        storage,
        llmExtractor: async (input) => [{
          eventType: "location_changed",
          subject: "韩立",
          predicate: "抵达",
          object: input.content.includes("洞府") ? "洞府" : "药园",
          evidenceText: input.content.trim(),
          confidence: 0.9,
          source: "settle",
        }],
      });
      expect(retried.chaptersSettled).toBe(2);
      expect(retried.chaptersFailed).toBe(0);
      expect(retried.totalExtracted).toBe(2);
    } finally {
      storage.close();
    }
  });
});
