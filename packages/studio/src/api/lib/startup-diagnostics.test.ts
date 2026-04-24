import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildProviderAvailabilityDiagnostics,
  buildWorktreePollutionDiagnostics,
  checkSessionStoreConsistency,
  prepareUncleanShutdownMarker,
} from "./startup-diagnostics";

let tempRoot = "";

async function makeTempRoot() {
  tempRoot = await mkdtemp(join(tmpdir(), "novelfork-startup-diagnostics-"));
  return tempRoot;
}

describe("startup diagnostics", () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = "";
    }
  });

  it("reports unclean shutdown when the running marker already exists and rewrites it for the current process", async () => {
    const root = await makeTempRoot();
    const markerPath = join(root, ".novelfork", "running.pid");
    await mkdir(join(root, ".novelfork"), { recursive: true });
    await writeFile(markerPath, JSON.stringify({ pid: 123, startedAt: "2026-04-24T00:00:00.000Z" }), "utf-8");

    const diagnostic = await prepareUncleanShutdownMarker(markerPath, {
      pid: 456,
      startedAt: "2026-04-24T01:00:00.000Z",
    });

    expect(diagnostic).toMatchObject({
      kind: "unclean-shutdown",
      status: "failed",
      reason: "检测到上次运行未干净退出",
    });
    await expect(readFile(markerPath, "utf-8")).resolves.toContain("456");
  });

  it("reports session-store inconsistencies between sessions.json and session-history files", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "session-history"), { recursive: true });
    await writeFile(join(root, "sessions.json"), JSON.stringify([{ id: "known" }]), "utf-8");
    await writeFile(join(root, "session-history", "known.json"), "[]", "utf-8");
    await writeFile(join(root, "session-history", "orphan.json"), "[]", "utf-8");

    await expect(checkSessionStoreConsistency(root)).resolves.toEqual(expect.objectContaining({
      kind: "session-store",
      status: "failed",
      reason: "会话存储存在孤儿历史文件",
      note: expect.stringContaining("orphan"),
    }));
  });

  it("reports external git worktrees as pollution diagnostics", () => {
    expect(buildWorktreePollutionDiagnostics("D:/DESKTOP/novelfork", [
      { path: "D:/DESKTOP/novelfork/.novelfork-worktrees/feature-a" },
      { path: "D:/DESKTOP/sub2api/inkos-master/packages/studio/.test-workspace/.inkos-worktrees/feature-test" },
    ])).toEqual(expect.objectContaining({
      kind: "git-worktree-pollution",
      status: "failed",
      reason: "检测到外部项目 worktree",
      note: expect.stringContaining("sub2api"),
    }));
  });

  it("summarizes provider availability without making network calls", () => {
    expect(buildProviderAvailabilityDiagnostics([
      { id: "openai", enabled: true, apiKeyConfigured: true },
      { id: "claude", enabled: true, apiKeyConfigured: false },
    ])).toEqual(expect.objectContaining({
      kind: "provider-availability",
      status: "skipped",
      reason: "部分启用供应商缺少 API Key",
      note: "configured=openai;missing=claude",
    }));
  });
});
