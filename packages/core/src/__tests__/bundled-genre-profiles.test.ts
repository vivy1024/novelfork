import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BUNDLED_GENRE_PROFILES } from "../models/bundled-genre-profiles.generated.js";
import { parseGenreProfile } from "../models/genre-profile.js";

const GENRES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "genres");

/**
 * 内嵌题材快照是编译态（EXE）里唯一的 builtin 题材来源。
 * 它一旦缺失或漂移，`readGenreProfile` 会在写章时硬失败，
 * 所以这些断言直接守护发布产物的可用性。
 */
describe("bundled genre profiles", () => {
  it("包含 fallback other，且每份都能解析", () => {
    expect(BUNDLED_GENRE_PROFILES.length).toBeGreaterThan(0);
    expect(BUNDLED_GENRE_PROFILES.some((entry) => entry.id === "other")).toBe(true);

    for (const entry of BUNDLED_GENRE_PROFILES) {
      const parsed = parseGenreProfile(entry.content);
      expect(parsed.profile.id).toBe(entry.id);
      expect(parsed.profile.name.length).toBeGreaterThan(0);
      expect(parsed.body.length).toBeGreaterThan(0);
    }
  });

  it("与 packages/core/genres 磁盘内容保持一致（生成物未过期）", async () => {
    const diskIds = (await readdir(GENRES_DIR))
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.replace(/\.md$/u, ""))
      .sort();
    expect([...BUNDLED_GENRE_PROFILES].map((entry) => entry.id).sort()).toEqual(diskIds);

    for (const entry of BUNDLED_GENRE_PROFILES) {
      const disk = (await readFile(join(GENRES_DIR, `${entry.id}.md`), "utf-8")).replace(/\r\n/g, "\n");
      expect(entry.content).toBe(disk);
    }
  });
});
