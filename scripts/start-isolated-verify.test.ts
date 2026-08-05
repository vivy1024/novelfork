import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const script = readFileSync(join(repositoryRoot, "scripts", "start-isolated-verify.ts"), "utf8");
const rootMain = readFileSync(join(repositoryRoot, "main.ts"), "utf8");
const claudeMd = readFileSync(join(repositoryRoot, "CLAUDE.md"), "utf8");

describe("隔离验证实例契约", () => {
  test("覆盖 main.ts 全部会落到用户家目录的数据路径变量", () => {
    // main.ts defaults these to ~/.novelfork. Overriding only a subset writes
    // verification accounts into the user's real Runtime database, which has
    // already happened more than once. Every variable must stay covered.
    const required = [
      "NOVELFORK_PROJECT_ROOT",
      "NOVELFORK_BOOKS_ROOT",
      "NOVELFORK_RUNTIME_DIR",
      "NARRAFORK_HOME",
      "NOVELFORK_SESSION_STORE_DIR",
      "NOVELFORK_STORAGE_DB_PATH",
    ];
    for (const variable of required) {
      expect(rootMain).toContain(variable);
      expect(script).toContain(variable);
    }
  });

  test("隔离数据路径全部落在同一个可丢弃目录内，不指向用户家目录", () => {
    expect(script).toContain("mkdtempSync(join(tmpdir(), \"novelfork-verify-\"))");
    expect(script).toContain("const runtimeDir = join(options.root, \"runtime\")");
    expect(script).toContain("NARRAFORK_HOME: runtimeDir");
    expect(script).toContain("NOVELFORK_STORAGE_DB_PATH: join(options.root, \"novelfork.db\")");
    expect(script).not.toContain("homedir()");
    expect(script).not.toContain(".novelfork\"");
  });

  test("默认不弹窗且默认清理临时数据", () => {
    expect(script).toContain('NOVELFORK_NO_BROWSER: "1"');
    expect(script).toContain("rmSync(options.root, { recursive: true, force: true })");
  });

  test("默认端口避开用户实例与开发 Runtime 端口", () => {
    // 4567 is the product default and 7778 the dev Runtime port; colliding with
    // either can attach verification traffic to the developer's own instance.
    // The generated range 41000-44999 excludes both by construction.
    expect(script).toContain("41000 + Math.floor(Math.random() * 4000)");
    expect(script).not.toMatch(/PORT: "(4567|7778)"/);
    expect(script).not.toMatch(/port = (4567|7778)\b/);
  });

  test("CLAUDE.md 把隔离验证固化为约定并说明部分覆盖不构成隔离", () => {
    expect(claudeMd).toContain("scripts/start-isolated-verify.ts");
    expect(claudeMd).toContain("只设 `NOVELFORK_PROJECT_ROOT` **不构成隔离**");
    expect(claudeMd).toContain("取得明确授权后");
  });
});
