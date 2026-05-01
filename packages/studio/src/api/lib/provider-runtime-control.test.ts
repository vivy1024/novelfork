import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProviderRuntimeStore } from "./provider-runtime-store";

describe("provider runtime control plane", () => {
  let runtimeDir: string;
  let store: ProviderRuntimeStore;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "novelfork-provider-control-"));
    store = new ProviderRuntimeStore({ storagePath: join(runtimeDir, "provider-runtime.json") });
  });

  afterEach(async () => {
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it("persists virtual models and resolves quota-aware routes with fallback reasons", async () => {
    await store.createProvider({
      id: "fast",
      name: "快速供应商",
      type: "custom",
      enabled: true,
      priority: 1,
      apiKeyRequired: false,
      compatibility: "openai-compatible",
      apiMode: "responses",
      config: {},
      models: [{ id: "draft-a", name: "Draft A", contextWindow: 128000, maxOutputTokens: 8192, enabled: true }],
    });
    await store.createProvider({
      id: "stable",
      name: "稳定供应商",
      type: "custom",
      enabled: true,
      priority: 2,
      apiKeyRequired: false,
      compatibility: "openai-compatible",
      apiMode: "responses",
      config: {},
      models: [{ id: "draft-b", name: "Draft B", contextWindow: 256000, maxOutputTokens: 8192, enabled: true }],
    });
    await store.createVirtualModel({
      id: "draft-model",
      name: "强力正文模型",
      enabled: true,
      routingMode: "quota-aware",
      tags: ["正文"],
      members: [
        { providerId: "fast", modelId: "draft-a", priority: 1, enabled: true },
        { providerId: "stable", modelId: "draft-b", priority: 2, enabled: true },
      ],
    });

    const resolved = await store.resolveVirtualModelRoute("draft-model");

    expect(resolved).toMatchObject({
      virtualModelId: "draft-model",
      providerId: "fast",
      modelId: "draft-a",
      routingMode: "quota-aware",
    });
    expect(resolved.reason).toContain("未记录配额");
    await expect(store.listVirtualModels()).resolves.toEqual([
      expect.objectContaining({ id: "draft-model", name: "强力正文模型", routingMode: "quota-aware" }),
    ]);
  });

  it("stores writing task model profile and validates missing virtual model references", async () => {
    await store.createVirtualModel({
      id: "analysis-model",
      name: "分析模型",
      enabled: true,
      routingMode: "priority",
      members: [],
      tags: ["分析"],
    });

    const saved = await store.updateWritingModelProfile({
      defaultDraftModel: "missing-draft",
      defaultAnalysisModel: "analysis-model",
      taskModels: { summary: "analysis-model", draft: "missing-draft" },
      advancedAgentModels: { generalPool: [] },
    });

    expect(saved.validation.invalidModelIds).toEqual(["missing-draft"]);
    await expect(store.getWritingModelProfile()).resolves.toMatchObject({
      defaultAnalysisModel: "analysis-model",
      taskModels: { summary: "analysis-model", draft: "missing-draft" },
      validation: { defaultAnalysisModel: "valid", defaultDraftModel: "invalid" },
    });
  });
});
