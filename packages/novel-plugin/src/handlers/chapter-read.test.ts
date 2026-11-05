import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleChapterRead } from "./chapter-read.js";

const tempDirs: string[] = [];

async function createBook(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "novelfork-chapter-read-"));
  tempDirs.push(dir);
  await mkdir(join(dir, "chapters", "卷01"), { recursive: true });
  const fileName = "卷01/0001_雨夜.md";
  await writeFile(join(dir, "chapters", fileName), content, "utf8");
  await writeFile(join(dir, "chapters", "index.json"), JSON.stringify([
    { number: 1, title: "雨夜", fileName, wordCount: content.length, updatedAt: "2026-10-01T00:00:00.000Z" },
  ]), "utf8");
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("handleChapterRead", () => {
  const content = "第一句。😀第二句。第三句。";
  const sha256 = createHash("sha256").update(content, "utf8").digest("hex");

  it("默认读整章并带整章 sha256，不带 range", async () => {
    const bookRoot = await createBook(content);
    const result = await handleChapterRead({ bookId: "b", chapterNumber: 1 }, undefined, { bookRoot });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ content, sha256, fileName: "卷01/0001_雨夜.md" });
    expect(result.data?.range).toBeUndefined();
  });

  it("offset / limit 按码点分段读取，sha256 仍是整章的", async () => {
    const bookRoot = await createBook(content);
    const first = await handleChapterRead({ bookId: "b", chapterNumber: 1, limit: 5 }, undefined, { bookRoot });
    expect(first.data).toMatchObject({
      content: "第一句。😀",
      sha256,
      range: { offset: 0, length: 5, totalChars: Array.from(content).length, hasMore: true },
    });
    const rest = await handleChapterRead({ bookId: "b", chapterNumber: 1, offset: 5 }, undefined, { bookRoot });
    expect(rest.data?.content).toBe("第二句。第三句。");
    expect(rest.data?.range?.hasMore).toBe(false);
    expect(`${first.data?.content}${rest.data?.content}`).toBe(content);

    const beyond = await handleChapterRead({ bookId: "b", chapterNumber: 1, offset: 999, limit: 3 }, undefined, { bookRoot });
    expect(beyond.data).toMatchObject({ content: "", range: { length: 0, hasMore: false } });
  });

  it("非法 offset / limit 被忽略，按整章读取", async () => {
    const bookRoot = await createBook(content);
    const result = await handleChapterRead({ bookId: "b", chapterNumber: 1, offset: -1, limit: 1.5 }, undefined, { bookRoot });
    expect(result.data?.content).toBe(content);
    expect(result.data?.range).toBeUndefined();
  });
});
