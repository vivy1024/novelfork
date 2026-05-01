import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProviderRuntimeStore } from "../lib/provider-runtime-store";
import { createPlatformIntegrationsRouter } from "./platform-integrations";

describe("platform integrations route", () => {
  let runtimeDir: string;
  let store: ProviderRuntimeStore;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "novelfork-platform-route-"));
    store = new ProviderRuntimeStore({ storagePath: join(runtimeDir, "provider-runtime.json") });
  });

  afterEach(async () => {
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it("returns only platform capabilities with real current implementation", async () => {
    const app = createPlatformIntegrationsRouter({ store });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      integrations: [
        { id: "codex", enabled: true, modelCount: expect.any(Number), supportedImportMethods: ["json-account"] },
        { id: "kiro", enabled: true, supportedImportMethods: ["json-account"] },
      ],
    });
  });

  it("returns real empty account state before JSON account import", async () => {
    const app = createPlatformIntegrationsRouter({ store });

    const response = await app.request("http://localhost/codex/accounts");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accounts: [] });
  });

  it("persists Codex JSON account data without leaking credentials and activates platform models", async () => {
    const storagePath = join(runtimeDir, "provider-runtime.json");
    const app = createPlatformIntegrationsRouter({ store });

    const importResponse = await app.request("http://localhost/codex/accounts/import-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: "主力 ChatGPT",
        accountJson: {
          account_id: "acct_123",
          email: "writer@example.com",
          plan_type: "Plus",
          refresh_token: "secret-refresh-token",
        },
      }),
    });
    const importBody = await importResponse.json();

    expect(importResponse.status).toBe(201);
    expect(JSON.stringify(importBody)).not.toContain("secret-refresh-token");
    expect(importBody.account).toMatchObject({
      platformId: "codex",
      displayName: "主力 ChatGPT",
      email: "writer@example.com",
      accountId: "acct_123",
      authMode: "json-account",
      credentialConfigured: true,
      status: "active",
      current: true,
    });

    const reloaded = new ProviderRuntimeStore({ storagePath });
    await expect(reloaded.listPlatformAccountViews()).resolves.toEqual([expect.objectContaining({ platformId: "codex", credentialConfigured: true })]);
    await expect(reloaded.getProvider("codex")).resolves.toMatchObject({
      id: "codex",
      enabled: true,
      models: expect.arrayContaining([expect.objectContaining({ source: "builtin-platform", enabled: true })]),
    });
  });

  it("updates platform account quota, current status, disabled state and deletion through real store actions", async () => {
    const app = createPlatformIntegrationsRouter({ store });
    const imported = await app.request("http://localhost/codex/accounts/import-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountJson: { account_id: "acct_123", email: "writer@example.com", quota: { hourlyPercentage: 42 } } }),
    });
    const account = (await imported.json()).account as { id: string };

    const quotaResponse = await app.request(`http://localhost/codex/accounts/${account.id}/refresh-quota`, { method: "POST" });
    const currentResponse = await app.request(`http://localhost/codex/accounts/${account.id}/set-current`, { method: "POST" });
    const disableResponse = await app.request(`http://localhost/codex/accounts/${account.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "disabled" }),
    });
    const deleteResponse = await app.request(`http://localhost/codex/accounts/${account.id}`, { method: "DELETE" });

    expect(quotaResponse.status).toBe(200);
    await expect(quotaResponse.json()).resolves.toMatchObject({ account: { quota: { hourlyPercentage: 42 }, credentialConfigured: true } });
    expect(currentResponse.status).toBe(200);
    await expect(currentResponse.json()).resolves.toMatchObject({ account: { current: true } });
    expect(disableResponse.status).toBe(200);
    await expect(disableResponse.json()).resolves.toMatchObject({ account: { status: "disabled" } });
    expect(deleteResponse.status).toBe(200);
    const accountsAfterDeleteResponse = await app.request("http://localhost/codex/accounts");
    await expect(accountsAfterDeleteResponse.json()).resolves.toEqual({ accounts: [] });
  });
});
