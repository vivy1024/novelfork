import { describe, it, expect } from "vitest";

import { describeLlmError } from "./llm-error";

describe("describeLlmError", () => {
  it("matches the raw NOVELFORK_LLM_API_KEY CLI message", () => {
    const raw = "NOVELFORK_LLM_API_KEY not set. Run 'novelfork config set-global' or add it to project .env file.";
    const info = describeLlmError(new Error(raw));
    expect(info.code).toBe("LLM_CONFIG_MISSING");
    expect(info.title).toBe("模型配置未完成");
    expect(info.rawMessage).toBe(raw);
    expect(info.actionLabel).toBe("去配置供应商");
  });

  it("recognizes generic 'missing api key' phrasing", () => {
    const info = describeLlmError("Missing API key for provider 'openai'");
    expect(info.code).toBe("LLM_CONFIG_MISSING");
  });

  it("recognizes quota and rate-limit errors", () => {
    expect(describeLlmError(new Error("quota exhausted")).code).toBe("LLM_QUOTA_EXHAUSTED");
    expect(describeLlmError(new Error("HTTP 429 rate limit")).code).toBe("LLM_QUOTA_EXHAUSTED");
    expect(describeLlmError(new Error("insufficient_quota from provider")).code).toBe(
      "LLM_QUOTA_EXHAUSTED",
    );
  });

  it("recognizes network errors", () => {
    expect(describeLlmError(new Error("fetch failed: ECONNREFUSED")).code).toBe(
      "LLM_NETWORK_ERROR",
    );
    expect(describeLlmError(new Error("Request timeout after 30s")).code).toBe(
      "LLM_NETWORK_ERROR",
    );
  });

  it("falls back to UNKNOWN with the raw message surfaced", () => {
    const info = describeLlmError(new Error("weird backend explosion"));
    expect(info.code).toBe("UNKNOWN");
    expect(info.description).toContain("weird backend explosion");
    expect(info.actionLabel).toBeUndefined();
  });

  it("accepts plain strings and structured error-like objects", () => {
    expect(describeLlmError("NOVELFORK_LLM_API_KEY not set").code).toBe("LLM_CONFIG_MISSING");
    expect(describeLlmError({ message: "ENOTFOUND api.provider.com" }).code).toBe(
      "LLM_NETWORK_ERROR",
    );
    expect(describeLlmError({ error: "rate_limit hit" }).code).toBe("LLM_QUOTA_EXHAUSTED");
  });

  it("uses structured backend error codes before message pattern matching", () => {
    const info = describeLlmError({
      code: "LLM_CONFIG_MISSING",
      message: "模型配置未完成，请先到管理中心配置 API Key 或选择可用网关。",
    });
    expect(info.code).toBe("LLM_CONFIG_MISSING");
    expect(info.title).toBe("模型配置未完成");
    expect(info.actionLabel).toBe("去配置供应商");
  });

  it("localizes copy when language is 'en'", () => {
    const info = describeLlmError(new Error("NOVELFORK_LLM_API_KEY not set"), "en");
    expect(info.title).toBe("Model configuration incomplete");
    expect(info.actionLabel).toBe("Open provider settings");
  });
});
