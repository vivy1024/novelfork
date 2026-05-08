import { describe, expect, it, vi } from "vitest";

import {
  validateProviderConnection,
  type ProviderValidationResult,
} from "./provider-validation";

describe("provider validation", () => {
  it("validates a working provider and returns available models", async () => {
    const fetchModels = vi.fn().mockResolvedValue({
      ok: true,
      models: [
        { id: "gpt-4o", name: "GPT-4o" },
        { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      ],
    });

    const result = await validateProviderConnection({
      providerId: "openai",
      apiKey: "sk-test-valid",
      baseUrl: "https://api.openai.com/v1",
      fetchModels,
    });

    expect(result.ok).toBe(true);
    expect(result.models).toHaveLength(2);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns error for invalid API key", async () => {
    const fetchModels = vi.fn().mockResolvedValue({
      ok: false,
      error: "401 Unauthorized",
    });

    const result = await validateProviderConnection({
      providerId: "openai",
      apiKey: "sk-invalid",
      baseUrl: "https://api.openai.com/v1",
      fetchModels,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
  });

  it("returns error for network timeout", async () => {
    const fetchModels = vi.fn().mockRejectedValue(new Error("ETIMEDOUT"));

    const result = await validateProviderConnection({
      providerId: "openai",
      apiKey: "sk-test",
      baseUrl: "https://unreachable.example.com",
      fetchModels,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ETIMEDOUT");
  });

  it("validates localhost providers without requiring API key", async () => {
    const fetchModels = vi.fn().mockResolvedValue({
      ok: true,
      models: [{ id: "local-model", name: "Local" }],
    });

    const result = await validateProviderConnection({
      providerId: "local",
      baseUrl: "http://127.0.0.1:1234/v1",
      fetchModels,
    });

    expect(result.ok).toBe(true);
    expect(result.models).toHaveLength(1);
  });
});
