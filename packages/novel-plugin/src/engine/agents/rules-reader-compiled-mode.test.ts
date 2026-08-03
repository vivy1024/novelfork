import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 编译态（EXE）回落守卫。
 *
 * v3.3.0 的真实故障是：`bun --compile` 产物里不存在 `packages/core/genres`，
 * 15 份题材 md 的正文一个字都没进 EXE（实测 `题材禁忌` 命中 0 次），于是
 * `pipeline.write` 第一步就抛「Genre profile not found ... other.md is missing」。
 *
 * 开发树里那个目录是存在的，所以普通用例覆盖不到这条路径。这里 fork 一个
 * 子进程，在子进程内把磁盘目录临时移走后再加载 rules-reader，真实复现编译态。
 * 目录改名只发生在子进程、且带 finally 还原，不影响主测试进程。
 */

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(MODULE_DIR, "..", "..", "..", "..", "..");
const GENRES_DIR = join(REPO_ROOT, "packages", "core", "genres");

const CHILD_SCRIPT = `
import { existsSync, renameSync } from "node:fs";

const genresDir = ${JSON.stringify(GENRES_DIR)};
const hiddenDir = genresDir + ".__compiled_mode_test";
let moved = false;
try {
  if (existsSync(genresDir)) {
    renameSync(genresDir, hiddenDir);
    moved = true;
  }
  const { readGenreProfile, listAvailableGenres, getBuiltinGenresDir } =
    await import(${JSON.stringify(join(MODULE_DIR, "rules-reader.ts").replaceAll("\\\\", "/"))});

  const unknown = await readGenreProfile("/nonexistent-book-root", "a-genre-that-does-not-exist");
  const known = await readGenreProfile("/nonexistent-book-root", "xianxia");
  const list = await listAvailableGenres("/nonexistent-book-root");

  console.log("__RESULT__" + JSON.stringify({
    builtinDirExists: existsSync(getBuiltinGenresDir()),
    fallbackId: unknown.profile.id,
    fallbackBodyLength: unknown.body.length,
    knownId: known.profile.id,
    listCount: list.length,
    listHasOther: list.some((genre) => genre.id === "other"),
  }));
} finally {
  if (moved && existsSync(hiddenDir)) renameSync(hiddenDir, genresDir);
}
`;

interface ChildResult {
  readonly builtinDirExists: boolean;
  readonly fallbackId: string;
  readonly fallbackBodyLength: number;
  readonly knownId: string;
  readonly listCount: number;
  readonly listHasOther: boolean;
}

/** bun 能直接执行 TS 子进程；vitest 自身跑在 node 上，所以显式找 bun。 */
function resolveBunExecutable(): string | null {
  if (process.versions.bun) return process.execPath;
  const candidates = process.platform === "win32"
    ? [join(process.env.USERPROFILE ?? "", ".bun", "bin", "bun.exe"), "bun.exe"]
    : [join(process.env.HOME ?? "", ".bun", "bin", "bun"), "/usr/local/bin/bun", "bun"];
  for (const candidate of candidates) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (existsSync(candidate)) return candidate;
    } else {
      const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
      if (probe.status === 0) return candidate;
    }
  }
  return null;
}

describe("readGenreProfile 编译态回落（磁盘题材目录缺失）", () => {
  it("磁盘目录不存在时仍能解析未知题材、已知题材与题材列表", async () => {
    const bunExecutable = resolveBunExecutable();
    // bun 是本仓库的既有运行时依赖（根 package.json engines.bun）。
    // 找不到就让用例失败，而不是静默跳过 —— 静默跳过等于没有这道守卫。
    expect(bunExecutable, "需要 bun 可执行文件来复现编译态；请确认已安装 bun").toBeTruthy();

    const child = spawnSync(bunExecutable!, ["--eval", CHILD_SCRIPT], {
      cwd: REPO_ROOT,
      env: process.env,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    const stdout = child.stdout ?? "";
    const stderr = child.stderr ?? "";
    const exitCode = child.status;

    // 子进程无论成败都要还原目录；这里再兜一次，避免它被强杀后留下改名的目录。
    const hidden = `${GENRES_DIR}.__compiled_mode_test`;
    if (existsSync(hidden) && !existsSync(GENRES_DIR)) renameSync(hidden, GENRES_DIR);
    expect(existsSync(GENRES_DIR)).toBe(true);

    expect(exitCode, `child failed: ${stderr}`).toBe(0);
    const marker = stdout.split("__RESULT__")[1];
    expect(marker, `missing result marker in: ${stdout}`).toBeTruthy();
    const result = JSON.parse(marker!.trim()) as ChildResult;

    expect(result.builtinDirExists).toBe(false);
    expect(result.fallbackId).toBe("other");
    expect(result.fallbackBodyLength).toBeGreaterThan(0);
    expect(result.knownId).toBe("xianxia");
    expect(result.listCount).toBeGreaterThan(0);
    expect(result.listHasOther).toBe(true);
  }, 60_000);
});
