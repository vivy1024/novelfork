import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsClientMock = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  testModel: vi.fn(),
  generateTls: vi.fn(),
  addRetryRule: vi.fn(),
}));

vi.mock("../../runtime-admin", () => ({
  createSettingsClient: () => settingsClientMock,
}));

vi.mock("@/components/ui/simple-select", () => ({
  SimpleSelect: ({ value, onValueChange, options, placeholder, "aria-label": ariaLabel }: {
    value: string;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    placeholder?: string;
    "aria-label"?: string;
  }) => (
    <select aria-label={ariaLabel} value={value} onChange={(event) => onValueChange(event.currentTarget.value)}>
      {placeholder && !options.some((option) => option.value === "") ? <option value="">{placeholder}</option> : null}
      {options.map((option) => <option key={`${ariaLabel}-${option.value}`} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

import { RuntimeControlPanel } from "./RuntimeControlPanel";

const settings = {
  server: { port: 7778, host: "localhost", openBrowser: "browser" },
  agent: {
    defaultModel: "openai:gpt-4.1",
    summaryModel: "kiro:claude-haiku-4.5",
    maxTurns: 200,
    defaultPermissionMode: "acceptEdits",
    defaultStartInPlanMode: false,
    defaultReasoningEffort: "medium",
    subagentModels: { explore: "kiro:claude-sonnet-4.5", plan: "", search: "openai:gpt-4.1" },
    hiddenModels: ["openai:gpt-5"],
    customModels: [{ value: "openai:writer-custom", label: "Writer Custom", provider: "openai" }],
    modelContextWindows: { "openai:writer-custom": 128000 },
  },
  codex: { defaultReasoningEffort: "high" },
  customApiProviders: [{ id: "openai-main", name: "OpenAI Main", prefix: "openai", apiKey: "********1234", baseUrl: "https://api.example/v1", defaultModel: "gpt-4.1", protocol: "responses-compatible" }],
  openaiProviders: [{ id: "openai-main", name: "OpenAI 派生缓存", prefix: "openai", apiKey: "********1234", baseUrl: "https://api.example/v1", defaultModel: "gpt-4.1", apiMode: "responses" }],
  kiroModels: [{ id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" }, { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" }],
  openaiModelsGrouped: [{ providerId: "openai-main", providerName: "OpenAI 派生缓存", models: [{ id: "gpt-4.1" }, { id: "gpt-5" }] }],
  codexModels: [{ id: "gpt-5-codex", name: "GPT-5 Codex" }],
};

beforeEach(() => {
  settingsClientMock.get.mockResolvedValue(settings);
  settingsClientMock.patch.mockImplementation(async (patch) => ({ ...settings, ...patch }));
  settingsClientMock.testModel.mockResolvedValue({ text: "测试通过", requestUrls: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RuntimeControlPanel", () => {
  it("只从标准 API 分组派生新模型选项，并保留历史平台当前值", async () => {
    render(<RuntimeControlPanel />);

    expect(await screen.findByRole("heading", { name: "模型设置" })).toBeTruthy();
    expect(settingsClientMock.get).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("默认模型").textContent).toContain("OpenAI Main · gpt-4.1");
    expect(screen.getByLabelText("默认模型").textContent).toContain("OpenAI Main · Writer Custom");
    expect(screen.getByLabelText("默认模型").textContent).not.toContain("gpt-5");
    expect(screen.getByLabelText("默认模型").textContent).not.toContain("OpenAI 派生缓存");
    expect(screen.getByLabelText("默认模型").textContent).not.toContain("Codex · GPT-5 Codex");
    expect(screen.getByLabelText("摘要模型").textContent).toContain("未列入标准 API 库");
    expect(screen.getByLabelText("Explore 子代理模型").textContent).toContain("未列入标准 API 库");
    expect((screen.getByLabelText("Codex Native 默认推理强度") as HTMLSelectElement).value).toBe("high");
  });

  it("只 PATCH 通用 agent 与 Codex 协议推理字段，不回写平台账户设置或 GET 载荷", async () => {
    render(<RuntimeControlPanel />);
    await screen.findByRole("heading", { name: "模型设置" });

    fireEvent.change(screen.getByLabelText("默认模型"), { target: { value: "openai:writer-custom" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模型设置" }));

    await waitFor(() => expect(settingsClientMock.patch).toHaveBeenCalledTimes(1));
    const patch = settingsClientMock.patch.mock.calls[0][0];
    expect(patch).toEqual({
      agent: {
        defaultModel: "openai:writer-custom",
        summaryModel: "kiro:claude-haiku-4.5",
        defaultReasoningEffort: "medium",
        subagentModels: { explore: "kiro:claude-sonnet-4.5", plan: "", search: "openai:gpt-4.1" },
        subagentAllowedModels: { explore: [], plan: [], search: [], general: [] },
        modelAggregations: [],
      },
      codex: {
        defaultReasoningEffort: "high",
      },
    });
    expect(patch).not.toHaveProperty("customApiProviders");
    expect(patch).not.toHaveProperty("openaiModelsGrouped");
    expect(patch).not.toHaveProperty("server");
  });

  it("uses Runtime test-model action", async () => {
    render(<RuntimeControlPanel />);
    await screen.findByRole("heading", { name: "模型设置" });

    fireEvent.change(screen.getByLabelText("测试模型"), { target: { value: "openai:writer-custom" } });
    fireEvent.change(screen.getByLabelText("测试提示词"), { target: { value: "测试写作模型" } });
    fireEvent.click(screen.getByRole("button", { name: "测试模型" }));

    await waitFor(() => expect(settingsClientMock.testModel).toHaveBeenCalledWith({
      model: "openai:writer-custom",
      prompt: "测试写作模型",
    }));
    expect(await screen.findByText("测试通过")).toBeTruthy();
  });

  it("不暴露旧模型池，也不重复 AI 代理页的权限与轮次字段", async () => {
    render(<RuntimeControlPanel />);
    await screen.findByRole("heading", { name: "模型设置" });

    expect(screen.queryByText("子代理模型池")).toBeNull();
    expect(screen.queryByText("全部允许")).toBeNull();
    expect(screen.queryByText("逐项询问")).toBeNull();
    expect(screen.queryByText("计划模式")).toBeNull();
    expect(screen.queryByLabelText("默认权限模式")).toBeNull();
    expect(screen.queryByLabelText("最大轮次")).toBeNull();
  });
});
