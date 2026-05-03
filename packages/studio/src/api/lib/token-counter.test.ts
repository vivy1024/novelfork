import { describe, expect, it } from "vitest";
import type { AgentTurnItem } from "./agent-turn-runtime";
import {
  roughTokenEstimation,
  tokenCountFromUsage,
  tokenCountWithEstimation,
  getContextWindowForModel,
} from "./token-counter";

describe("token-counter", () => {
  describe("roughTokenEstimation", () => {
    it("estimates English text tokens as length / 4 (ceil)", () => {
      // 13 chars → ceil(13/4) = 4
      expect(roughTokenEstimation("Hello, world!")).toBe(4);
    });

    it("estimates Chinese text tokens as length / 4 (ceil)", () => {
      // 6 chars → ceil(6/4) = 2
      expect(roughTokenEstimation("你好世界测试")).toBe(2);
    });

    it("returns 0 for empty string", () => {
      expect(roughTokenEstimation("")).toBe(0);
    });

    it("handles long content", () => {
      const content = "a".repeat(1000);
      expect(roughTokenEstimation(content)).toBe(250);
    });
  });

  describe("tokenCountFromUsage", () => {
    it("sums input and output tokens", () => {
      expect(tokenCountFromUsage({ input_tokens: 100, output_tokens: 50 })).toBe(150);
    });

    it("returns 0 when no fields are present", () => {
      expect(tokenCountFromUsage({})).toBe(0);
    });

    it("includes cache tokens in the total", () => {
      expect(
        tokenCountFromUsage({
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 30,
          cache_read_input_tokens: 20,
        }),
      ).toBe(200);
    });

    it("handles partial usage with only input_tokens", () => {
      expect(tokenCountFromUsage({ input_tokens: 42 })).toBe(42);
    });
  });

  describe("tokenCountWithEstimation", () => {
    it("uses rough estimation when no messages have usage", () => {
      const messages: AgentTurnItem[] = [
        { type: "message", role: "user", content: "Hello, world!" },
        { type: "message", role: "assistant", content: "Hi there!" },
      ];
      // "Hello, world!" → ceil(13/4)=4, "Hi there!" → ceil(9/4)=3
      expect(tokenCountWithEstimation(messages)).toBe(7);
    });

    it("uses precise count from last usage + rough estimation for subsequent messages", () => {
      const messages: AgentTurnItem[] = [
        { type: "message", role: "user", content: "first" },
        {
          type: "message",
          role: "assistant",
          content: "response with usage",
          metadata: { usage: { input_tokens: 100, output_tokens: 50 } },
        },
        { type: "message", role: "user", content: "follow up question here" },
      ];
      // precise: 100 + 50 = 150
      // rough for "follow up question here" → ceil(22/4) = 6
      expect(tokenCountWithEstimation(messages)).toBe(156);
    });

    it("handles mixed messages with tool calls and tool results", () => {
      const messages: AgentTurnItem[] = [
        {
          type: "message",
          role: "assistant",
          content: "let me check",
          metadata: { usage: { input_tokens: 200, output_tokens: 80 } },
        },
        { type: "tool_call", id: "tc-1", name: "read_file", input: { path: "/a.ts" } },
        { type: "tool_result", toolCallId: "tc-1", name: "read_file", content: "file content here" },
      ];
      // precise: 200 + 80 = 280
      // tool_call text: "read_file" + JSON.stringify({path:"/a.ts"}) = "read_file{\"path\":\"/a.ts\"}" → 25 chars → ceil(25/4) = 7
      // tool_result text: "file content here" → 17 chars → ceil(17/4) = 5
      expect(tokenCountWithEstimation(messages)).toBe(292);
    });

    it("returns 0 for empty messages array", () => {
      expect(tokenCountWithEstimation([])).toBe(0);
    });
  });

  describe("getContextWindowForModel", () => {
    it("returns known context window for exact model match", () => {
      expect(getContextWindowForModel("any-provider", "gpt-4o")).toBe(128000);
    });

    it("returns known context window for prefix match", () => {
      expect(getContextWindowForModel("anthropic", "claude-3-5-sonnet-20241022")).toBe(200000);
    });

    it("returns default 200000 for unknown models", () => {
      expect(getContextWindowForModel("custom", "my-custom-model")).toBe(200000);
    });

    it("returns correct window for DeepSeek models", () => {
      expect(getContextWindowForModel("deepseek", "deepseek-chat")).toBe(128000);
    });

    it("returns correct window for Gemini models", () => {
      expect(getContextWindowForModel("google", "gemini-2.5-pro-latest")).toBe(1000000);
    });
  });
});
