import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProviderRuntimeStore } from "../lib/provider-runtime-store";
import { createWritingModelProfileRouter } from "./writing-model-profile";

describe("writing model profile route", () => {
  let runtimeDir: string;
  let store: ProviderRuntimeStore;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "novelfork-writing-profile-"));
    store = new ProviderRuntimeStore({ storagePath: join(runtimeDir, "provider-runtime.json") });
  });

  afterEach(async () => {
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it("persists and validates NovelFork writing task model bindings", async () => {
    await store.createVirtualModel({ id: "draft", name: "正文模型", enabled: true, routingMode: "priority", tags: ["正文"], members: [] });
    await store.createVirtualModel({ id: "audit", name: "审稿模型", enabled: true, routingMode: "priority", tags: ["审稿"], members: [] });
    const app = createWritingModelProfileRouter({ store });

    const saved = await app.request("http://localhost/", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultDraftModel: "draft", defaultAnalysisModel: "audit", taskModels: { summary: "audit", draft: "draft" }, advancedAgentModels: { generalPool: [] } }),
    });
    const validation = await app.request("http://localhost/validate", { method: "POST" });

    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({ profile: { defaultDraftModel: "draft", defaultAnalysisModel: "audit", validation: { invalidModelIds: [] } } });
    expect(validation.status).toBe(200);
    await expect(validation.json()).resolves.toMatchObject({ profile: { validation: { defaultDraftModel: "valid", defaultAnalysisModel: "valid" } } });
  });
});
