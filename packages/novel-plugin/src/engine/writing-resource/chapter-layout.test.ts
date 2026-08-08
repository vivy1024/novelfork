import { mkdir, readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  listChapterFiles,
  parseChapterFileName,
  synchronizeChapterLayout,
} from "./chapter-layout.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("chapter layout", () => {
  it("parses chapter numbers from nested file names without trusting a path", () => {
    expect(parseChapterFileName("卷02\\0012-转折.md")).toEqual({
      number: 12,
      fileName: "0012-转折.md",
      title: "转折",
    });
    expect(parseChapterFileName("卷02/无效.md")).toBeNull();
  });

  it("migrates a legacy flat chapter and rewrites index.json to a relative nested path", async () => {
    const bookRoot = await mkdtemp(join(tmpdir(), "novelfork-chapter-layout-"));
    tempDirs.push(bookRoot);
    await mkdir(join(bookRoot, "chapters"), { recursive: true });
    await writeFile(join(bookRoot, "chapters", "0001-旧章节.md"), "旧正文", "utf8");
    await writeFile(join(bookRoot, "chapters", "index.json"), JSON.stringify([{
      number: 1,
      title: "旧章节",
      fileName: "0001-旧章节.md",
      wordCount: 3,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }]), "utf8");

    const result = await synchronizeChapterLayout(bookRoot, bookRoot, async () => "卷02");

    expect(result.migrated).toBe(1);
    await expect(readFile(join(bookRoot, "chapters", "卷02", "0001_旧章节.md"), "utf8")).resolves.toBe("旧正文");
    await expect(readFile(join(bookRoot, "chapters", "0001-旧章节.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(join(bookRoot, "chapters", "index.json"), "utf8"))).toEqual([expect.objectContaining({
      number: 1,
      fileName: "卷02/0001_旧章节.md",
    })]);
  });

  it("lists chapters recursively and preserves the volume path", async () => {
    const bookRoot = await mkdtemp(join(tmpdir(), "novelfork-chapter-layout-"));
    tempDirs.push(bookRoot);
    await mkdir(join(bookRoot, "chapters", "卷03"), { recursive: true });
    await writeFile(join(bookRoot, "chapters", "卷03", "0012-高潮.md"), "# 高潮\n正文", "utf8");

    await expect(listChapterFiles(bookRoot)).resolves.toEqual([expect.objectContaining({
      number: 12,
      chapterRelativePath: "卷03/0012-高潮.md",
      relativePath: "chapters/卷03/0012-高潮.md",
    })]);
  });
});
