import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Radix Select never opens in jsdom. Render it as a native select so scope
// switching is testable without asserting on Radix internals.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const context = React.createContext<{
    value: string;
    onValueChange: (value: string) => void;
    options: React.ReactNode;
  } | null>(null);

  function collectItems(node: React.ReactNode): React.ReactNode[] {
    const items: React.ReactNode[] = [];
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as { value?: unknown; children?: React.ReactNode };
      if (typeof props.value === "string") {
        items.push(
          React.createElement("option", { key: props.value, value: props.value }, props.children),
        );
        return;
      }
      items.push(...collectItems(props.children));
    });
    return items;
  }

  return {
    Select: ({ value, onValueChange, children }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children?: React.ReactNode;
    }) =>
      React.createElement(
        context.Provider,
        {
          value: {
            value: value ?? "",
            onValueChange: onValueChange ?? (() => {}),
            options: collectItems(children),
          },
        },
        children,
      ),
    SelectTrigger: ({ id, "aria-label": ariaLabel }: { id?: string; "aria-label"?: string }) => {
      const ctx = React.useContext(context);
      return React.createElement(
        "select",
        {
          id,
          "aria-label": ariaLabel,
          value: ctx?.value ?? "",
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
            ctx?.onValueChange(event.currentTarget.value),
        },
        ctx?.options,
      );
    },
    SelectValue: () => null,
    SelectContent: () => null,
    SelectGroup: () => null,
    SelectItem: () => null,
    SelectLabel: () => null,
  };
});

import type {
  CreateRuntimeDeviceInput,
  DeviceConnectionDiagnostics,
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

const readyDiagnostics: DeviceConnectionDiagnostics = {
  deviceId: "device-1",
  mode: "reverse",
  online: true,
  stage: "ready",
  protocolVersion: 3,
  agentVersion: "1.0.0",
  lastEventAt: 1_785_000_000_000,
  capabilities: { shell: true, fileTransfer: true, browser: false },
};

function createClient(initialDevices: ReadonlyArray<RuntimeDevice> = [device]): DevicesClient {
  return {
    listDevices: vi.fn().mockResolvedValue(initialDevices),
    listProjects: vi.fn().mockResolvedValue([
      { id: "proj-42", name: "青云志", status: "active" },
      { id: "proj-7", name: "长夜行", status: "active" },
    ]),
    createDevice: vi.fn().mockImplementation(async (input: CreateRuntimeDeviceInput) => ({
      device: { ...device, id: "device-2", name: input.name, description: input.description ?? null },
      token: "nf_device_secret",
    })),
    rotateToken: vi.fn().mockResolvedValue({ token: "nf_rotated_secret" }),
    updateDevice: vi.fn().mockImplementation(async (id: string, input: Record<string, unknown>) => ({
      ...device,
      id,
      ...input,
    })),
    deleteDevice: vi.fn().mockResolvedValue({ success: true }),
    transferFiles: vi.fn().mockResolvedValue({ ok: true, filesTransferred: 1, bytesTransferred: 2048 }),
    diagnostics: vi.fn().mockResolvedValue(readyDiagnostics),
    testConnection: vi.fn().mockResolvedValue({
      ok: true,
      stage: "rpc_ready",
      latencyMs: 42,
      diagnostics: readyDiagnostics,
    }),
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

  it("测试连接后展示阶段、耗时与执行器能力集", async () => {
    const client = createClient();
    render(<DevicesPanel client={client} refreshIntervalMs={0} />);
    await screen.findByRole("heading", { name: "设备管理" });

    fireEvent.click(screen.getByRole("button", { name: /测试连接/ }));

    await waitFor(() => expect(client.testConnection).toHaveBeenCalledWith("device-1"));
    expect(await screen.findByText("连接测试通过")).toBeTruthy();
    expect(screen.getByText(/RPC 可用（rpc_ready）/)).toBeTruthy();
    expect(screen.getByText("耗时 42 ms")).toBeTruthy();
    // Diagnostics come back with the test result, so no extra request is needed.
    expect(screen.getByText(/握手阶段：已就绪（ready）/)).toBeTruthy();
    expect(screen.getByText(/协议版本：3/)).toBeTruthy();
    expect(screen.getByText("shell")).toBeTruthy();
    expect(screen.getByText("browser：否")).toBeTruthy();
  });

  it("测试失败时给出停在哪一阶段以及传输层错误", async () => {
    const client = createClient([{ ...device, status: "offline", connectionMode: "direct", directUrl: "wss://pc.local:8443" }]);
    const failedDiagnostics: DeviceConnectionDiagnostics = {
      deviceId: "device-1",
      mode: "direct",
      online: false,
      stage: "reconnect_wait",
      directUrl: "wss://pc.local:8443",
      socketState: "closed",
      lastError: "connect ECONNREFUSED 192.168.1.9:8443",
    };
    client.testConnection = vi.fn().mockResolvedValue({
      ok: false,
      stage: "reconnect_wait",
      latencyMs: 5_100,
      message: "connect ECONNREFUSED 192.168.1.9:8443",
      diagnostics: failedDiagnostics,
    });

    render(<DevicesPanel client={client} refreshIntervalMs={0} />);
    await screen.findByRole("heading", { name: "设备管理" });

    fireEvent.click(screen.getByRole("button", { name: /测试连接/ }));

    expect(await screen.findByText("连接测试失败")).toBeTruthy();
    // The stalled stage shows both on the test result line and in the diagnostics block.
    expect(screen.getAllByText(/等待重连（reconnect_wait）/).length).toBe(2);
    expect(screen.getByText(/Socket 状态：closed（已关闭）/)).toBeTruthy();
    expect(screen.getByText(/最近错误：connect ECONNREFUSED 192.168.1.9:8443/)).toBeTruthy();
    expect(screen.getByText(/直连地址：wss:\/\/pc.local:8443/)).toBeTruthy();
  });

  it("诊断按钮单独拉取连接诊断，不发起连接测试", async () => {
    const client = createClient();
    render(<DevicesPanel client={client} refreshIntervalMs={0} />);
    await screen.findByRole("heading", { name: "设备管理" });

    fireEvent.click(screen.getByRole("button", { name: /诊断/ }));

    await waitFor(() => expect(client.diagnostics).toHaveBeenCalledWith("device-1"));
    expect(client.testConnection).not.toHaveBeenCalled();
    expect(await screen.findByText("连接诊断")).toBeTruthy();
    expect(screen.queryByText("连接测试通过")).toBeNull();
  });

  it("执行器未上报能力集时明确说明，而不是留白", async () => {
    const client = createClient();
    client.diagnostics = vi.fn().mockResolvedValue({
      deviceId: "device-1",
      mode: "reverse",
      online: false,
      stage: "waiting_for_executor",
    } satisfies DeviceConnectionDiagnostics);

    render(<DevicesPanel client={client} refreshIntervalMs={0} />);
    await screen.findByRole("heading", { name: "设备管理" });

    fireEvent.click(screen.getByRole("button", { name: /诊断/ }));

    expect(await screen.findByText("执行器尚未上报能力集。")).toBeTruthy();
    expect(screen.getByText(/等待执行器接入（waiting_for_executor）/)).toBeTruthy();
  });

  it("创建设备可绑定到指定项目，未选项目时不允许提交", async () => {
    const client = createClient();
    render(<DevicesPanel client={client} refreshIntervalMs={0} />);
    await screen.findByRole("heading", { name: "设备管理" });
    await waitFor(() => expect(client.listProjects).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /添加设备/ }));
    fireEvent.change(screen.getByLabelText("设备名称"), { target: { value: "项目专用机" } });

    // Scope defaults to global; the project picker only appears for project scope.
    expect(screen.queryByLabelText("绑定项目")).toBeNull();

    fireEvent.change(screen.getByLabelText("作用域"), { target: { value: "project" } });
    const picker = (await screen.findByLabelText("绑定项目")) as HTMLSelectElement;
    // Projects are chosen by name rather than by a hand-typed id.
    expect(Array.from(picker.options).map((option) => option.textContent)).toContain("青云志");
    expect((screen.getByRole("button", { name: "创建设备" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(picker, { target: { value: "proj-42" } });
    fireEvent.click(screen.getByRole("button", { name: "创建设备" }));

    await waitFor(() => expect(client.createDevice).toHaveBeenCalledWith({
      name: "项目专用机",
      description: undefined,
      connectionMode: "reverse",
      directUrl: undefined,
      scope: "project",
      projectId: "proj-42",
    }));
  });

  it("项目列表不可用时降级为手动填写项目 ID", async () => {
    const client = createClient();
    client.listProjects = vi.fn().mockRejectedValue(new Error("projects unavailable"));

    render(<DevicesPanel client={client} refreshIntervalMs={0} />);
    await screen.findByRole("heading", { name: "设备管理" });

    fireEvent.click(screen.getByRole("button", { name: /添加设备/ }));
    fireEvent.change(screen.getByLabelText("设备名称"), { target: { value: "手填绑定" } });
    fireEvent.change(screen.getByLabelText("作用域"), { target: { value: "project" } });

    const input = await screen.findByLabelText("项目 ID");
    expect(screen.getByText(/未能读取项目列表/)).toBeTruthy();

    fireEvent.change(input, { target: { value: "proj-manual" } });
    fireEvent.click(screen.getByRole("button", { name: "创建设备" }));

    await waitFor(() => expect(client.createDevice).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "project", projectId: "proj-manual" }),
    ));
  });

  it("编辑设备可把项目绑定改回全局", async () => {
    const client = createClient([{ ...device, scope: "project", projectId: "proj-7" }]);
    render(<DevicesPanel client={client} refreshIntervalMs={0} />);
    await screen.findByRole("heading", { name: "设备管理" });
    await waitFor(() => expect(client.listProjects).toHaveBeenCalledTimes(1));

    // The card surfaces the current binding so scope is visible without opening the dialog.
    expect(screen.getByText("项目：proj-7")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    expect(((await screen.findByLabelText("绑定项目")) as HTMLSelectElement).value).toBe("proj-7");

    fireEvent.change(screen.getByLabelText("作用域"), { target: { value: "global" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(client.updateDevice).toHaveBeenCalledWith("device-1", {
      name: "Writing PC",
      description: "Windows workstation",
      connectionMode: "reverse",
      directUrl: null,
      scope: "global",
      projectId: null,
    }));
  });
});
