import { describe, expect, it, vi } from "vitest";

import { createProviderModelsClient, runtimeProviderModelFamily } from "./provider-models";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("provider models client", () => {
  it("routes canonical protocols to the Runtime model families", () => {
    expect(runtimeProviderModelFamily("anthropic-official")).toBe("anthropic");
    expect(runtimeProviderModelFamily("anthropic-compatible")).toBe("anthropic");
    expect(runtimeProviderModelFamily("responses-compatible")).toBe("openai");
    expect(runtimeProviderModelFamily("completions-compatible")).toBe("openai");
    expect(runtimeProviderModelFamily("codex-native")).toBe("openai");
  });

  it("calls the real provider-specific OpenAI and Anthropic refresh routes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => (
      jsonResponse({ models: [{ id: "model-1" }], fromCache: false })
    ));
    const client = createProviderModelsClient({ fetchImpl: fetchMock });

    await client.refreshProviderModels({
      providerId: "open ai/中文",
      protocol: "responses-compatible",
    });
    await client.refreshProviderModels({
      providerId: "anthropic-main",
      protocol: "anthropic-official",
    });

    expect(fetchMock.mock.calls.map(([path, init]) => [path, init?.method])).toEqual([
      ["/api/openai/providers/open%20ai%2F%E4%B8%AD%E6%96%87/models/refresh", "POST"],
      ["/api/anthropic/providers/anthropic-main/models/refresh", "POST"],
    ]);
  });
});
