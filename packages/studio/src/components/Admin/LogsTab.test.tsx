import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.fn();

vi.mock("../../hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { LogsTab } from "./LogsTab";

describe("LogsTab", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders real log tail entries from the admin API", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      sourcePath: "D:/DESKTOP/novelfork/novelfork.log",
      exists: true,
      refreshedAt: "2026-04-20T10:05:00Z",
      updatedAt: "2026-04-20T10:04:30Z",
      sizeBytes: 2048,
      limit: 200,
      totalEntries: 12,
      refreshHintMs: 5000,
      entries: [
        {
          timestamp: "2026-04-20T10:04:00Z",
          level: "info",
          tag: "studio",
          message: "server booted",
          raw: '{"message":"server booted"}',
          source: "json",
        },
        {
          timestamp: "2026-04-20T10:04:05Z",
          level: "error",
          tag: "run:run-2",
          message: "run-2 audit failed",
          raw: '[run:run-2] audit failed',
          source: "text",
        },
      ],
    });

    const onInspectRun = vi.fn();
    const onNavigateSection = vi.fn();

    render(<LogsTab runId="run-2" onInspectRun={onInspectRun} onNavigateSection={onNavigateSection} />);

    expect(await screen.findByRole("heading", { name: "运行日志" })).toBeTruthy();
    expect(screen.getByText("server booted")).toBeTruthy();
    expect(screen.getByText("run-2 audit failed")).toBeTruthy();
    expect(screen.getByText("D:/DESKTOP/novelfork/novelfork.log")).toBeTruthy();
    expect(screen.getByRole("button", { name: "定位运行 run-2" })).toBeTruthy();
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/admin/logs?limit=200&runId=run-2");

    fireEvent.click(screen.getByRole("button", { name: "定位运行 run-2" }));
    expect(onInspectRun).toHaveBeenCalledWith("run-2");

    fireEvent.click(screen.getByRole("button", { name: "查看请求 run-2" }));
    expect(onNavigateSection).toHaveBeenCalledWith("requests", { runId: "run-2" });
  });

  it("refreshes the current log tail limit on demand", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        sourcePath: "D:/DESKTOP/novelfork/novelfork.log",
        exists: true,
        refreshedAt: "2026-04-20T10:05:00Z",
        updatedAt: "2026-04-20T10:04:30Z",
        sizeBytes: 1024,
        limit: 200,
        totalEntries: 2,
        refreshHintMs: 5000,
        entries: [{ message: "first line", raw: "first line", source: "text" }],
      })
      .mockResolvedValueOnce({
        sourcePath: "D:/DESKTOP/novelfork/novelfork.log",
        exists: true,
        refreshedAt: "2026-04-20T10:06:00Z",
        updatedAt: "2026-04-20T10:05:45Z",
        sizeBytes: 2048,
        limit: 200,
        totalEntries: 3,
        refreshHintMs: 5000,
        entries: [{ message: "second line", raw: "second line", source: "text" }],
      });

    render(<LogsTab />);

    await screen.findByText("first line");
    fireEvent.click(screen.getByRole("button", { name: "刷新日志" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenNthCalledWith(2, "/api/admin/logs?limit=200");
    });

    expect(await screen.findByText("second line")).toBeTruthy();
  });
});
