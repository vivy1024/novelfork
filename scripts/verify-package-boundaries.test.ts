import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkPackageBoundaries } from "./verify-package-boundaries.ts";

const roots: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novelfork-boundary-test-"));
  roots.push(root);
  await mkdir(join(root, "packages", "core", "src"), { recursive: true });
  await mkdir(join(root, "packages", "core", "dist"), { recursive: true });
  await mkdir(join(root, "packages", "novel-plugin", "src"), { recursive: true });
  await writeFile(join(root, "packages", "core", "src", "index.ts"), "export const publicContract = true;\n");
  await writeFile(join(root, "packages", "core", "dist", "index.js"), "export const publicContract = true;\n");
  await writeFile(join(root, "packages", "novel-plugin", "src", "index.ts"), "export const plugin = true;\n");
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("checkPackageBoundaries", () => {
  test("接受只包含公开契约的 core 源码和 packlist", async () => {
    const root = await fixture();
    expect(await checkPackageBoundaries({ repoRoot: root, corePacklistFiles: ["dist/index.js"] })).toEqual([]);
  });

  test("拒绝 core 导入 novel-plugin 和 private Runtime", async () => {
    const root = await fixture();
    await writeFile(
      join(root, "packages", "core", "src", "index.ts"),
      [
        'export * from "@vivy1024/novelfork-novel-plugin";',
        'export * from "@vivy1024/novelfork-runtime-private/server";',
      ].join("\n"),
    );
    const violations = await checkPackageBoundaries({ repoRoot: root, corePacklistFiles: ["dist/index.js"] });
    expect(violations.some((item) => item.specifier.includes("novel-plugin"))).toBe(true);
    expect(violations.some((item) => item.specifier.includes("runtime-private"))).toBe(true);
  });

  test("拒绝 vendored Runtime 导入 NovelFork 产品包或保留产品依赖", async () => {
    const root = await fixture();
    await mkdir(join(root, "packages", "narrafork-runtime-private", "server"), { recursive: true });
    await writeFile(
      join(root, "packages", "narrafork-runtime-private", "server", "index.ts"),
      'import { createStorageDatabase } from "@vivy1024/novelfork-core";\n',
    );
    await writeFile(
      join(root, "packages", "narrafork-runtime-private", "package.json"),
      JSON.stringify({
        name: "@test/runtime-private",
        dependencies: { "@vivy1024/narrafork-runtime-bridge": "workspace:*" },
      }),
    );

    const violations = await checkPackageBoundaries({ repoRoot: root, corePacklistFiles: ["dist/index.js"] });
    expect(violations).toContainEqual(expect.objectContaining({
      ruleName: "runtime-no-novelfork-product-imports",
      specifier: "@vivy1024/novelfork-core",
    }));
    expect(violations).toContainEqual(expect.objectContaining({
      ruleName: "runtime-no-novelfork-product-dependencies",
      specifier: "@vivy1024/narrafork-runtime-bridge",
    }));
  });

  test("拒绝产品包绕过 Runtime bridge 进行深层导入", async () => {
    const root = await fixture();
    await mkdir(join(root, "packages", "novelfork-product-runtime", "src"), { recursive: true });
    await writeFile(
      join(root, "packages", "novelfork-product-runtime", "src", "adapter.ts"),
      'import { db } from "@server/db";\nexport { db };\n',
    );

    const violations = await checkPackageBoundaries({ repoRoot: root, corePacklistFiles: ["dist/index.js"] });
    expect(violations).toContainEqual(expect.objectContaining({
      ruleName: "product-runtime-no-private-runtime-deep-imports",
      specifier: "@server/db",
    }));
  });

  test("拒绝 Runtime schema、可执行 migration 和旧迁移入口保留产品持久化", async () => {
    const root = await fixture();
    await mkdir(join(root, "packages", "narrafork-runtime-private", "server", "db"), { recursive: true });
    await mkdir(join(root, "packages", "narrafork-runtime-private", "server", "scripts"), { recursive: true });
    await mkdir(join(root, "packages", "narrafork-runtime-private", "drizzle"), { recursive: true });
    await writeFile(
      join(root, "packages", "narrafork-runtime-private", "server", "db", "schema.ts"),
      "export const bookRuntimeBindings = true;\n",
    );
    await writeFile(
      join(root, "packages", "narrafork-runtime-private", "drizzle", "0000.sql"),
      "CREATE TABLE book_provision_operations (id text);\n",
    );
    await writeFile(
      join(root, "packages", "narrafork-runtime-private", "server", "scripts", "migrate-legacy-sessions.ts"),
      "export {};\n",
    );

    const violations = await checkPackageBoundaries({ repoRoot: root, corePacklistFiles: ["dist/index.js"] });
    expect(violations.some((item) => item.ruleName === "runtime-no-novelfork-product-persistence" && item.specifier === "bookRuntimeBindings")).toBe(true);
    expect(violations.some((item) => item.ruleName === "runtime-no-novelfork-product-persistence" && item.specifier === "book_provision_operations")).toBe(true);
    expect(violations.some((item) => item.ruleName === "runtime-no-novelfork-product-persistence" && item.specifier === "migrate-legacy-sessions.ts")).toBe(true);
  });

  test("拒绝 runtime-contracts 源码和公开产物混入 Bun、SQLite、PTY 实现", async () => {
    const root = await fixture();
    await mkdir(join(root, "packages", "core", "src", "runtime-contracts"), { recursive: true });
    await mkdir(join(root, "packages", "core", "dist", "runtime-contracts"), { recursive: true });
    await writeFile(join(root, "packages", "core", "src", "runtime-contracts", "bun.ts"), 'const db = require("bun:sqlite");\n');
    await writeFile(
      join(root, "packages", "core", "dist", "runtime-contracts", "index.js"),
      'import pty from "node-pty";\nconst server = Bun.serve({});\n',
    );
    const violations = await checkPackageBoundaries({ repoRoot: root, corePacklistFiles: ["dist/runtime-contracts/index.js"] });
    expect(violations.some((item) => item.file.endsWith("runtime-contracts/bun.ts") && item.specifier.includes("bun:sqlite"))).toBe(true);
    expect(violations.some((item) => item.kind === "core packlist" && item.specifier.includes("node-pty"))).toBe(true);
    expect(violations.some((item) => item.kind === "core packlist" && item.specifier.includes("Bun."))).toBe(true);
  });

  test("允许 Core 既有的通用 SQLite 存储实现", async () => {
    const root = await fixture();
    await mkdir(join(root, "packages", "core", "src", "storage"), { recursive: true });
    await writeFile(join(root, "packages", "core", "src", "storage", "db.ts"), 'const db = require("bun:sqlite");\n');
    expect(await checkPackageBoundaries({ repoRoot: root, corePacklistFiles: ["dist/index.js"] })).toEqual([]);
  });

  test("拒绝 workspace 包循环依赖", async () => {
    const root = await fixture();
    await mkdir(join(root, "packages", "studio"), { recursive: true });
    await writeFile(join(root, "packages", "core", "package.json"), JSON.stringify({ name: "@test/core" }));
    await writeFile(join(root, "packages", "novel-plugin", "package.json"), JSON.stringify({
      name: "@test/novel-plugin",
      dependencies: { "@test/studio": "workspace:*" },
    }));
    await writeFile(join(root, "packages", "studio", "package.json"), JSON.stringify({
      name: "@test/studio",
      dependencies: { "@test/novel-plugin": "workspace:*" },
    }));

    const violations = await checkPackageBoundaries({ repoRoot: root, corePacklistFiles: ["dist/index.js"] });
    expect(violations).toContainEqual(expect.objectContaining({
      ruleName: "workspace-no-cyclic-package-dependencies",
      specifier: expect.stringContaining("@test/studio"),
    }));
  });
});
