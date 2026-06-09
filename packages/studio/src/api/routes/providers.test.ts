import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProviderAdapterRegistry, type RuntimeAdapter } from "../lib/provider-adapters";
import { ProviderRuntimeStore, type RuntimeModelInput } from "../lib/provider-runtime-store";
import { createProvidersRouter } from "./providers";

function okAdapter(models: RuntimeModelInput[] = []): RuntimeAdapter {
  return {
    listModels: vi.fn(async () => ({ success: true as const, models })),
    testModel: vi.fn(async () => ({ success: true as const, latency: 7 })),
    generate: vi.fn(async () => ({ success: true as const, type: "message" as const, content: "ok" })),
  };
}

/**
 * Mock only the external upstream HTTP. Internal adapters (real protocol
 * adapters from the registry) run for real and route by URL path.
 * - /models → returns the provided model catalog
 * - /chat/completions → returns the provided completion outcome
 */
type UpstreamStub = {
  readonly models?: Array<Record<string, unknown>>;
  readonly completion?: { readonly status: number; readonly body: Record<string, unknown> };
};

function stubUpstreamFetch(stub: UpstreamStub): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
    const target = typeof url === "string" ? url : url.toString();
    if (target.includes("/models")) {
      return new Response(JSON.stringify({ data: stub.models ?? [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (target.includes("/chat/completions")) {
      const completion = stub.completion ?? { status: 200, body: { choices: [{ message: { content: "ok" } }] } };
      return new Response(JSON.stringify(completion.body), {
        status: completion.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: { message: "unexpected upstream call" } }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }));
}

describe("providers route runtime store", () => {
  let runtimeDir: string;
  let store: ProviderRuntimeStore;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "novelfork-providers-route-"));
    store = new ProviderRuntimeStore({ storagePath: join(runtimeDir, "provider-runtime.json") });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it("persists providers and never returns API keys in API views", async () => {
    const app = createProvidersRouter({ store, adapters: createProviderAdapterRegistry({ "openai-compatible": okAdapter() }) });

    const createResponse = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "sub2api",
        name: "Sub2API",
        type: "custom",
        enabled: true,
        apiKeyRequired: true,
        baseUrl: "https://api.example.com/v1",
        compatibility: "openai-compatible",
        apiMode: "responses",
        config: { apiKey: "sk-secret", timeout: 30 },
        models: [],
      }),
    });
    const body = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(body.provider.config).toEqual({ timeout: 30, apiKeyConfigured: true });
    expect(JSON.stringify(body)).not.toContain("sk-secret");
    await expect(new ProviderRuntimeStore({ storagePath: join(runtimeDir, "provider-runtime.json") }).getProvider("sub2api"))
      .resolves.toMatchObject({ config: { apiKey: "sk-secret" } });

    const listResponse = await app.request("http://localhost/");
    const listBody = await listResponse.json();
    expect(JSON.stringify(listBody)).not.toContain("sk-secret");
    expect(listBody.providers[0].config.apiKeyConfigured).toBe(true);
  });

  it("refreshes models through the adapter and persists detected models", async () => {
    stubUpstreamFetch({ models: [{ id: "gpt-5-codex", name: "GPT-5 Codex", context_window: 192000, max_output_tokens: 8192 }] });
    await store.createProvider({ id: "sub2api", name: "Sub2API", type: "custom", enabled: true, priority: 1, apiKeyRequired: true, baseUrl: "https://api.example.com/v1", compatibility: "openai-compatible", apiMode: "responses", config: { apiKey: "sk-secret" }, models: [] });
    const app = createProvidersRouter({ store, adapters: createProviderAdapterRegistry() });

    const response = await app.request("http://localhost/sub2api/models/refresh", { method: "POST" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.models).toEqual([expect.objectContaining({ id: "gpt-5-codex", source: "detected", lastRefreshedAt: expect.any(String) })]);
    await expect(store.getModel("sub2api", "gpt-5-codex")).resolves.toMatchObject({ id: "gpt-5-codex", source: "detected" });
  });

  it("tests models through the adapter and writes real status", async () => {
    stubUpstreamFetch({ completion: { status: 200, body: { choices: [{ message: { content: "pong" } }] } } });
    await store.createProvider({ id: "sub2api", name: "Sub2API", type: "custom", enabled: true, priority: 1, apiKeyRequired: true, baseUrl: "https://api.example.com/v1", compatibility: "openai-compatible", apiMode: "responses", config: { apiKey: "sk-secret" }, models: [] });
    await store.upsertModels("sub2api", [{ id: "gpt-5-codex", name: "GPT-5 Codex", contextWindow: 192000, maxOutputTokens: 8192, source: "detected" }]);
    const app = createProvidersRouter({ store, adapters: createProviderAdapterRegistry() });

    const response = await app.request("http://localhost/sub2api/models/gpt-5-codex/test", { method: "POST" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.model).toMatchObject({ id: "gpt-5-codex", lastTestStatus: "success", lastTestLatency: expect.any(Number) });
    await expect(store.getModel("sub2api", "gpt-5-codex")).resolves.toMatchObject({ lastTestStatus: "success" });
  });

  it("provider-level tests persist first model failure status without leaking credentials", async () => {
    stubUpstreamFetch({ completion: { status: 502, body: { error: { message: "网关 502" } } } });
    await store.createProvider({ id: "sub2api", name: "Sub2API", type: "custom", enabled: true, priority: 1, apiKeyRequired: true, baseUrl: "https://api.example.com/v1", compatibility: "openai-compatible", apiMode: "responses", config: { apiKey: "sk-secret" }, models: [] });
    await store.upsertModels("sub2api", [{ id: "gpt-5-codex", name: "GPT-5 Codex", contextWindow: 192000, maxOutputTokens: 8192, source: "detected" }]);
    const app = createProvidersRouter({ store, adapters: createProviderAdapterRegistry() });

    const response = await app.request("http://localhost/sub2api/test", { method: "POST" });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({ success: false, code: "upstream-error", error: "网关 502" });
    expect(JSON.stringify(body)).not.toContain("sk-secret");
    await expect(store.getModel("sub2api", "gpt-5-codex")).resolves.toMatchObject({
      lastTestStatus: "error",
      lastTestError: "网关 502",
    });
  });

  it("returns the unified runtime model pool from /models", async () => {
    await store.createProvider({ id: "sub2api", name: "Sub2API", type: "custom", enabled: true, priority: 1, apiKeyRequired: true, config: { apiKey: "sk-secret" }, models: [{ id: "gpt-5-codex", name: "GPT-5 Codex", contextWindow: 192000, maxOutputTokens: 8192, source: "detected" }] });
    const app = createProvidersRouter({ store, adapters: createProviderAdapterRegistry() });

    const response = await app.request("http://localhost/models");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.models).toEqual([expect.objectContaining({ modelId: "sub2api:gpt-5-codex", source: "detected", enabled: true })]);
    expect(JSON.stringify(body)).not.toContain("sk-secret");
  });

  it("returns provider summary and grouped physical model inventory for the control plane", async () => {
    await store.createProvider({ id: "sub2api", name: "Sub2API", type: "custom", enabled: true, priority: 1, apiKeyRequired: true, config: { apiKey: "sk-secret" }, models: [{ id: "gpt-5-codex", name: "GPT-5 Codex", contextWindow: 192000, maxOutputTokens: 8192, source: "detected", lastTestStatus: "success", supportsFunctionCalling: true, supportsStreaming: true }] });
    const app = createProvidersRouter({ store, adapters: createProviderAdapterRegistry() });

    const summary = await app.request("http://localhost/summary");
    const grouped = await app.request("http://localhost/models/grouped");
    const summaryBody = await summary.json();

    expect(summary.status).toBe(200);
    expect(summaryBody.summary).toMatchObject({ providerCount: 1, enabledProviderCount: 1, physicalModelCount: 1, availableModelCount: 1, totalCatalogModelCount: 1, callableModelCount: 1, issueCount: 0 });
    expect(summaryBody.summary).not.toHaveProperty(`${"virtual"}ModelCount`);
    expect(grouped.status).toBe(200);
    await expect(grouped.json()).resolves.toMatchObject({ groups: [{ providerId: "sub2api", providerName: "Sub2API", models: [expect.objectContaining({ id: "gpt-5-codex", lastTestStatus: "success", capabilities: expect.arrayContaining(["大上下文", "工具调用"]) })] }] });
  });

  it("returns non-2xx for unsupported adapters and store write failures", async () => {
    // Anthropic adapter is implemented but requires baseUrl — returns config-missing (422)
    await store.createProvider({ id: "anthropic", name: "Anthropic", type: "anthropic", enabled: true, priority: 1, apiKeyRequired: true, compatibility: "anthropic-compatible", config: { apiKey: "sk-ant" }, models: [] });
    const app = createProvidersRouter({ store, adapters: createProviderAdapterRegistry() });
    const unsupported = await app.request("http://localhost/anthropic/models/refresh", { method: "POST" });

    expect(unsupported.status).toBe(422);
    await expect(unsupported.json()).resolves.toMatchObject({ success: false, code: "config-missing" });

    const failingStore = new ProviderRuntimeStore({ storagePath: join(runtimeDir, "failing.json") });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(failingStore, "createProvider").mockRejectedValue(new Error("disk full"));
    const failingApp = createProvidersRouter({ store: failingStore, adapters: createProviderAdapterRegistry() });
    const failedWrite = await failingApp.request("http://localhost/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "x", name: "X", type: "custom", apiKeyRequired: false, config: {}, models: [] }) });

    expect(failedWrite.status).toBe(500);
    await expect(failedWrite.json()).resolves.toMatchObject({ error: "Failed to add provider" });
  });
});
