import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeStorageDatabase, initializeStorageDatabase, runStorageMigrations } from "@vivy1024/novelfork-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWritingResourceRouter } from "./writing-resource.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "novelfork-writing-resource-errors-"));
  const storage = initializeStorageDatabase({ databasePath: join(root, "novelfork.db") });
  runStorageMigrations(storage);
  await mkdir(join(root, "books", "book-1", "chapters", "卷01"), { recursive: true });
});

afterEach(async () => {
  closeStorageDatabase();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("章节资源路由：索引损坏时给出带 explanation 的错误", () => {
  it("GET 列表遇到坏 index.json 返回 409 + explanation，坏文件留底，不返回空列表", async () => {
    const chaptersDir = join(root, "books", "book-1", "chapters");
    await writeFile(join(chaptersDir, "卷01", "0001_开篇.md"), "正文", "utf8");
    await writeFile(join(chaptersDir, "index.json"), "[{\"number\":1,", "utf8");
    const app = createWritingResourceRouter({ resolveBookDir: (bookId) => join(root, "books", bookId) });

    const response = await app.request("http://localhost/api/books/book-1/resources");

    expect(response.status).toBe(409);
    const body = await response.json() as { error: { code: string; message: string }; explanation: Record<string, string> };
    expect(body.error.code).toBe("CHAPTER_INDEX_CORRUPT");
    expect(body.explanation).toMatchObject({
      whatHappened: expect.stringContaining("index.json.corrupt-"),
      whyItMatters: expect.any(String),
      suggestedAction: expect.any(String),
    });
    const backup = (await readdir(chaptersDir)).find((name) => name.startsWith("index.json.corrupt-"));
    expect(backup).toBeDefined();
    expect(await readFile(join(chaptersDir, backup!), "utf8")).toBe("[{\"number\":1,");
  });

  it("留底之后再次请求，按磁盘正文重建索引并正常返回", async () => {
    const chaptersDir = join(root, "books", "book-1", "chapters");
    await writeFile(join(chaptersDir, "卷01", "0001_开篇.md"), "正文", "utf8");
    await writeFile(join(chaptersDir, "index.json"), "not json", "utf8");
    const app = createWritingResourceRouter({ resolveBookDir: (bookId) => join(root, "books", bookId) });

    expect((await app.request("http://localhost/api/books/book-1/resources")).status).toBe(409);
    const retry = await app.request("http://localhost/api/books/book-1/resources");
    expect(retry.status).toBe(200);
    const payload = await retry.json() as { resources: Array<{ chapterNumber: number }> };
    expect(payload.resources.map((resource) => resource.chapterNumber)).toEqual([1]);
  });
});
