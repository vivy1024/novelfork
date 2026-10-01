import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handlePublishExport, PUBLISH_EXPORT_DIRECTORY } from "./publish-export.js";

const tempDirs: string[] = [];

async function createBook(options: {
  title?: string;
  platform?: string;
  chapters?: Array<{ number: number; title: string; content: string }>;
} = {}): Promise<string> {
  const dir = join(tmpdir(), `novelfork-publish-export-${crypto.randomUUID()}`);
  await mkdir(join(dir, "chapters"), { recursive: true });
  await mkdir(join(dir, ".novelfork"), { recursive: true });
  await mkdir(join(dir, "attachments"), { recursive: true });
  tempDirs.push(dir);
  await writeFile(join(dir, "book.json"), JSON.stringify({
    id: "book-1",
    title: options.title ?? "测试书",
    platform: options.platform ?? "tomato",
    genre: "玄幻",
    language: "zh",
    status: "active",
    chapterWordCount: 2200,
  }), "utf8");
  await writeFile(join(dir, ".novelfork", "last-pipeline-run.json"), "{\"secret\":true}", "utf8");
  await writeFile(join(dir, "attachments", "cover.png"), "not-a-real-image", "utf8");
  const index = [];
  for (const chapter of options.chapters ?? [
    { number: 1, title: "山门", content: `# 山门\n${"韩立走进山门。".repeat(80)}` },
    { number: 2, title: "试炼", content: `# 试炼\n${"守门人抬手。".repeat(80)}` },
  ]) {
    const fileName = `${String(chapter.number).padStart(4, "0")}_${chapter.title}.md`;
    await writeFile(join(dir, "chapters", fileName), chapter.content, "utf8");
    index.push({
      number: chapter.number,
      title: chapter.title,
      fileName,
      wordCount: chapter.content.replace(/\s+/g, "").length,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  }
  await writeFile(join(dir, "chapters", "index.json"), JSON.stringify(index, null, 2), "utf8");
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("handlePublishExport", () => {
  it("写出作品信息、目录和章节正文，不混入附件或工作数据", async () => {
    const bookRoot = await createBook();
    const result = await handlePublishExport({ bookId: "book-1", bookRoot });
    expect(result.ok).toBe(true);
    expect(result.outputDir).toBe(PUBLISH_EXPORT_DIRECTORY);
    expect(result.chapters?.map((chapter) => chapter.number)).toEqual([1, 2]);
    expect(result.included).toEqual(expect.arrayContaining(["作品信息", "目录", "章节正文"]));
    expect(result.excluded?.join(" ")).toContain("附件");
    expect(result.excluded?.join(" ")).toContain("叙事记忆");

    const output = join(bookRoot, PUBLISH_EXPORT_DIRECTORY);
    const top = await readdir(output);
    expect(top.sort()).toEqual(["README.md", "book.json", "catalog.md", "chapters", "publish-advice.md"].sort());
    expect(top).not.toContain("attachments");
    expect(top).not.toContain(".novelfork");

    const bookInfo = JSON.parse(await readFile(join(output, "book.json"), "utf8")) as { title: string };
    expect(bookInfo.title).toBe("测试书");
    const catalog = await readFile(join(output, "catalog.md"), "utf8");
    expect(catalog).toContain("第1章 山门");
    expect(catalog).toContain("第2章 试炼");
    const chapterOne = await readFile(join(output, "chapters", "0001_山门.md"), "utf8");
    expect(chapterOne).toContain("韩立走进山门");
    const advice = await readFile(join(output, "publish-advice.md"), "utf8");
    expect(advice).toContain("投稿准备建议");
    expect(advice).toContain("人工复核");
  });

  it("可以只导出指定章范围且不附带投稿建议", async () => {
    const bookRoot = await createBook();
    const result = await handlePublishExport({
      bookId: "book-1",
      bookRoot,
      fromChapter: 2,
      toChapter: 2,
      includeAdvice: false,
    });
    expect(result.ok).toBe(true);
    expect(result.chapters?.map((chapter) => chapter.number)).toEqual([2]);
    expect(result.adviceIncluded).toBe(false);
    const top = await readdir(join(bookRoot, PUBLISH_EXPORT_DIRECTORY));
    expect(top).not.toContain("publish-advice.md");
    expect(result.files).not.toContain("publish-advice.md");
  });

  it("范围内没有章节时不创建发布包", async () => {
    const bookRoot = await createBook();
    const result = await handlePublishExport({ bookId: "book-1", bookRoot, fromChapter: 90, toChapter: 99 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no-chapters");
    await expect(readdir(join(bookRoot, PUBLISH_EXPORT_DIRECTORY))).rejects.toThrow();
  });
});
