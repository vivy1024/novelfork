import { describe, expect, it } from "vitest";

import { PROVIDERS } from "../../shared/provider-catalog";
import { ProviderManager } from "./provider-manager";

describe("ProviderManager", () => {
  it("initializes from the shared provider registry", () => {
    const manager = new ProviderManager();
    manager.initialize();

    const providers = manager.listProviders();
    const modelPool = manager.getModelPool();

    expect(providers.map((provider) => provider.id)).toEqual(PROVIDERS.map((provider) => provider.id));
    expect(providers[0]?.models.map((model) => model.id)).toEqual(PROVIDERS[0]?.models.map((model) => model.id));
    expect(modelPool.some((entry) => entry.modelId === "anthropic:claude-sonnet-4-6")).toBe(true);
  });

  it("keeps shared model metadata when updating config only", () => {
    const manager = new ProviderManager();
    manager.initialize();

    const updated = manager.updateProvider("openai", {
      config: { apiKey: "test-key" },
    });

    expect(updated?.config.apiKey).toBe("test-key");
    expect(updated?.models.map((model) => model.id)).toEqual(PROVIDERS.find((provider) => provider.id === "openai")?.models.map((model) => model.id));
    expect(manager.getModel("openai:gpt-4-turbo")?.name).toBe("GPT-4 Turbo");
  });

  it("refreshes provider models with model-level settings metadata", () => {
    const manager = new ProviderManager();
    manager.initialize();

    const refreshed = manager.refreshProviderModels("custom", [
      {
        id: "proxy-chat",
        name: "Proxy Chat",
        contextWindow: 64000,
        maxOutputTokens: 8192,
      },
    ], "2026-04-27T00:00:00.000Z");

    expect(refreshed?.models).toEqual([
      expect.objectContaining({
        id: "proxy-chat",
        enabled: true,
        contextWindow: 64000,
        lastRefreshedAt: "2026-04-27T00:00:00.000Z",
        lastTestStatus: "untested",
      }),
    ]);
    expect(manager.getModel("custom:proxy-chat")?.name).toBe("Proxy Chat");
  });

  it("updates and tests individual model state without disabling the whole provider", async () => {
    const manager = new ProviderManager();
    manager.initialize();
    manager.updateProvider("openai", { config: { apiKey: "test-key" } });

    const updatedModel = manager.updateModel("openai", "gpt-4-turbo", {
      enabled: false,
      contextWindow: 64000,
    });
    const testResult = await manager.testModelConnection("openai", "gpt-4-turbo");

    expect(updatedModel).toMatchObject({ enabled: false, contextWindow: 64000 });
    expect(testResult).toMatchObject({ success: true });
    expect(manager.getProvider("openai")?.enabled).toBe(true);
    expect(manager.getModel("openai:gpt-4-turbo")).toMatchObject({
      lastTestStatus: "success",
      lastTestLatency: expect.any(Number),
    });
  });
});
