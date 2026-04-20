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
      config: { apiKey: "sk-test-1234567890" },
    });

    expect(updated?.config.apiKey).toBe("sk-test-1234567890");
    expect(updated?.models.map((model) => model.id)).toEqual(PROVIDERS.find((provider) => provider.id === "openai")?.models.map((model) => model.id));
    expect(manager.getModel("openai:gpt-4-turbo")?.name).toBe("GPT-4 Turbo");
  });
});
