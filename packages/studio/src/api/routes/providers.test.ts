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
    generate: vi.fn(async () => ({ success: true as const, content: "ok" })),
  };
}

describe("providers route runtime store", () => {
  let runtimeDir: string;
  let store: ProviderRuntimeStore;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "novelfork-providers-route-"));
    store = new ProviderRuntimeStore({ storagePath: join(runtimeDir, "provider-runtime.json") });
  });

  afterEach(async () => {
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
    const adapter = okAdapter([{ id: "gpt-5-codex", name: "GPT-5 Codex", contextWindow: 192000, maxOutputTokens: 8192, source: "detected" }]);
    await store.createProvider({ id: "sub2api", name: "Sub2API", type: "custom", enabled: true, priority: 1, apiKeyRequired: true, baseUrl: "https://api.example.com/v1", compatibility: "openai-compatible", apiMode: "responses", config: { apiKey: "sk-secret" }, models: [] });
    const app = createProvidersRouter({ store, adapters: createProviderAdapterRegistry({ "openai-compatible": adapter }) });

    const response = await app.request("http://localhost/sub2api/models/refresh", { method: "POST" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(adapter.listModels).toHaveBeenCalledWith(expect.objectContaining({ providerId: "sub2api", baseUrl: "https://api.example.com/v1", apiKey: "sk-secret" }));
    expect(body.models).toEqual([expect.objectContaining({ id: "gpt-5-codex", source: "detected", lastRefreshedAt: expect.any(String) })]);
    await expect(store.getModel("sub2api", "gpt-5-codex")).resolves.toMatchObject({ id: "gpt-5-codex", source: "detected" });
  });

  it("tests models through the adapter and writes real status", async () => {
    const adapter = okAdapter();
    await store.createProvider({ id: "sub2api", name: "Sub2API", type: "custom", enabled: true, priority: 1, apiKeyRequired: true, baseUrl: "https://api.example.com/v1", compatibility: "openai-compatible", apiMode: "responses", config: { apiKey: "sk-secret" }, models: [] });
    await store.upsertModels("sub2api", [{ id: "gpt-5-codex", name: "GPT-5 Codex", contextWindow: 192000, maxOutputTokens: 8192, source: "detected" }]);
    const app = createProvidersRouter({ store, adapters: createProviderAdapterRegistry({ "openai-compatible": adapter }) });

    const response = await app.request("http://localhost/sub2api/models/gpt-5-codex/test", { method: "POST" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(adapter.testModel).toHaveBeenCalledWith(expect.objectContaining({ modelId: "gpt-5-codex", apiKey: "sk-secret" }));
    expect(body.model).toMatchObject({ id: "gpt-5-codex", lastTestStatus: "success", lastTestLatency: 7 });
    await expect(store.getModel("sub2api", "gpt-5-codex")).resolves.toMatchObject({ lastTestStatus: "success", lastTestLatency: 7 });
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

  it("returns non-2xx for unsupported adapters and store write failures", async () => {
    await store.createProvider({ id: "anthropic", name: "Anthropic", type: "anthropic", enabled: true, priority: 1, apiKeyRequired: true, compatibility: "anthropic-compatible", config: { apiKey: "sk-ant" }, models: [] });
    const app = createProvidersRouter({ store, adapters: createProviderAdapterRegistry() });
    const unsupported = await app.request("http://localhost/anthropic/models/refresh", { method: "POST" });

    expect(unsupported.status).toBe(501);
    await expect(unsupported.json()).resolves.toMatchObject({ success: false, code: "unsupported" });

    const failingStore = new ProviderRuntimeStore({ storagePath: join(runtimeDir, "failing.json") });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(failingStore, "createProvider").mockRejectedValue(new Error("disk full"));
    const failingApp = createProvidersRouter({ store: failingStore, adapters: createProviderAdapterRegistry() });
    const failedWrite = await failingApp.request("http://localhost/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "x", name: "X", type: "custom", apiKeyRequired: false, config: {}, models: [] }) });

    expect(failedWrite.status).toBe(500);
    await expect(failedWrite.json()).resolves.toMatchObject({ error: "Failed to add provider" });
  });
});
