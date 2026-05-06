import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useApiMock = vi.hoisted(() => vi.fn());
const putApiMock = vi.hoisted(() => vi.fn());
const fetchJsonMock = vi.hoisted(() => vi.fn());

vi.mock("../../hooks/use-api", () => ({
  useApi: useApiMock,
  fetchJson: fetchJsonMock,
  putApi: putApiMock,
}));

import { SettingsSectionContent } from "./SettingsSectionContent";

const sampleUser = {
  profile: { name: "test", email: "t@t.com", gitName: "vivy1024", gitEmail: "vivy@test.com" },
  preferences: { theme: "dark", fontSize: 14, fontFamily: "system-ui" },
  runtimeControls: {
    defaultPermissionMode: "ask",
    defaultReasoningEffort: "medium",
    contextCompressionThresholdPercent: 80,
    contextTruncateTargetPercent: 70,
    recovery: { maxRetryAttempts: 3, maxRetryDelayMs: 5000 },
    toolAccess: { allowlist: [], blocklist: [], mcpStrategy: "inherit" },
    runtimeDebug: { tokenDebugEnabled: false, rateDebugEnabled: false, dumpEnabled: false },
  },
  modelDefaults: { defaultSessionModel: "gpt-4o", summaryModel: "gpt-4o-mini", subagentModelPool: ["gpt-4o", "gpt-4o-mini"] },
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

beforeEach(() => {
  fetchJsonMock.mockImplementation((path: string) => {
    if (path === "/settings/user") return Promise.resolve(sampleUser);
    if (path === "/api/providers/models") return Promise.resolve({ models: [] });
    if (path === "/settings/metrics") return Promise.resolve({ bunVersion: "1.3.0", dbPath: "/data/storage.sqlite" });
    return Promise.resolve({});
  });
  useApiMock.mockImplementation((path: string | null) => {
    if (path === "/settings/user") return { data: sampleUser, loading: false, error: null, refetch: vi.fn() };
    if (path === "/settings/metrics") return { data: { bunVersion: "1.3.0", dbPath: "/data/storage.sqlite" }, loading: false, error: null, refetch: vi.fn() };
    if (path === "/settings/release") return { data: { version: "0.1.0", commit: "abc1234def", platform: "win32" }, loading: false, error: null, refetch: vi.fn() };
    return { data: null, loading: false, error: null, refetch: vi.fn() };
  });
  putApiMock.mockResolvedValue(sampleUser);
});

describe("SettingsSectionContent", () => {
  it("shows profile fields with Git identity and an explicit avatar gap", async () => {
    render(<SettingsSectionContent sectionId="profile" />);
    expect(await screen.findByText("个人资料")).toBeTruthy();
    expect(screen.getByText("Git 用户名")).toBeTruthy();
    expect(screen.getByText("Git 邮箱")).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
  });

  it("shows model defaults, sub-agent preferences and reasoning settings", () => {
    render(<SettingsSectionContent sectionId="models" />);
    expect(screen.getByText("模型")).toBeTruthy();
    expect(screen.getByText("默认模型")).toBeTruthy();
    expect(screen.getByText("摘要模型")).toBeTruthy();
    expect(screen.getByText("Explore 子代理模型")).toBeTruthy();
    expect(screen.getByText("Plan 子代理模型")).toBeTruthy();
    expect(screen.getByText("模型池限制")).toBeTruthy();
    expect(screen.getByText("全局推理强度")).toBeTruthy();
    expect(screen.queryByText("Codex 推理强度")).toBeNull();
    expect(screen.getByRole("button", { name: "打开 AI 供应商" })).toBeTruthy();
  });

  it("RED: 没有真实 settings schema 来源时不展示 Codex 推理强度空字段", () => {
    render(<SettingsSectionContent sectionId="models" />);

    expect(screen.queryByText("Codex 推理强度")).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("RED: 模型设置通过 SettingsTruthModel 展示来源、状态和读写 API", () => {
    render(<SettingsSectionContent sectionId="models" />);

    expect(screen.getAllByText("来源：用户设置").length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText("读取：/api/settings/user").length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText("写入：/api/settings/user").length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText("状态：已配置").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("—")).toBeNull();
  });

  it("mounts RuntimeControlPanel for agents section", async () => {
    render(<SettingsSectionContent sectionId="agents" />);
    expect(await screen.findByText("权限与推理")).toBeTruthy();
  });

  it("shows non-provider settings sections with explicit reuse or not-connected status", async () => {
    const sections = [
      ["notifications", "通知", "此功能尚未开放"],
      ["appearance", "外观"],
      ["server", "服务器与系统"],
      ["history", "使用历史"],
      ["about", "关于"],
    ] as const;

    for (const [sectionId, ...markers] of sections) {
      cleanup();
      render(<SettingsSectionContent sectionId={sectionId} />);
      for (const marker of markers) {
        expect((await screen.findAllByText(new RegExp(marker))).length).toBeGreaterThan(0);
      }
    }
  });
});
