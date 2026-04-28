import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createProviderAdapterRegistry, type RuntimeAdapter } from "./provider-adapters";
import { ProviderRuntimeStore } from "./provider-runtime-store";
import { createLlmRuntimeService } from "./llm-runtime-service";

const okAdapter = (content = "来自真实 adapter 的回复"): RuntimeAdapter => ({
  listModels: vi.fn(async () => ({ success: true as const, models: [] })),
  testModel: vi.fn(async () => ({ success: true as const, latency: 10 })),
  generate: vi.fn(async () => ({ success: true as const, content })),
});

describe("llm-runtime-service", () => {
  let runtimeDir: string;
  let store: ProviderRuntimeStore;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "novelfork-llm-runtime-"));
    store = new ProviderRuntimeStore({ storagePath: join(runtimeDir, "provider-runtime.json") });
  });

  afterEach(async () => {
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it("validates the runtime model pool and calls the target adapter", async () => {
    const adapter = okAdapter("真实回复");
    await store.createProvider({
      id: "sub2api",
      name: "Sub2API",
      type: "custom",
      enabled: true,
      priority: 1,
      apiKeyRequired: true,
      baseUrl: "https://gateway.example/v1",
      compatibility: "openai-compatible",
      config: { apiKey: "sk-live" },
      models: [{ id: "gpt-5-codex", name: "GPT-5 Codex", contextWindow: 192000, maxOutputTokens: 8192, enabled: true, source: "detected" }],
    });

    const service = createLlmRuntimeService({
      store,
      adapters: createProviderAdapterRegistry({ "openai-compatible": adapter }),
    });

    const result = await service.generate({
      sessionConfig: { providerId: "sub2api", modelId: "gpt-5-codex", permissionMode: "edit", reasoningEffort: "medium" },
      messages: [{ id: "m1", role: "user", content: "继续写", timestamp: 1 }],
    });

    expect(result).toMatchObject({
      success: true,
      content: "真实回复",
      metadata: { providerId: "sub2api", modelId: "gpt-5-codex", providerName: "Sub2API" },
    });
    expect(adapter.generate).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "sub2api",
      providerName: "Sub2API",
      baseUrl: "https://gateway.example/v1",
      apiKey: "sk-live",
      modelId: "gpt-5-codex",
      messages: [{ role: "user", content: "继续写" }],
    }));
  });

  it("fails without fake content when the session model is not usable", async () => {
    const service = createLlmRuntimeService({
      store,
      adapters: createProviderAdapterRegistry({ "openai-compatible": okAdapter("不应调用") }),
    });

    const result = await service.generate({
      sessionConfig: { providerId: "sub2api", modelId: "missing", permissionMode: "edit", reasoningEffort: "medium" },
      messages: [{ id: "m1", role: "user", content: "继续写", timestamp: 1 }],
    });

    expect(result).toMatchObject({
      success: false,
      code: "model-unavailable",
    });
  });
});
