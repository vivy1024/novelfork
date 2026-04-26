import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchJsonMock = vi.fn();

class MockEventSource {
  static instances: MockEventSource[] = [];

  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }

  close() {
    return undefined;
  }
}

Object.defineProperty(globalThis, "EventSource", {
  writable: true,
  configurable: true,
  value: MockEventSource as unknown as typeof EventSource,
});
vi.mock("../../hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { RequestsTab } from "./RequestsTab";

describe("RequestsTab", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    MockEventSource.instances = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("renders request summary cards", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      total: 3,
      logs: [
        { id: "1", timestamp: "2026-04-20T10:00:00Z", method: "GET", endpoint: "/api/books", status: 200, duration: 120, userId: "u1" },
        { id: "2", timestamp: "2026-04-20T10:01:00Z", method: "POST", endpoint: "/api/chat", status: 500, duration: 2100, userId: "u1" },
        { id: "3", timestamp: "2026-04-20T10:02:00Z", method: "POST", endpoint: "/api/chat", status: 201, duration: 430, userId: "u2" },
      ],
    });

    render(<RequestsTab />);

    expect(await screen.findByText("总请求数")).toBeTruthy();
    expect(screen.getByText("成功率")).toBeTruthy();
    expect(screen.getByText("慢请求")).toBeTruthy();
    expect(screen.getByText("67%")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("renders endpoint rows after loading", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      total: 1,
      logs: [
        { id: "1", timestamp: "2026-04-20T10:00:00Z", method: "POST", endpoint: "/api/chat", status: 200, duration: 320, userId: "writer" },
      ],
    });

    render(<RequestsTab />);

    expect(await screen.findByText("/api/chat")).toBeTruthy();
    expect(screen.getByText("writer")).toBeTruthy();
    expect(screen.getAllByText("320ms").length).toBeGreaterThanOrEqual(1);
  });

  it("renders request diagnostics from the admin summary and metadata fields", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      total: 1,
      summary: {
        successRate: 100,
        slowRequests: 0,
        errorRequests: 0,
        averageDuration: 320,
        averageTtftMs: 480,
        totalTokens: 2048,
        totalCostUsd: 0.1234,
        cacheHitRate: 75,
        topEndpoints: [{ label: "/api/chat", count: 3 }],
        topNarrators: [{ label: "session.alpha", count: 2 }],
      },
      logs: [
        {
          id: "1",
          timestamp: "2026-04-20T10:00:00Z",
          method: "POST",
          endpoint: "/api/chat",
          status: 200,
          duration: 320,
          userId: "writer",
          requestKind: "tool-call",
          narrator: "session.alpha",
          provider: "sub2api",
          model: "claude-sonnet-4.6",
          tokens: { total: 2048, estimated: true },
          cache: { status: "hit", scope: "admin" },
          details: "run=run-1",
          aiStatus: "success",
          bookId: "demo-book",
          sessionId: "session-1",
          ttftMs: 480,
        },
      ],
    });

    render(<RequestsTab />);

    expect(await screen.findByText("缓存命中率")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("平均 TTFT")).toBeTruthy();
    expect(screen.getByText("480ms")).toBeTruthy();
    expect(screen.getAllByText(/session.alpha/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/claude-sonnet-4.6/)).toBeTruthy();
    expect(screen.getByText(/2048 tokens · 估算/)).toBeTruthy();
    expect(screen.getByText(/session-1/)).toBeTruthy();
    expect(screen.getByText(/run=run-1/)).toBeTruthy();
  });

  it("sends AI history filter params from the admin controls", async () => {
    fetchJsonMock.mockResolvedValue({ total: 0, logs: [], summary: { successRate: 0, slowRequests: 0, errorRequests: 0, averageDuration: 0, averageTtftMs: null, totalTokens: 0, totalCostUsd: 0, cacheHitRate: null, topEndpoints: [], topNarrators: [] } });

    render(<RequestsTab />);

    await screen.findByText("请求筛选");
    const firstUrl = String(fetchJsonMock.mock.calls[0]?.[0]);
    expect(firstUrl).toContain("scope=ai");

    fireEvent.change(await screen.findByDisplayValue("仅 AI 请求"), { target: { value: "" } });
    fireEvent.change(await screen.findByPlaceholderText("bookId"), { target: { value: "demo-book" } });
    fireEvent.change(await screen.findByPlaceholderText("sessionId"), { target: { value: "session-42" } });

    await waitFor(() => {
      const urls = fetchJsonMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("scope=ai"))).toBe(true);
      expect(urls.some((url) => url.includes("bookId=demo-book") && url.includes("sessionId=session-42"))).toBe(true);
    });
  });

  it("renders live run summary from the global run stream", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      total: 0,
      logs: [],
    });

    const onInspectRun = vi.fn();
    const onNavigateSection = vi.fn();

    render(<RequestsTab onInspectRun={onInspectRun} onNavigateSection={onNavigateSection} />);

    expect(await screen.findByText("总请求数")).toBeTruthy();
    expect(MockEventSource.instances[0]?.url).toBe("/api/runs/events");

    act(() => {
      MockEventSource.instances[0]?.emit({
        type: "snapshot",
        runId: "__all__",
        runs: [
          {
            id: "run-1",
            bookId: "demo-book",
            chapter: 3,
            chapterNumber: 3,
            action: "tool",
            status: "running",
            stage: "Tool Read",
            createdAt: "2026-04-21T10:00:00.000Z",
            updatedAt: "2026-04-21T10:00:01.000Z",
            startedAt: "2026-04-21T10:00:00.000Z",
            finishedAt: null,
            logs: [],
          },
          {
            id: "run-2",
            bookId: "demo-book",
            chapter: 4,
            chapterNumber: 4,
            action: "audit",
            status: "failed",
            stage: "Failed",
            createdAt: "2026-04-21T09:59:00.000Z",
            updatedAt: "2026-04-21T10:00:00.000Z",
            startedAt: "2026-04-21T09:59:00.000Z",
            finishedAt: "2026-04-21T10:00:00.000Z",
            logs: [],
            error: "audit failed",
          },
        ],
      });
    });

    expect(screen.getByText("实时运行总览")).toBeTruthy();
    expect(screen.getByText("运行中")).toBeTruthy();
    expect(screen.getByText("失败运行")).toBeTruthy();
    expect(screen.getAllByText("Tool Read").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/run-1/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/audit failed/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "定位运行 run-1" }));
    expect(onInspectRun).toHaveBeenCalledWith("run-1");

    fireEvent.click(screen.getByRole("button", { name: "查看日志 run-2" }));
    expect(onNavigateSection).toHaveBeenCalledWith("logs", { runId: "run-2" });
  });

  it("shows live run fact details for the selected run", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      total: 0,
      logs: [],
    });

    render(<RequestsTab />);

    expect(await screen.findByText("总请求数")).toBeTruthy();

    act(() => {
      MockEventSource.instances[0]?.emit({
        type: "snapshot",
        runId: "__all__",
        runs: [
          {
            id: "run-1",
            bookId: "demo-book",
            chapter: 3,
            chapterNumber: 3,
            action: "tool",
            status: "running",
            stage: "Tool Read",
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
      expect(MockEventSource.instances[1]?.url).toBe("/api/runs/run-1/events");
    });

    act(() => {
      MockEventSource.instances[1]?.emit({
        type: "snapshot",
        runId: "run-1",
        run: {
          id: "run-1",
          bookId: "demo-book",
          chapter: 3,
          chapterNumber: 3,
          action: "tool",
          status: "running",
          stage: "Tool Read",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:00:03.000Z",
          startedAt: "2026-04-21T10:00:00.000Z",
          finishedAt: null,
          logs: [
            {
              timestamp: "2026-04-21T10:00:01.000Z",
              level: "info",
              message: "Attempt 1/2 started",
            },
            {
              timestamp: "2026-04-21T10:00:02.000Z",
              level: "warn",
              message: "Waiting 500ms before retry",
            },
          ],
          result: {
            attempts: 2,
            traceEnabled: true,
          },
        },
      });
    });

    expect(await screen.findByText("运行事实详情")).toBeTruthy();
    expect(screen.getByText(/demo-book/)).toBeTruthy();
    expect(screen.getByText(/第 3 章/)).toBeTruthy();
    expect(screen.getByText(/Attempt 1\/2 started/)).toBeTruthy();
    expect(screen.getByText(/Waiting 500ms before retry/)).toBeTruthy();
    expect(screen.getAllByText(/Tool Read/).length).toBeGreaterThanOrEqual(1);
  });

  it("opens pipeline drill-down for the selected live run when requested", async () => {
    const onOpenRun = vi.fn();
    fetchJsonMock.mockResolvedValueOnce({
      total: 0,
      logs: [],
    });

    render(<RequestsTab onOpenRun={onOpenRun} />);

    expect(await screen.findByText("总请求数")).toBeTruthy();

    act(() => {
      MockEventSource.instances[0]?.emit({
        type: "snapshot",
        runId: "__all__",
        runs: [
          {
            id: "run-1",
            bookId: "demo-book",
            chapter: 5,
            chapterNumber: 5,
            action: "tool",
            status: "running",
            stage: "Tool Bash",
            createdAt: "2026-04-21T10:00:00.000Z",
            updatedAt: "2026-04-21T10:00:01.000Z",
            startedAt: "2026-04-21T10:00:00.000Z",
            finishedAt: null,
            logs: [],
          },
        ],
      });
    });

    expect(await screen.findByText("运行事实详情")).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开 Pipeline" })).toBeTruthy();

    act(() => {
      screen.getByRole("button", { name: "打开 Pipeline" }).click();
    });

    expect(onOpenRun).toHaveBeenCalledWith("run-1");
  });
});
