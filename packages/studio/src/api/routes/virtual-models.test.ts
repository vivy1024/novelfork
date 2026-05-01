import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProviderRuntimeStore } from "../lib/provider-runtime-store";
import { createVirtualModelsRouter } from "./virtual-models";

describe("virtual models route", () => {
  let runtimeDir: string;
  let store: ProviderRuntimeStore;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "novelfork-virtual-models-"));
    store = new ProviderRuntimeStore({ storagePath: join(runtimeDir, "provider-runtime.json") });
  });

  afterEach(async () => {
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it("creates, updates, resolves and deletes virtual models", async () => {
    await store.createProvider({ id: "sub2api", name: "Sub2API", type: "custom", enabled: true, priority: 1, apiKeyRequired: false, config: {}, models: [{ id: "gpt-5", name: "GPT-5", contextWindow: 128000, maxOutputTokens: 8192, source: "manual" }] });
    const app = createVirtualModelsRouter({ store });

    const created = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "draft", name: "正文模型", enabled: true, routingMode: "fallback", tags: ["正文"], members: [{ providerId: "sub2api", modelId: "gpt-5", priority: 1, enabled: true }] }),
    });
    const route = await app.request("http://localhost/draft/test-route", { method: "POST" });
    const updated = await app.request("http://localhost/draft", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "强力正文模型" }) });
    const deleted = await app.request("http://localhost/draft", { method: "DELETE" });

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({ virtualModel: { id: "draft", name: "正文模型" } });
    expect(route.status).toBe(200);
    await expect(route.json()).resolves.toMatchObject({ route: { virtualModelId: "draft", providerId: "sub2api", modelId: "gpt-5" } });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ virtualModel: { name: "强力正文模型" } });
    expect(deleted.status).toBe(200);
    const listAfterDeleteResponse = await app.request("http://localhost/");
    await expect(listAfterDeleteResponse.json()).resolves.toEqual({ virtualModels: [] });
  });
});
