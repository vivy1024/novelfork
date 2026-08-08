import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { describe, expect, it, afterEach } from "vitest";
import { handleChapterWrite } from "./chapter-write.js";

const tempDirs: string[] = [];

async function createBook(chapters: Array<{ number: number; content: string; title?: string }>) {
  const dir = join(tmpdir(), `novelfork-write-${crypto.randomUUID()}`);
  await mkdir(join(dir, "chapters", "卷01"), { recursive: true });
  await mkdir(join(dir, "story"), { recursive: true });
  tempDirs.push(dir);

  await writeFile(
    join(dir, "book.json"),
    JSON.stringify({
      id: "book-1",
      title: "测试书",
      chapterWordCount: 1000,
      language: "zh",
    }),
    "utf8",
  );

  const index = [];
  for (const chapter of chapters) {
    const title = chapter.title ?? `第${chapter.number}章`;
    const fileName = `卷01/${String(chapter.number).padStart(4, "0")}_${title}.md`;
    await writeFile(join(dir, "chapters", fileName), chapter.content, "utf8");
    index.push({
      number: chapter.number,
      title,
      fileName,
      wordCount: chapter.content.length,
      updatedAt: new Date().toISOString(),
    });
  }
  await writeFile(join(dir, "chapters", "index.json"), JSON.stringify(index, null, 2), "utf8");
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("handleChapterWrite", () => {
  it("successfully writes a chapter with correct hash and retains volume layout", async () => {
    const content = "这是测试正文。".repeat(143); // 1001 字
    const bookRoot = await createBook([{ number: 1, content: "这是旧章节正文。".repeat(143) }]);

    const result = await handleChapterWrite(
      {
        bookId: "book-1",
        chapterNumber: 1,
        content,
      },
      { bookRoot },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.bookId).toBe("book-1");
    expect(result.data.chapterNumber).toBe(1);
    expect(result.data.fileName).toBe("卷01/0001_第1章.md");
    expect(result.data.hash).toBe(createHash("sha256").update(content, "utf8").digest("hex"));

    // Verify file content written to disk
    const savedContent = await readFile(join(bookRoot, "chapters", result.data.fileName), "utf8");
    expect(savedContent).toBe(content);

    // Verify index.json layout
    const indexRaw = await readFile(join(bookRoot, "chapters", "index.json"), "utf8");
    const index = JSON.parse(indexRaw);
    expect(index[0].fileName).toBe("卷01/0001_第1章.md");
    expect(index[0].wordCount).toBe(result.data.wordCount);
  });

  it("validates expectedHash CAS match before writing", async () => {
    const initialContent = "初始章节正文。".repeat(143); // 1001 字
    const bookRoot = await createBook([{ number: 1, content: initialContent }]);
    const currentHash = createHash("sha256").update(initialContent, "utf8").digest("hex");

    const newContent = "更新后的正文内容。".repeat(111); // 999 字
    const result = await handleChapterWrite(
      {
        bookId: "book-1",
        chapterNumber: 1,
        content: newContent,
        expectedHash: currentHash,
      },
      { bookRoot },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.hash).toBe(createHash("sha256").update(newContent, "utf8").digest("hex"));
  });

  it("returns chapter-concurrent-modification on expectedHash mismatch and does not overwrite disk", async () => {
    const initialContent = "初始章节正文。".repeat(143);
    const bookRoot = await createBook([{ number: 1, content: initialContent }]);
    const actualCurrentHash = createHash("sha256").update(initialContent, "utf8").digest("hex");
    const staleExpectedHash = "0000000000000000000000000000000000000000000000000000000000000000";

    const newContent = "尝试覆盖的正文。".repeat(143);
    const result = await handleChapterWrite(
      {
        bookId: "book-1",
        chapterNumber: 1,
        content: newContent,
        expectedHash: staleExpectedHash,
      },
      { bookRoot },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toBe("chapter-concurrent-modification");
    expect(result.summary).toContain("已被并发修改");
    expect(result.explanation).toContain("检测到章节正文在读取与本次写入之间已被其它并发任务更新");
    expect(result.data?.currentHash).toBe(actualCurrentHash);
    expect(result.data?.expectedHash).toBe(staleExpectedHash);

    // Verify content on disk was NOT modified
    const savedContent = await readFile(join(bookRoot, "chapters", "卷01", "0001_第1章.md"), "utf8");
    expect(savedContent).toBe(initialContent);
  });
});
