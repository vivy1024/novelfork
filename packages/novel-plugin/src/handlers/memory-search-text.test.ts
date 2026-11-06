import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { NOVEL_TOOL_SCHEMAS } from "../tool-schemas.js";
import { handleChapterRead } from "./chapter-read.js";
import { handleMemorySearchText } from "./memory-search-text.js";
import { NOVEL_RUNTIME_TOOL_CATALOG } from "./tool-registry.js";
import { getNovelToolRoutine } from "./tool-routines.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function setup(): Promise<{ storage: StorageDatabase; bookRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), "novelfork-search-text-"));
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  const bookRoot = join(dir, "book");
  await mkdir(join(bookRoot, "chapters", "卷01"), { recursive: true });
  cleanups.push(async () => {
    try {
      storage.close();
    } catch {
      // already closed
    }
    await rm(dir, { recursive: true, force: true });
  });
  const chapters: Record<number, string> = {
    1: "雨夜，少年在破庙里避雨。",
    2: `${"山道湿滑，".repeat(40)}他对着残月起誓：此生不负青梅。随后把那枚铜镜埋在槐树下。`,
    3: "多年以后，他回到槐树下，铜镜早已不见。",
  };
  for (const [chapter, body] of Object.entries(chapters)) {
    await writeFile(join(bookRoot, "chapters", "卷01", `${String(chapter).padStart(4, "0")}_第${chapter}章.md`), `# 第${chapter}章\n\n${body}`, "utf8");
  }
  return { storage, bookRoot };
}

describe("memory.search_text", () => {
  it("返回章号、带高亮的片段、可直接交给 chapter.read 的 offset / limit 与提示", async () => {
    const { storage, bookRoot } = await setup();
    const result = await handleMemorySearchText({ bookId: "book-a", bookRoot, query: "铜镜" }, storage);
    expect(result.ok).toBe(true);
    const hits = result.data!.hits;
    expect(hits.map((hit) => hit.chapterNumber).sort()).toEqual([2, 3]);
    const hit = hits.find((item) => item.chapterNumber === 2)!;
    expect(hit.snippet).toContain("【铜镜】");
    expect(hit.fileName).toBe("卷01/0002_第2章.md");
    expect(hit.matchedTerms).toEqual(["铜镜"]);
    expect(result.data!.hint).toContain("chapter.read");
    expect(result.data!.index.totalChapters).toBe(3);
    expect(result.summary).toContain("第");

    // offset / limit 原样交给 chapter.read 能读回命中的那段
    const read = await handleChapterRead({ bookId: "book-a", chapterNumber: 2, offset: hit.offset, limit: hit.length }, undefined, { bookRoot });
    expect(read.ok).toBe(true);
    expect(read.data!.content).toContain("铜镜");
    expect(read.data!.content).toBe(hit.snippet.replace(/[【】]/gu, "").replace(/^…|…$/gu, ""));
  });

  it("默认多词同段命中；match=any 放宽；章号范围生效；单字被忽略并说明", async () => {
    const { storage, bookRoot } = await setup();
    const both = await handleMemorySearchText({ bookId: "book-a", bookRoot, query: "起誓 铜镜" }, storage);
    expect(both.data!.hits.map((hit) => hit.chapterNumber)).toEqual([2]);
    const any = await handleMemorySearchText({ bookId: "book-a", bookRoot, query: "破庙 槐树", match: "any" }, storage);
    expect(any.data!.hits.map((hit) => hit.chapterNumber).sort()).toEqual([1, 2, 3]);
    const ranged = await handleMemorySearchText({ bookId: "book-a", bookRoot, query: "铜镜", fromChapter: 3 }, storage);
    expect(ranged.data!.hits.map((hit) => hit.chapterNumber)).toEqual([3]);
    const single = await handleMemorySearchText({ bookId: "book-a", bookRoot, query: "镜 槐树" }, storage);
    expect(single.data!.ignoredTerms).toEqual(["镜"]);
    expect(single.summary).toContain("单字");
    const none = await handleMemorySearchText({ bookId: "book-a", bookRoot, query: "镜" }, storage);
    expect(none.ok).toBe(false);
    expect(none.error).toBe("query-too-short");
  });

  it("登记为自动档的记忆组只读工具，schema 不暴露书籍目录", () => {
    const entry = NOVEL_RUNTIME_TOOL_CATALOG.find((tool) => tool.name === "memory.search_text");
    expect(entry?.risk).toBe("read");
    expect(entry?.runtimeStatus).toBe("ready");
    expect(getNovelToolRoutine("memory.search_text")).toMatchObject({ defaultMode: "auto", nameZh: "记忆·搜正文" });
    const properties = (NOVEL_TOOL_SCHEMAS["memory.search_text"] as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties)).not.toContain("bookRoot");
  });
});
