import { afterEach, describe, expect, it, vi } from "vitest";

import { createProviderAdapterRegistry } from "./provider-adapters";

describe("provider adapters", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("converts canonical tool call and tool result messages for OpenAI-compatible chat completions", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "ok" } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createProviderAdapterRegistry().get("openai-compatible");
    await adapter.generate({
      providerId: "sub2api",
      providerName: "Sub2API",
      baseUrl: "https://gateway.example/v1",
      apiKey: "sk-live",
      modelId: "gpt-5-codex",
      messages: [
        { role: "system", content: "system prompt" },
        { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "cockpit.get_snapshot", input: { bookId: "book-1" } }] },
        { role: "tool", toolCallId: "call-1", name: "cockpit.get_snapshot", content: "已读取。" },
      ],
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(requestInit.body));

    expect(body.messages).toEqual([
      { role: "system", content: "system prompt" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call-1",
          type: "function",
          function: { name: "cockpit_get_snapshot", arguments: JSON.stringify({ bookId: "book-1" }) },
        }],
      },
      { role: "tool", tool_call_id: "call-1", content: "已读取。" },
    ]);
  });
});
