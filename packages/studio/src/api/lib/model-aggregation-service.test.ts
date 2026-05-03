import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProviderAdapterRegistry, type RuntimeAdapter } from "./provider-adapters";
import { ProviderRuntimeStore } from "./provider-runtime-store";
import { createLlmRuntimeService } from "./llm-runtime-service";
import type { ModelAggregation } from "../../types/settings";
import { resetRoundRobinCounters } from "./model-aggregation-service";

const okAdapter = (content = "ok"): RuntimeAdapter => ({
  listModels: vi.fn(async () => ({ success: true as const, models: [] })),
  testModel: vi.fn(async () => ({ success: true as const, latency: 10 })),
  generate: vi.fn(async () => ({ success: true as const, type: "message" as const, content })),
});

// Mock user-config-service for aggregation lookups
let mockAggregations: ModelAggregation[] = [];

vi.mock("./user-config-service", () => ({
  loadUserConfig: vi.fn(async () => ({
    modelDefaults: {
      defaultSessionModel: "",
      summaryModel: "",
      exploreSubagentModel: "",
      planSubagentModel: "",
      generalSubagentModel: "",
      subagentModelPool: [],
      codexReasoningEffort: "high",
      validation: { defaultSessionModel: "empty", summaryModel: "empty", subagentModelPool: {}, invalidModelIds: [] },
      aggregations: mockAggregations,
    },
    profile: { name: "", email: "" },
    preferences: { theme: "auto", fontSize: 14, fontFamily: "system-ui", editorLineHeight: 1.6, editorTabSize: 2, autoSave: true, autoSaveDelay: 2000, dailyWordTarget: 6000, workbenchMode: false, advancedAnimations: true, wrapMarkdown: true, wrapCode: true, wrapDiff: true, language: "zh" },
    runtimeControls: {},
    onboarding: { dismissedFirstRun: false, dismissedGettingStarted: false, tasks: {} },
    shortcuts: {},
    recentWorkspaces: [],
    proxy: { providers: {}, webFetch: "", platforms: {} },
  })),
  updateUserConfig: vi.fn(async () => ({})),
}));

describe("model-aggregation-service integration with llm-runtime-service", () => {
  let runtimeDir: string;
  let store: ProviderRuntimeStore;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "novelfork-agg-"));
    store = new ProviderRuntimeStore({ storagePath: join(runtimeDir, "provider-runtime.json") });
    mockAggregations = [];
    resetRoundRobinCounters();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it("resolves aggregation with priority strategy to the first available member", async () => {
    const adapter = okAdapter("来自 sub2api");
    await store.createProvider({
      id: "sub2api",
      name: "Sub2API",
      type: "custom",
      enabled: true,
      priority: 1,
      apiKeyRequired: true,
      config: { apiKey: "sk-live" },
      models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", contextWindow: 128000, maxOutputTokens: 8192, enabled: true, source: "detected" }],
    });
    await store.createProvider({
      id: "openrouter",
      name: "OpenRouter",
      type: "custom",
      enabled: true,
      priority: 2,
      apiKeyRequired: true,
      config: { apiKey: "sk-or" },
      models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", contextWindow: 128000, maxOutputTokens: 8192, enabled: true, source: "detected" }],
    });

    mockAggregations = [{
      id: "agg:ds-v4-flash",
      displayName: "DeepSeek V4 Flash",
      members: [
        { providerId: "sub2api", modelId: "deepseek-v4-flash", priority: 1 },
        { providerId: "openrouter", modelId: "deepseek-v4-flash", priority: 2 },
      ],
      routingStrategy: "priority",
    }];

    const service = createLlmRuntimeService({
      store,
      adapters: createProviderAdapterRegistry({ "openai-compatible": adapter }),
    });

    const result = await service.generate({
      sessionConfig: { providerId: "", modelId: "agg:ds-v4-flash", permissionMode: "edit", reasoningEffort: "medium" },
      messages: [{ id: "m1", role: "user", content: "test", timestamp: 1 }],
    });

    expect(result).toMatchObject({
      success: true,
      type: "message",
      content: "来自 sub2api",
      metadata: { providerId: "sub2api", modelId: "deepseek-v4-flash" },
    });
  });

  it("falls back to next member when first provider is unavailable", async () => {
    const adapter = okAdapter("来自 openrouter");
    // sub2api is disabled
    await store.createProvider({
      id: "sub2api",
      name: "Sub2API",
      type: "custom",
      enabled: false,
      priority: 1,
      apiKeyRequired: true,
      config: { apiKey: "sk-live" },
      models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", contextWindow: 128000, maxOutputTokens: 8192, enabled: true, source: "detected" }],
    });
    await store.createProvider({
      id: "openrouter",
      name: "OpenRouter",
      type: "custom",
      enabled: true,
      priority: 2,
      apiKeyRequired: true,
      config: { apiKey: "sk-or" },
      models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", contextWindow: 128000, maxOutputTokens: 8192, enabled: true, source: "detected" }],
    });

    mockAggregations = [{
      id: "agg:ds-v4-flash",
      displayName: "DeepSeek V4 Flash",
      members: [
        { providerId: "sub2api", modelId: "deepseek-v4-flash", priority: 1 },
        { providerId: "openrouter", modelId: "deepseek-v4-flash", priority: 2 },
      ],
      routingStrategy: "priority",
    }];

    const service = createLlmRuntimeService({
      store,
      adapters: createProviderAdapterRegistry({ "openai-compatible": adapter }),
    });

    const result = await service.generate({
      sessionConfig: { providerId: "", modelId: "agg:ds-v4-flash", permissionMode: "edit", reasoningEffort: "medium" },
      messages: [{ id: "m1", role: "user", content: "test", timestamp: 1 }],
    });

    expect(result).toMatchObject({
      success: true,
      type: "message",
      content: "来自 openrouter",
      metadata: { providerId: "openrouter", modelId: "deepseek-v4-flash" },
    });
  });

  it("returns model-unavailable when all aggregation members are unavailable", async () => {
    // No providers at all
    mockAggregations = [{
      id: "agg:empty",
      displayName: "Empty Agg",
      members: [
        { providerId: "sub2api", modelId: "nonexistent", priority: 1 },
      ],
      routingStrategy: "priority",
    }];

    const service = createLlmRuntimeService({
      store,
      adapters: createProviderAdapterRegistry({ "openai-compatible": okAdapter() }),
    });

    const result = await service.generate({
      sessionConfig: { providerId: "", modelId: "agg:empty", permissionMode: "edit", reasoningEffort: "medium" },
      messages: [{ id: "m1", role: "user", content: "test", timestamp: 1 }],
    });

    expect(result).toMatchObject({
      success: false,
      code: "model-unavailable",
    });
    expect(result.success === false && result.error).toContain("No available member");
  });

  it("returns model-unavailable for non-existent aggregation id", async () => {
    mockAggregations = [];

    const service = createLlmRuntimeService({
      store,
      adapters: createProviderAdapterRegistry({ "openai-compatible": okAdapter() }),
    });

    const result = await service.generate({
      sessionConfig: { providerId: "", modelId: "agg:nonexistent", permissionMode: "edit", reasoningEffort: "medium" },
      messages: [{ id: "m1", role: "user", content: "test", timestamp: 1 }],
    });

    expect(result).toMatchObject({
      success: false,
      code: "model-unavailable",
    });
    expect(result.success === false && result.error).toContain("Aggregation not found");
  });

  it("round-robin strategy cycles through available members", async () => {
    const adapter = okAdapter("rr");
    await store.createProvider({
      id: "provider-a",
      name: "Provider A",
      type: "custom",
      enabled: true,
      priority: 1,
      apiKeyRequired: true,
      config: { apiKey: "sk-a" },
      models: [{ id: "model-x", name: "Model X", contextWindow: 128000, maxOutputTokens: 8192, enabled: true, source: "manual" }],
    });
    await store.createProvider({
      id: "provider-b",
      name: "Provider B",
      type: "custom",
      enabled: true,
      priority: 2,
      apiKeyRequired: true,
      config: { apiKey: "sk-b" },
      models: [{ id: "model-x", name: "Model X", contextWindow: 128000, maxOutputTokens: 8192, enabled: true, source: "manual" }],
    });

    mockAggregations = [{
      id: "agg:rr-test",
      displayName: "RR Test",
      members: [
        { providerId: "provider-a", modelId: "model-x", priority: 1 },
        { providerId: "provider-b", modelId: "model-x", priority: 2 },
      ],
      routingStrategy: "round-robin",
    }];

    const service = createLlmRuntimeService({
      store,
      adapters: createProviderAdapterRegistry({ "openai-compatible": adapter }),
    });

    const input = {
      sessionConfig: { providerId: "", modelId: "agg:rr-test", permissionMode: "edit" as const, reasoningEffort: "medium" as const },
      messages: [{ id: "m1", role: "user" as const, content: "test", timestamp: 1 }],
    };

    const result1 = await service.generate(input);
    const result2 = await service.generate(input);

    // Should alternate between provider-a and provider-b
    expect(result1.success && result1.metadata.providerId).toBe("provider-a");
    expect(result2.success && result2.metadata.providerId).toBe("provider-b");
  });
});
