import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CreateRuntimeDeviceInput,
  DeviceTransferInput,
  DevicesClient,
  RuntimeDevice,
} from "../../runtime-admin/devices";
import { DevicesPanel } from "./DevicesPanel";

const device: RuntimeDevice = {
  id: "device-1",
  name: "Writing PC",
  slug: "writing-pc",
  description: "Windows workstation",
  tokenPrefix: "nf_abcd",
  connectionMode: "reverse",
  directUrl: null,
  status: "online",
  lastSeenAt: "2026-05-05T12:00:00.000Z",
  platformOs: "windows",
  platformArch: "x64",
  shellPath: "C:/Program Files/Git/bin/bash.exe",
  defaultCwd: "D:/Novels",
  agentVersion: "1.0.0",
  capabilities: {},
  scope: "global",
  projectId: null,
  createdAt: "2026-05-01T12:00:00.000Z",
  updatedAt: "2026-05-05T12:00:00.000Z",
  revokedAt: null,
};

function createClient(initialDevices: ReadonlyArray<RuntimeDevice> = [device]): DevicesClient {
  return {
    listDevices: vi.fn().mockResolvedValue(initialDevices),
    createDevice: vi.fn().mockImplementation(async (input: CreateRuntimeDeviceInput) => ({
      device: { ...device, id: "device-2", name: input.name, description: input.description ?? null },
      token: "nf_device_secret",
    })),
    rotateToken: vi.fn().mockResolvedValue({ token: "nf_rotated_secret" }),
    deleteDevice: vi.fn().mockResolvedValue({ success: true }),
    transferFiles: vi.fn().mockResolvedValue({ ok: true, filesTransferred: 1, bytesTransferred: 2048 }),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DevicesPanel", () => {
  it("lists devices and creates a global reverse-connection device with a one-time token", async () => {
    const client = createClient();
    render(<DevicesPanel client={client} refreshIntervalMs={0} />);

    expect(await screen.findByRole("heading", { name: "设备管理" })).toBeTruthy();
    expect(screen.getByText("Writing PC")).toBeTruthy();
    expect(screen.getByText("windows/x64")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "添加设备" }));
    fireEvent.change(screen.getByLabelText("设备名称"), { target: { value: "Laptop" } });
    fireEvent.change(screen.getByLabelText("设备说明"), { target: { value: "Travel machine" } });
    fireEvent.click(screen.getByRole("button", { name: "创建设备" }));

    await waitFor(() => expect(client.createDevice).toHaveBeenCalledWith({
      name: "Laptop",
      description: "Travel machine",
      connectionMode: "reverse",
      directUrl: undefined,
      scope: "global",
    }));
    expect(await screen.findByRole("heading", { name: "保存设备令牌" })).toBeTruthy();
    expect(screen.getAllByText(/nf_device_secret/).length).toBeGreaterThan(0);
  });

  it("rotates tokens and revokes devices only after confirmation", async () => {
    const client = createClient();
    render(<DevicesPanel client={client} refreshIntervalMs={0} />);
    await screen.findByRole("heading", { name: "设备管理" });

    fireEvent.click(screen.getByRole("button", { name: "轮换令牌" }));
    fireEvent.click(screen.getByRole("button", { name: "确认轮换" }));
    await waitFor(() => expect(client.rotateToken).toHaveBeenCalledWith("device-1"));
    expect(await screen.findByRole("heading", { name: "保存设备令牌" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "我已保存" }));

    fireEvent.click(screen.getByRole("button", { name: "删除 Writing PC" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(client.deleteDevice).toHaveBeenCalledWith("device-1"));
    expect(screen.queryByText("Writing PC")).toBeNull();
  });

  it("uses the real transfer endpoint for online device file transfers", async () => {
    const client = createClient();
    render(<DevicesPanel client={client} refreshIntervalMs={0} />);
    await screen.findByRole("heading", { name: "设备管理" });

    fireEvent.click(screen.getByRole("button", { name: "文件传输" }));
    fireEvent.change(screen.getByLabelText("设备路径"), { target: { value: "/books/chapter.md" } });
    fireEvent.change(screen.getByLabelText("Runtime 主机路径"), { target: { value: "D:/backups/chapter.md" } });
    fireEvent.click(screen.getByRole("button", { name: "开始传输" }));

    const expected: DeviceTransferInput = {
      direction: "download",
      remotePath: "/books/chapter.md",
      localPath: "D:/backups/chapter.md",
      recursive: false,
    };
    await waitFor(() => expect(client.transferFiles).toHaveBeenCalledWith("device-1", expected));
    expect(await screen.findByText("文件传输完成：1 个文件，2.0 KB。")).toBeTruthy();
  });
});
