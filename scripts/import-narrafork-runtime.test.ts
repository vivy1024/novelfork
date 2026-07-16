import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  analyzeNarraForkRuntimeImpact,
  importNarraForkRuntime,
  parseCliArgs,
  type UpstreamLock,
} from "./import-narrafork-runtime.ts";

interface Fixture {
  readonly root: string;
  readonly outer: string;
  readonly source: string;
  readonly target: string;
}

let fixture: Fixture;

async function command(args: readonly string[], cwd: string): Promise<string> {
  const process = Bun.spawn(args, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: globalThis.process.env });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${args.join(" ")} failed: ${stderr || stdout}`);
  return stdout.trim();
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "novelfork-import-test-"));
  const outer = join(root, "novelfork");
  const source = join(root, "upstream");
  const target = join(outer, "packages", "narrafork-runtime-private");
  await mkdir(join(outer, "packages"), { recursive: true });
  await mkdir(source, { recursive: true });

  await command(["git", "init"], outer);
  await command(["git", "config", "user.name", "Outer Test"], outer);
  await command(["git", "config", "user.email", "outer@example.test"], outer);
  await writeFile(
    join(outer, ".gitignore"),
    "/packages/narrafork-runtime-private/\n/packages/.narrafork-runtime-import/\n",
  );
  await command(["git", "add", ".gitignore"], outer);
  await command(["git", "commit", "-m", "ignore private import paths"], outer);

  await command(["git", "init"], source);
  await command(["git", "config", "user.name", "Importer Test"], source);
  await command(["git", "config", "user.email", "importer@example.test"], source);
  await command(["git", "config", "core.autocrlf", "true"], source);
  await command(["git", "remote", "add", "origin", "git@github.com:example/private-runtime.git"], source);
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "package.json"), '{"name":"private-runtime","version":"0.5.4"}\n');
  await writeFile(join(source, ".gitignore"), "node_modules/\n*.secret\n");
  await writeFile(join(source, "src", "tracked.ts"), "export const value = 1;\n");
  await command(["git", "add", ".gitignore", "package.json", "src/tracked.ts"], source);
  await command(["git", "commit", "-m", "fixture"], source);

  return { root, outer, source, target };
}

beforeEach(async () => {
  fixture = await createFixture();
});

afterEach(async () => {
  await rm(fixture.root, { recursive: true, force: true });
});

describe("importNarraForkRuntime", () => {
  test("拒绝非 Git source", async () => {
    const nonGit = join(fixture.root, "not-a-repo");
    await mkdir(nonGit);
    await expect(importNarraForkRuntime({
      source: nonGit,
      target: fixture.target,
      repositoryRoot: fixture.outer,
    })).rejects.toThrow(/Git|仓库/);
  });

  test("拒绝命中父仓库而自身不是 Git toplevel 的 source", async () => {
    const nested = join(fixture.source, "nested");
    await mkdir(nested);
    await expect(importNarraForkRuntime({
      source: nested,
      target: fixture.target,
      repositoryRoot: fixture.outer,
    })).rejects.toThrow(/自身不是 Git toplevel/);
  });

  test("拒绝脏 source", async () => {
    await writeFile(join(fixture.source, "src", "tracked.ts"), "dirty\n");
    await expect(importNarraForkRuntime({
      source: fixture.source,
      target: fixture.target,
      repositoryRoot: fixture.outer,
    })).rejects.toThrow(/clean Git checkout/);
  });

  test("只导出 tracked 文件并生成来源 lock", async () => {
    await mkdir(join(fixture.source, "node_modules"), { recursive: true });
    await writeFile(join(fixture.source, "node_modules", "ignored.js"), "secret\n");
    await writeFile(join(fixture.source, "local.secret"), "not tracked\n");

    const result = await importNarraForkRuntime({
      source: fixture.source,
      target: fixture.target,
      repositoryRoot: fixture.outer,
    });

    expect(result.dryRun).toBe(false);
    expect(await readFile(join(fixture.target, "src", "tracked.ts"), "utf8")).toBe("export const value = 1;\n");
    expect(await Bun.file(join(fixture.target, "node_modules", "ignored.js")).exists()).toBe(false);
    expect(await Bun.file(join(fixture.target, "local.secret")).exists()).toBe(false);

    const lock = JSON.parse(await readFile(join(fixture.target, "UPSTREAM.lock.json"), "utf8")) as UpstreamLock;
    expect(lock).toMatchObject({
      schemaVersion: 1,
      repository: "example/private-runtime",
      remote: "git@github.com:example/private-runtime.git",
      version: "0.5.4",
      trackedFileCount: 3,
      importMethod: "git-archive",
    });
    expect(lock.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(lock.tree).toMatch(/^[0-9a-f]{40}$/);
    expect(lock.branch.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(lock.importedAt))).toBe(false);

    const outerStatus = await command(["git", "status", "--porcelain", "--untracked-files=all"], fixture.outer);
    expect(outerStatus).toBe("");
    expect(await exists(join(fixture.outer, "packages", ".narrafork-runtime-import"))).toBe(false);
  });

  test("target 已存在且无 replace 时拒绝", async () => {
    await mkdir(fixture.target, { recursive: true });
    await writeFile(join(fixture.target, "keep.txt"), "old\n");
    await expect(importNarraForkRuntime({
      source: fixture.source,
      target: fixture.target,
      repositoryRoot: fixture.outer,
    })).rejects.toThrow(/target 已存在/);
    expect(await readFile(join(fixture.target, "keep.txt"), "utf8")).toBe("old\n");
  });

  test("replace 仅允许完整匹配 UPSTREAM.lock 的 target", async () => {
    await importNarraForkRuntime({
      source: fixture.source,
      target: fixture.target,
      repositoryRoot: fixture.outer,
    });
    await writeFile(join(fixture.source, "src", "tracked.ts"), "export const value = 2;\n");
    await command(["git", "add", "src/tracked.ts"], fixture.source);
    await command(["git", "commit", "-m", "upstream update"], fixture.source);

    const result = await importNarraForkRuntime({
      source: fixture.source,
      target: fixture.target,
      repositoryRoot: fixture.outer,
      replace: true,
    });

    expect(result.replaced).toBe(true);
    expect(await readFile(join(fixture.target, "src", "tracked.ts"), "utf8")).toContain("value = 2");
    expect(await Bun.file(join(fixture.target, "UPSTREAM.lock.json")).exists()).toBe(true);
    expect(await command(["git", "status", "--porcelain", "--untracked-files=all"], fixture.outer)).toBe("");
    expect(await exists(join(fixture.outer, "packages", ".narrafork-runtime-import"))).toBe(false);
  }, 20_000);

  test("replace 拒绝覆盖相对 UPSTREAM.lock 已修改的 Runtime", async () => {
    await importNarraForkRuntime({
      source: fixture.source,
      target: fixture.target,
      repositoryRoot: fixture.outer,
    });
    await writeFile(join(fixture.target, "src", "tracked.ts"), "local product patch\n");
    await writeFile(join(fixture.source, "src", "tracked.ts"), "export const value = 2;\n");
    await command(["git", "add", "src/tracked.ts"], fixture.source);
    await command(["git", "commit", "-m", "upstream update"], fixture.source);

    await expect(importNarraForkRuntime({
      source: fixture.source,
      target: fixture.target,
      repositoryRoot: fixture.outer,
      replace: true,
    })).rejects.toThrow(/已修改|拒绝覆盖/);
    expect(await readFile(join(fixture.target, "src", "tracked.ts"), "utf8")).toBe("local product patch\n");
  }, 20_000);

  test("report-only 输出 changed files、能力分类和本地修改且不写 target", async () => {
    await mkdir(join(fixture.source, ".narrafork"), { recursive: true });
    await writeFile(join(fixture.source, ".narrafork", "plan-upstream.md"), "upstream plan\n");
    await command(["git", "add", ".narrafork/plan-upstream.md"], fixture.source);
    await command(["git", "commit", "-m", "track upstream maintenance plan"], fixture.source);
    await importNarraForkRuntime({
      source: fixture.source,
      target: fixture.target,
      repositoryRoot: fixture.outer,
    });
    const lockBefore = await readFile(join(fixture.target, "UPSTREAM.lock.json"), "utf8");
    await writeFile(join(fixture.target, "src", "tracked.ts"), "local product patch\n");
    await writeFile(join(fixture.target, ".narrafork", "plan-upstream.md"), "local plan patch\n");
    await mkdir(join(fixture.target, "node_modules", "local-only"), { recursive: true });
    await mkdir(join(fixture.target, "server", "generated"), { recursive: true });
    await mkdir(join(fixture.target, ".runtime-e2e", "books"), { recursive: true });
    await writeFile(join(fixture.target, "node_modules", "local-only", "index.js"), "generated\n");
    await writeFile(join(fixture.target, "server", "generated", "embedded.ts"), "generated\n");
    await writeFile(join(fixture.target, ".runtime-e2e", "books", "book.json"), "{}\n");
    await writeFile(join(fixture.target, "local.db"), "generated\n");
    await mkdir(join(fixture.source, "server", "permission"), { recursive: true });
    await writeFile(join(fixture.source, "server", "permission", "gate.ts"), "export const gate = true;\n");
    await command(["git", "add", "server/permission/gate.ts"], fixture.source);
    await command(["git", "commit", "-m", "add permission gate"], fixture.source);

    const report = await analyzeNarraForkRuntimeImpact({
      source: fixture.source,
      target: fixture.target,
      repositoryRoot: fixture.outer,
      reportOnly: true,
    });

    expect(report.previousLock.commit).not.toBe(report.nextLock.commit);
    expect(report.changedFiles).toContainEqual(expect.objectContaining({
      status: "A",
      path: "server/permission/gate.ts",
      capability: "security-permissions",
    }));
    expect(report.capabilityFiles["security-permissions"]).toContain("server/permission/gate.ts");
    expect(report.targetModifications).toContainEqual(expect.objectContaining({ status: "M", path: "src/tracked.ts" }));
    expect(report.targetModifications).toContainEqual(expect.objectContaining({
      status: "M",
      path: ".narrafork/plan-upstream.md",
    }));
    expect(report.targetModifications.map((item) => item.path)).not.toContain("node_modules/local-only/index.js");
    expect(report.targetModifications.map((item) => item.path)).not.toContain("server/generated/embedded.ts");
    expect(report.targetModifications.map((item) => item.path)).not.toContain(".runtime-e2e/books/book.json");
    expect(report.targetModifications.map((item) => item.path)).not.toContain("local.db");
    expect(await readFile(join(fixture.target, "UPSTREAM.lock.json"), "utf8")).toBe(lockBefore);
    expect(await readFile(join(fixture.target, "src", "tracked.ts"), "utf8")).toBe("local product patch\n");
  }, 20_000);

  test("dry-run 验证 archive 但不写 target", async () => {
    const result = await importNarraForkRuntime({
      source: fixture.source,
      target: fixture.target,
      repositoryRoot: fixture.outer,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(await Bun.file(fixture.target).exists()).toBe(false);
  });
});

describe("parseCliArgs", () => {
  test("解析 source、target、dry-run 和 replace", () => {
    expect(parseCliArgs(["--source", "upstream", "--target", "private", "--dry-run", "--replace"])).toEqual({
      source: "upstream",
      target: "private",
      dryRun: true,
      replace: true,
    });
  });

  test("解析 report-only/impact-report 并拒绝覆盖型参数组合", () => {
    expect(parseCliArgs(["--source", "upstream", "--report-only"])).toEqual({
      source: "upstream",
      target: undefined,
      dryRun: false,
      replace: false,
      reportOnly: true,
    });
    expect(parseCliArgs(["--source", "upstream", "--impact-report"]).reportOnly).toBe(true);
    expect(() => parseCliArgs(["--source", "upstream", "--report-only", "--replace"])).toThrow(/不能与/);
  });
});
