import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { SessionToolDefinition } from "../../shared/agent-native-workspace";
import { createProviderAdapterRegistry, type RuntimeAdapter } from "./provider-adapters";
import { ProviderRuntimeStore } from "./provider-runtime-store";
import { createLlmRuntimeService } from "./llm-runtime-service";

const cockpitSnapshotTool: SessionToolDefinition = {
  name: "cockpit.get_snapshot",
  description: "读取当前书籍驾驶舱快照",
  inputSchema: {
    type: "object",
    properties: { bookId: { type: "string" } },
    required: ["bookId"],
    additionalProperties: false,
  },
  risk: "read",
  renderer: "cockpit.snapshot",
  enabledForModes: ["read", "plan", "ask", "edit", "allow"],
};

const okAdapter = (content = "来自真实 adapter 的回复"): RuntimeAdapter => ({
  listModels: vi.fn(async () => ({ success: true as const, models: [] })),
  testModel: vi.fn(async () => ({ success: true as const, latency: 10 })),
  generate: vi.fn(async () => ({ success: true as const, type: "message" as const, content })),
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
      type: "message",
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

  it("returns unsupported-tools without calling the adapter when tools are requested for a non-tool model", async () => {
    const adapter = okAdapter("不应调用");
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
      models: [{ id: "plain-model", name: "Plain Model", contextWindow: 128000, maxOutputTokens: 4096, enabled: true, source: "manual", supportsFunctionCalling: false }],
    });
    const service = createLlmRuntimeService({
      store,
      adapters: createProviderAdapterRegistry({ "openai-compatible": adapter }),
    });

    const result = await service.generate({
      sessionConfig: { providerId: "sub2api", modelId: "plain-model", permissionMode: "edit", reasoningEffort: "medium" },
      messages: [{ id: "m1", role: "user", content: "看看当前状态", timestamp: 1 }],
      tools: [cockpitSnapshotTool],
    });

    expect(result).toMatchObject({
      success: false,
      code: "unsupported-tools",
      error: "当前模型不支持工具循环",
      metadata: { providerId: "sub2api", modelId: "plain-model", providerName: "Sub2API" },
    });
    expect(adapter.generate).not.toHaveBeenCalled();
  });

  it("passes session tools to tool-capable adapters while preserving text response compatibility", async () => {
    const adapter = okAdapter("工具可用模型回复");
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
      models: [{ id: "tool-model", name: "Tool Model", contextWindow: 128000, maxOutputTokens: 4096, enabled: true, source: "manual", supportsFunctionCalling: true }],
    });
    const service = createLlmRuntimeService({
      store,
      adapters: createProviderAdapterRegistry({ "openai-compatible": adapter }),
    });

    const result = await service.generate({
      sessionConfig: { providerId: "sub2api", modelId: "tool-model", permissionMode: "edit", reasoningEffort: "medium" },
      messages: [{ id: "m1", role: "user", content: "看看当前状态", timestamp: 1 }],
      tools: [cockpitSnapshotTool],
    });

    expect(result).toMatchObject({ success: true, type: "message", content: "工具可用模型回复" });
    expect(adapter.generate).toHaveBeenCalledWith(expect.objectContaining({
      tools: [expect.objectContaining({
        name: "cockpit.get_snapshot",
        description: "读取当前书籍驾驶舱快照",
        inputSchema: cockpitSnapshotTool.inputSchema,
      })],
    }));
  });

  it("returns structured tool_use results from adapters", async () => {
    const adapter: RuntimeAdapter = {
      listModels: vi.fn(async () => ({ success: true as const, models: [] })),
      testModel: vi.fn(async () => ({ success: true as const, latency: 10 })),
      generate: vi.fn(async () => ({
        success: true as const,
        type: "tool_use" as const,
        toolUses: [{ id: "call-1", name: "cockpit.get_snapshot", input: { bookId: "book-1" } }],
      })),
    };
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
      models: [{ id: "tool-model", name: "Tool Model", contextWindow: 128000, maxOutputTokens: 4096, enabled: true, source: "manual", supportsFunctionCalling: true }],
    });
    const service = createLlmRuntimeService({
      store,
      adapters: createProviderAdapterRegistry({ "openai-compatible": adapter }),
    });

    const result = await service.generate({
      sessionConfig: { providerId: "sub2api", modelId: "tool-model", permissionMode: "edit", reasoningEffort: "medium" },
      messages: [{ id: "m1", role: "user", content: "看看当前状态", timestamp: 1 }],
      tools: [cockpitSnapshotTool],
    });

    expect(result).toMatchObject({
      success: true,
      type: "tool_use",
      toolUses: [{ id: "call-1", name: "cockpit.get_snapshot", input: { bookId: "book-1" } }],
      metadata: { providerId: "sub2api", modelId: "tool-model", providerName: "Sub2API" },
    });
  });
});
