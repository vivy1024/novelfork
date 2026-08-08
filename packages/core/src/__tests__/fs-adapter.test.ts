import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystemStorageAdapter } from "../storage/fs-adapter.js";
import type { ChapterMeta } from "../models/chapter.js";

function chapterMeta(number: number, title: string): ChapterMeta {
  return {
    number,
    title,
    status: "drafted",
    wordCount: 100,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    auditIssues: [],
    lengthWarnings: [],
  };
}

describe("FileSystemStorageAdapter chapter layout", () => {
  let projectRoot: string;
  let adapter: FileSystemStorageAdapter;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "novelfork-fs-adapter-test-"));
    adapter = new FileSystemStorageAdapter(projectRoot);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("writes new chapters to volume 01 and persists a relative fileName", async () => {
    await adapter.saveChapterContent(
      "book",
      1,
      "Chapter one body",
      chapterMeta(1, "第一章"),
    );

    const chapterPath = join(
      projectRoot,
      "books",
      "book",
      "chapters",
      "卷01",
      "0001_第一章.md",
    );
    expect(await readFile(chapterPath, "utf-8")).toBe("Chapter one body");

    const index = JSON.parse(
      await readFile(join(projectRoot, "books", "book", "chapters", "index.json"), "utf-8"),
    ) as Array<{ number: number; fileName?: string }>;
    expect(index[0]).toMatchObject({ number: 1, fileName: "卷01/0001_第一章.md" });
  });

  it("prefers an indexed nested fileName over another recursively discovered file", async () => {
    const chaptersDir = join(projectRoot, "books", "book", "chapters");
    await Promise.all([
      mkdir(join(chaptersDir, "卷01"), { recursive: true }),
      mkdir(join(chaptersDir, "卷02"), { recursive: true }),
    ]);
    await writeFile(
      join(chaptersDir, "卷01", "0001_legacy.md"),
      "legacy body",
      "utf-8",
    );
    await writeFile(
      join(chaptersDir, "卷02", "indexed-body.md"),
      "indexed body",
      "utf-8",
    );
    await writeFile(
      join(chaptersDir, "index.json"),
      JSON.stringify([{ ...chapterMeta(1, "Indexed"), fileName: "卷02/indexed-body.md" }]),
      "utf-8",
    );

    await expect(adapter.loadChapterContent("book", 1)).resolves.toBe("indexed body");
  });

  it("falls back to recursive chapter-number parsing when index has no fileName", async () => {
    const chaptersDir = join(projectRoot, "books", "book", "chapters");
    await mkdir(join(chaptersDir, "卷03", "支线"), { recursive: true });
    await writeFile(
      join(chaptersDir, "卷03", "支线", "0002_fallback.md"),
      "recursive body",
      "utf-8",
    );
    await writeFile(
      join(chaptersDir, "index.json"),
      JSON.stringify([chapterMeta(2, "Fallback")]),
      "utf-8",
    );

    await expect(adapter.loadChapterContent("book", 2)).resolves.toBe("recursive body");
  });

  it("removes old chapter files recursively before writing the volume 01 replacement", async () => {
    const chaptersDir = join(projectRoot, "books", "book", "chapters");
    const oldPath = join(chaptersDir, "卷04", "0003_old.md");
    await mkdir(join(chaptersDir, "卷04"), { recursive: true });
    await writeFile(oldPath, "old body", "utf-8");
    await writeFile(
      join(chaptersDir, "index.json"),
      JSON.stringify([{ ...chapterMeta(3, "Old"), fileName: "卷04/0003_old.md" }]),
      "utf-8",
    );

    await adapter.saveChapterContent("book", 3, "new body", chapterMeta(3, "New"));

    await expect(stat(oldPath)).rejects.toThrow();
    await expect(
      readFile(join(chaptersDir, "卷01", "0003_New.md"), "utf-8"),
    ).resolves.toBe("new body");
  });
});
