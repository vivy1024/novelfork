import { describe, expect, it } from "vitest";

import { requireModelForAiAction } from "./ai-gate";

describe("requireModelForAiAction", () => {
  it("allows AI actions when a usable model is configured", () => {
    expect(requireModelForAiAction("ai-writing", {
      hasUsableModel: true,
      defaultProvider: "openai",
      defaultModel: "gpt-4-turbo",
    })).toEqual({
      ok: true,
      action: "ai-writing",
      provider: "openai",
      model: "gpt-4-turbo",
    });
  });

  it("returns a light model-not-configured gate without blocking local writing", () => {
    const result = requireModelForAiAction("generate-jingwei", {
      hasUsableModel: false,
    });

    expect(result).toMatchObject({
      ok: false,
      action: "generate-jingwei",
      reason: "model-not-configured",
    });
    if (!result.ok) {
      expect(result.message).toContain("此功能需要配置 AI 模型");
      expect(result.message).toContain("继续使用本地写作功能");
    }
  });

  it("preserves the latest connection error while keeping the same gate reason", () => {
    const result = requireModelForAiAction("workbench-agent", {
      hasUsableModel: false,
      defaultProvider: "openai",
      defaultModel: "gpt-4-turbo",
      lastConnectionError: "401 Unauthorized",
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "model-not-configured",
      lastConnectionError: "401 Unauthorized",
    });
  });
});
