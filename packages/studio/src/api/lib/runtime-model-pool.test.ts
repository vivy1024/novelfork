import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProviderRuntimeStore } from "./provider-runtime-store";
import { buildRuntimeModelPool } from "./runtime-model-pool";

describe("runtime model pool", () => {
  let runtimeDir: string;
  let store: ProviderRuntimeStore;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "novelfork-model-pool-"));
    store = new ProviderRuntimeStore({ storagePath: join(runtimeDir, "provider-runtime.json") });
  });

  afterEach(async () => {
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it("builds model entries from runtime providers without exposing credentials", async () => {
    await store.createProvider({
      id: "sub2api",
      name: "Sub2API",
      type: "custom",
      enabled: true,
      priority: 1,
      apiKeyRequired: true,
      baseUrl: "https://api.example.com/v1",
      compatibility: "openai-compatible",
      apiMode: "responses",
      config: { apiKey: "sk-secret" },
        models: [{ id: "gpt-5-codex", name: "GPT-5 Codex", contextWindow: 192000, maxOutputTokens: 8192, enabled: true, source: "detected", lastTestStatus: "success", supportsStreaming: true }],
    });

    const pool = await buildRuntimeModelPool(store);

    expect(pool).toEqual([expect.objectContaining({
      modelId: "sub2api:gpt-5-codex",
      providerId: "sub2api",
      enabled: true,
      source: "detected",
      lastTestStatus: "success",
      capabilities: { functionCalling: false, vision: false, streaming: true },
    })]);
    expect(JSON.stringify(pool)).not.toContain("sk-secret");
  });

  it("only returns platform models when the platform has an active account", async () => {
    await store.createProvider({
      id: "codex",
      name: "Codex",
      type: "custom",
      enabled: true,
      priority: 1,
      apiKeyRequired: false,
      compatibility: "openai-compatible",
      apiMode: "codex",
      config: {},
      models: [{ id: "gpt-5-codex", name: "GPT-5 Codex", contextWindow: 192000, maxOutputTokens: 8192, enabled: true, source: "builtin-platform" }],
    });

    await expect(buildRuntimeModelPool(store)).resolves.toEqual([]);

    await store.importPlatformAccount({ id: "codex-1", platformId: "codex", displayName: "主力", authMode: "json-account", status: "active", current: true, priority: 1, successCount: 0, failureCount: 0, credentialSource: "json", credentialJson: { refresh_token: "rt" } });
    await expect(buildRuntimeModelPool(store)).resolves.toEqual([expect.objectContaining({ modelId: "codex:gpt-5-codex", source: "builtin-platform", enabled: true })]);

    await store.importPlatformAccount({ id: "codex-1", platformId: "codex", displayName: "主力", authMode: "json-account", status: "disabled", current: true, priority: 1, successCount: 0, failureCount: 0, credentialSource: "json", credentialJson: { refresh_token: "rt" } });
    await expect(buildRuntimeModelPool(store)).resolves.toEqual([]);
  });
});
