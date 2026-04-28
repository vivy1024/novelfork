import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.fn();

class MockEventSource {
  static instances: MockEventSource[] = [];

  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }

  close() {
    this.closed = true;
    return undefined;
  }
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.onopen?.();
    });
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }

  close() {
    this.closed = true;
    return undefined;
  }
}

vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

vi.mock("../../hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { ResourcesTab } from "./ResourcesTab";

function formatShortDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

describe("ResourcesTab", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    MockEventSource.instances = [];
    MockWebSocket.instances = [];
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

  it("refreshes runtime metrics from the admin resources WebSocket without dropping the fetched snapshot", async () => {
    const initialSampledAt = "2026-04-20T10:00:00Z";
    const liveSampledAt = "2026-04-20T10:01:00Z";

    fetchJsonMock.mockResolvedValueOnce({
      stats: {
        cpu: { usage: 18.2, cores: 8 },
        memory: { used: 8 * 1024 * 1024 * 1024, total: 16 * 1024 * 1024 * 1024, free: 8 * 1024 * 1024 * 1024, usagePercent: 50 },
        disk: { used: 32 * 1024 * 1024 * 1024, total: 128 * 1024 * 1024 * 1024, free: 96 * 1024 * 1024 * 1024, usagePercent: 25 },
        network: { sent: 1024, received: 2048, available: true },
        sampledAt: initialSampledAt,
      },
      requestMeta: {
        narrator: "admin.resources",
        requestKind: "resource-monitor",
        cache: { status: "hit", scope: "storage-scan", ageMs: 1200 },
        details: "storage=3/3;startup=filesystem",
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
            largestChildren: [],
          },
        ],
      },
    });

    render(<ResourcesTab />);

    expect(await screen.findByText("18.2%")).toBeTruthy();
    expect(MockWebSocket.instances[0]?.url).toContain("/api/admin/resources/ws");
    expect(screen.getByText(`采样 ${formatShortDateTime(initialSampledAt)}`)).toBeTruthy();

    act(() => {
      MockWebSocket.instances[0]?.emit({
        cpu: { usage: 64.4, cores: 8 },
        memory: { used: 12 * 1024 * 1024 * 1024, total: 16 * 1024 * 1024 * 1024, free: 4 * 1024 * 1024 * 1024, usagePercent: 75 },
        disk: { used: 48 * 1024 * 1024 * 1024, total: 128 * 1024 * 1024 * 1024, free: 80 * 1024 * 1024 * 1024, usagePercent: 37.5 },
        network: { sent: 4096, received: 8192, available: true },
        sampledAt: liveSampledAt,
      });
    });

    expect(await screen.findByText("64.4%")).toBeTruthy();
    expect(screen.getByText("12.00 GB / 16.00 GB")).toBeTruthy();
    expect(screen.getByText(`采样 ${formatShortDateTime(liveSampledAt)}`)).toBeTruthy();
    expect(screen.getAllByText("工作台源码").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("共享请求语义")).toBeTruthy();
  });

  it("closes the admin resources WebSocket when the component unmounts", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      stats: {
        cpu: { usage: 10, cores: 4 },
        memory: { used: 4 * 1024 * 1024 * 1024, total: 8 * 1024 * 1024 * 1024, free: 4 * 1024 * 1024 * 1024, usagePercent: 50 },
        disk: { used: 0, total: 0, free: 0, usagePercent: 0 },
        network: { sent: 0, received: 0, available: false },
        sampledAt: "2026-04-20T10:00:00Z",
      },
      storage: null,
      startup: null,
    });

    const { unmount } = render(<ResourcesTab />);

    await screen.findByRole("heading", { name: "资源 / 存储面板" });
    expect(MockWebSocket.instances[0]?.closed).toBe(false);

    unmount();

    expect(MockWebSocket.instances[0]?.closed).toBe(true);
  });

  it("renders shared request metadata for the resources snapshot", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      stats: {
        cpu: { usage: 18.2, cores: 8 },
        memory: { used: 8 * 1024 * 1024 * 1024, total: 16 * 1024 * 1024 * 1024, free: 8 * 1024 * 1024 * 1024, usagePercent: 50 },
        disk: { used: 32 * 1024 * 1024 * 1024, total: 128 * 1024 * 1024 * 1024, free: 96 * 1024 * 1024 * 1024, usagePercent: 25 },
        network: { sent: 1024, received: 2048 },
        sampledAt: "2026-04-20T10:00:00Z",
      },
      requestMeta: {
        narrator: "admin.resources",
        requestKind: "resource-monitor",
        cache: { status: "hit", scope: "storage-scan", ageMs: 1200 },
        details: "storage=3/5;startup=filesystem",
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
        mode: "cached",
        ageMs: 1200,
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
        targets: [],
      },
    });

    render(<ResourcesTab />);

    expect(await screen.findByText("共享请求语义")).toBeTruthy();
    expect(screen.getAllByText(/admin.resources/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/resource-monitor/)).toBeTruthy();
    expect(screen.getByText(/缓存 hit/)).toBeTruthy();
    expect(screen.getByText(/storage=3\/5;startup=filesystem/)).toBeTruthy();
  });

  it("shows live run diagnostics alongside the resource snapshot", async () => {
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
        targets: [],
      },
    });

    render(<ResourcesTab />);

    expect(await screen.findByRole("heading", { name: "资源 / 存储面板" })).toBeTruthy();
    expect(MockEventSource.instances[0]?.url).toBe("/api/runs/events");

    act(() => {
      MockEventSource.instances[0]?.emit({
        type: "snapshot",
        runId: "__all__",
        runs: [
          {
            id: "run-resource-1",
            bookId: "demo-book",
            chapter: 8,
            chapterNumber: 8,
            action: "tool",
            status: "running",
            stage: "Tool Audit",
            createdAt: "2026-04-21T10:00:00.000Z",
            updatedAt: "2026-04-21T10:00:01.000Z",
            startedAt: "2026-04-21T10:00:00.000Z",
            finishedAt: null,
            logs: [],
          },
        ],
      });
    });

    await waitFor(() => {
      expect(MockEventSource.instances[1]?.url).toBe("/api/runs/run-resource-1/events");
    });

    act(() => {
      MockEventSource.instances[1]?.emit({
        type: "snapshot",
        runId: "run-resource-1",
        run: {
          id: "run-resource-1",
          bookId: "demo-book",
          chapter: 8,
          chapterNumber: 8,
          action: "tool",
          status: "running",
          stage: "Tool Audit",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:00:03.000Z",
          startedAt: "2026-04-21T10:00:00.000Z",
          finishedAt: null,
          logs: [
            {
              timestamp: "2026-04-21T10:00:02.000Z",
              level: "info",
              message: "资源巡检完成第 8 章",
            },
          ],
        },
      });
    });

    expect(await screen.findByText("实时运行焦点")).toBeTruthy();
    expect(screen.getByText(/run-resource-1/)).toBeTruthy();
    expect(screen.getByText(/demo-book/)).toBeTruthy();
    expect(screen.getAllByText(/第 8 章/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Tool Audit/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/资源巡检完成第 8 章/)).toBeTruthy();
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
    expect(screen.getByText(/当前失败项已经统一映射到启动诊断与自愈链/)).toBeTruthy();
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

  it("renders unified startup health checks and executes self-heal actions", async () => {
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
          delivery: { staticMode: "filesystem", indexHtmlReady: true, compileSmokeStatus: "failed", compileCommand: "pnpm bun:compile", expectedArtifactPath: "dist/novelfork" },
          recoveryReport: { startedAt: "2026-04-20T09:59:00Z", finishedAt: "2026-04-20T10:00:00Z", durationMs: 1000, counts: { success: 1, skipped: 2, failed: 2 }, actions: [] },
          failures: [
            { phase: "session-store", message: "orphan=demo-session" },
            { phase: "compile-smoke", message: "dist/novelfork" },
          ],
          healthChecks: [
            {
              id: "unclean-shutdown",
              category: "runtime",
              phase: "unclean-shutdown",
              title: "未干净退出",
              summary: "检测到上次运行未干净退出",
              status: "warning",
              source: "diagnostic",
              detail: "pid=123",
              action: { kind: "manual-check", label: "查看上次残留标记", detail: "pid=123" },
            },
            {
              id: "session-store",
              category: "session",
              phase: "session-store",
              title: "会话存储",
              summary: "会话存储存在孤儿历史文件",
              status: "error",
              source: "diagnostic",
              detail: "orphan=demo-session",
              action: { kind: "cleanup-session-history", label: "清理孤儿会话历史", endpoint: "/api/admin/resources/recovery/session-store", method: "POST" },
            },
            {
              id: "git-worktree-pollution",
              category: "workspace",
              phase: "git-worktree-pollution",
              title: "外部 worktree 污染",
              summary: "检测到外部项目 worktree",
              status: "warning",
              source: "diagnostic",
              detail: "D:/DESKTOP/sub2api/worktrees/demo",
              action: { kind: "ignore-external-worktrees", label: "忽略当前外部 worktree", endpoint: "/api/admin/resources/recovery/worktree-pollution", method: "POST" },
            },
            {
              id: "compile-smoke",
              category: "delivery",
              phase: "compile-smoke",
              title: "compile smoke",
              summary: "compile smoke 未通过，交付链仍需人工核对。",
              status: "error",
              source: "delivery",
              detail: "dist/novelfork",
              action: { kind: "manual-check", label: "手动执行 pnpm bun:compile", detail: "命令：pnpm bun:compile；期望产物：dist/novelfork" },
            },
          ],
          decisions: [
            {
              id: "search-index:library:0",
              phase: "search-index",
              severity: "error",
              title: "搜索索引重建失败",
              description: "当前内存搜索索引没有完成 rebuild，先单独重建搜索索引，再重新核对 startup summary。",
              action: {
                kind: "rebuild-search-index",
                label: "重建搜索索引",
                endpoint: "/api/admin/resources/recovery/search-index",
                method: "POST",
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
          delivery: { staticMode: "embedded", indexHtmlReady: true, compileSmokeStatus: "success" },
          recoveryReport: { startedAt: "2026-04-20T10:10:00Z", finishedAt: "2026-04-20T10:10:01Z", durationMs: 1000, counts: { success: 4, skipped: 1, failed: 0 }, actions: [] },
          failures: [],
          healthChecks: [],
          decisions: [],
        },
        storage: null,
        sessionStoreCleanupTriggered: true,
      });

    render(<ResourcesTab />);

    expect(await screen.findByRole("heading", { name: "启动诊断与自愈链" })).toBeTruthy();
    expect(screen.getByText("会话存储")).toBeTruthy();
    expect(screen.getByText("外部 worktree 污染")).toBeTruthy();
    expect(screen.getByText(/命令：pnpm bun:compile/)).toBeTruthy();
    expect(screen.getByText("搜索索引重建失败")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "清理孤儿会话历史" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenNthCalledWith(2, "/api/admin/resources/recovery/session-store", { method: "POST" });
    });

    expect(await screen.findByText(/success 4/)).toBeTruthy();
  });

  it("renders missing resource follow-ups as explicit unsupported capabilities", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      stats: null,
      startup: {
        delivery: { staticMode: "embedded", indexHtmlReady: true, compileSmokeStatus: "success" },
        recoveryReport: { startedAt: "2026-04-20T10:00:00Z", finishedAt: "2026-04-20T10:00:01Z", durationMs: 1000, counts: { success: 1, skipped: 0, failed: 0 }, actions: [] },
        failures: [],
        healthChecks: [],
        decisions: [],
      },
      storage: null,
    });

    render(<ResourcesTab />);

    expect(await screen.findByText("接入状态")).toBeTruthy();
    for (const [title, capability] of [
      ["异常资源列表未接入", "resources.anomaly-list"],
      ["清理建议未接入", "resources.cleanup-suggestions"],
      ["扫描历史队列未接入", "resources.scan-history"],
    ] as const) {
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
      expect(screen.getByText(capability)).toBeTruthy();
    }
  });

  it("executes ignored external worktree action from startup health checks", async () => {
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
          delivery: { staticMode: "filesystem", indexHtmlReady: true, compileSmokeStatus: "success" },
          recoveryReport: { startedAt: "2026-04-20T09:59:00Z", finishedAt: "2026-04-20T10:00:00Z", durationMs: 1000, counts: { success: 1, skipped: 2, failed: 0 }, actions: [] },
          failures: [],
          healthChecks: [
            {
              id: "git-worktree-pollution",
              category: "workspace",
              phase: "git-worktree-pollution",
              title: "外部 worktree 污染",
              summary: "检测到外部项目 worktree",
              status: "warning",
              source: "diagnostic",
              detail: "D:/DESKTOP/sub2api/worktrees/demo",
              action: { kind: "ignore-external-worktrees", label: "忽略当前外部 worktree", endpoint: "/api/admin/resources/recovery/worktree-pollution", method: "POST" },
            },
          ],
          decisions: [],
        },
        storage: null,
      })
      .mockResolvedValueOnce({
        stats: null,
        startup: {
          delivery: { staticMode: "embedded", indexHtmlReady: true, compileSmokeStatus: "success" },
          recoveryReport: { startedAt: "2026-04-20T10:20:00Z", finishedAt: "2026-04-20T10:20:01Z", durationMs: 1000, counts: { success: 4, skipped: 1, failed: 0 }, actions: [] },
          failures: [],
          healthChecks: [],
          decisions: [],
        },
        storage: null,
        worktreeIgnoreTriggered: true,
      });

    render(<ResourcesTab />);

    expect(await screen.findByText("外部 worktree 污染")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "忽略当前外部 worktree" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenNthCalledWith(2, "/api/admin/resources/recovery/worktree-pollution", { method: "POST" });
    });
  });
});
