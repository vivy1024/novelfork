import { describe, expect, it } from "vitest";

import { createPlatformIntegrationsRouter } from "./platform-integrations";

describe("platform integrations route", () => {
  it("returns a platform catalog focused on JSON account import, without local reverse proxy state", async () => {
    const app = createPlatformIntegrationsRouter();

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      integrations: [
        {
          id: "codex",
          name: "Codex",
          enabled: true,
          modelCount: expect.any(Number),
          supportedImportMethods: expect.arrayContaining(["json-account"]),
        },
        {
          id: "kiro",
          name: "Kiro",
          enabled: true,
          supportedImportMethods: expect.arrayContaining(["json-account"]),
        },
        {
          id: "cline",
          name: "Cline",
          enabled: false,
          supportedImportMethods: [],
        },
      ],
    });
  });

  it("returns real empty account state before JSON account import", async () => {
    const app = createPlatformIntegrationsRouter();

    const response = await app.request("http://localhost/codex/accounts");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accounts: [] });
  });

  it("imports Codex JSON account data and exposes the account in platform details", async () => {
    const app = createPlatformIntegrationsRouter();

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

    expect(importResponse.status).toBe(201);
    await expect(importResponse.json()).resolves.toMatchObject({
      account: {
        platformId: "codex",
        displayName: "主力 ChatGPT",
        email: "writer@example.com",
        accountId: "acct_123",
        authMode: "json-account",
        planType: "Plus",
        status: "active",
        current: true,
      },
    });

    const listResponse = await app.request("http://localhost/codex/accounts");
    await expect(listResponse.json()).resolves.toMatchObject({ accounts: [{ displayName: "主力 ChatGPT" }] });
  });

  it("imports Kiro JSON account data but rejects platforms without JSON import support", async () => {
    const app = createPlatformIntegrationsRouter();

    const kiroResponse = await app.request("http://localhost/kiro/accounts/import-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountJson: { id: "kiro-user", email: "kiro@example.com" } }),
    });
    const clineResponse = await app.request("http://localhost/cline/accounts/import-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountJson: { id: "cline-user" } }),
    });

    expect(kiroResponse.status).toBe(201);
    await expect(kiroResponse.json()).resolves.toMatchObject({ account: { platformId: "kiro", email: "kiro@example.com" } });
    expect(clineResponse.status).toBe(400);
  });
});
