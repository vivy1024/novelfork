import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RuntimeAdminUser,
  RuntimeUsersSnapshot,
  UpdateRuntimeUserInput,
  UsersClient,
} from "../../runtime-admin/users";
import { UsersPanel } from "./UsersPanel";

const owner: RuntimeAdminUser = {
  id: "owner",
  username: "owner",
  role: "admin",
  avatarColor: null,
  avatarImageId: null,
  createdAt: "2026-05-01T12:00:00.000Z",
};

const writer: RuntimeAdminUser = {
  id: "writer-1",
  username: "writer",
  role: "user",
  avatarColor: null,
  avatarImageId: null,
  createdAt: "2026-05-02T12:00:00.000Z",
};

const snapshot: RuntimeUsersSnapshot = {
  currentUser: { id: owner.id, username: owner.username, role: owner.role },
  users: [owner, writer],
  registrationOpen: true,
};

function createClient(): UsersClient {
  return {
    getCurrentUser: vi.fn().mockResolvedValue(snapshot.currentUser),
    listUsers: vi.fn().mockResolvedValue(snapshot.users),
    getRegistrationSettings: vi.fn().mockResolvedValue({ registrationOpen: true }),
    getSnapshot: vi.fn().mockResolvedValue(snapshot),
    updateRegistrationOpen: vi.fn().mockImplementation(async (registrationOpen: boolean) => ({ registrationOpen })),
    updateUser: vi.fn().mockImplementation(async (id: string, input: UpdateRuntimeUserInput) => ({
      ...(id === owner.id ? owner : writer),
      ...input,
    })),
    deleteUser: vi.fn().mockResolvedValue({ ok: true }),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UsersPanel", () => {
  it("loads users and updates the real registration setting", async () => {
    const client = createClient();
    render(<UsersPanel client={client} />);

    expect(await screen.findByRole("heading", { name: "用户管理" })).toBeTruthy();
    expect(client.getSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByText("owner")).toBeTruthy();
    expect(screen.getByText("writer")).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: "允许新用户注册" }));

    await waitFor(() => expect(client.updateRegistrationOpen).toHaveBeenCalledWith(false));
    expect(screen.getByText("注册已关闭")).toBeTruthy();
  });

  it("confirms role changes and edits username and password through Runtime", async () => {
    const client = createClient();
    render(<UsersPanel client={client} />);
    await screen.findByRole("heading", { name: "用户管理" });

    fireEvent.click(screen.getByRole("button", { name: "将 writer 设为管理员" }));
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
    await waitFor(() => expect(client.updateUser).toHaveBeenCalledWith("writer-1", { role: "admin" }));

    fireEvent.click(screen.getByRole("button", { name: "编辑 writer" }));
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "novelist" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "fresh-password" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(client.updateUser).toHaveBeenCalledWith("writer-1", {
      username: "novelist",
      password: "fresh-password",
    }));
    expect(screen.getByText("novelist")).toBeTruthy();
  });

  it("prevents self deletion in the UI and deletes another user only after confirmation", async () => {
    const client = createClient();
    render(<UsersPanel client={client} />);
    await screen.findByRole("heading", { name: "用户管理" });

    expect(screen.queryByRole("button", { name: "删除 owner" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "删除 writer" }));
    expect(screen.getByRole("heading", { name: "删除用户" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(client.deleteUser).toHaveBeenCalledWith("writer-1"));
    expect(screen.queryByText("writer")).toBeNull();
  });
});
