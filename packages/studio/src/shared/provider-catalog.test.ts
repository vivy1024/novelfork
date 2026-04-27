import { describe, expect, it } from "vitest";

import {
  PROVIDERS,
  buildManagedProviders,
  buildModelPool,
  getDefaultModel,
  getDefaultProvider,
  getModel,
  getProvider,
  getProviderTypeLabel,
  normalizeProviderForSettings,
  resolveProviderApiTransport,
} from "./provider-catalog";

describe("provider-catalog", () => {
  it("uses shared provider ids and model helpers consistently", () => {
    expect(PROVIDERS.map((provider) => provider.id)).toEqual(["anthropic", "openai", "deepseek", "custom"]);
    expect(getProvider("anthropic")?.name).toBe("Anthropic");
    expect(getProvider("anthropic")?.type).toBe("anthropic");
    expect(getProviderTypeLabel("custom")).toBe("自定义");
    expect(getModel("anthropic", "claude-sonnet-4-6")?.name).toBe("Claude Sonnet 4.6");
  });

  it("builds managed providers and model pool from the canonical registry", () => {
    const managedProviders = buildManagedProviders();
    const defaultProvider = getDefaultProvider();
    const defaultModel = getDefaultModel(defaultProvider.id);
    const modelPool = buildModelPool(managedProviders);

    expect(managedProviders).toHaveLength(PROVIDERS.length);
    expect(managedProviders[0]).toMatchObject({
      id: defaultProvider.id,
      enabled: true,
      priority: 1,
      config: {},
      compatibility: "anthropic-compatible",
      apiMode: "completions",
      prefix: "anthropic",
    });
    expect(managedProviders[0].models[0]).toMatchObject({
      id: defaultModel?.id,
      enabled: true,
      lastTestStatus: "untested",
    });
    expect(defaultModel?.id).toBe(managedProviders[0].models[0]?.id);
    expect(modelPool[0]).toMatchObject({
      modelId: `${managedProviders[0].id}:${managedProviders[0].models[0]?.id}`,
      providerId: managedProviders[0].id,
      providerName: managedProviders[0].name,
      enabled: true,
    });
  });

  it("normalizes legacy provider data for NarraFork-style provider settings", () => {
    const legacy = normalizeProviderForSettings({
      id: "legacy-openai",
      name: "Legacy OpenAI Proxy",
      type: "custom",
      apiKeyRequired: true,
      models: [
        {
          id: "legacy-model",
          name: "Legacy Model",
          contextWindow: 4096,
          maxOutputTokens: 1024,
        },
      ],
    });

    expect(legacy).toMatchObject({
      prefix: "legacy-openai",
      compatibility: "openai-compatible",
      apiMode: "completions",
    });
    expect(legacy.models[0]).toMatchObject({
      enabled: true,
      contextWindow: 4096,
      lastTestStatus: "untested",
    });
  });

  it("maps Studio provider API modes to runtime transport formats", () => {
    expect(resolveProviderApiTransport({ apiMode: "completions" })).toMatchObject({ apiFormat: "chat" });
    expect(resolveProviderApiTransport({ apiMode: "responses" })).toMatchObject({ apiFormat: "responses" });
    expect(resolveProviderApiTransport({ apiMode: "codex", thinkingStrength: "high" })).toMatchObject({
      apiFormat: "codex",
      thinkingStrength: "high",
    });
  });
});
