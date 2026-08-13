/**
 * memory.settle_chapter 行为契约。
 *
 * 这里锁的是任务 B 的核心纪律：章后结算只结算**已落盘**正文。
 * 因此「先保存正文，再更新记忆」不是代码书写顺序的约定，而是运行时的数据依赖 ——
 * 章节没落盘，结算必然失败，不可能出现「记忆里有、正文里没有」的错位。
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  handleMemorySettleChapter,
  SETTLE_CHAPTER_TOOL_NAME,
  SETTLE_CHAPTER_TOOL_RENDERER,
} from "./memory-settle-chapter.js";
import { NOVEL_RUNTIME_TOOL_CATALOG } from "./tool-registry.js";

const tempDirs: string[] = [];

async function createBook(chapters: readonly { number: number; content: string }[]): Promise<{
  bookRoot: string;
  storage: StorageDatabase;
}> {
  const dir = join(tmpdir(), `novelfork-settle-chapter-${crypto.randomUUID()}`);
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
    const fileName = `${String(chapter.number).padStart(4, "0")}-ch.md`;
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

  return { bookRoot: dir, storage: createStorageDatabase({ databasePath: join(dir, "novelfork.db") }) };
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
          object: match[2]!.trim().replace(/[，。].*$/u, ""),
          evidenceText: line.trim(),
          confidence: 0.88,
          source: "settle",
        });
      }
    }
    return drafts;
  };
}

describe("memory.settle_chapter 工具注册", () => {
  it("以已在 Studio 表态过的 narrative-memory.admin 渲染，不引入未注册 renderer", () => {
    const entry = NOVEL_RUNTIME_TOOL_CATALOG.find((tool) => tool.name === SETTLE_CHAPTER_TOOL_NAME);
    expect(entry, `${SETTLE_CHAPTER_TOOL_NAME} 必须注册在工具目录里，否则管线发起的结算不会出现在叙述者面板`).toBeDefined();
    expect(entry?.renderer).toBe(SETTLE_CHAPTER_TOOL_RENDERER);
    expect(entry?.renderer).toBe("narrative-memory.admin");
    // 结算写入正史，风险等级不能低于 confirmed-write。
    expect(entry?.risk).toBe("confirmed-write");
    expect(entry?.runtimeStatus).toBe("ready");
  });
});

describe("memory.settle_chapter 顺序保证", () => {
  it("拒绝结算未落盘的章节（保存先于结算是数据依赖，不是书写约定）", async () => {
    const { bookRoot, storage } = await createBook([]);
    try {
      const result = await handleMemorySettleChapter({
        bookId: "book-1",
        bookRoot,
        chapterNumber: 12,
        storage,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("chapter-not-persisted");
      expect(result.settlement).toBeUndefined();
      // 拦截必须带人话解释（发生了什么 / 为什么要看 / 建议怎么做）。
      expect(result.summary).toContain("发生了什么：");
      expect(result.summary).toContain("为什么要看：");
      expect(result.summary).toContain("建议怎么做：");
    } finally {
      storage.close();
    }
  });

  it("章节落盘后结算成功，并写入 narrative events", async () => {
    const content = "【地点】韩立抵达药园，发现小瓶能催熟药草。";
    const { bookRoot, storage } = await createBook([
      { number: 12, content },
    ]);
    try {
      const result = await handleMemorySettleChapter({
        bookId: "book-1",
        bookRoot,
        chapterNumber: 12,
        title: "药园试探",
        storage,
        llmExtractor: markerExtractor(content),
      });

      expect(result.ok).toBe(true);
      expect(result.chapterNumber).toBe(12);
      expect(result.settlement?.status).toBe("completed");
      expect(result.settlement?.extracted).toBeGreaterThan(0);
      // 面板要能看到「抽出几条 / 几条直接应用 / 几条进待审」。
      expect(result.summary).toContain("抽取");
      expect(result.summary).toContain("直接应用");
      expect(result.summary).toContain("待审");

      const persisted = storage.sqlite
        .prepare("SELECT COUNT(*) AS c FROM narrative_event WHERE book_id = ? AND chapter_number = ?")
        .get("book-1", 12) as { c: number };
      expect(persisted.c).toBeGreaterThan(0);
    } finally {
      storage.close();
    }
  });

  it("缺少可信 bookRoot 时拒绝结算，不猜路径", async () => {
    const { bookRoot, storage } = await createBook([{ number: 1, content: "【地点】韩立回到洞府。" }]);
    try {
      const result = await handleMemorySettleChapter({
        bookId: "book-1",
        bookRoot: "   ",
        chapterNumber: 1,
        storage,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("missing-book-root");
      void bookRoot;
    } finally {
      storage.close();
    }
  });

  it("章号非法时拒绝结算", async () => {
    const { storage } = await createBook([]);
    try {
      const result = await handleMemorySettleChapter({
        bookId: "book-1",
        bookRoot: "/tmp/whatever",
        chapterNumber: 0,
        storage,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("invalid-chapter");
    } finally {
      storage.close();
    }
  });
});
