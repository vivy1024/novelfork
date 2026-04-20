import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.fn();

vi.mock("../../hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { UsersTab } from "./UsersTab";

describe("UsersTab", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens a dialog before deleting a user", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        users: [
          {
            id: "1",
            username: "admin",
            email: "admin@inkos.local",
            role: "admin",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastLogin: "2026-04-20T10:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValue({ users: [] });

    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);

    render(<UsersTab />);

    fireEvent.click(await screen.findByRole("button", { name: "删除用户 admin" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("确认删除用户")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith("/api/admin/users/1", { method: "DELETE" });
    });
    expect(confirmSpy).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });
});
