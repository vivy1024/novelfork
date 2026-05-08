import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

import { executeNovelInit } from "./novel-init-handler";

describe("/novel:init handler", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "novelfork-init-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("creates book directory structure with chapters, story, and config", async () => {
    const result = await executeNovelInit({ bookName: "灵潮纪元", workDir });

    expect(result.ok).toBe(true);
    expect(result.bookPath).toContain("灵潮纪元");
    expect(existsSync(join(result.bookPath!, "chapters"))).toBe(true);
    expect(existsSync(join(result.bookPath!, "story"))).toBe(true);
    expect(existsSync(join(result.bookPath!, "novelfork.json"))).toBe(true);
  });

  it("creates story bible and jingwei placeholder files", async () => {
    const result = await executeNovelInit({ bookName: "测试书", workDir });

    expect(existsSync(join(result.bookPath!, "story", "story_bible.md"))).toBe(true);
    expect(existsSync(join(result.bookPath!, "story", "jingwei.json"))).toBe(true);
  });
});
