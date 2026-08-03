import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gatewayClientMock = vi.hoisted(() => ({
  status: vi.fn(),
  reload: vi.fn(),
  sessions: vi.fn(),
  deleteSession: vi.fn(),
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  weixinQrStart: vi.fn(),
  weixinQrPoll: vi.fn(),
}));

const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../runtime-admin/gateway", () => ({
  createGatewayClient: () => gatewayClientMock,
}));

vi.mock("@/lib/notify", () => ({ notify: notifyMock }));

import { GatewayPanel } from "./GatewayPanel";

const gatewaySession = {
  id: "gateway-session-1",
  platform: "telegram",
  chatId: "chat-42",
  userId: "user-42",
  username: "alice",
  narratorId: "narrator-1",
  appUserId: "app-user-1",
  projectId: "project-1",
  chapterId: "chapter-3",
  lastMessageAt: "2026-03-18T10:00:00.000Z",
  createdAt: "2026-03-17T10:00:00.000Z",
  updatedAt: "2026-03-18T10:00:00.000Z",
};

beforeEach(() => {
  gatewayClientMock.status.mockResolvedValue({ started: true, platforms: ["telegram", "webhook"] });
  gatewayClientMock.sessions.mockResolvedValue([gatewaySession]);
  gatewayClientMock.getConfig.mockResolvedValue({
    enabled: true,
    streaming: true,
    defaultPermissionMode: "bypassPermissions",
    platforms: [{ platform: "telegram", enabled: true, token: "tok-xxx" }],
  });
  gatewayClientMock.reload.mockResolvedValue({
    ok: true,
    reloaded: ["telegram"],
    status: { started: false, platforms: [] },
  });
  gatewayClientMock.deleteSession.mockResolvedValue({ ok: true });
  gatewayClientMock.saveConfig.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GatewayPanel", () => {
  it("loads real Gateway status and session inventory through the runtime client", async () => {
    render(<GatewayPanel />);

    expect(await screen.findByRole("heading", { name: "Gateway" })).toBeTruthy();
    await waitFor(() => {
      expect(gatewayClientMock.status).toHaveBeenCalledTimes(1);
      expect(gatewayClientMock.sessions).toHaveBeenCalledTimes(1);
      expect(gatewayClientMock.getConfig).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText("运行中")).toBeTruthy();
    expect(screen.getAllByText("Telegram").length).toBeGreaterThan(0);
    expect(screen.getByText("Webhook")).toBeTruthy();
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.getByText("叙述者：narrator-1")).toBeTruthy();
    expect(screen.getByText("项目：project-1 · 章节：chapter-3")).toBeTruthy();
  });

  it("reloads the Gateway through the runtime client and adopts returned status", async () => {
    render(<GatewayPanel />);
    await screen.findByText("运行中");

    fireEvent.click(screen.getByRole("button", { name: "重载 Gateway" }));

    await waitFor(() => expect(gatewayClientMock.reload).toHaveBeenCalledWith());
    expect(await screen.findByText("已停止")).toBeTruthy();
    expect(notifyMock.success).toHaveBeenCalledWith("Gateway 已重载", {
      description: "已重载：Telegram",
    });
  });

  it("confirms and deletes a Runtime Gateway session", async () => {
    render(<GatewayPanel />);
    await screen.findByText("alice");

    fireEvent.click(screen.getByRole("button", { name: "删除 alice 的 Gateway 会话" }));
    expect(screen.getByRole("heading", { name: "删除 Gateway 会话？" })).toBeTruthy();
    expect(screen.getByText(/不会删除关联的叙述者/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(gatewayClientMock.deleteSession).toHaveBeenCalledWith("gateway-session-1"));
    expect(await screen.findByText("暂无 Gateway 会话")).toBeTruthy();
    expect(screen.queryByText("alice")).toBeNull();
  });

  it("keeps successful session data visible when the status request fails", async () => {
    gatewayClientMock.status.mockRejectedValue(new Error("gateway unavailable"));

    render(<GatewayPanel />);

    expect(await screen.findByText("alice")).toBeTruthy();
    expect(screen.getByText(/状态：gateway unavailable/)).toBeTruthy();
    expect(screen.getByText("Runtime 未返回 Gateway 状态。")).toBeTruthy();
  });

  it("renders gateway config fields when enabled", async () => {
    render(<GatewayPanel />);

    // Wait for config to load
    await waitFor(() => expect(gatewayClientMock.getConfig).toHaveBeenCalledTimes(1));

    // Should show config UI since config.enabled is true
    expect(await screen.findByText("网关配置")).toBeTruthy();
    expect(screen.getByText("平台配置")).toBeTruthy();
    expect(screen.getByText("流式输出")).toBeTruthy();
  });

  it("saves gateway config and triggers reload", async () => {
    gatewayClientMock.getConfig.mockResolvedValue({
      enabled: true,
      streaming: true,
      defaultPermissionMode: "bypassPermissions",
      platforms: [],
    });
    gatewayClientMock.reload.mockResolvedValue({
      ok: true,
      reloaded: [],
      status: { started: true, platforms: [] },
    });

    render(<GatewayPanel />);

    // Wait for config to load
    await waitFor(() => expect(gatewayClientMock.getConfig).toHaveBeenCalledTimes(1));

    // Change streaming to trigger dirty state
    await screen.findByText("流式输出");
    const streamingSwitch = screen.getByText("流式输出").previousElementSibling;
    if (streamingSwitch) fireEvent.click(streamingSwitch);

    // Save button should appear
    const saveButton = await screen.findByRole("button", { name: /保存配置/ });
    fireEvent.click(saveButton);

    await waitFor(() => expect(gatewayClientMock.saveConfig).toHaveBeenCalledTimes(1));
    expect(notifyMock.success).toHaveBeenCalledWith("Gateway 配置已保存");
  });
});
