import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("CI and release workflow contracts", () => {
  it("runs only Runtime-independent checks in public CI and keeps the release gate local", async () => {
    const ci = await readFile(join(process.cwd(), "..", "..", ".github", "workflows", "ci.yml"), "utf-8");

    // 推送 master 与 PR 自动触发。
    expect(ci).toContain("branches: [master]");
    expect(ci).toContain("pull_request:");

    // 公开边界：当前文件 + 本次带入的每个提交（需要完整历史）。
    expect(ci).toContain("fetch-depth: 0");
    expect(ci).toContain("node scripts/check-public-boundary.mjs");
    expect(ci).toContain('node scripts/check-public-boundary.mjs --range "$RANGE"');

    // 只跑不依赖私有 Runtime 的 core / novel-plugin。
    expect(ci).toContain("--filter @vivy1024/novelfork-core --filter @vivy1024/novelfork-novel-plugin run typecheck");
    expect(ci).toContain("--filter @vivy1024/novelfork-core --filter @vivy1024/novelfork-novel-plugin run test");
    for (const needsRuntime of ["novelfork-studio", "novelfork-product-runtime", "narrafork-runtime-bridge", "narrafork-runtime-private", "runtime:sync"]) {
      expect(ci).not.toContain(needsRuntime);
    }

    // 不在公开 CI 里构建或发布产品；发版门禁留在维护者本机。
    expect(ci).not.toContain("oven-sh/setup-bun");
    expect(ci).not.toMatch(/pnpm (run )?(build|compile)/);
    expect(ci).toContain("发版门禁仍在维护者本机完成");
  });

  it("keeps public release manual-only without pretending to publish artifacts", async () => {
    const release = await readFile(join(process.cwd(), "..", "..", ".github", "workflows", "release.yml"), "utf-8");

    expect(release).toContain("workflow_dispatch:");
    expect(release).toContain("noop:");
    expect(release).toContain("Public release workflow disabled");
    expect(release).toContain("Automatic GitHub Release is intentionally disabled.");
    expect(release).toContain("local compile + EXE verification");
    expect(release).not.toContain("oven-sh/setup-bun");
    expect(release).not.toContain("softprops/action-gh-release");
  });
});
