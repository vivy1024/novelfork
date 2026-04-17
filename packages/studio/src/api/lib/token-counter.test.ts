/**
 * Token counter tests
 */

import { describe, it, expect } from "vitest";
import { countTokens, estimateTokens } from "./token-counter.js";

describe("token-counter", () => {
  describe("countTokens", () => {
    it("should count tokens in English text", () => {
      const text = "Hello, world! This is a test.";
      const result = countTokens(text);

      expect(result.tokens).toBeGreaterThan(0);
      expect(result.characters).toBe(text.length);
    });

    it("should count tokens in Chinese text", () => {
      const text = "你好，世界！这是一个测试。";
      const result = countTokens(text);

      expect(result.tokens).toBeGreaterThan(0);
      expect(result.characters).toBe(text.length);
    });

    it("should handle empty string", () => {
      const result = countTokens("");

      expect(result.tokens).toBe(0);
      expect(result.characters).toBe(0);
    });

    it("should handle long text", () => {
      const text = "a".repeat(10000);
      const result = countTokens(text);

      expect(result.tokens).toBeGreaterThan(0);
      expect(result.tokens).toBeLessThan(text.length);
    });

    it("should count mixed language text", () => {
      const text = "Hello 你好 World 世界";
      const result = countTokens(text);

      expect(result.tokens).toBeGreaterThan(0);
      expect(result.characters).toBe(text.length);
    });
  });

  describe("estimateTokens", () => {
    it("should estimate tokens using heuristic", () => {
      const text = "Hello, world!";
      const estimate = estimateTokens(text);

      expect(estimate).toBe(Math.ceil(text.length / 2));
    });

    it("should handle empty string", () => {
      const estimate = estimateTokens("");

      expect(estimate).toBe(0);
    });

    it("should estimate for long text", () => {
      const text = "a".repeat(1000);
      const estimate = estimateTokens(text);

      expect(estimate).toBe(500);
    });
  });
});
