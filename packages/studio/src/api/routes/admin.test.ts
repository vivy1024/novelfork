import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const getDaemonAdminSnapshotMock = vi.fn();
const startDaemonMock = vi.fn();
const stopDaemonMock = vi.fn();
const listWorktreesMock = vi.fn();
const getWorktreeStatusMock = vi.fn();

vi.mock("./daemon.js", () => ({
  getDaemonAdminSnapshot: (...args: unknown[]) => getDaemonAdminSnapshotMock(...args),
  startDaemon: (...args: unknown[]) => startDaemonMock(...args),
  stopDaemon: (...args: unknown[]) => stopDaemonMock(...args),
}));

vi.mock("../lib/git-utils.js", () => ({
  listWorktrees: (...args: unknown[]) => listWorktreesMock(...args),
  getWorktreeStatus: (...args: unknown[]) => getWorktreeStatusMock(...args),
}));

import { createAdminRouter, resetAdminState } from "./admin";

describe("createAdminRouter", () => {
  let root: string;

  beforeEach(async () => {
    resetAdminState();
    getDaemonAdminSnapshotMock.mockReset();
    startDaemonMock.mockReset();
    stopDaemonMock.mockReset();
    listWorktreesMock.mockReset();
    getWorktreeStatusMock.mockReset();

    root = await mkdtemp(join(tmpdir(), "novelfork-admin-route-"));
    await mkdir(join(root, "books", "demo-book"), { recursive: true });
    await mkdir(join(root, "assets"), { recursive: true });
    await mkdir(join(root, "packages", "studio"), { recursive: true });
    await writeFile(join(root, "books", "demo-book", "chapter-1.md"), "# 第一章\n", "utf-8");
    await writeFile(join(root, "assets", "cover.png"), "png", "utf-8");
    await writeFile(join(root, "packages", "studio", "index.ts"), "export const ok = true;\n", "utf-8");
  });

  afterEach(async () => {
    resetAdminState();
    await rm(root, { recursive: true, force: true });
  });

  it("returns real storage scan structure and reuses cached snapshots until forced refresh", async () => {
    const app = createAdminRouter(root);

    const firstResponse = await app.request("http://localhost/resources");
    expect(firstResponse.status).toBe(200);
    const firstPayload = await firstResponse.json();

    expect(firstPayload.storage.mode).toBe("fresh");
    expect(firstPayload.storage.summary.existingTargets).toBeGreaterThanOrEqual(3);
    expect(firstPayload.storage.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "books", status: "ready" }),
        expect.objectContaining({ id: "assets", status: "ready" }),
        expect.objectContaining({ id: "packages", status: "ready" }),
      ]),
    );

    const secondResponse = await app.request("http://localhost/resources");
    expect(secondResponse.status).toBe(200);
    const secondPayload = await secondResponse.json();

    expect(secondPayload.storage.mode).toBe("cached");
    expect(secondPayload.storage.summary.totalBytes).toBe(firstPayload.storage.summary.totalBytes);

    const refreshedResponse = await app.request("http://localhost/resources?refresh=1");
    expect(refreshedResponse.status).toBe(200);
    const refreshedPayload = await refreshedResponse.json();

    expect(refreshedPayload.storage.mode).toBe("fresh");
    expect(refreshedPayload.storage.scanDurationMs).toBeGreaterThan(0);
  });

  it("records admin request history with cache metadata and narrator buckets", async () => {
    const app = createAdminRouter(root);

    await app.request("http://localhost/resources");
    await app.request("http://localhost/resources");
    await app.request("http://localhost/resources?refresh=1");

    const requestsResponse = await app.request("http://localhost/requests?limit=10");
    expect(requestsResponse.status).toBe(200);
    const payload = await requestsResponse.json();

    expect(payload.total).toBe(3);
    expect(payload.summary.cacheHitRate).toBe(50);
    expect(payload.summary.topNarrators).toEqual(expect.arrayContaining([expect.objectContaining({ label: "admin.resources" })]));
    expect(payload.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ endpoint: "/resources", cache: expect.objectContaining({ status: "hit" }) }),
        expect.objectContaining({ endpoint: "/resources", cache: expect.objectContaining({ status: "miss" }) }),
        expect.objectContaining({ endpoint: "/resources", cache: expect.objectContaining({ status: "bypass" }) }),
      ]),
    );
  });

  it("returns daemon snapshots through the admin route and proxies start/stop actions", async () => {
    getDaemonAdminSnapshotMock.mockResolvedValue({
      running: false,
      refreshedAt: "2026-04-20T10:05:00Z",
      refreshHintMs: 15000,
      schedule: { radarCron: "0 */6 * * *", writeCron: "*/15 * * * *" },
      limits: {
        maxConcurrentBooks: 3,
        chaptersPerCycle: null,
        retryDelayMs: null,
        cooldownAfterChapterMs: null,
        maxChaptersPerDay: null,
      },
      recentEvents: [],
      capabilities: { start: true, stop: false, terminal: false, container: false },
    });

    const runtime = {
      root,
      broadcast: vi.fn(),
      buildPipelineConfig: vi.fn(),
      getSessionLlm: vi.fn(),
      runStore: {},
      state: {},
    } as never;
    const app = createAdminRouter(root, runtime);

    const snapshotResponse = await app.request("http://localhost/daemon");
    expect(snapshotResponse.status).toBe(200);
    const snapshot = await snapshotResponse.json();
    expect(snapshot.running).toBe(false);
    expect(snapshot.schedule.writeCron).toBe("*/15 * * * *");

    const startResponse = await app.request("http://localhost/daemon/start", { method: "POST" });
    expect(startResponse.status).toBe(200);
    expect(startDaemonMock).toHaveBeenCalledWith(runtime);

    const stopResponse = await app.request("http://localhost/daemon/stop", { method: "POST" });
    expect(stopResponse.status).toBe(200);
    expect(stopDaemonMock).toHaveBeenCalledWith(runtime);
  });

  it("reads real log tail snapshots from inkos.log without fake filler", async () => {
    await writeFile(
      join(root, "inkos.log"),
      [
        JSON.stringify({ timestamp: "2026-04-20T10:00:00Z", level: "info", tag: "studio", message: "server booted" }),
        "plain line",
        JSON.stringify({ timestamp: "2026-04-20T10:01:00Z", level: "error", message: "daemon failed" }),
      ].join("\n"),
      "utf-8",
    );

    const app = createAdminRouter(root);
    const response = await app.request("http://localhost/logs?limit=2");
    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.exists).toBe(true);
    expect(payload.totalEntries).toBe(3);
    expect(payload.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "daemon failed", source: "json" }),
        expect.objectContaining({ message: "plain line", source: "text" }),
      ]),
    );
  });

  it("returns worktree summary from real git utils structure", async () => {
    listWorktreesMock.mockResolvedValue([
      {
        path: root,
        branch: "refs/heads/main",
        head: "1234567890abcdef",
        bare: false,
      },
      {
        path: join(root, ".novelfork-worktrees", "feature-a"),
        branch: "refs/heads/feature-a",
        head: "abcdef1234567890",
        bare: false,
      },
    ]);
    getWorktreeStatusMock.mockResolvedValueOnce({ modified: [], added: [], deleted: [], untracked: [], hasChanges: false });
    getWorktreeStatusMock.mockResolvedValueOnce({ modified: ["a.ts"], added: [], deleted: [], untracked: ["b.ts"], hasChanges: true });

    const app = createAdminRouter(root);
    const response = await app.request("http://localhost/worktrees");
    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.status).toBe("ready");
    expect(payload.summary).toEqual({ total: 2, dirty: 1, clean: 1, bare: 0 });
    expect(payload.worktrees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ branch: "main", isPrimary: true, dirty: false }),
        expect.objectContaining({ branch: "feature-a", dirty: true, changeCount: 2 }),
      ]),
    );
  });
});
