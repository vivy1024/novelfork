import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.fn();

vi.mock("../../hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { ResourcesTab } from "./ResourcesTab";

describe("ResourcesTab", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders runtime resources and real storage scan results from the admin API", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      stats: {
        cpu: { usage: 18.2, cores: 8 },
        memory: { used: 8 * 1024 * 1024 * 1024, total: 16 * 1024 * 1024 * 1024, free: 8 * 1024 * 1024 * 1024, usagePercent: 50 },
        disk: { used: 32 * 1024 * 1024 * 1024, total: 128 * 1024 * 1024 * 1024, free: 96 * 1024 * 1024 * 1024, usagePercent: 25 },
        network: { sent: 1024, received: 2048 },
        sampledAt: "2026-04-20T10:00:00Z",
      },
      startup: {
        delivery: {
          staticMode: "filesystem",
          indexHtmlReady: true,
          compileSmokeStatus: "success",
        },
        recoveryReport: {
          startedAt: "2026-04-20T09:59:00Z",
          finishedAt: "2026-04-20T10:00:00Z",
          durationMs: 1000,
          counts: { success: 4, skipped: 1, failed: 0 },
          actions: [],
        },
        failures: [],
      },
      storage: {
        rootPath: "D:/DESKTOP/novelfork",
        scannedAt: "2026-04-20T10:05:00Z",
        scanDurationMs: 123,
        mode: "fresh",
        ageMs: 0,
        ttlMs: 30000,
        summary: {
          scannedTargets: 3,
          existingTargets: 3,
          totalBytes: 5 * 1024 * 1024 * 1024,
          fileCount: 120,
          directoryCount: 12,
          largestTargetId: "packages",
          largestTargetLabel: "工作台源码",
          largestTargetBytes: 3 * 1024 * 1024 * 1024,
        },
        targets: [
          {
            id: "packages",
            label: "工作台源码",
            relativePath: "packages",
            absolutePath: "D:/DESKTOP/novelfork/packages",
            status: "ready",
            totalBytes: 3 * 1024 * 1024 * 1024,
            fileCount: 80,
            directoryCount: 8,
            lastModifiedAt: "2026-04-20T10:04:00Z",
            largestChildren: [{ name: "studio", relativePath: "packages/studio", kind: "directory", totalBytes: 2 * 1024 * 1024 * 1024 }],
          },
          {
            id: "books",
            label: "书籍目录",
            relativePath: "books",
            absolutePath: "D:/DESKTOP/novelfork/books",
            status: "ready",
            totalBytes: 1 * 1024 * 1024 * 1024,
            fileCount: 20,
            directoryCount: 2,
            lastModifiedAt: "2026-04-20T10:03:00Z",
            largestChildren: [],
          },
          {
            id: "dist",
            label: "构建产物",
            relativePath: "dist",
            absolutePath: "D:/DESKTOP/novelfork/dist",
            status: "ready",
            totalBytes: 0,
            fileCount: 0,
            directoryCount: 0,
            lastModifiedAt: null,
            largestChildren: [],
          },
        ],
      },
    });

    render(<ResourcesTab />);

    expect(await screen.findByRole("heading", { name: "资源 / 存储面板" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "运行资源" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "存储扫描" })).toBeTruthy();
    expect(screen.getByText("接入状态")).toBeTruthy();
    expect(screen.getByText("启动恢复报告")).toBeTruthy();
    expect(screen.getByText("正式交付边界")).toBeTruthy();
    expect(screen.getByText(/pnpm bun:compile/)).toBeTruthy();
    expect(screen.getByText(/产物 dist\/novelfork/)).toBeTruthy();
    expect(screen.getByText(/单文件交付未就绪/)).toBeTruthy();
    expect(screen.getByText(/embedded 资源未就绪/)).toBeTruthy();
    expect(screen.getByText(/安装器 \/ 签名 \/ 自动更新 \/ 首启 UX 仍在边界外/)).toBeTruthy();
    expect(screen.getAllByText("已接入").length).toBeGreaterThanOrEqual(2);

    expect(screen.getByText("18.2%")).toBeTruthy();
    expect(screen.getByText("8 核心")).toBeTruthy();
    expect(screen.getByText("8.00 GB / 16.00 GB")).toBeTruthy();
    expect(screen.getByText("存储扫描工作台")).toBeTruthy();
    expect(screen.getAllByText("工作台源码").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("当前展示最新重扫结果")).toBeTruthy();
    expect(screen.getByText("5.00 GB")).toBeTruthy();
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/admin/resources");
  });

  it("marks the diagnostic summary as alerting when resources are stale or unhealthy", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      stats: {
        cpu: { usage: 92.5, cores: 8 },
        memory: { used: 15 * 1024 * 1024 * 1024, total: 16 * 1024 * 1024 * 1024, free: 1 * 1024 * 1024 * 1024, usagePercent: 93.8 },
        disk: { used: 118 * 1024 * 1024 * 1024, total: 128 * 1024 * 1024 * 1024, free: 10 * 1024 * 1024 * 1024, usagePercent: 92.2 },
        network: { sent: 4096, received: 1024 },
        sampledAt: "2026-04-20T10:10:00Z",
      },
      startup: {
        delivery: {
          staticMode: "missing",
          indexHtmlReady: false,
          compileSmokeStatus: "failed",
        },
        recoveryReport: {
          startedAt: "2026-04-20T09:59:00Z",
          finishedAt: "2026-04-20T10:00:00Z",
          durationMs: 1000,
          counts: { success: 1, skipped: 1, failed: 2 },
          actions: [],
        },
        failures: [{ phase: "compile-smoke", message: "index missing" }],
      },
      storage: {
        rootPath: "D:/DESKTOP/novelfork",
        scannedAt: "2026-04-20T10:00:00Z",
        scanDurationMs: 300,
        mode: "cached",
        ageMs: 45000,
        ttlMs: 30000,
        summary: {
          scannedTargets: 2,
          existingTargets: 1,
          totalBytes: 1024,
          fileCount: 2,
          directoryCount: 1,
          largestTargetId: "books",
          largestTargetLabel: "书籍目录",
          largestTargetBytes: 1024,
        },
        targets: [
          {
            id: "books",
            label: "书籍目录",
            relativePath: "books",
            absolutePath: "D:/DESKTOP/novelfork/books",
            status: "ready",
            totalBytes: 1024,
            fileCount: 2,
            directoryCount: 1,
            lastModifiedAt: "2026-04-20T10:09:00Z",
            largestChildren: [],
          },
          {
            id: "dist",
            label: "构建产物",
            relativePath: "dist",
            absolutePath: "D:/DESKTOP/novelfork/dist",
            status: "error",
            totalBytes: 0,
            fileCount: 0,
            directoryCount: 0,
            lastModifiedAt: null,
            largestChildren: [],
            error: "扫描失败",
          },
        ],
      },
    });

    render(<ResourcesTab />);

    expect(await screen.findByText("接入状态")).toBeTruthy();
    expect(screen.getByText("当前展示缓存快照")).toBeTruthy();
    expect(screen.getByText("扫描失败")).toBeTruthy();
    expect(screen.getByText(/当前已有 1 条启动失败记录/)).toBeTruthy();
    expect(screen.getByText(/默认 30 秒内读缓存/)).toBeTruthy();
    expect(screen.getAllByText("异常").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the storage scan section visible when runtime stats are empty", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      stats: null,
      storage: {
        rootPath: "D:/DESKTOP/novelfork",
        scannedAt: "2026-04-20T10:05:00Z",
        scanDurationMs: 80,
        mode: "cached",
        ageMs: 1200,
        ttlMs: 30000,
        summary: {
          scannedTargets: 2,
          existingTargets: 1,
          totalBytes: 1024,
          fileCount: 2,
          directoryCount: 1,
          largestTargetId: "books",
          largestTargetLabel: "书籍目录",
          largestTargetBytes: 1024,
        },
        targets: [
          {
            id: "books",
            label: "书籍目录",
            relativePath: "books",
            absolutePath: "D:/DESKTOP/novelfork/books",
            status: "ready",
            totalBytes: 1024,
            fileCount: 2,
            directoryCount: 1,
            lastModifiedAt: "2026-04-20T10:04:00Z",
            largestChildren: [],
          },
          {
            id: "dist",
            label: "构建产物",
            relativePath: "dist",
            absolutePath: "D:/DESKTOP/novelfork/dist",
            status: "missing",
            totalBytes: 0,
            fileCount: 0,
            directoryCount: 0,
            lastModifiedAt: null,
            largestChildren: [],
          },
        ],
      },
    });

    render(<ResourcesTab />);

    expect(await screen.findByText("暂无运行资源快照")).toBeTruthy();
    expect(screen.getByText("存储扫描工作台")).toBeTruthy();
    expect(screen.getByText("当前展示缓存快照")).toBeTruthy();
    expect(screen.getAllByText("书籍目录").length).toBeGreaterThanOrEqual(1);
  });

  it("shows runtime load errors without hiding the storage scan section", async () => {
    fetchJsonMock.mockRejectedValueOnce(new Error("资源接口暂不可用"));

    render(<ResourcesTab />);

    expect(await screen.findByText("运行资源快照加载失败")).toBeTruthy();
    expect(screen.getByText("资源接口暂不可用")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试加载" })).toBeTruthy();
    expect(screen.getByText("存储扫描工作台")).toBeTruthy();
  });

  it("forces a backend storage rescan when clicking the rescan button", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        stats: {
          cpu: { usage: 10, cores: 4 },
          memory: { used: 4 * 1024 * 1024 * 1024, total: 8 * 1024 * 1024 * 1024, free: 4 * 1024 * 1024 * 1024, usagePercent: 50 },
          disk: { used: 0, total: 0, free: 0, usagePercent: 0 },
          network: { sent: 0, received: 0 },
          sampledAt: "2026-04-20T10:00:00Z",
        },
        storage: {
          rootPath: "D:/DESKTOP/novelfork",
          scannedAt: "2026-04-20T10:05:00Z",
          scanDurationMs: 80,
          mode: "cached",
          ageMs: 1200,
          ttlMs: 30000,
          summary: {
            scannedTargets: 1,
            existingTargets: 1,
            totalBytes: 1024,
            fileCount: 2,
            directoryCount: 1,
            largestTargetId: "books",
            largestTargetLabel: "书籍目录",
            largestTargetBytes: 1024,
          },
          targets: [
            {
              id: "books",
              label: "书籍目录",
              relativePath: "books",
              absolutePath: "D:/DESKTOP/novelfork/books",
              status: "ready",
              totalBytes: 1024,
              fileCount: 2,
              directoryCount: 1,
              lastModifiedAt: "2026-04-20T10:04:00Z",
              largestChildren: [],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        stats: {
          cpu: { usage: 10, cores: 4 },
          memory: { used: 4 * 1024 * 1024 * 1024, total: 8 * 1024 * 1024 * 1024, free: 4 * 1024 * 1024 * 1024, usagePercent: 50 },
          disk: { used: 0, total: 0, free: 0, usagePercent: 0 },
          network: { sent: 0, received: 0 },
          sampledAt: "2026-04-20T10:01:00Z",
        },
        storage: {
          rootPath: "D:/DESKTOP/novelfork",
          scannedAt: "2026-04-20T10:06:00Z",
          scanDurationMs: 95,
          mode: "fresh",
          ageMs: 0,
          ttlMs: 30000,
          summary: {
            scannedTargets: 1,
            existingTargets: 1,
            totalBytes: 2048,
            fileCount: 3,
            directoryCount: 1,
            largestTargetId: "books",
            largestTargetLabel: "书籍目录",
            largestTargetBytes: 2048,
          },
          targets: [
            {
              id: "books",
              label: "书籍目录",
              relativePath: "books",
              absolutePath: "D:/DESKTOP/novelfork/books",
              status: "ready",
              totalBytes: 2048,
              fileCount: 3,
              directoryCount: 1,
              lastModifiedAt: "2026-04-20T10:05:30Z",
              largestChildren: [],
            },
          ],
        },
      });

    render(<ResourcesTab />);

    await screen.findByRole("heading", { name: "资源 / 存储面板" });

    fireEvent.click(screen.getByRole("button", { name: "重扫存储" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenNthCalledWith(2, "/api/admin/resources?refresh=1");
    });

    expect(await screen.findByText("当前展示最新重扫结果")).toBeTruthy();
    expect(screen.getAllByText("2.00 KB").length).toBeGreaterThanOrEqual(1);
  });

  it("triggers startup recovery rerun when clicking the recovery button", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        stats: {
          cpu: { usage: 10, cores: 4 },
          memory: { used: 4 * 1024 * 1024 * 1024, total: 8 * 1024 * 1024 * 1024, free: 4 * 1024 * 1024 * 1024, usagePercent: 50 },
          disk: { used: 0, total: 0, free: 0, usagePercent: 0 },
          network: { sent: 0, received: 0 },
          sampledAt: "2026-04-20T10:00:00Z",
        },
        startup: {
          delivery: { staticMode: "missing", indexHtmlReady: false, compileSmokeStatus: "failed" },
          recoveryReport: { startedAt: "2026-04-20T09:59:00Z", finishedAt: "2026-04-20T10:00:00Z", durationMs: 1000, counts: { success: 0, skipped: 0, failed: 2 }, actions: [] },
          failures: [{ phase: "compile-smoke", message: "index missing" }],
        },
        storage: {
          rootPath: "D:/DESKTOP/novelfork",
          scannedAt: "2026-04-20T10:05:00Z",
          scanDurationMs: 80,
          mode: "cached",
          ageMs: 1200,
          ttlMs: 30000,
          summary: { scannedTargets: 1, existingTargets: 1, totalBytes: 1024, fileCount: 2, directoryCount: 1, largestTargetId: "books", largestTargetLabel: "书籍目录", largestTargetBytes: 1024 },
          targets: [],
        },
      })
      .mockResolvedValueOnce({
        stats: null,
        startup: {
          delivery: { staticMode: "filesystem", indexHtmlReady: true, compileSmokeStatus: "success" },
          recoveryReport: { startedAt: "2026-04-20T10:10:00Z", finishedAt: "2026-04-20T10:10:01Z", durationMs: 1000, counts: { success: 3, skipped: 0, failed: 0 }, actions: [] },
          failures: [],
        },
        storage: null,
        recoveryTriggered: true,
      });

    render(<ResourcesTab />);

    await screen.findByRole("heading", { name: "资源 / 存储面板" });

    fireEvent.click(screen.getByRole("button", { name: "重新执行恢复" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenNthCalledWith(2, "/api/admin/resources/recovery", { method: "POST" });
    });

    expect(await screen.findByText(/success 3/)).toBeTruthy();
  });

  it("renders startup repair decisions and executes the recommended runtime-state repair action", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        stats: {
          cpu: { usage: 10, cores: 4 },
          memory: { used: 4 * 1024 * 1024 * 1024, total: 8 * 1024 * 1024 * 1024, free: 4 * 1024 * 1024 * 1024, usagePercent: 50 },
          disk: { used: 0, total: 0, free: 0, usagePercent: 0 },
          network: { sent: 0, received: 0 },
          sampledAt: "2026-04-20T10:00:00Z",
        },
        startup: {
          delivery: { staticMode: "missing", indexHtmlReady: false, compileSmokeStatus: "failed" },
          recoveryReport: { startedAt: "2026-04-20T09:59:00Z", finishedAt: "2026-04-20T10:00:00Z", durationMs: 1000, counts: { success: 0, skipped: 0, failed: 2 }, actions: [] },
          failures: [{ bookId: "demo-book", phase: "migration", message: "runtime repair failed" }],
          decisions: [
            {
              id: "migration:demo-book:0",
              phase: "migration",
              severity: "error",
              title: "demo-book 运行态修复失败",
              description: "当前 runtime state 补建失败，先对该书重新执行 repair，再回放启动恢复结果。",
              action: {
                kind: "repair-runtime-state",
                label: "修复该书运行态",
                endpoint: "/api/admin/resources/recovery/runtime-state",
                method: "POST",
                payload: { bookId: "demo-book" },
              },
            },
          ],
        },
        storage: {
          rootPath: "D:/DESKTOP/novelfork",
          scannedAt: "2026-04-20T10:05:00Z",
          scanDurationMs: 80,
          mode: "cached",
          ageMs: 1200,
          ttlMs: 30000,
          summary: { scannedTargets: 1, existingTargets: 1, totalBytes: 1024, fileCount: 2, directoryCount: 1, largestTargetId: "books", largestTargetLabel: "书籍目录", largestTargetBytes: 1024 },
          targets: [],
        },
      })
      .mockResolvedValueOnce({
        stats: null,
        startup: {
          delivery: { staticMode: "filesystem", indexHtmlReady: true, compileSmokeStatus: "success" },
          recoveryReport: { startedAt: "2026-04-20T10:10:00Z", finishedAt: "2026-04-20T10:10:01Z", durationMs: 1000, counts: { success: 3, skipped: 0, failed: 0 }, actions: [] },
          failures: [],
          decisions: [],
        },
        storage: null,
        repairTriggered: true,
      });

    render(<ResourcesTab />);

    expect(await screen.findByText("demo-book 运行态修复失败")).toBeTruthy();
    expect(screen.getByText(/先对该书重新执行 repair/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "修复该书运行态" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenNthCalledWith(2, "/api/admin/resources/recovery/runtime-state", {
        method: "POST",
        body: JSON.stringify({ bookId: "demo-book" }),
        headers: { "Content-Type": "application/json" },
      });
    });

    expect(await screen.findByText(/success 3/)).toBeTruthy();
  });
});
