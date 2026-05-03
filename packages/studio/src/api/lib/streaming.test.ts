import { describe, expect, it, vi } from "vitest";

import type { SessionConfig } from "../../shared/session-types";
import { runAgentTurn, type AgentGenerateInput, type AgentTurnItem, type AgentTurnRuntimeInput, type AgentTurnEvent } from "./agent-turn-runtime";
import { createProviderAdapterRegistry } from "./provider-adapters";

const sessionConfig: SessionConfig = {
  providerId: "sub2api",
  modelId: "gpt-5-codex",
  permissionMode: "edit",
  reasoningEffort: "medium",
};

const baseMessages: AgentTurnItem[] = [
  { type: "message", role: "user", content: "写下一章" },
];

function input(overrides: Partial<AgentTurnRuntimeInput> = {}): AgentTurnRuntimeInput {
  return {
    sessionId: "session-1",
    sessionConfig,
    messages: baseMessages,
    systemPrompt: "你是 NovelFork 叙述者。",
    tools: [],
    permissionMode: "edit",
    generate: vi.fn(async () => ({
      success: true as const,
      type: "message" as const,
      content: "已完成。",
      metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
    })),
    executeTool: vi.fn(async () => ({ ok: true, summary: "ok" })),
    ...overrides,
  };
}

describe("streaming", () => {
  it("emits streaming_chunk events for each chunk via onStreamChunk", async () => {
    const chunks: string[] = [];
    const generate = vi.fn(async (generateInput: { onStreamChunk?: (chunk: string) => void }) => {
      // Simulate streaming by calling onStreamChunk multiple times
      if (generateInput.onStreamChunk) {
        generateInput.onStreamChunk("你好");
        generateInput.onStreamChunk("，世界");
        generateInput.onStreamChunk("！");
      }
      return {
        success: true as const,
        type: "message" as const,
        content: "你好，世界！",
        metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      };
    });

    const events = await runAgentTurn(input({
      generate,
      onStreamChunk: (chunk) => chunks.push(chunk),
    }));

    expect(chunks).toEqual(["你好", "，世界", "！"]);

    const streamEvents = events.filter((e): e is Extract<AgentTurnEvent, { type: "streaming_chunk" }> => e.type === "streaming_chunk");
    expect(streamEvents).toEqual([
      { type: "streaming_chunk", content: "你好" },
      { type: "streaming_chunk", content: "，世界" },
      { type: "streaming_chunk", content: "！" },
    ]);

    // Should still have the final assistant_message and turn_completed
    expect(events.some((e) => e.type === "assistant_message")).toBe(true);
    expect(events.some((e) => e.type === "turn_completed")).toBe(true);
  });

  it("aborts streaming when signal is triggered", async () => {
    const controller = new AbortController();
    const chunks: string[] = [];

    const generate = vi.fn(async (generateInput: { onStreamChunk?: (chunk: string) => void; signal?: AbortSignal }) => {
      if (generateInput.onStreamChunk) {
        generateInput.onStreamChunk("第一段");
      }
      // Simulate abort during generation
      controller.abort();
      return {
        success: true as const,
        type: "message" as const,
        content: "第一段",
        metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
      };
    });

    const events = await runAgentTurn(input({
      generate,
      onStreamChunk: (chunk) => chunks.push(chunk),
      signal: controller.signal,
    }));

    expect(chunks).toEqual(["第一段"]);
    // After the first generate returns, the loop checks signal.aborted and emits turn_completed
    // The first call produces assistant_message + turn_completed, then the loop would check abort
    // Since abort happens during generate, the next iteration of the loop will see aborted
    const hasCompleted = events.some((e) => e.type === "turn_completed");
    expect(hasCompleted).toBe(true);
    // generate should only be called once since abort stops the loop
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("falls back to non-streaming when onStreamChunk is not provided", async () => {
    const generate = vi.fn(async (_input: AgentGenerateInput) => ({
      success: true as const,
      type: "message" as const,
      content: "非流式回复。",
      metadata: { providerId: "sub2api", providerName: "Sub2API", modelId: "gpt-5-codex" },
    }));

    const events = await runAgentTurn(input({ generate }));

    // No streaming_chunk events
    const streamEvents = events.filter((e) => e.type === "streaming_chunk");
    expect(streamEvents).toHaveLength(0);

    // Should still have assistant_message
    expect(events.some((e) => e.type === "assistant_message")).toBe(true);
    expect(events.some((e) => e.type === "turn_completed")).toBe(true);

    // generate should not receive onStreamChunk
    const callArgs = generate.mock.calls[0]?.[0];
    expect(callArgs?.onStreamChunk).toBeUndefined();
  });

  it("returns complete usage data after streaming completes", async () => {
    const generate = vi.fn(async (generateInput: { onStreamChunk?: (chunk: string) => void }) => {
      if (generateInput.onStreamChunk) {
        generateInput.onStreamChunk("内容");
      }
      return {
        success: true as const,
        type: "message" as const,
        content: "内容",
        metadata: {
          providerId: "sub2api",
          providerName: "Sub2API",
          modelId: "gpt-5-codex",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      };
    });

    const events = await runAgentTurn(input({
      generate,
      onStreamChunk: () => {},
    }));

    const assistantEvent = events.find((e): e is Extract<AgentTurnEvent, { type: "assistant_message" }> => e.type === "assistant_message");
    expect(assistantEvent).toBeDefined();
    expect(assistantEvent!.runtime.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
  });
});

describe("OpenAI-compatible streaming adapter", () => {
  it("calls onStreamChunk for each SSE data chunk", async () => {
    const chunks: string[] = [];
    const ssePayload = [
      'data: {"choices":[{"delta":{"content":"你好"}}]}',
      'data: {"choices":[{"delta":{"content":"世界"}}]}',
      'data: {"choices":[{"delta":{"content":"！"}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}',
      "data: [DONE]",
      "",
    ].join("\n");

    const fetchMock = vi.fn<typeof fetch>(async () => new Response(ssePayload, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createProviderAdapterRegistry().get("openai-compatible");
    const result = await adapter.generate({
      providerId: "sub2api",
      providerName: "Sub2API",
      baseUrl: "https://gateway.example/v1",
      apiKey: "sk-live",
      modelId: "gpt-5-codex",
      messages: [{ role: "user", content: "hello" }],
      onStreamChunk: (chunk) => chunks.push(chunk),
    });

    expect(chunks).toEqual(["你好", "世界", "！"]);
    expect(result).toEqual({
      success: true,
      type: "message",
      content: "你好世界！",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    // Verify stream: true was sent
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(requestInit.body));
    expect(body.stream).toBe(true);

    vi.unstubAllGlobals();
  });

  it("falls back to non-streaming for tool_use requests even with onStreamChunk", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: { name: "test_tool", arguments: "{}" },
          }],
        },
      }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    const adapter = createProviderAdapterRegistry().get("openai-compatible");
    const result = await adapter.generate({
      providerId: "sub2api",
      providerName: "Sub2API",
      baseUrl: "https://gateway.example/v1",
      apiKey: "sk-live",
      modelId: "gpt-5-codex",
      messages: [{ role: "user", content: "use tool" }],
      tools: [{ name: "test_tool", description: "test", inputSchema: {} }],
      onStreamChunk: (chunk) => chunks.push(chunk),
    });

    // No streaming chunks for tool_use
    expect(chunks).toHaveLength(0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.type).toBe("tool_use");
    }

    // Verify stream: false was sent (non-streaming path for tools)
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(requestInit.body));
    expect(body.stream).toBe(false);

    vi.unstubAllGlobals();
  });
});
