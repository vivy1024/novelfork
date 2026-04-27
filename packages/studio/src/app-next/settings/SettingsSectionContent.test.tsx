import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useApiMock = vi.hoisted(() => vi.fn());
const putApiMock = vi.hoisted(() => vi.fn());

vi.mock("../../hooks/use-api", () => ({
  useApi: useApiMock,
  fetchJson: vi.fn(),
  putApi: putApiMock,
}));

import { SettingsSectionContent } from "./SettingsSectionContent";

const sampleUser = {
  profile: { name: "test", email: "t@t.com", gitName: "vivy1024", gitEmail: "vivy@test.com" },
  preferences: { theme: "dark", fontSize: 14 },
  runtimeControls: {
    defaultPermissionMode: "ask",
    contextCompressionThresholdPercent: 80,
    contextTruncateTargetPercent: 70,
    recovery: { maxRetryAttempts: 3, maxRetryDelayMs: 5000 },
    toolAccess: { mcpStrategy: "inherit" },
    runtimeDebug: { tokenDebugEnabled: false, rateDebugEnabled: false, dumpEnabled: false },
  },
  modelDefaults: { defaultSessionModel: "gpt-4o", summaryModel: "gpt-4o-mini", subagentModelPool: ["gpt-4o", "gpt-4o-mini"] },
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

beforeEach(() => {
  useApiMock.mockImplementation((path: string) => {
    if (path === "/settings/user") return { data: sampleUser, loading: false, error: null, refetch: vi.fn() };
    if (path === "/settings/theme") return { data: { theme: "dark" }, loading: false, error: null, refetch: vi.fn() };
    if (path === "/settings/editor") return { data: { fontSize: 14 }, loading: false, error: null, refetch: vi.fn() };
    if (path === "/settings/metrics") return { data: { bunVersion: "1.3.0", dbPath: "/data/storage.sqlite" }, loading: false, error: null, refetch: vi.fn() };
    if (path === "/settings/release") return { data: { version: "0.1.0", commit: "abc1234def", platform: "win32", builtAt: "2026-04-27" }, loading: false, error: null, refetch: vi.fn() };
    return { data: null, loading: false, error: null, refetch: vi.fn() };
  });
  putApiMock.mockResolvedValue({});
});

describe("SettingsSectionContent", () => {
  it("shows profile fields with Git identity and an explicit avatar gap", () => {
    render(<SettingsSectionContent sectionId="profile" />);
    expect(screen.getByRole("heading", { name: "个人资料" })).toBeTruthy();
    expect(screen.getByText("Git 用户名")).toBeTruthy();
    expect(screen.getByText("Git 邮箱")).toBeTruthy();
    expect(screen.getByText(/头像上传未接入/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
  });

  it("saves profile through putApi", async () => {
    render(<SettingsSectionContent sectionId="profile" />);
    fireEvent.change(screen.getByDisplayValue("vivy1024"), { target: { value: "newname" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(putApiMock).toHaveBeenCalledWith("/settings/user", expect.objectContaining({ profile: { gitName: "newname", gitEmail: "vivy@test.com" } })));
  });

  it("shows model defaults, sub-agent preferences and reasoning settings", () => {
    render(<SettingsSectionContent sectionId="models" />);
    expect(screen.getByRole("heading", { name: "模型" })).toBeTruthy();
    expect(screen.getByText("默认模型")).toBeTruthy();
    expect(screen.getByText("摘要模型")).toBeTruthy();
    expect(screen.getByText("Explore 子代理模型")).toBeTruthy();
    expect(screen.getByText("Plan 子代理模型")).toBeTruthy();
    expect(screen.getByText("模型池限制")).toBeTruthy();
    expect(screen.getByText("全局推理强度")).toBeTruthy();
    expect(screen.getByText("Codex 推理强度")).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开 AI 供应商" })).toBeTruthy();
  });

  it("shows runtime agent controls mapped from RuntimeControlPanel", () => {
    render(<SettingsSectionContent sectionId="agents" />);
    expect(screen.getByRole("heading", { name: "AI 代理" })).toBeTruthy();
    expect(screen.getByText("默认权限模式")).toBeTruthy();
    expect(screen.getByText("每条消息最大轮次")).toBeTruthy();
    expect(screen.getByText("可恢复错误最大重试次数")).toBeTruthy();
    expect(screen.getByText("WebFetch 代理模式")).toBeTruthy();
    expect(screen.getByText("上下文窗口阈值")).toBeTruthy();
    expect(screen.getByText("token 用量 / 输出速率")).toBeTruthy();
    expect(screen.getByText("目录 / 命令白名单黑名单")).toBeTruthy();
  });

  it("shows non-provider settings sections with explicit reuse or not-connected status", () => {
    const sections = [
      ["notifications", "通知", "未接入通知配置"],
      ["appearance", "外观与界面", "主题模式"],
      ["server", "服务器与系统", "启动诊断"],
      ["storage", "存储空间", "SQLite 数据库"],
      ["resources", "运行资源", "Admin Resources"],
      ["history", "使用历史", "Admin Requests"],
      ["about", "关于", "版本 / commit / 平台 / 作者"],
    ] as const;

    for (const [sectionId, heading, marker] of sections) {
      cleanup();
      render(<SettingsSectionContent sectionId={sectionId} />);
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
      expect(screen.getAllByText(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).length).toBeGreaterThan(0);
    }
  });
});
