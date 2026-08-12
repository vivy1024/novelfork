import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handlePublishCheck } from "./publish-check.js";

const tempDirs: string[] = [];

async function createBook(options: {
  platform?: string;
  chapterWordCount?: number;
  chapters?: Array<{ number: number; content: string }>;
} = {}): Promise<string> {
  const dir = join(tmpdir(), `novelfork-publish-${crypto.randomUUID()}`);
  await mkdir(join(dir, "chapters"), { recursive: true });
  tempDirs.push(dir);
  await writeFile(join(dir, "book.json"), JSON.stringify({
    id: "book-1",
    title: "测试书",
    platform: options.platform ?? "tomato",
    chapterWordCount: options.chapterWordCount ?? 2200,
  }), "utf8");
  const index = [];
  for (const chapter of options.chapters ?? []) {
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
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("handlePublishCheck", () => {
  it("resolves the platform from book.json and reports a chapter", async () => {
    const bookRoot = await createBook({
      chapters: [{ number: 1, content: `第一章 山门\n${"韩立走进山门。".repeat(200)}` }],
    });
    const result = await handlePublishCheck({ bookId: "book-1", bookRoot });
    expect(result.ok).toBe(true);
    expect(result.platform).toBe("fanqie");
    expect(result.platformLabel).toBe("番茄小说");
    expect(result.checkedChapters).toBe(1);
    expect(result.report).not.toBeNull();
    expect(["ready", "has-warnings", "needs-review"]).toContain(result.status);
    expect(result.report?.rulePack.name).toContain("投稿风险自检");
  });

  it("honors an explicit platform override", async () => {
    const bookRoot = await createBook({
      platform: "tomato",
      chapters: [{ number: 1, content: `第一章\n${"正文".repeat(600)}` }],
    });
    const result = await handlePublishCheck({ bookId: "book-1", bookRoot, platform: "qidian" });
    expect(result.platform).toBe("qidian");
    expect(result.profile.notes.join(" ")).toContain("人工复核");
  });

  it("warns when the configured chapter target is outside the platform window", async () => {
    const bookRoot = await createBook({
      platform: "tomato",
      chapterWordCount: 9000,
      chapters: [{ number: 1, content: `第一章\n${"正文".repeat(600)}` }],
    });
    const result = await handlePublishCheck({ bookId: "book-1", bookRoot });
    expect(result.chapterTarget?.status).toBe("above-max");
    expect(result.summary).toContain("高于");
  });

  it("checks explicit single-chapter content without touching disk chapters", async () => {
    const bookRoot = await createBook();
    const result = await handlePublishCheck({
      bookId: "book-1",
      bookRoot,
      chapterNumber: 7,
      content: `第七章\n${"正文".repeat(500)}`,
    });
    expect(result.ok).toBe(true);
    expect(result.checkedChapters).toBe(1);
    expect(result.report?.formatCheck).toBeDefined();
  });

  it("skips when the range has no readable chapters", async () => {
    const bookRoot = await createBook({ chapters: [{ number: 1, content: "正文".repeat(400) }] });
    const result = await handlePublishCheck({ bookId: "book-1", bookRoot, fromChapter: 50, toChapter: 60 });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("skipped");
    expect(result.checkedChapters).toBe(0);
  });

  it("requires bookId and bookRoot", async () => {
    expect((await handlePublishCheck({ bookId: "", bookRoot: "/tmp" })).error).toBe("missing-book-id");
    expect((await handlePublishCheck({ bookId: "book-1", bookRoot: "" })).error).toBe("missing-book-root");
  });
});
