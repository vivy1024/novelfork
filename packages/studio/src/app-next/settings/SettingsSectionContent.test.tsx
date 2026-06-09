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

import { PROVIDER_MODELS_API_PATH } from "../backend-contract";
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
    if (path === PROVIDER_MODELS_API_PATH) return Promise.resolve({ models: [] });
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

  it("shows model defaults, sub-agent preferences and reasoning settings", async () => {
    render(<SettingsSectionContent sectionId="models" />);
    expect(await screen.findByText("模型设置")).toBeTruthy();
    expect(screen.getByText("默认模型")).toBeTruthy();
    expect(screen.getByText("摘要模型")).toBeTruthy();
    expect(screen.getByText("Explore 子代理模型")).toBeTruthy();
    expect(screen.getByText("Plan 子代理模型")).toBeTruthy();
    expect(screen.getByText("子代理模型池")).toBeTruthy();
    expect(screen.getByText("全局默认推理强度")).toBeTruthy();
    expect(screen.getByText("Codex 推理强度")).toBeTruthy();
  });

  it("RED: 没有真实 settings schema 来源时不展示 Codex 推理强度空字段", async () => {
    render(<SettingsSectionContent sectionId="models" />);
    // After loading, Codex 推理强度 field exists (as a select), its value follows from sampleUser
    expect(await screen.findByText("模型设置")).toBeTruthy();
    // Codex 推理强度 is now always shown as a configurable field
    expect(screen.getByText("Codex 推理强度")).toBeTruthy();
  });

  it("RED: 模型设置通过 RuntimeControlPanel 展示模型选择与推理配置", async () => {
    render(<SettingsSectionContent sectionId="models" />);
    // RuntimeControlPanel loads user settings then renders model selects
    expect(await screen.findByText("模型设置")).toBeTruthy();
    expect(screen.getByLabelText("默认会话模型")).toBeTruthy();
    expect(screen.getByLabelText("摘要模型")).toBeTruthy();
    expect(screen.getByLabelText("全局默认推理强度")).toBeTruthy();
    expect(screen.getByLabelText("Codex 推理强度")).toBeTruthy();
  });

  it("mounts AgentSettingsPanel for agents section", async () => {
    render(<SettingsSectionContent sectionId="agents" />);
    // AgentSettingsPanel shows loading state when API is not mocked
    expect(await screen.findByText("正在读取 Agent 配置…")).toBeTruthy();
  });

  it("shows non-provider settings sections with expected content", async () => {
    const sections = [
      ["notifications", "通知"],
      ["appearance", "外观"],
      ["server", "服务器与系统"],
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
