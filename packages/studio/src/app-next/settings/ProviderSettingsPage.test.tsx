import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderSettingsPage, type ProviderSettingsClient } from "./ProviderSettingsPage";

const openaiProvider = {
  id: "openai",
  name: "OpenAI",
  type: "openai" as const,
  enabled: true,
  priority: 1,
  apiKeyRequired: true,
  baseUrl: "https://api.openai.com/v1",
  prefix: "openai",
  compatibility: "openai-compatible" as const,
  apiMode: "responses" as const,
  config: { apiKey: "test-key" },
  models: [
    {
      id: "gpt-4o",
      name: "GPT-4o",
      enabled: true,
      contextWindow: 128000,
      maxOutputTokens: 4096,
      lastTestStatus: "untested" as const,
    },
  ],
};

function createClient(): ProviderSettingsClient {
  return {
    listProviders: vi.fn(async () => ({ providers: [openaiProvider] })),
    createProvider: vi.fn(async (provider) => ({
      provider: {
        ...provider,
        priority: 2,
        models: [],
      },
    })),
    refreshModels: vi.fn(async (providerId) => ({
      provider: {
        ...openaiProvider,
        id: providerId,
        models: [
          {
            id: "gpt-5-codex",
            name: "GPT-5 Codex",
            enabled: true,
            contextWindow: 192000,
            maxOutputTokens: 8192,
            lastTestStatus: "untested" as const,
            lastRefreshedAt: "2026-04-27T00:00:00.000Z",
          },
        ],
      },
    })),
    testModel: vi.fn(async () => ({
      success: true,
      latency: 12,
      model: {
        id: "gpt-4o",
        name: "GPT-4o",
        enabled: true,
        contextWindow: 128000,
        maxOutputTokens: 4096,
        lastTestStatus: "success" as const,
        lastTestLatency: 12,
      },
    })),
    updateModel: vi.fn(async (_providerId, _modelId, updates) => ({
      model: {
        ...openaiProvider.models[0],
        ...updates,
      },
    })),
  };
}

afterEach(() => cleanup());

describe("ProviderSettingsPage", () => {
  it("renders the NarraFork-style provider overview and grouped cards", async () => {
    render(<ProviderSettingsPage client={createClient()} />);

    expect(await screen.findByRole("heading", { name: "AI 供应商" })).toBeTruthy();
    expect(screen.getByText(/1 供应商/)).toBeTruthy();
    expect(screen.getByText(/已启用/)).toBeTruthy();
    expect(screen.getByText(/可用模型/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "平台集成" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "API key 接入" })).toBeTruthy();
    expect(screen.getAllByText("OpenAI").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/responses/).length).toBeGreaterThan(0);
  });

  it("uses the short add-provider form and keeps advanced fields in the provider detail", async () => {
    const client = createClient();
    render(<ProviderSettingsPage client={client} />);

    await screen.findAllByText("OpenAI");
    fireEvent.click(screen.getByRole("button", { name: /添加供应商/ }));
    fireEvent.change(screen.getByLabelText("供应商名称"), { target: { value: "Local Codex" } });
    fireEvent.change(screen.getByLabelText("供应商前缀"), { target: { value: "codex-local" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "test-key" } });
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "http://127.0.0.1:8080/v1" } });
    fireEvent.change(screen.getByLabelText("API 模式"), { target: { value: "codex" } });
    fireEvent.change(screen.getByLabelText("兼容格式"), { target: { value: "openai-compatible" } });
    fireEvent.click(screen.getByRole("button", { name: "保存供应商" }));

    await waitFor(() => expect(client.createProvider).toHaveBeenCalledWith(expect.objectContaining({
      id: "codex-local",
      name: "Local Codex",
      prefix: "codex-local",
      apiMode: "codex",
      compatibility: "openai-compatible",
      baseUrl: "http://127.0.0.1:8080/v1",
      config: { apiKey: "test-key" },
    })));
    expect(screen.getByText("高级字段")).toBeTruthy();
    expect(screen.getByLabelText("ChatGPT 账户 ID")).toBeTruthy();
    expect(screen.getByLabelText("Responses WebSocket")).toBeTruthy();
    expect(screen.getByLabelText("Codex 思考强度")).toBeTruthy();
  });

  it("refreshes models, tests one model and updates context/enabled state", async () => {
    const client = createClient();
    render(<ProviderSettingsPage client={client} />);

    await screen.findAllByText("GPT-4o");
    fireEvent.click(screen.getAllByRole("button", { name: "刷新模型" })[0]);
    await waitFor(() => expect(client.refreshModels).toHaveBeenCalledWith("openai"));

    fireEvent.click(screen.getAllByRole("button", { name: "测试模型 GPT-5 Codex" })[0]);
    await waitFor(() => expect(client.testModel).toHaveBeenCalledWith("openai", "gpt-5-codex"));

    fireEvent.change(screen.getAllByLabelText("GPT-5 Codex 上下文长度")[0], { target: { value: "64000" } });
    fireEvent.click(screen.getAllByRole("button", { name: "保存 GPT-5 Codex 上下文长度" })[0]);
    await waitFor(() => expect(client.updateModel).toHaveBeenCalledWith("openai", "gpt-5-codex", { contextWindow: 64000 }));

    fireEvent.click(screen.getAllByRole("button", { name: "禁用 GPT-5 Codex" })[0]);
    await waitFor(() => expect(client.updateModel).toHaveBeenCalledWith("openai", "gpt-5-codex", { enabled: false }));
  });

  it("shows empty state when no providers exist", async () => {
    const client = createClient();
    (client.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue({ providers: [] });
    render(<ProviderSettingsPage client={client} />);

    await screen.findByRole("heading", { name: "AI 供应商" });
    expect(screen.getAllByText("暂无供应商").length).toBeGreaterThan(0);
  });

  it("shows empty model state when provider has no models", async () => {
    const client = createClient();
    const noModelProvider = { ...openaiProvider, models: [] };
    (client.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue({ providers: [noModelProvider] });
    render(<ProviderSettingsPage client={client} />);

    await screen.findAllByText("OpenAI");
    expect(screen.getAllByText("暂无模型").length).toBeGreaterThan(0);
  });

  it("displays test failure status on model row", async () => {
    const client = createClient();
    (client.testModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: "Connection refused",
      model: {
        ...openaiProvider.models[0],
        lastTestStatus: "error",
        lastTestError: "Connection refused",
      },
    });
    render(<ProviderSettingsPage client={client} />);

    await screen.findAllByText("GPT-4o");
    const testBtn = screen.getAllByRole("button", { name: /测试模型.*GPT-4o/ })[0];
    fireEvent.click(testBtn);
    await waitFor(() => expect(client.testModel).toHaveBeenCalledWith("openai", "gpt-4o"));
  });

  it("supports Anthropic compatible provider creation", async () => {
    const client = createClient();
    render(<ProviderSettingsPage client={client} />);

    await screen.findAllByText("OpenAI");
    fireEvent.click(screen.getByRole("button", { name: /添加供应商/ }));
    fireEvent.change(screen.getByLabelText("供应商名称"), { target: { value: "Anthropic" } });
    fireEvent.change(screen.getByLabelText("供应商前缀"), { target: { value: "anthropic" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-ant-test" } });
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://api.anthropic.com" } });
    fireEvent.change(screen.getByLabelText("API 模式"), { target: { value: "completions" } });
    fireEvent.change(screen.getByLabelText("兼容格式"), { target: { value: "anthropic-compatible" } });
    fireEvent.click(screen.getByRole("button", { name: "保存供应商" }));

    await waitFor(() => expect(client.createProvider).toHaveBeenCalledWith(expect.objectContaining({
      name: "Anthropic",
      prefix: "anthropic",
      apiMode: "completions",
      compatibility: "anthropic-compatible",
    })));
  });
});
