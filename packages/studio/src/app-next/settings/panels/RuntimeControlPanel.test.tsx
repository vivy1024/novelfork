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
        translationModel: "__summary__",
        defaultReasoningEffort: "medium",
        subagentModels: { explore: "kiro:claude-sonnet-4.5", plan: "", search: "openai:gpt-4.1", review: "" },
        subagentAllowedModels: { explore: [], plan: [], search: [], general: [], review: [] },
        reasoningEffortBlocklist: [],
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

  it("暴露 Review 子代理模型与允许模型白名单", async () => {
    render(<RuntimeControlPanel />);
    await screen.findByRole("heading", { name: "模型设置" });

    // Runtime supports a review subagent; without these inputs the model and its
    // allowed pool are unreachable from the product UI.
    expect(screen.getByLabelText("Review 子代理模型")).toBeTruthy();
    expect(screen.getByLabelText("review 允许模型")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Review 子代理模型"), { target: { value: "openai:gpt-4.1" } });
    fireEvent.change(screen.getByLabelText("review 允许模型"), { target: { value: "openai:writer-custom" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模型设置" }));

    await waitFor(() => expect(settingsClientMock.patch).toHaveBeenCalledTimes(1));
    const patch = settingsClientMock.patch.mock.calls[0][0];
    expect(patch.agent.subagentModels.review).toBe("openai:gpt-4.1");
    expect(patch.agent.subagentAllowedModels.review).toEqual(["openai:writer-custom"]);
  });

  it("翻译模型默认跟随摘要模型，且哨兵值不被当成库存外模型", async () => {
    render(<RuntimeControlPanel />);
    await screen.findByRole("heading", { name: "模型设置" });

    const translation = screen.getByLabelText("翻译模型") as HTMLSelectElement;
    expect(translation.value).toBe("__summary__");
    expect(translation.textContent).toContain("跟随摘要模型");
    expect(screen.queryByText(/__summary__/)).toBeNull();

    fireEvent.change(translation, { target: { value: "openai:gpt-4.1" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模型设置" }));

    await waitFor(() => expect(settingsClientMock.patch).toHaveBeenCalledTimes(1));
    expect(settingsClientMock.patch.mock.calls[0][0].agent.translationModel).toBe("openai:gpt-4.1");
  });

  it("默认推理强度提供 Runtime 的全部七档，含默认值 max", async () => {
    render(<RuntimeControlPanel />);
    await screen.findByRole("heading", { name: "模型设置" });

    const select = screen.getByLabelText("默认推理强度") as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);
    // Runtime ships defaultReasoningEffort: "max"; excluding it left the product
    // unable to express the shipped default.
    expect(values).toEqual(["", "none", "low", "medium", "high", "xhigh", "max"]);
  });

  it("推理强度黑名单可增删并按 Runtime 形状提交", async () => {
    render(<RuntimeControlPanel />);
    await screen.findByRole("heading", { name: "模型设置" });

    expect(screen.getByText(/暂无规则/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /添加规则/ }));
    fireEvent.change(screen.getByLabelText("推理强度黑名单模式 1"), {
      target: { value: "  claude-3  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存模型设置" }));

    await waitFor(() => expect(settingsClientMock.patch).toHaveBeenCalledTimes(1));
    // Patterns are trimmed and default to enabled, matching the Runtime schema.
    expect(settingsClientMock.patch.mock.calls[0][0].agent.reasoningEffortBlocklist).toEqual([
      { pattern: "claude-3", enabled: true },
    ]);
  });

  it("空白模式不会被提交到 Runtime", async () => {
    render(<RuntimeControlPanel />);
    await screen.findByRole("heading", { name: "模型设置" });

    fireEvent.click(screen.getByRole("button", { name: /添加规则/ }));
    fireEvent.change(screen.getByLabelText("推理强度黑名单模式 1"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "保存模型设置" }));

    await waitFor(() => expect(settingsClientMock.patch).toHaveBeenCalledTimes(1));
    expect(settingsClientMock.patch.mock.calls[0][0].agent.reasoningEffortBlocklist).toEqual([]);
  });

  it("聚合成员可调整顺序，顺序即 priority 路由优先级", async () => {
    settingsClientMock.get.mockResolvedValue({
      ...settings,
      agent: {
        ...settings.agent,
        modelAggregations: [
          {
            id: "fast",
            name: "Fast",
            models: ["openai:gpt-4.1", "openai:writer-custom"],
            routingMode: "priority",
          },
        ],
      },
    });

    render(<RuntimeControlPanel />);
    await screen.findByRole("heading", { name: "模型设置" });

    fireEvent.click(screen.getByRole("button", { name: "下移 openai:gpt-4.1" }));
    fireEvent.click(screen.getByRole("button", { name: "保存模型设置" }));

    await waitFor(() => expect(settingsClientMock.patch).toHaveBeenCalledTimes(1));
    expect(settingsClientMock.patch.mock.calls[0][0].agent.modelAggregations[0].models).toEqual([
      "openai:writer-custom",
      "openai:gpt-4.1",
    ]);
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
