import { beforeEach, describe, expect, it } from "vitest";

import { providerManager } from "../lib/provider-manager";
import { createProvidersRouter } from "./providers";

describe("providers status route", () => {
  beforeEach(() => {
    providerManager.initialize();
  });

  it("reports missing model config as non-fatal status", async () => {
    const app = createProvidersRouter();

    const response = await app.request("http://localhost/status");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: {
        hasUsableModel: false,
      },
    });
  });

  it("reports the first enabled provider with an API key as usable", async () => {
    providerManager.updateProvider("openai", {
      config: { apiKey: "test-key" },
    });
    const app = createProvidersRouter();

    const response = await app.request("http://localhost/status");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: {
        hasUsableModel: true,
        defaultProvider: "openai",
        defaultModel: "gpt-4-turbo",
      },
    });
  });

  it("saves NarraFork provider fields and returns model refresh metadata", async () => {
    const app = createProvidersRouter();

    const createResponse = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "codex-proxy",
        name: "Codex Proxy",
        type: "custom",
        enabled: true,
        apiKeyRequired: true,
        config: { apiKey: "test-key" },
        models: [],
        prefix: "codex",
        compatibility: "openai-compatible",
        apiMode: "codex",
        baseUrl: "http://127.0.0.1:8080/v1",
        accountId: "acct_local",
        useResponsesWebSocket: true,
        thinkingStrength: "medium",
      }),
    });
    const refreshResponse = await app.request("http://localhost/codex-proxy/models/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: [
          {
            id: "gpt-5-codex",
            name: "GPT-5 Codex",
            contextWindow: 192000,
            maxOutputTokens: 8192,
          },
        ],
      }),
    });

    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toMatchObject({
      provider: {
        prefix: "codex",
        compatibility: "openai-compatible",
        apiMode: "codex",
        thinkingStrength: "medium",
      },
    });
    expect(refreshResponse.status).toBe(200);
    await expect(refreshResponse.json()).resolves.toMatchObject({
      provider: {
        models: [
          {
            id: "gpt-5-codex",
            enabled: true,
            lastTestStatus: "untested",
            lastRefreshedAt: expect.any(String),
          },
        ],
      },
    });
  });

  it("tests and updates individual provider models", async () => {
    providerManager.updateProvider("openai", {
      config: { apiKey: "test-key" },
    });
    const app = createProvidersRouter();

    const patchResponse = await app.request("http://localhost/openai/models/gpt-4-turbo", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, contextWindow: 64000 }),
    });
    const testResponse = await app.request("http://localhost/openai/models/gpt-4-turbo/test", {
      method: "POST",
    });

    expect(patchResponse.status).toBe(200);
    await expect(patchResponse.json()).resolves.toMatchObject({
      model: { enabled: false, contextWindow: 64000 },
    });
    expect(testResponse.status).toBe(200);
    await expect(testResponse.json()).resolves.toMatchObject({
      success: true,
      model: {
        id: "gpt-4-turbo",
        lastTestStatus: "success",
        lastTestLatency: expect.any(Number),
      },
    });
  });

  it("includes the latest provider connection error in status", async () => {
    await providerManager.testProviderConnection("anthropic");
    const app = createProvidersRouter();

    const response = await app.request("http://localhost/status");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: {
        hasUsableModel: false,
        lastConnectionError: "API key not configured",
      },
    });
  });
});
