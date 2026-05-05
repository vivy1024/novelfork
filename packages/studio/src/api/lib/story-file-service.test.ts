import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createStoryFileReadService, isSafeStoryFileName, TRUTH_FILES } from "./story-file-service";

describe("story file read service", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "novelfork-story-file-service-"));
    await mkdir(join(root, "books", "book-1", "story"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists truth files with labels, previews and safe filtering", async () => {
    const storyDir = join(root, "books", "book-1", "story");
    await writeFile(join(storyDir, "pending_hooks.md"), "# hooks\n\n伏笔正文", "utf-8");
    await writeFile(join(storyDir, "chapter_summaries.md"), "# summaries", "utf-8");
    await writeFile(join(storyDir, "style_profile.json"), "{}", "utf-8");

    const service = createStoryFileReadService({ resolveBookDir: (bookId) => join(root, "books", bookId) });

    await expect(service.listTruthFiles("book-1")).resolves.toEqual({
      files: expect.arrayContaining([
        expect.objectContaining({ name: "pending_hooks.md", label: "待处理伏笔", size: 13, preview: expect.stringContaining("伏笔正文") }),
        expect.objectContaining({ name: "chapter_summaries.md", label: "章节摘要" }),
      ]),
    });
    const result = await service.listTruthFiles("book-1");
    expect(result.files.map((file) => file.name)).not.toContain("style_profile.json");
  });

  it("reads truth files and preserves invalid/missing semantics", async () => {
    const storyDir = join(root, "books", "book-1", "story");
    await writeFile(join(storyDir, "story_bible.md"), "# 故事经纬", "utf-8");
    const service = createStoryFileReadService({ resolveBookDir: (bookId) => join(root, "books", bookId) });

    await expect(service.readTruthFile("book-1", "story_bible.md")).resolves.toEqual({ file: "story_bible.md", content: "# 故事经纬" });
    await expect(service.readTruthFile("book-1", "evil_file.md")).resolves.toEqual({ error: "Invalid truth file" });
    await expect(service.readTruthFile("book-1", "book_rules.md")).resolves.toEqual({ file: "book_rules.md", content: null });
    expect(TRUTH_FILES).toContain("story_bible.md");
  });

  it("lists and reads generic story files while rejecting unsafe names", async () => {
    const storyDir = join(root, "books", "book-1", "story");
    await writeFile(join(storyDir, "pending_hooks.md"), "# hooks", "utf-8");
    await writeFile(join(storyDir, "style_profile.json"), "{\"tone\":\"稳\"}", "utf-8");
    await writeFile(join(storyDir, "ignore.exe"), "binary", "utf-8");
    const service = createStoryFileReadService({ resolveBookDir: (bookId) => join(root, "books", bookId) });

    await expect(service.listStoryFiles("book-1")).resolves.toEqual({
      files: expect.arrayContaining([
        expect.objectContaining({ name: "pending_hooks.md" }),
        expect.objectContaining({ name: "style_profile.json" }),
      ]),
    });
    const listed = await service.listStoryFiles("book-1");
    expect(listed.files.map((file) => file.name)).not.toContain("ignore.exe");
    await expect(service.readStoryFile("book-1", "style_profile.json")).resolves.toEqual({ file: "style_profile.json", content: "{\"tone\":\"稳\"}" });
    await expect(service.readStoryFile("book-1", "../secrets.md")).resolves.toEqual({ error: "Invalid story file" });
    await expect(service.readStoryFile("book-1", "missing.md")).resolves.toEqual({ file: "missing.md", content: null });
    expect(isSafeStoryFileName("style_profile.json")).toBe(true);
    expect(isSafeStoryFileName("../secrets.md")).toBe(false);
  });
});
