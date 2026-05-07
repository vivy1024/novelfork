import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCompileSmokeSummary } from "./compile-smoke";

const COMPILED_RUNTIME = {
  runtime: "bun" as const,
  isProd: true,
  isCompiledBinary: true,
  metaUrl: "file:///B:/~BUN/root/novelfork.exe",
};

const SOURCE_PROD_RUNTIME = {
  runtime: "bun" as const,
  isProd: true,
  isCompiledBinary: false,
  metaUrl: "file:///D:/DESKTOP/novelfork/packages/studio/src/api/server.ts",
};

describe("buildCompileSmokeSummary", () => {
  let root: string;

  beforeEach(async () => {
    root = join(tmpdir(), `novelfork-compile-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(root, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("accepts the running compiled executable as the single-file artifact", async () => {
    const exePath = join(root, "novelfork-v0.1.0-windows-x64.exe");
    await writeFile(exePath, "binary", "utf-8");

    const summary = buildCompileSmokeSummary({
      root,
      indexHtmlReady: true,
      runtimeMode: { ...COMPILED_RUNTIME, exePath },
    });

    expect(summary).toEqual({
      status: "success",
      reason: "单文件产物与静态入口均可用",
      note: exePath,
    });
  });

  it("keeps production source startup failed when root dist artifacts are missing", () => {
    const summary = buildCompileSmokeSummary({
      root,
      indexHtmlReady: true,
      runtimeMode: { ...SOURCE_PROD_RUNTIME, exePath: join(root, "missing-bun.exe") },
    });

    expect(summary.status).toBe("failed");
    expect(summary.reason).toBe("单文件产物缺失");
    expect(summary.note).toContain(join(root, "dist", "novelfork.exe"));
  });
});
