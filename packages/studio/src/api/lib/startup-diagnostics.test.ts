import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildProviderAvailabilityDiagnostics,
  buildWorktreePollutionDiagnostics,
  checkSessionStoreConsistency,
  cleanupOrphanSessionHistoryFiles,
  clearUncleanShutdownMarkerSync,
  ignoreExternalWorktreePollution,
  inspectSessionStoreConsistency,
  loadIgnoredExternalWorktreePaths,
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
      details: expect.objectContaining({ markerPath }),
    });
    await expect(readFile(markerPath, "utf-8")).resolves.toContain("456");
  });

  it("removes the running marker synchronously for signal cleanup", async () => {
    const root = await makeTempRoot();
    const markerPath = join(root, ".novelfork", "running.pid");
    await mkdir(join(root, ".novelfork"), { recursive: true });
    await writeFile(markerPath, JSON.stringify({ pid: 123, startedAt: "2026-04-24T00:00:00.000Z" }), "utf-8");

    clearUncleanShutdownMarkerSync(markerPath);

    expect(existsSync(markerPath)).toBe(false);
  });

  it("reports session-store inconsistencies between sessions.json and session-history files", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "session-history"), { recursive: true });
    await writeFile(join(root, "sessions.json"), JSON.stringify([{ id: "known" }]), "utf-8");
    await writeFile(join(root, "session-history", "known.json"), "[]", "utf-8");
    await writeFile(join(root, "session-history", "orphan.json"), "[]", "utf-8");

    await expect(checkSessionStoreConsistency(root)).resolves.toEqual(expect.objectContaining({
      kind: "session-store",
      status: "skipped",
      reason: "会话存储存在孤儿历史文件，已保留为可恢复记录",
      note: expect.stringContaining("orphan"),
      details: expect.objectContaining({ orphanHistoryIds: ["orphan"] }),
    }));
  });

  it("inspects and quarantines orphan session history files without deleting recovery data", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "session-history"), { recursive: true });
    await writeFile(join(root, "sessions.json"), JSON.stringify([{ id: "known" }, { id: "dangling" }]), "utf-8");
    await writeFile(join(root, "session-history", "known.json"), "[]", "utf-8");
    await writeFile(join(root, "session-history", "orphan.json"), "[]", "utf-8");

    const inspection = await inspectSessionStoreConsistency(root);
    expect(inspection).toMatchObject({
      orphanHistoryIds: ["orphan"],
      danglingSessionIds: ["dangling"],
    });

    const cleaned = await cleanupOrphanSessionHistoryFiles(root);
    expect(cleaned).toEqual({
      sessionStoreDir: root,
      quarantineDir: join(root, "session-history-orphans"),
      quarantinedHistoryIds: ["orphan"],
    });
    expect(existsSync(join(root, "session-history", "orphan.json"))).toBe(false);
    expect(existsSync(join(root, "session-history-orphans", "orphan.json"))).toBe(true);
    await expect(readFile(join(root, "session-history-orphans", "orphan.json"), "utf-8")).resolves.toBe("[]");
    expect(existsSync(join(root, "session-history", "known.json"))).toBe(true);
  });

  it("reports external git worktrees as pollution diagnostics", () => {
    expect(buildWorktreePollutionDiagnostics("D:/DESKTOP/novelfork", [
      { path: "D:/DESKTOP/novelfork/.novelfork-worktrees/feature-a" },
      { path: "D:/DESKTOP/sub2api/novelfork-legacy/packages/studio/.test-workspace/.novelfork-worktrees/feature-test" },
    ])).toEqual(expect.objectContaining({
      kind: "git-worktree-pollution",
      status: "failed",
      reason: "检测到外部项目 worktree",
      note: expect.stringContaining("sub2api"),
      details: expect.objectContaining({
        externalWorktrees: ["D:/DESKTOP/sub2api/novelfork-legacy/packages/studio/.test-workspace/.novelfork-worktrees/feature-test"],
      }),
    }));
  });

  it("treats parent repository worktrees as expected when the project root is a nested E2E workspace", () => {
    expect(buildWorktreePollutionDiagnostics("D:/DESKTOP/novelfork/.novelfork/e2e-workspace-flow-123", [
      { path: "D:/DESKTOP/novelfork" },
      { path: "D:/DESKTOP/novelfork/.worktrees/spec任务4-XvCRK-" },
    ])).toEqual(expect.objectContaining({
      kind: "git-worktree-pollution",
      status: "skipped",
      reason: "当前项目根位于父级 git worktree 内，外部 worktree 仅作为宿主仓库上下文记录",
      note: expect.stringContaining("D:/DESKTOP/novelfork"),
    }));
  });

  it("persists ignored external worktrees and downgrades them to skipped diagnostics", async () => {
    const root = await makeTempRoot();
    const internalWorktree = join(root, ".novelfork-worktrees", "feature-a").replace(/\\/g, "/");
    const worktrees = [
      { path: internalWorktree },
      { path: "D:/DESKTOP/sub2api/worktrees/feature-test" },
    ];

    const ignored = await ignoreExternalWorktreePollution(root, worktrees);
    expect(ignored).toEqual(["D:/DESKTOP/sub2api/worktrees/feature-test"]);
    await expect(loadIgnoredExternalWorktreePaths(root)).resolves.toEqual(["D:/DESKTOP/sub2api/worktrees/feature-test"]);

    expect(buildWorktreePollutionDiagnostics(root, worktrees, { ignoredPaths: ignored })).toEqual(expect.objectContaining({
      kind: "git-worktree-pollution",
      status: "skipped",
      reason: "检测到的外部项目 worktree 已标记忽略",
      note: "D:/DESKTOP/sub2api/worktrees/feature-test",
    }));
  });

  it("summarizes provider availability without making network calls", () => {
    expect(buildProviderAvailabilityDiagnostics([
      { id: "openai", enabled: true, apiKeyConfigured: true },
      { id: "claude", enabled: true, apiKeyConfigured: false },
      { id: "disabled-provider", enabled: false, apiKeyConfigured: false },
    ])).toEqual(expect.objectContaining({
      kind: "provider-availability",
      status: "skipped",
      reason: "部分启用供应商缺少 API Key",
      note: "configured=openai;missing=claude;disabled=disabled-provider",
      details: {
        configured: ["openai"],
        missing: ["claude"],
        disabled: ["disabled-provider"],
      },
    }));
  });

  it("reports provider configuration reminders separately from disabled or usable providers", () => {
    expect(buildProviderAvailabilityDiagnostics([])).toEqual(expect.objectContaining({
      kind: "provider-availability",
      status: "skipped",
      reason: "未配置启用供应商，AI 功能保持未启用",
      note: "configured=none;missing=none;disabled=none",
      details: {
        configured: [],
        missing: [],
        disabled: [],
      },
    }));

    expect(buildProviderAvailabilityDiagnostics([
      { id: "openai", enabled: false, apiKeyConfigured: false },
    ])).toEqual(expect.objectContaining({
      kind: "provider-availability",
      status: "skipped",
      reason: "所有供应商均已禁用，AI 功能保持未启用",
      note: "configured=none;missing=none;disabled=openai",
      details: {
        configured: [],
        missing: [],
        disabled: ["openai"],
      },
    }));

    expect(buildProviderAvailabilityDiagnostics([
      { id: "openai", enabled: true, apiKeyConfigured: true },
    ])).toEqual(expect.objectContaining({
      kind: "provider-availability",
      status: "success",
      reason: "至少一个启用供应商已配置 API Key",
      note: "configured=openai;missing=none;disabled=none",
      details: {
        configured: ["openai"],
        missing: [],
        disabled: [],
      },
    }));
  });
});
