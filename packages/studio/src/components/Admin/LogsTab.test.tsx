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
      sourcePath: "D:/DESKTOP/novelfork/inkos.log",
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
          message: "plain line",
          raw: "plain line",
          source: "text",
        },
      ],
    });

    render(<LogsTab />);

    expect(await screen.findByRole("heading", { name: "运行日志" })).toBeTruthy();
    expect(screen.getByText("server booted")).toBeTruthy();
    expect(screen.getByText("plain line")).toBeTruthy();
    expect(screen.getByText("D:/DESKTOP/novelfork/inkos.log")).toBeTruthy();
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/admin/logs?limit=200");
  });

  it("refreshes the current log tail limit on demand", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        sourcePath: "D:/DESKTOP/novelfork/inkos.log",
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
        sourcePath: "D:/DESKTOP/novelfork/inkos.log",
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
