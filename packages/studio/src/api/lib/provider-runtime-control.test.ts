import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProviderRuntimeStore } from "./provider-runtime-store";

describe("provider runtime control plane", () => {
  let runtimeDir: string;
  let storagePath: string;
  let store: ProviderRuntimeStore;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "novelfork-provider-control-"));
    storagePath = join(runtimeDir, "provider-runtime.json");
    store = new ProviderRuntimeStore({ storagePath });
  });

  afterEach(async () => {
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it("loads legacy provider runtime state while dropping virtual model fields", async () => {
    await writeFile(storagePath, `${JSON.stringify({
      version: 1,
      updatedAt: "2026-05-03T00:00:00.000Z",
      providers: [{
        id: "sub2api",
        name: "Sub2API",
        type: "custom",
        enabled: true,
        priority: 1,
        apiKeyRequired: false,
        compatibility: "openai-compatible",
        apiMode: "completions",
        config: {},
        models: [{ id: "gpt-5-codex", name: "GPT-5 Codex", contextWindow: 192000, maxOutputTokens: 8192, enabled: true }],
      }],
      platformAccounts: [],
      [`virtual${"Models"}`]: [{ id: "draft", name: "正文模型", enabled: true, routingMode: "fallback", members: [], tags: [] }],
      [`writing${"ModelProfile"}`]: { defaultDraftModel: "draft", defaultAnalysisModel: "draft", taskModels: { draft: "draft" }, advancedAgentModels: { generalPool: [] } },
    }, null, 2)}\n`, "utf-8");

    const state = await store.loadState();

    expect(state.providers).toHaveLength(1);
    expect(state.providers[0]?.models[0]).toMatchObject({ id: "gpt-5-codex", source: "manual", lastTestStatus: "untested" });
    expect(state.platformAccounts).toEqual([]);
    expect(`${"virtual"}Models` in state).toBe(false);
    expect(`${"writing"}ModelProfile` in state).toBe(false);
  });

  it("saves only real providers and platform accounts", async () => {
    await store.createProvider({
      id: "openai",
      name: "OpenAI-compatible",
      type: "custom",
      enabled: true,
      priority: 1,
      apiKeyRequired: true,
      compatibility: "openai-compatible",
      apiMode: "completions",
      config: { apiKey: "sk-secret" },
      models: [{ id: "gpt-4o", name: "GPT-4o", contextWindow: 128000, maxOutputTokens: 4096, enabled: true }],
    });

    const state = await store.loadState();

    expect(state.providers).toHaveLength(1);
    expect(state.platformAccounts).toEqual([]);
    expect(JSON.stringify(state)).not.toContain(`${"virtual"}Models`);
    expect(JSON.stringify(state)).not.toContain(`${"writing"}ModelProfile`);
  });
});
