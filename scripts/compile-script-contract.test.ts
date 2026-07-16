import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as {
  version: string;
  scripts: Record<string, string>;
};
const rootMain = readFileSync(join(repositoryRoot, "main.ts"), "utf8");
const buildScript = readFileSync(
  join(repositoryRoot, "packages", "narrafork-runtime-private", "scripts", "build-cross-platform.ts"),
  "utf8",
);

describe("根 Host 编译契约", () => {
  test("根入口直接加载完整 NarraFork Runtime 后端", () => {
    const runtimeImport = 'await import("./packages/narrafork-runtime-private/server/index.ts")';
    expect(rootMain).toContain(runtimeImport);
    expect(rootMain).not.toContain("runtime-core-private");
    expect(rootMain).not.toContain("legacy-runtime-loader");
    expect(existsSync(join(repositoryRoot, "packages", "runtime-core-private"))).toBe(false);
    expect(rootMain).toContain("NOVELFORK_PROJECT_ROOT");
    expect(rootMain).toContain("NOVELFORK_BOOKS_ROOT");
    expect(rootMain).toContain('resolve(homedir(), ".novelfork")');
    expect(rootMain).toContain("NOVELFORK_RUNTIME_DIR");
    expect(rootMain).toContain("NARRAFORK_HOME");
    expect(rootMain).toContain("NOVELFORK_SESSION_STORE_DIR");
    expect(rootMain).toContain("NOVELFORK_STORAGE_DB_PATH");
    expect(rootMain).toContain('resolve(novelForkHome, "novelfork.db")');
    expect(rootMain).toContain('process.env.PORT ??= "4567"');
    expect(rootMain.indexOf("NOVELFORK_STORAGE_DB_PATH")).toBeLessThan(rootMain.indexOf(runtimeImport));
    expect(rootMain.indexOf("NARRAFORK_HOME")).toBeLessThan(rootMain.indexOf(runtimeImport));
  });

  test("compile 指向根 main.ts 并将产物写入根 dist", () => {
    expect(packageJson.version).toBe("3.2.0");
    expect(packageJson.scripts.compile).toContain("--entry=../../main.ts");
    expect(packageJson.scripts.compile).toContain("--dist=../../dist");
    expect(packageJson.scripts.compile).not.toContain("server/index.ts");
    expect(packageJson.scripts["bun:compile"]).toBe("bun run compile");
  });

  test("跨平台脚本支持可选 entry/dist 且默认仍使用 Runtime 路径", () => {
    expect(buildScript).toContain('const entryArg = args.find((a) => a.startsWith("--entry="))');
    expect(buildScript).toContain('const distArg = args.find((a) => a.startsWith("--dist="))');
    expect(buildScript).toContain('join(ROOT, "server", "index.ts")');
    expect(buildScript).toContain('join(ROOT, "dist")');
    expect(buildScript).toContain("entry,");
    expect(buildScript).toContain("const DIST_DIR = distArg");
  });
});
