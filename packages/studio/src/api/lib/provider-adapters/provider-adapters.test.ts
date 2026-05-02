import { afterEach, describe, expect, it, vi } from "vitest";

import { createProviderAdapterRegistry } from "./index";

describe("provider adapter registry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the OpenAI-compatible models endpoint with provider credentials", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: "gpt-5-codex", context_window: 192000, max_output_tokens: 8192 },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "真实回复" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
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

  it("sends OpenAI-compatible tools and returns structured tool_use calls", async () => {
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "cockpit.get_snapshot",
                arguments: JSON.stringify({ bookId: "book-1" }),
              },
            }],
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
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
          name: "cockpit.get_snapshot",
          description: "读取当前书籍驾驶舱快照",
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
      toolUses: [{ id: "call-1", name: "cockpit.get_snapshot", input: { bookId: "book-1" } }],
    });
  });

  it("returns auth-missing before fetch when OpenAI-compatible credentials are absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
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

  it("does not fake success for unimplemented platform and Anthropic adapters", async () => {
    const registry = createProviderAdapterRegistry();

    await expect(registry.get("anthropic-compatible").listModels({
      providerId: "anthropic",
      providerName: "Anthropic",
      apiKey: "sk-ant",
    })).resolves.toMatchObject({ success: false, code: "unsupported" });
    await expect(registry.get("codex-platform").testModel({
      providerId: "codex",
      providerName: "Codex",
      modelId: "gpt-5-codex",
    })).resolves.toMatchObject({ success: false, code: "unsupported" });
    await expect(registry.get("kiro-platform").generate({
      providerId: "kiro",
      providerName: "Kiro",
      modelId: "kiro-default",
      messages: [{ role: "user", content: "hello" }],
    })).resolves.toMatchObject({ success: false, code: "unsupported" });
  });
});
