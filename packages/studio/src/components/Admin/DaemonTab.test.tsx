import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.fn();

vi.mock("../../hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { DaemonTab } from "./DaemonTab";

describe("DaemonTab", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders real daemon status and event flow from the admin API", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      running: true,
      refreshedAt: "2026-04-20T10:05:00Z",
      refreshHintMs: 5000,
      schedule: {
        radarCron: "0 */6 * * *",
        writeCron: "*/15 * * * *",
      },
      limits: {
        maxConcurrentBooks: 3,
        chaptersPerCycle: 2,
        retryDelayMs: 120000,
        cooldownAfterChapterMs: null,
        maxChaptersPerDay: null,
      },
      recentEvents: [
        {
          timestamp: "2026-04-20T10:04:00Z",
          event: "started",
          level: "info",
          message: "守护进程已启动",
        },
      ],
      capabilities: {
        start: false,
        stop: true,
        terminal: false,
        container: false,
      },
    });

    render(<DaemonTab />);

    expect(await screen.findByRole("heading", { name: "守护进程" })).toBeTruthy();
    expect(screen.getAllByText("运行中").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("0 */6 * * *")).toBeTruthy();
    expect(screen.getByText("守护进程已启动")).toBeTruthy();
    expect(screen.getByText("启动 / 停止")).toBeTruthy();
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/admin/daemon");
  });

  it("posts admin daemon start action and refreshes the snapshot", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        running: false,
        refreshedAt: "2026-04-20T10:05:00Z",
        refreshHintMs: 15000,
        schedule: {
          radarCron: "0 */6 * * *",
          writeCron: "*/15 * * * *",
        },
        limits: {
          maxConcurrentBooks: 3,
          chaptersPerCycle: null,
          retryDelayMs: null,
          cooldownAfterChapterMs: null,
          maxChaptersPerDay: null,
        },
        recentEvents: [],
        capabilities: {
          start: true,
          stop: false,
          terminal: false,
          container: false,
        },
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        running: true,
        refreshedAt: "2026-04-20T10:06:00Z",
        refreshHintMs: 5000,
        schedule: {
          radarCron: "0 */6 * * *",
          writeCron: "*/15 * * * *",
        },
        limits: {
          maxConcurrentBooks: 3,
          chaptersPerCycle: null,
          retryDelayMs: null,
          cooldownAfterChapterMs: null,
          maxChaptersPerDay: null,
        },
        recentEvents: [
          {
            timestamp: "2026-04-20T10:06:00Z",
            event: "started",
            level: "info",
            message: "守护进程已启动",
          },
        ],
        capabilities: {
          start: false,
          stop: true,
          terminal: false,
          container: false,
        },
      });

    render(<DaemonTab />);

    await screen.findByRole("button", { name: "启动守护进程" });
    fireEvent.click(screen.getByRole("button", { name: "启动守护进程" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenNthCalledWith(2, "/api/admin/daemon/start", { method: "POST" });
      expect(fetchJsonMock).toHaveBeenNthCalledWith(3, "/api/admin/daemon");
    });

    expect(await screen.findByText("守护进程启动指令已发送")).toBeTruthy();
    expect(screen.getAllByText("运行中").length).toBeGreaterThanOrEqual(1);
  });
});
