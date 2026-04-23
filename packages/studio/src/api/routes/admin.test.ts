import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createAdminRouter, resetAdminState } from "./admin";

describe("createAdminRouter", () => {
  let root: string;

  beforeEach(async () => {
    resetAdminState();
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

  it("returns startup recovery summary alongside resources when provider is available", async () => {
    const app = createAdminRouter(root, {
      getStartupSummary: () => ({
        delivery: {
          staticMode: "filesystem",
          indexHtmlReady: true,
          compileSmokeStatus: "success",
          compileCommand: "pnpm bun:compile",
          expectedArtifactPath: "dist/novelfork",
          embeddedAssetsReady: false,
          singleFileReady: false,
          excludedDeliveryScopes: ["installer", "signing", "auto-update", "first-launch UX"],
        },
        recoveryReport: {
          startedAt: "2026-04-20T09:59:00Z",
          finishedAt: "2026-04-20T10:00:00Z",
          durationMs: 1000,
          counts: { success: 4, skipped: 1, failed: 0 },
          actions: [],
        },
        failures: [],
      }),
    });

    const response = await app.request("http://localhost/resources");
    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.startup).toMatchObject({
      delivery: expect.objectContaining({
        staticMode: "filesystem",
        compileSmokeStatus: "success",
        compileCommand: "pnpm bun:compile",
        expectedArtifactPath: "dist/novelfork",
        embeddedAssetsReady: false,
        singleFileReady: false,
        excludedDeliveryScopes: ["installer", "signing", "auto-update", "first-launch UX"],
      }),
      recoveryReport: expect.objectContaining({
        counts: expect.objectContaining({ success: 4, failed: 0 }),
      }),
    });
  });

  it("fills missing delivery boundary fields when startup summaries come from older providers", async () => {
    const app = createAdminRouter(root, {
      getStartupSummary: () => ({
        delivery: {
          staticMode: "embedded",
          indexHtmlReady: true,
          compileSmokeStatus: "success",
        },
        recoveryReport: {
          startedAt: "2026-04-20T09:59:00Z",
          finishedAt: "2026-04-20T10:00:00Z",
          durationMs: 1000,
          counts: { success: 4, skipped: 0, failed: 0 },
          actions: [],
        },
        failures: [],
      }),
    });

    const response = await app.request("http://localhost/resources");
    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.startup.delivery).toMatchObject({
      compileCommand: "pnpm bun:compile",
      expectedArtifactPath: "dist/novelfork",
      embeddedAssetsReady: true,
      singleFileReady: true,
      excludedDeliveryScopes: ["installer", "signing", "auto-update", "first-launch UX"],
    });
  });

  it("derives startup failure decisions for repair, rebuild, and manual delivery follow-up", async () => {
    const app = createAdminRouter(root, {
      getStartupSummary: () => ({
        delivery: {
          staticMode: "missing",
          indexHtmlReady: false,
          compileSmokeStatus: "failed",
        },
        recoveryReport: {
          startedAt: "2026-04-20T09:59:00Z",
          finishedAt: "2026-04-20T10:00:00Z",
          durationMs: 1000,
          counts: { success: 1, skipped: 0, failed: 3 },
          actions: [],
        },
        failures: [
          { bookId: "demo-book", phase: "migration", message: "runtime repair failed" },
          { phase: "search-index", message: "search rebuild failed" },
          { phase: "compile-smoke", message: "index missing" },
        ],
      }),
    });

    const response = await app.request("http://localhost/resources");
    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.startup.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "migration",
          severity: "error",
          action: expect.objectContaining({
            kind: "repair-runtime-state",
            label: "修复该书运行态",
            endpoint: "/api/admin/resources/recovery/runtime-state",
            method: "POST",
            payload: { bookId: "demo-book" },
          }),
        }),
        expect.objectContaining({
          phase: "search-index",
          action: expect.objectContaining({
            kind: "rebuild-search-index",
            label: "重建搜索索引",
            endpoint: "/api/admin/resources/recovery/search-index",
          }),
        }),
        expect.objectContaining({
          phase: "compile-smoke",
          action: expect.objectContaining({
            kind: "manual-check",
            label: "手动执行 pnpm bun:compile",
          }),
        }),
      ]),
    );
  });

  it("reruns startup recovery and returns a refreshed summary instead of the stale snapshot", async () => {
    const staleSummary = {
      delivery: {
        staticMode: "filesystem",
        indexHtmlReady: true,
        compileSmokeStatus: "success",
      },
      recoveryReport: {
        startedAt: "2026-04-20T10:00:00Z",
        finishedAt: "2026-04-20T10:00:01Z",
        durationMs: 1000,
        counts: { success: 1, skipped: 0, failed: 1 },
        actions: [],
      },
      failures: [{ phase: "search-index", message: "stale failure" }],
    };
    const refreshedSummary = {
      delivery: {
        staticMode: "embedded",
        indexHtmlReady: true,
        compileSmokeStatus: "success",
      },
      recoveryReport: {
        startedAt: "2026-04-20T10:10:00Z",
        finishedAt: "2026-04-20T10:10:01Z",
        durationMs: 1000,
        counts: { success: 4, skipped: 0, failed: 0 },
        actions: [],
      },
      failures: [],
    };
    const rerunStartupRecovery = vi.fn(async () => refreshedSummary);

    const app = createAdminRouter(root, {
      getStartupSummary: () => staleSummary as never,
      rerunStartupRecovery,
    } as never);

    const response = await app.request("http://localhost/resources/recovery", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(rerunStartupRecovery).toHaveBeenCalledTimes(1);

    const payload = await response.json();
    expect(payload.recoveryTriggered).toBe(true);
    expect(payload.startup).toMatchObject({
      delivery: expect.objectContaining({ staticMode: "embedded" }),
      recoveryReport: expect.objectContaining({
        startedAt: "2026-04-20T10:10:00Z",
        counts: expect.objectContaining({ failed: 0, success: 4 }),
      }),
      failures: [],
    });
    expect(payload.startup.recoveryReport.startedAt).not.toBe(staleSummary.recoveryReport.startedAt);
  });

  it("executes the runtime-state repair endpoint and returns a refreshed startup summary", async () => {
    const repairRuntimeState = vi.fn(async (bookId: string) => ({
      delivery: {
        staticMode: "filesystem",
        indexHtmlReady: true,
        compileSmokeStatus: "success",
      },
      recoveryReport: {
        startedAt: "2026-04-20T10:10:00Z",
        finishedAt: "2026-04-20T10:10:01Z",
        durationMs: 1000,
        counts: { success: 3, skipped: 0, failed: 0 },
        actions: [],
      },
      failures: [],
      repairedBookId: bookId,
    }));

    const app = createAdminRouter(root, {
      getStartupSummary: () => null,
      repairRuntimeState,
    } as never);

    const response = await app.request("http://localhost/resources/recovery/runtime-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: "demo-book" }),
    });

    expect(response.status).toBe(200);
    expect(repairRuntimeState).toHaveBeenCalledWith("demo-book");

    const payload = await response.json();
    expect(payload.repairTriggered).toBe(true);
    expect(payload.startup).toMatchObject({
      delivery: expect.objectContaining({ staticMode: "filesystem" }),
      recoveryReport: expect.objectContaining({ counts: expect.objectContaining({ failed: 0 }) }),
    });
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
});
