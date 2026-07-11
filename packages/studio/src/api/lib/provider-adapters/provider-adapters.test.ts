import { afterEach, describe, expect, it, vi } from "vitest";

import { createProviderAdapterRegistry } from "./index";

const originalFetch = globalThis.fetch;
function setFetchMock(fetchMock: typeof fetch): void {
  globalThis.fetch = fetchMock;
}

describe("provider adapter registry", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls the OpenAI-compatible models endpoint with provider credentials", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: "gpt-5-codex", context_window: 192000, max_output_tokens: 8192 },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    setFetchMock(fetchMock as unknown as typeof fetch);
    const adapter = createProviderAdapterRegistry().get("openai-compatible");

    const result = await adapter.listModels({
      providerId: "sub2api",
      providerName: "Sub2API",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
    });

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/v1/models", expect.objectContaining({
      method: "GET",
      headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
    }));
    expect(result).toEqual({
      success: true,
      models: [expect.objectContaining({
        id: "gpt-5-codex",
        name: "gpt-5-codex",
        contextWindow: 192000,
        maxOutputTokens: 8192,
        source: "detected",
      })],
    });
  });

  it("falls back to /v1 when an OpenAI-compatible gateway root returns non-JSON", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://api.example.com/models") {
        return new Response("<html>gateway</html>", { status: 200, headers: { "Content-Type": "text/html" } });
      }
      return new Response(JSON.stringify({
        data: [{ id: "gpt-5-codex", context_window: 192000, max_output_tokens: 8192 }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    setFetchMock(fetchMock as unknown as typeof fetch);
    const adapter = createProviderAdapterRegistry().get("openai-compatible");

    const result = await adapter.listModels({
      providerId: "sub-tokyo",
      providerName: "Sub Tokyo",
      baseUrl: "https://api.example.com",
      apiKey: "sk-test",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://api.example.com/models", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://api.example.com/v1/models", expect.any(Object));
    expect(result).toMatchObject({
      success: true,
      models: [expect.objectContaining({ id: "gpt-5-codex" })],
    });
  });

  it("tests an OpenAI-compatible target model with a minimal chat request", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "ok" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    setFetchMock(fetchMock as unknown as typeof fetch);
    const adapter = createProviderAdapterRegistry().get("openai-compatible");

    const result = await adapter.testModel({
      providerId: "sub2api",
      providerName: "Sub2API",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      modelId: "gpt-5-codex",
    });

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/v1/chat/completions", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      body: expect.stringContaining("gpt-5-codex"),
    }));
    expect(result).toMatchObject({ success: true, latency: expect.any(Number) });
  });

  it("generates OpenAI-compatible text from the upstream response", async () => {
    setFetchMock(vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "真实回复" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch);
    const adapter = createProviderAdapterRegistry().get("openai-compatible");

    const result = await adapter.generate({
      providerId: "sub2api",
      providerName: "Sub2API",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      modelId: "gpt-5-codex",
      messages: [{ role: "user", content: "你好" }],
    });

    expect(result).toEqual({ success: true, type: "message", content: "真实回复" });
  });

  it("maps dotted session tool names to provider-safe OpenAI-compatible function names", async () => {
    let requestBody: Record<string, unknown> | undefined;
    setFetchMock(vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "cockpit_get_snapshot",
                arguments: JSON.stringify({ bookId: "book-1" }),
              },
            }],
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch);
    const adapter = createProviderAdapterRegistry().get("openai-compatible");

    const result = await adapter.generate({
      providerId: "sub2api",
      providerName: "Sub2API",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      modelId: "gpt-5-codex",
      messages: [{ role: "user", content: "看看当前状态" }],
      tools: [{
        name: "cockpit.get_snapshot",
        description: "读取当前书籍驾驶舱快照",
        inputSchema: {
          type: "object",
          properties: { bookId: { type: "string" } },
          required: ["bookId"],
          additionalProperties: false,
        },
      }],
    });

    expect(requestBody).toMatchObject({
      tools: [{
        type: "function",
        function: {
          name: "cockpit_get_snapshot",
          description: "读取当前书籍驾驶舱快照\n\nInternal tool name: cockpit.get_snapshot",
          parameters: {
            type: "object",
            properties: { bookId: { type: "string" } },
            required: ["bookId"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: "auto",
    });
    expect(result).toEqual({
      success: true,
      type: "tool_use",
      toolUses: [{ id: "call_call-1", name: "cockpit.get_snapshot", input: { bookId: "book-1" } }],
    });
  });

  it("extracts reasoning_content from OpenAI-compatible tool call responses", async () => {
    setFetchMock(vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          reasoning_content: "需要先读取项目文件。",
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: {
              name: "Grep",
              arguments: JSON.stringify({ pattern: "reasoning_content" }),
            },
          }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch);
    const adapter = createProviderAdapterRegistry().get("openai-compatible");

    const result = await adapter.generate({
      providerId: "deepseek",
      providerName: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-test",
      modelId: "deepseek-reasoner",
      messages: [{ role: "user", content: "查一下" }],
      tools: [{ name: "Grep", description: "搜索文件", inputSchema: { type: "object" } }],
    });

    expect(result).toEqual({
      success: true,
      type: "tool_use",
      toolUses: [{ id: "call_call-1", name: "Grep", input: { pattern: "reasoning_content" } }],
      reasoningContent: "需要先读取项目文件。",
    });
  });

  it("returns auth-missing before fetch when OpenAI-compatible credentials are absent", async () => {
    const fetchMock = vi.fn();
    setFetchMock(fetchMock as unknown as typeof fetch);
    const adapter = createProviderAdapterRegistry().get("openai-compatible");

    const result = await adapter.testModel({
      providerId: "sub2api",
      providerName: "Sub2API",
      baseUrl: "https://api.example.com/v1",
      modelId: "gpt-5-codex",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, code: "auth-missing" });
  });

  it("preserves all runtime system blocks after the first prompt cache boundary in the final Anthropic request body", async () => {
    let requestBody: Record<string, unknown> | undefined;
    setFetchMock(vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        content: [{ type: "text", text: "ok" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch);

    const result = await createProviderAdapterRegistry().get("anthropic-compatible").generate({
      providerId: "anthropic",
      providerName: "Anthropic",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-ant-test",
      modelId: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: "静态规则\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n动态会话上下文" },
        { role: "system", content: "运行时提示一：当前画布" },
        { role: "system", content: "运行时提示二：资源状态" },
        { role: "user", content: "继续" },
      ],
    });

    expect(result).toMatchObject({ success: true, type: "message", content: "ok" });
    expect(requestBody?.system).toEqual([
      { type: "text", text: "静态规则", cache_control: { type: "ephemeral" } },
      { type: "text", text: "动态会话上下文" },
      { type: "text", text: "运行时提示一：当前画布" },
      { type: "text", text: "运行时提示二：资源状态" },
    ]);
    expect(requestBody?.messages).toEqual([{ role: "user", content: "继续" }]);
  });

  it.each([
    { providerId: "openai", modelId: "gpt-5", label: "OpenAI-compatible" },
    { providerId: "deepseek", modelId: "deepseek-chat", label: "DeepSeek" },
  ])("preserves ordered runtime system hints in the final $label request body", async ({ providerId, modelId }) => {
    let requestBody: Record<string, unknown> | undefined;
    setFetchMock(vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch);

    await createProviderAdapterRegistry().get("openai-compatible").generate({
      providerId,
      providerName: providerId,
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      modelId,
      messages: [
        { role: "system", content: "主提示" },
        { role: "system", content: "运行时提示一" },
        { role: "system", content: "运行时提示二" },
        { role: "user", content: "继续" },
      ],
    });

    expect(requestBody?.messages).toEqual([
      { role: "system", content: "主提示" },
      { role: "system", content: "运行时提示一" },
      { role: "system", content: "运行时提示二" },
      { role: "user", content: "继续" },
    ]);
  });

  it("does not fake success for unimplemented platform and Anthropic adapters", async () => {
    const registry = createProviderAdapterRegistry();

    // Anthropic listModels is implemented but requires baseUrl — returns config-missing
    await expect(registry.get("anthropic-compatible").listModels({
      providerId: "anthropic",
      providerName: "Anthropic",
      apiKey: "sk-ant",
    })).resolves.toMatchObject({ success: false, code: "config-missing" });
    // Codex testModel is implemented but requires apiKey — returns auth-missing
    await expect(registry.get("codex-platform").testModel({
      providerId: "codex",
      providerName: "Codex",
      modelId: "gpt-5-codex",
    })).resolves.toMatchObject({ success: false, code: "auth-missing" });
    await expect(registry.get("kiro-platform").generate({
      providerId: "kiro",
      providerName: "Kiro",
      modelId: "kiro-default",
      messages: [{ role: "user", content: "hello" }],
    })).resolves.toMatchObject({ success: false, code: "auth-missing" });
  });
});
