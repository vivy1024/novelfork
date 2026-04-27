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
    { id: "gpt-4o", name: "GPT-4o", enabled: true, contextWindow: 128000, maxOutputTokens: 4096, lastTestStatus: "untested" as const },
  ],
};

function createClient(): ProviderSettingsClient {
  return {
    listProviders: vi.fn(async () => ({ providers: [openaiProvider] })),
    createProvider: vi.fn(async (provider) => ({ provider: { ...provider, priority: 2, models: [] } })),
    refreshModels: vi.fn(async (providerId) => ({
      provider: { ...openaiProvider, id: providerId, models: [
        { id: "gpt-5-codex", name: "GPT-5 Codex", enabled: true, contextWindow: 192000, maxOutputTokens: 8192, lastTestStatus: "untested" as const, lastRefreshedAt: "2026-04-27T00:00:00.000Z" },
      ] },
    })),
    testModel: vi.fn(async () => ({ success: true, latency: 12, model: { id: "gpt-4o", name: "GPT-4o", enabled: true, contextWindow: 128000, maxOutputTokens: 4096, lastTestStatus: "success" as const, lastTestLatency: 12 } })),
    updateModel: vi.fn(async (_providerId, _modelId, updates) => ({ model: { ...openaiProvider.models[0], ...updates } })),
  };
}

function disabledButton(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

afterEach(() => cleanup());

describe("ProviderSettingsPage", () => {
  it("renders platform integration cards and API key provider cards separately", async () => {
    render(<ProviderSettingsPage client={createClient()} />);

    expect(await screen.findByRole("heading", { name: "AI 供应商" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "平台集成" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "API key 接入" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看 Codex 平台集成详情" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看 Kiro 平台集成详情" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看 Cline 平台集成详情" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看 OpenAI API key 接入详情" })).toBeTruthy();
  });

  it("opens Codex platform detail with credential management and disabled import actions", async () => {
    render(<ProviderSettingsPage client={createClient()} />);

    fireEvent.click(await screen.findByRole("button", { name: "查看 Codex 平台集成详情" }));

    expect(await screen.findByText("凭据管理")).toBeTruthy();
    expect(screen.getByText(/平台账号集成/)).toBeTruthy();
    expect(disabledButton("浏览器添加").disabled).toBe(true);
    expect(disabledButton("设备码添加").disabled).toBe(true);
    expect(disabledButton("JSON 导入").disabled).toBe(true);
    expect(screen.getByText("暂无平台账号")).toBeTruthy();
  });

  it("opens OpenAI API provider detail with API fields, model list and refresh action", async () => {
    render(<ProviderSettingsPage client={createClient()} />);

    fireEvent.click(await screen.findByRole("button", { name: "查看 OpenAI API key 接入详情" }));

    expect(await screen.findByText("Base URL")).toBeTruthy();
    expect(screen.getByText("API Key")).toBeTruthy();
    expect(screen.getByText("compatibility")).toBeTruthy();
    expect(screen.getByText("apiMode")).toBeTruthy();
    expect(screen.getByText("https://api.openai.com/v1")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "模型列表" })).toBeTruthy();
    expect(screen.getByText("GPT-4o")).toBeTruthy();
    expect(screen.getByRole("button", { name: "刷新模型" })).toBeTruthy();
  });

  it("refreshes models in API provider detail view", async () => {
    const client = createClient();
    render(<ProviderSettingsPage client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "查看 OpenAI API key 接入详情" }));
    await screen.findByRole("button", { name: "刷新模型" });
    fireEvent.click(screen.getByRole("button", { name: "刷新模型" }));

    await waitFor(() => expect(client.refreshModels).toHaveBeenCalledWith("openai"));
  });

  it("shows empty API key provider state when provider-manager has no providers", async () => {
    const client = createClient();
    (client.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue({ providers: [] });
    render(<ProviderSettingsPage client={client} />);

    await screen.findByRole("heading", { name: "AI 供应商" });
    expect(screen.getByText(/0 API key 供应商/)).toBeTruthy();
    expect(screen.getByText("暂无 API key 供应商")).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看 Codex 平台集成详情" })).toBeTruthy();
  });
});
