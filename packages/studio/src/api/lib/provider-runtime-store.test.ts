import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProviderRuntimeStore } from "./provider-runtime-store";

describe("ProviderRuntimeStore", () => {
  let runtimeDir: string;
  let storagePath: string;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "novelfork-provider-runtime-"));
    storagePath = join(runtimeDir, "provider-runtime.json");
  });

  afterEach(async () => {
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it("persists providers, model patches and platform accounts across store reinitialization", async () => {
    const store = new ProviderRuntimeStore({ storagePath });

    await store.createProvider({
      id: "sub2api",
      name: "Sub2API",
      type: "custom",
      enabled: true,
      priority: 1,
      apiKeyRequired: true,
      baseUrl: "https://api.example.com/v1",
      prefix: "sub2api",
      compatibility: "openai-compatible",
      apiMode: "responses",
      config: { apiKey: "sk-initial" },
      models: [],
    });
    await store.updateProvider("sub2api", {
      enabled: false,
      baseUrl: "https://api.updated.example/v1",
      config: { apiKey: "sk-updated" },
    });
    await store.upsertModels("sub2api", [
      {
        id: "gpt-5-codex",
        name: "GPT-5 Codex",
        contextWindow: 192000,
        maxOutputTokens: 8192,
        enabled: true,
        source: "detected",
        lastTestStatus: "untested",
      },
    ]);
    await store.patchModel("sub2api", "gpt-5-codex", {
      enabled: false,
      contextWindow: 256000,
    });
    await store.importPlatformAccount({
      id: "codex-acct-1",
      platformId: "codex",
      displayName: "主力 ChatGPT",
      email: "writer@example.com",
      accountId: "acct_123",
      authMode: "json-account",
      status: "active",
      current: true,
      priority: 1,
      successCount: 0,
      failureCount: 0,
      credentialSource: "json",
      credentialJson: { refresh_token: "rt-secret" },
      createdAt: "2026-04-28T00:00:00.000Z",
    });

    const reloaded = new ProviderRuntimeStore({ storagePath });

    await expect(reloaded.getProvider("sub2api")).resolves.toMatchObject({
      id: "sub2api",
      enabled: false,
      baseUrl: "https://api.updated.example/v1",
      config: { apiKey: "sk-updated" },
    });
    await expect(reloaded.getModel("sub2api", "gpt-5-codex")).resolves.toMatchObject({
      id: "gpt-5-codex",
      enabled: false,
      contextWindow: 256000,
      source: "detected",
    });
    await expect(reloaded.listPlatformAccounts()).resolves.toEqual([
      expect.objectContaining({
        id: "codex-acct-1",
        platformId: "codex",
        credentialJson: { refresh_token: "rt-secret" },
      }),
    ]);
    await expect(reloaded.listProviderViews()).resolves.toEqual([
      expect.objectContaining({
        id: "sub2api",
        config: { apiKeyConfigured: true },
      }),
    ]);
    await expect(reloaded.listPlatformAccountViews()).resolves.toEqual([
      expect.objectContaining({
        id: "codex-acct-1",
        credentialConfigured: true,
      }),
    ]);
  });
});
