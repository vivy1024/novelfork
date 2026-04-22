import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

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

vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
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

  it("renders live run summary from the global run stream", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      total: 0,
      logs: [],
    });

    render(<RequestsTab />);

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
    expect(screen.getByText(/run-1/)).toBeTruthy();
    expect(screen.getByText(/audit failed/)).toBeTruthy();
  });
});
