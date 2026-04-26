import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createAdminRouter, resetAdminState, setupAdminWebSocket } from "./admin";
import { logRequest } from "../lib/request-observability";

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
        healthChecks: [
          {
            id: "static-delivery",
            category: "delivery",
            phase: "static-delivery",
            title: "静态资源模式",
            summary: "当前使用 filesystem 静态资源启动。",
            status: "warning",
            source: "delivery",
          },
        ],
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
      healthChecks: expect.arrayContaining([
        expect.objectContaining({ id: "static-delivery", status: "warning" }),
      ]),
    });
    expect(payload.requestMeta).toMatchObject({
      narrator: "admin.resources",
      requestKind: "resource-monitor",
      cache: expect.objectContaining({ status: "miss", scope: "storage-scan" }),
    });
  });

  it("supports run-level drill-down filters across request and log endpoints", async () => {
    const app = createAdminRouter(root);

    await app.request("http://localhost/resources");
    await app.request("http://localhost/requests");

    const requestsResponse = await app.request("http://localhost/requests?runId=run-2");
    expect(requestsResponse.status).toBe(200);
    const requestsPayload = await requestsResponse.json();
    expect(requestsPayload).toMatchObject({
      filters: expect.objectContaining({ runId: "run-2" }),
      requestMeta: expect.objectContaining({
        narrator: "admin.requests",
        requestKind: "request-audit",
      }),
    });

    const logsResponse = await app.request("http://localhost/logs?limit=50&runId=run-2");
    expect(logsResponse.status).toBe(200);
    const logsPayload = await logsResponse.json();
    expect(logsPayload).toMatchObject({
      filters: expect.objectContaining({ runId: "run-2" }),
      requestMeta: expect.objectContaining({
        narrator: "admin.logs",
        requestKind: "runtime-log",
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
    expect(payload.startup.healthChecks).toEqual([]);
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
          counts: { success: 1, skipped: 0, failed: 5 },
          actions: [],
        },
        failures: [
          { bookId: "demo-book", phase: "migration", message: "runtime repair failed" },
          { phase: "search-index", message: "search rebuild failed" },
          { phase: "session-store", message: "orphan=demo-session" },
          { phase: "git-worktree-pollution", message: "D:/DESKTOP/sub2api/worktrees/demo" },
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
          phase: "session-store",
          action: expect.objectContaining({
            kind: "cleanup-session-history",
            label: "清理孤儿会话历史",
            endpoint: "/api/admin/resources/recovery/session-store",
          }),
        }),
        expect.objectContaining({
          phase: "git-worktree-pollution",
          action: expect.objectContaining({
            kind: "ignore-external-worktrees",
            label: "忽略当前外部 worktree",
            endpoint: "/api/admin/resources/recovery/worktree-pollution",
          }),
        }),
        expect.objectContaining({
          phase: "compile-smoke",
          action: expect.objectContaining({
            kind: "manual-check",
            label: "手动执行 pnpm bun:compile",
            detail: expect.stringContaining("pnpm bun:compile"),
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
      healthChecks: [],
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
      healthChecks: [],
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

  it("executes session-store cleanup and worktree ignore recovery endpoints", async () => {
    const cleanupSessionStore = vi.fn(async () => ({
      delivery: {
        staticMode: "embedded",
        indexHtmlReady: true,
        compileSmokeStatus: "success",
      },
      recoveryReport: {
        startedAt: "2026-04-20T10:10:00Z",
        finishedAt: "2026-04-20T10:10:01Z",
        durationMs: 1000,
        counts: { success: 4, skipped: 1, failed: 0 },
        actions: [],
      },
      failures: [],
      healthChecks: [],
    }));
    const ignoreExternalWorktreePollution = vi.fn(async () => ({
      delivery: {
        staticMode: "embedded",
        indexHtmlReady: true,
        compileSmokeStatus: "success",
      },
      recoveryReport: {
        startedAt: "2026-04-20T10:20:00Z",
        finishedAt: "2026-04-20T10:20:01Z",
        durationMs: 1000,
        counts: { success: 4, skipped: 1, failed: 0 },
        actions: [],
      },
      failures: [],
      healthChecks: [],
    }));

    const app = createAdminRouter(root, {
      getStartupSummary: () => null,
      cleanupSessionStore,
      ignoreExternalWorktreePollution,
    } as never);

    const cleanupResponse = await app.request("http://localhost/resources/recovery/session-store", { method: "POST" });
    expect(cleanupResponse.status).toBe(200);
    expect(cleanupSessionStore).toHaveBeenCalledTimes(1);
    await expect(cleanupResponse.json()).resolves.toMatchObject({ sessionStoreCleanupTriggered: true });

    const ignoreResponse = await app.request("http://localhost/resources/recovery/worktree-pollution", { method: "POST" });
    expect(ignoreResponse.status).toBe(200);
    expect(ignoreExternalWorktreePollution).toHaveBeenCalledTimes(1);
    await expect(ignoreResponse.json()).resolves.toMatchObject({ worktreeIgnoreTriggered: true });
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

  it("reads persisted AI request history from novelfork.log", async () => {
    const app = createAdminRouter(root);
    await writeFile(
      join(root, "novelfork.log"),
      `${JSON.stringify({
        timestamp: "2026-04-20T10:04:00Z",
        level: "info",
        tag: "studio",
        message: "AI request completed (inline-complete)",
        ctx: {
          eventType: "ai.request",
          requestDomain: "ai",
          endpoint: "/api/ai/complete",
          method: "POST",
          requestKind: "inline-complete",
          narrator: "studio.ai.complete",
          provider: "openai",
          model: "gpt-4-turbo",
          bookId: "demo-book",
          sessionId: "session-42",
          durationMs: 321,
          ttftMs: 88,
          status: "success",
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          tokenSource: "actual",
        },
      })}\n`,
      "utf-8",
    );

    const response = await app.request("http://localhost/requests?scope=ai&provider=openai&sessionId=session-42");
    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.total).toBe(1);
    expect(payload.logs[0]).toMatchObject({
      endpoint: "/api/ai/complete",
      provider: "openai",
      model: "gpt-4-turbo",
      bookId: "demo-book",
      sessionId: "session-42",
      ttftMs: 88,
      tokens: {
        input: 100,
        output: 50,
        total: 150,
      },
    });
  });

  it("filters AI request history by provider, book and session", async () => {
    logRequest({
      timestamp: new Date("2026-04-20T10:00:00Z"),
      method: "POST",
      endpoint: "/api/ai/complete",
      status: 200,
      duration: 321,
      userId: "system",
      requestKind: "inline-complete",
      narrator: "studio.ai.complete",
      provider: "openai",
      model: "gpt-4-turbo",
      tokens: { input: 100, output: 50, total: 150, source: "actual" },
      ttftMs: 88,
      requestDomain: "ai",
      aiStatus: "success",
      bookId: "demo-book",
      sessionId: "session-42",
    });
    logRequest({
      timestamp: new Date("2026-04-20T10:01:00Z"),
      method: "GET",
      endpoint: "/resources",
      status: 200,
      duration: 120,
      userId: "admin",
      requestDomain: "admin",
      narrator: "admin.resources",
    });

    const app = createAdminRouter(root);
    const response = await app.request("http://localhost/requests?scope=ai&provider=openai&bookId=demo-book&sessionId=session-42");
    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.total).toBe(1);
    expect(payload.logs[0]).toMatchObject({
      provider: "openai",
      model: "gpt-4-turbo",
      bookId: "demo-book",
      sessionId: "session-42",
      aiStatus: "success",
    });
  });

  it("returns admin log snapshots with parsed metadata from novelfork.log", async () => {
    const app = createAdminRouter(root);
    await writeFile(
      join(root, "novelfork.log"),
      [
        JSON.stringify({
          timestamp: "2026-04-20T10:04:00Z",
          level: "info",
          tag: "studio",
          narrator: "session.alpha",
          requestKind: "tool-call",
          provider: "sub2api",
          model: "claude-sonnet-4.6",
          runId: "run-42",
          message: "tool finished",
        }),
        "plain text log line",
      ].join("\n"),
      "utf-8",
    );

    const response = await app.request("http://localhost/logs?limit=50");
    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload).toMatchObject({
      exists: true,
      limit: 50,
      totalEntries: 2,
    });
    expect(payload.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          tag: "studio",
          narrator: "session.alpha",
          requestKind: "tool-call",
          provider: "sub2api",
          model: "claude-sonnet-4.6",
          runId: "run-42",
          message: "tool finished",
          source: "json",
        }),
        expect.objectContaining({
          message: "plain text log line",
          source: "text",
        }),
      ]),
    );
    expect(payload.sourcePath).toContain("novelfork.log");
    expect(typeof payload.refreshedAt).toBe("string");
    expect(typeof payload.updatedAt).toBe("string");
  });

  it("registers the resource websocket route on bun-compatible servers", () => {
    const registerWebSocketRoute = vi.fn();

    setupAdminWebSocket({
      runtime: "bun",
      registerWebSocketRoute,
    });

    expect(registerWebSocketRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/admin/resources/ws",
        upgrade: expect.any(Function),
        open: expect.any(Function),
        close: expect.any(Function),
      }),
    );
  });
});
