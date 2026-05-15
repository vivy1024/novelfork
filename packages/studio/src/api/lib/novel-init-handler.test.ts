import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

import { executeNovelInit } from "@vivy1024/novelfork-novel-plugin/handlers";

describe("/novel:init handler", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "novelfork-init-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("creates book directory structure with chapters, jingwei, and config", async () => {
    const result = await executeNovelInit({ bookName: "灵潮纪元", workDir });

    expect(result.ok).toBe(true);
    expect(result.bookPath).toContain("灵潮纪元");
    expect(existsSync(join(result.bookPath!, "chapters"))).toBe(true);
    expect(existsSync(join(result.bookPath!, "jingwei"))).toBe(true);
    expect(existsSync(join(result.bookPath!, "jingwei", "角色"))).toBe(true);
    expect(existsSync(join(result.bookPath!, "jingwei", "势力"))).toBe(true);
    expect(existsSync(join(result.bookPath!, "jingwei", "设定"))).toBe(true);
    expect(existsSync(join(result.bookPath!, "jingwei", "伏笔"))).toBe(true);
    expect(existsSync(join(result.bookPath!, "jingwei", "大纲"))).toBe(true);
    expect(existsSync(join(result.bookPath!, "jingwei", "状态"))).toBe(true);
    expect(existsSync(join(result.bookPath!, "jingwei", "规则"))).toBe(true);
    expect(existsSync(join(result.bookPath!, "novelfork.json"))).toBe(true);
  });

  it("creates story bible and jingwei placeholder files", async () => {
    const result = await executeNovelInit({ bookName: "测试书", workDir });

    expect(existsSync(join(result.bookPath!, "jingwei", "设定", "story_bible.md"))).toBe(true);
    expect(existsSync(join(result.bookPath!, "jingwei", "jingwei.json"))).toBe(true);
  });
});
