import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getBuiltinGenresDir, listAvailableGenres, readGenreProfile } from "./rules-reader.js";

/**
 * 这些用例守护的是 v3.3.0 EXE 里出现的真实故障：
 * `bun --compile` 产物内不存在 `packages/core/genres`，题材 md 一个字都没进 EXE，
 * 于是写章第一步就抛「Genre profile not found ... other.md is missing」。
 *
 * 走真实文件系统而不是 mock：`node:fs/promises` 是内建模块，导出不可重定义，
 * 且 rules-reader 在模块顶层静态导入，任何 spy/mock 都拦不住它实际调用的那份。
 */

function genreMarkdown(id: string, name: string): string {
  return `---
name: ${name}
id: ${id}
chapterTypes: ["推进章"]
fatigueWords: ["震惊"]
pacingRule: "测试节奏"
satisfactionTypes: ["目标达成"]
auditDimensions: [1]
---

## 题材禁忌

- 测试禁忌
`;
}

async function withTempProject<T>(run: (projectRoot: string) => Promise<T>): Promise<T> {
  const projectRoot = await mkdtemp(join(tmpdir(), "novelfork-rules-reader-"));
  try {
    return await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

describe("readGenreProfile 题材来源查找链", () => {
  it("未知题材在磁盘与项目级都命不中时，回落到内嵌 other 快照", async () => {
    await withTempProject(async (projectRoot) => {
      // 该 id 在 packages/core/genres 与内嵌快照里都不存在，
      // 因此只能走 fallback；不抛错即证明 fallback 链可用。
      const parsed = await readGenreProfile(projectRoot, "a-genre-that-does-not-exist");
      expect(parsed.profile.id).toBe("other");
      expect(parsed.body.length).toBeGreaterThan(0);
    });
  });

  it("已知题材可直接解析出对应 profile", async () => {
    await withTempProject(async (projectRoot) => {
      const parsed = await readGenreProfile(projectRoot, "xianxia");
      expect(parsed.profile.id).toBe("xianxia");
    });
  });

  it("书籍级 genres/{id}.md 覆盖内置来源", async () => {
    await withTempProject(async (projectRoot) => {
      await mkdir(join(projectRoot, "genres"), { recursive: true });
      await writeFile(
        join(projectRoot, "genres", "xianxia.md"),
        genreMarkdown("xianxia", "本书专用仙侠"),
        "utf-8",
      );
      const parsed = await readGenreProfile(projectRoot, "xianxia");
      expect(parsed.profile.name).toBe("本书专用仙侠");
    });
  });

  it("书籍级可为完全自定义题材提供定义，避免走 fallback", async () => {
    await withTempProject(async (projectRoot) => {
      await mkdir(join(projectRoot, "genres"), { recursive: true });
      await writeFile(
        join(projectRoot, "genres", "my-own-genre.md"),
        genreMarkdown("my-own-genre", "自定义题材"),
        "utf-8",
      );
      const parsed = await readGenreProfile(projectRoot, "my-own-genre");
      expect(parsed.profile.id).toBe("my-own-genre");
      expect(parsed.profile.name).toBe("自定义题材");
    });
  });

  it("内嵌快照能独立提供 other，与磁盘目录是否存在无关", async () => {
    // 断言的是「快照自带 fallback」这一编译态前提，而不是当前开发机上恰好有磁盘目录。
    const { BUNDLED_GENRE_PROFILES } = await import("@vivy1024/novelfork-core/models/genre-profiles");
    const bundledOther = BUNDLED_GENRE_PROFILES.find((entry) => entry.id === "other");
    expect(bundledOther).toBeDefined();
    expect(bundledOther?.content).toContain("id: other");
  });
});

describe("listAvailableGenres", () => {
  it("返回内置题材列表且包含 other", async () => {
    await withTempProject(async (projectRoot) => {
      const genres = await listAvailableGenres(projectRoot);
      expect(genres.length).toBeGreaterThan(0);
      expect(genres.some((genre) => genre.id === "other")).toBe(true);
    });
  });

  it("书籍级题材以 project 来源覆盖同名内置项", async () => {
    await withTempProject(async (projectRoot) => {
      await mkdir(join(projectRoot, "genres"), { recursive: true });
      await writeFile(
        join(projectRoot, "genres", "xianxia.md"),
        genreMarkdown("xianxia", "本书专用仙侠"),
        "utf-8",
      );
      const genres = await listAvailableGenres(projectRoot);
      expect(genres.find((genre) => genre.id === "xianxia")).toMatchObject({
        name: "本书专用仙侠",
        source: "project",
      });
    });
  });

  it("内嵌快照覆盖磁盘目录中的全部题材 id（编译态不会丢题材）", async () => {
    const builtinDir = getBuiltinGenresDir();
    // 开发树里应当存在该目录；若不存在（编译态）就跳过磁盘侧比对。
    if (!existsSync(builtinDir)) return;
    const { BUNDLED_GENRE_PROFILES } = await import("@vivy1024/novelfork-core/models/genre-profiles");
    const { readdir } = await import("node:fs/promises");
    const diskIds = (await readdir(builtinDir))
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.replace(/\.md$/u, ""));
    const bundledIds = new Set(BUNDLED_GENRE_PROFILES.map((entry) => entry.id));
    for (const id of diskIds) {
      expect(bundledIds.has(id)).toBe(true);
    }
  });
});
