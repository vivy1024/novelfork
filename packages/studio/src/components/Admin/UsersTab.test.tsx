import { cleanup, render, screen } from "@testing-library/react";
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

  it("shows local single-user mode and disables editable user CRUD", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      mode: "local-single-user",
      users: [],
      userManagement: {
        code: "unsupported",
        capability: "admin.users.crud",
        status: "planned",
        reason: "当前是本地单用户工具，用户管理 CRUD 尚未接入持久化用户系统。",
      },
    });

    render(<UsersTab />);

    expect((await screen.findAllByText("本地单用户模式")).length).toBeGreaterThan(0);
    expect(screen.getByText(/用户管理 CRUD 尚未接入持久化用户系统/)).toBeTruthy();
    for (const button of screen.getAllByRole("button", { name: /添加用户/ }) as HTMLButtonElement[]) {
      expect(button.disabled).toBe(true);
    }
    expect(screen.queryByRole("button", { name: /删除用户/ })).toBeNull();
  });
});
