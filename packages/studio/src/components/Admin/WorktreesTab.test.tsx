import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.fn();

vi.mock("../../hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { WorktreesTab } from "./WorktreesTab";

describe("WorktreesTab", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders worktree list and change counts from the admin API", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      rootPath: "D:/DESKTOP/novelfork",
      refreshedAt: "2026-04-20T10:05:00Z",
      refreshHintMs: 10000,
      status: "ready",
      summary: {
        total: 2,
        dirty: 1,
        clean: 1,
        bare: 0,
      },
      worktrees: [
        {
          path: "D:/DESKTOP/novelfork",
          relativePath: ".",
          branch: "main",
          head: "1234567890abcdef",
          shortHead: "12345678",
          bare: false,
          isPrimary: true,
          dirty: false,
          changeCount: 0,
          status: { modified: 0, added: 0, deleted: 0, untracked: 0 },
        },
        {
          path: "D:/DESKTOP/novelfork/.novelfork-worktrees/feature-a",
          relativePath: ".novelfork-worktrees/feature-a",
          branch: "feature-a",
          head: "abcdef1234567890",
          shortHead: "abcdef12",
          bare: false,
          isPrimary: false,
          dirty: true,
          changeCount: 3,
          status: { modified: 1, added: 1, deleted: 0, untracked: 1 },
        },
      ],
    });

    render(<WorktreesTab />);

    expect(await screen.findByRole("heading", { name: "Worktree" })).toBeTruthy();
    expect(screen.getByText("feature-a")).toBeTruthy();
    expect(screen.getByText("主仓库")).toBeTruthy();
    expect(screen.getAllByText("总变更").length).toBeGreaterThanOrEqual(1);
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/admin/worktrees");
  });

  it("refreshes worktree data on demand", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        rootPath: "D:/DESKTOP/novelfork",
        refreshedAt: "2026-04-20T10:05:00Z",
        refreshHintMs: 10000,
        status: "ready",
        summary: {
          total: 1,
          dirty: 0,
          clean: 1,
          bare: 0,
        },
        worktrees: [
          {
            path: "D:/DESKTOP/novelfork",
            relativePath: ".",
            branch: "main",
            head: "1234567890abcdef",
            shortHead: "12345678",
            bare: false,
            isPrimary: true,
            dirty: false,
            changeCount: 0,
            status: { modified: 0, added: 0, deleted: 0, untracked: 0 },
          },
        ],
      })
      .mockResolvedValueOnce({
        rootPath: "D:/DESKTOP/novelfork",
        refreshedAt: "2026-04-20T10:06:00Z",
        refreshHintMs: 10000,
        status: "ready",
        summary: {
          total: 2,
          dirty: 1,
          clean: 1,
          bare: 0,
        },
        worktrees: [
          {
            path: "D:/DESKTOP/novelfork",
            relativePath: ".",
            branch: "main",
            head: "1234567890abcdef",
            shortHead: "12345678",
            bare: false,
            isPrimary: true,
            dirty: false,
            changeCount: 0,
            status: { modified: 0, added: 0, deleted: 0, untracked: 0 },
          },
          {
            path: "D:/DESKTOP/novelfork/.novelfork-worktrees/feature-a",
            relativePath: ".novelfork-worktrees/feature-a",
            branch: "feature-a",
            head: "abcdef1234567890",
            shortHead: "abcdef12",
            bare: false,
            isPrimary: false,
            dirty: true,
            changeCount: 1,
            status: { modified: 1, added: 0, deleted: 0, untracked: 0 },
          },
        ],
      });

    render(<WorktreesTab />);

    await screen.findByText("main");
    fireEvent.click(screen.getByRole("button", { name: "刷新 Worktree" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenNthCalledWith(2, "/api/admin/worktrees");
    });

    expect(await screen.findByText("feature-a")).toBeTruthy();
  });
});
