import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { SessionToolDefinition } from "../../shared/agent-native-workspace";
import type { RuntimeAdapter } from "./provider-adapters";
import { ProviderRuntimeStore } from "./provider-runtime-store";

// Mock the adapter registry so we can inject test adapters
const getAdapterForProtocolMock = vi.fn();
vi.mock("./provider-adapters/registry.js", () => ({
  getAdapterForProtocol: (...args: unknown[]) => getAdapterForProtocolMock(...args),
}));

// Mock user config to avoid filesystem and use fast retries
vi.mock("./user-config-service.js", () => ({
  loadUserConfig: async () => ({
    runtimeControls: {
      recovery: {
        resumeOnStartup: true,
        maxRecoveryAttempts: 3,
        maxRetryAttempts: 3,
        initialRetryDelayMs: 0,
        maxRetryDelayMs: 0,
        backoffMultiplier: 1,
        jitterPercent: 0,
      },
      retryRules: [],
    },
  }),
}));

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
  visibility: "author",
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
    vi.clearAllMocks();
    await rm(runtimeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("validates the runtime model pool and calls the target adapter", async () => {
    const adapter = okAdapter("真实回复");
    getAdapterForProtocolMock.mockReturnValue(adapter);
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

    const service = createLlmRuntimeService({ store });

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
    getAdapterForProtocolMock.mockReturnValue(okAdapter("不应调用"));
    const service = createLlmRuntimeService({ store });

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
    getAdapterForProtocolMock.mockReturnValue(adapter);
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
    const service = createLlmRuntimeService({ store });

    const result = await service.generate({
      sessionConfig: { providerId: "sub2api", modelId: "plain-model", permissionMode: "edit", reasoningEffort: "medium" },
      messages: [{ id: "m1", role: "user", content: "看看当前状态", timestamp: 1 }],
      tools: [cockpitSnapshotTool],
    });

    // Non-tool model is skipped, resulting in all-providers-failed
    expect(result).toMatchObject({
      success: false,
      code: "all-providers-failed",
    });
    expect(adapter.generate).not.toHaveBeenCalled();
  });

  it("passes session tools to tool-capable adapters while preserving text response compatibility", async () => {
    const adapter = okAdapter("工具可用模型回复");
    getAdapterForProtocolMock.mockReturnValue(adapter);
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
    const service = createLlmRuntimeService({ store });

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

  it("passes canonical tool calls and tool results to adapters", async () => {
    const adapter = okAdapter("已基于工具结果继续");
    getAdapterForProtocolMock.mockReturnValue(adapter);
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
    const service = createLlmRuntimeService({ store });

    await service.generate({
      sessionConfig: { providerId: "sub2api", modelId: "tool-model", permissionMode: "edit", reasoningEffort: "medium" },
      messages: [
        { type: "message", role: "user", content: "看看当前状态" },
        { type: "tool_call", id: "call-1", name: "cockpit.get_snapshot", input: { bookId: "book-1" } },
        { type: "tool_result", toolCallId: "call-1", name: "cockpit.get_snapshot", content: "已读取。" },
      ],
      tools: [cockpitSnapshotTool],
    });

    expect(adapter.generate).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { role: "user", content: "看看当前状态" },
        { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "cockpit.get_snapshot", input: { bookId: "book-1" } }] },
        { role: "tool", toolCallId: "call-1", name: "cockpit.get_snapshot", content: "已读取。" },
      ],
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
    getAdapterForProtocolMock.mockReturnValue(adapter);
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
    const service = createLlmRuntimeService({ store });

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

  it("retries on transient 429 errors with exponential backoff", async () => {
    let callCount = 0;
    const adapter: RuntimeAdapter = {
      listModels: vi.fn(async () => ({ success: true as const, models: [] })),
      testModel: vi.fn(async () => ({ success: true as const, latency: 10 })),
      generate: vi.fn(async () => {
        callCount++;
        if (callCount <= 2) {
          return { success: false as const, code: "upstream-error" as const, error: "429 rate_limit exceeded" };
        }
        return { success: true as const, type: "message" as const, content: "重试后成功" };
      }),
    };
    getAdapterForProtocolMock.mockReturnValue(adapter);
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

    const service = createLlmRuntimeService({ store });

    const result = await service.generate({
      sessionConfig: { providerId: "sub2api", modelId: "gpt-5-codex", permissionMode: "edit", reasoningEffort: "medium" },
      messages: [{ id: "m1", role: "user", content: "hello", timestamp: 1 }],
    });

    expect(result).toMatchObject({ success: true, content: "重试后成功" });
    expect(callCount).toBe(3); // 2 failures + 1 success
  });

  it("gives up after max retry attempts and falls through to next provider", async () => {
    const adapter: RuntimeAdapter = {
      listModels: vi.fn(async () => ({ success: true as const, models: [] })),
      testModel: vi.fn(async () => ({ success: true as const, latency: 10 })),
      generate: vi.fn(async () => ({ success: false as const, code: "upstream-error" as const, error: "503 service unavailable" })),
    };
    getAdapterForProtocolMock.mockReturnValue(adapter);
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

    const service = createLlmRuntimeService({ store });

    const result = await service.generate({
      sessionConfig: { providerId: "sub2api", modelId: "gpt-5-codex", permissionMode: "edit", reasoningEffort: "medium" },
      messages: [{ id: "m1", role: "user", content: "hello", timestamp: 1 }],
    });

    // Should fail after retries exhausted (maxRetryAttempts = 3 from mocked config)
    expect(result.success).toBe(false);
    // adapter.generate should have been called multiple times (1 initial + retries)
    expect((adapter.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
  });

  it("does not retry on non-transient errors like auth failures", async () => {
    const adapter: RuntimeAdapter = {
      listModels: vi.fn(async () => ({ success: true as const, models: [] })),
      testModel: vi.fn(async () => ({ success: true as const, latency: 10 })),
      generate: vi.fn(async () => ({ success: false as const, code: "auth-missing" as const, error: "API key invalid" })),
    };
    getAdapterForProtocolMock.mockReturnValue(adapter);
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

    const service = createLlmRuntimeService({ store });

    const result = await service.generate({
      sessionConfig: { providerId: "sub2api", modelId: "gpt-5-codex", permissionMode: "edit", reasoningEffort: "medium" },
      messages: [{ id: "m1", role: "user", content: "hello", timestamp: 1 }],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("auth-missing");
    // Should NOT retry — only 1 call
    expect(adapter.generate).toHaveBeenCalledTimes(1);
  });
});