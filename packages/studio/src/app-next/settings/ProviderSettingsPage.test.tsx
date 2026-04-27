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

afterEach(() => cleanup());

describe("ProviderSettingsPage", () => {
  it("renders provider overview and grouped cards", async () => {
    render(<ProviderSettingsPage client={createClient()} />);
    expect(await screen.findByRole("heading", { name: "AI 供应商" })).toBeTruthy();
    expect(screen.getAllByText("OpenAI").length).toBeGreaterThan(0);
  });

  it("navigates to detail view on card click and back", async () => {
    render(<ProviderSettingsPage client={createClient()} />);
    await screen.findAllByText("OpenAI");
    // Click the provider name button to enter detail view
    fireEvent.click(screen.getAllByText("OpenAI")[0]);
    // Should see detail view with back button and model list
    expect(await screen.findByText(/返回供应商列表/)).toBeTruthy();
    expect(screen.getByText("GPT-4o")).toBeTruthy();
    // Go back
    fireEvent.click(screen.getByText(/返回供应商列表/));
    expect(screen.getAllByText("OpenAI").length).toBeGreaterThan(0);
  });

  it("refreshes models in detail view", async () => {
    const client = createClient();
    render(<ProviderSettingsPage client={client} />);
    await screen.findAllByText("OpenAI");
    fireEvent.click(screen.getAllByText("OpenAI")[0]);
    await screen.findByText(/返回供应商列表/);
    fireEvent.click(screen.getByRole("button", { name: "刷新模型" }));
    await waitFor(() => expect(client.refreshModels).toHaveBeenCalledWith("openai"));
  });

  it("shows empty state when no providers exist", async () => {
    const client = createClient();
    (client.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue({ providers: [] });
    render(<ProviderSettingsPage client={client} />);
    await screen.findByRole("heading", { name: "AI 供应商" });
    // With no providers, stats show 0
    expect(screen.getByText(/0 供应商/)).toBeTruthy();
  });
});
