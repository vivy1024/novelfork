import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeClientMock = vi.hoisted(() => ({
  cached: vi.fn(),
  scan: vi.fn(),
  cleanup: vi.fn(),
}));

const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@/app-next/runtime-admin", () => ({
  createRuntimeMaintenanceClient: () => runtimeClientMock,
}));

vi.mock("@/lib/notify", () => ({ notify: notifyMock }));

import { RuntimeEnvironmentPanel } from "./RuntimeEnvironmentPanel";

const cachedScan = {
  terminals: {
    running: 2,
    exited: 1,
    orphanSockets: 1,
  },
  containers: {
    running: 1,
    stopped: 3,
    podmanAvailable: false,
    reason: "Podman 服务当前不可用",
  },
  browsers: {
    processRunning: true,
    connected: true,
    headedRunning: false,
    headedConnected: false,
    activeSessions: 2,
  },
  scannedAt: new Date("2026-05-22T08:30:00.000Z").getTime(),
};

const cleanScan = {
  ...cachedScan,
  terminals: {
    running: 2,
    exited: 0,
    orphanSockets: 0,
  },
  scannedAt: new Date("2026-05-22T08:31:00.000Z").getTime(),
};

beforeEach(() => {
  runtimeClientMock.cached.mockResolvedValue({ cached: true, data: cachedScan });
  runtimeClientMock.scan.mockResolvedValue(cleanScan);
  runtimeClientMock.cleanup.mockResolvedValue({ ok: true, killed: 2 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RuntimeEnvironmentPanel", () => {
  it("loads and renders the cached Runtime resource scan", async () => {
    render(<RuntimeEnvironmentPanel />);

    await waitFor(() => expect(runtimeClientMock.cached).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("运行中 2")).toBeTruthy();
    expect(screen.getByText("已退出 1")).toBeTruthy();
    expect(screen.getByText("Podman 服务当前不可用")).toBeTruthy();
    expect(screen.getByText("活跃会话 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新扫描" })).toBeTruthy();
    expect(runtimeClientMock.scan).not.toHaveBeenCalled();
  });

  it("scans through the Runtime client when no cached result exists", async () => {
    runtimeClientMock.cached.mockResolvedValue({ cached: false });

    render(<RuntimeEnvironmentPanel />);

    expect(await screen.findByText("尚无运行时扫描结果")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "扫描运行时" }));

    await waitFor(() => expect(runtimeClientMock.scan).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("已退出 0")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新扫描" })).toBeTruthy();
  });

  it("cancels cleanup without a request, then confirms cleanup and rescans", async () => {
    render(<RuntimeEnvironmentPanel />);
    await screen.findByText("已退出 1");

    fireEvent.click(screen.getByRole("button", { name: "清理终端资源" }));
    expect(screen.getByRole("heading", { name: "确认清理终端资源？" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(runtimeClientMock.cleanup).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "清理终端资源" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清理" }));

    await waitFor(() => expect(runtimeClientMock.cleanup).toHaveBeenCalledWith("terminals"));
    await waitFor(() => expect(runtimeClientMock.scan).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("已退出 0")).toBeTruthy();
    expect(notifyMock.success).toHaveBeenCalledWith("终端资源清理完成", {
      description: "已清理 2 个退出终端或孤立套接字。",
    });
  });

  it("shows the real Runtime administrator error from cached maintenance", async () => {
    runtimeClientMock.cached.mockRejectedValue(
      Object.assign(new Error("需要管理员权限"), { status: 403 }),
    );

    render(<RuntimeEnvironmentPanel />);

    expect(await screen.findByText(/403：读取运行时缓存需要 Runtime 管理员权限/)).toBeTruthy();
    expect(screen.getByText("尚无运行时扫描结果")).toBeTruthy();
  });

  it("keeps the previous result visible when a rescan fails", async () => {
    runtimeClientMock.scan.mockRejectedValue(new Error("runtime scan unavailable"));

    render(<RuntimeEnvironmentPanel />);
    await screen.findByText("已退出 1");
    fireEvent.click(screen.getByRole("button", { name: "重新扫描" }));

    expect(await screen.findByText(/扫描运行时资源失败：runtime scan unavailable/)).toBeTruthy();
    expect(screen.getByText("已退出 1")).toBeTruthy();
    expect(notifyMock.error).toHaveBeenCalledWith("运行时扫描失败", {
      description: "扫描运行时资源失败：runtime scan unavailable",
    });
  });
});
