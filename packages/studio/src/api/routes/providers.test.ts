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
      config: { apiKey: "sk-test-1234567890" },
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
