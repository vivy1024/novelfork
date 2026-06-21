import { describe, it, expect } from "bun:test";
import {
  estimateTokenCount,
  getContextTokensFromUsage,
  getEffectiveContextWindow,
  tokenCountWithEstimation,
} from "./token-utils.js";

describe("token-utils 单一权威口径", () => {
  describe("getContextTokensFromUsage — 四字段全算", () => {
    it("input + cache_creation + cache_read + output 全部计入", () => {
      const usage = {
        input_tokens: 2000,
        cache_creation_input_tokens: 5000,
        cache_read_input_tokens: 80000,
        output_tokens: 3000,
      };
      expect(getContextTokensFromUsage(usage)).toBe(90000);
    });

    it("开 prompt caching 场景：不能只看 input（防回归）", () => {
      // 真实场景：内容在 cache_read，input 很小。只看 input 会严重低估 → 该压缩不压缩
      const usage = { input_tokens: 2000, cache_read_input_tokens: 80000 };
      const ctx = getContextTokensFromUsage(usage);
      expect(ctx).toBe(82000);
      expect(ctx).not.toBe(usage.input_tokens); // 绝不能等于只取 input
    });

    it("缺字段按 0 处理", () => {
      expect(getContextTokensFromUsage({ input_tokens: 1000 })).toBe(1000);
      expect(getContextTokensFromUsage(undefined)).toBe(0);
      expect(getContextTokensFromUsage({})).toBe(0);
    });
  });

  describe("getEffectiveContextWindow — 窗口扣输出预留", () => {
    it("默认扣 32768 输出预留", () => {
      expect(getEffectiveContextWindow(128000)).toBe(128000 - 32768);
      expect(getEffectiveContextWindow(200000)).toBe(200000 - 32768);
    });

    it("自定义预留", () => {
      expect(getEffectiveContextWindow(200000, 20000)).toBe(180000);
    });

    it("窗口小于预留时不返回负数", () => {
      expect(getEffectiveContextWindow(10000)).toBe(0);
    });

    it("窗口为 0 或无效返回 0", () => {
      expect(getEffectiveContextWindow(0)).toBe(0);
      expect(getEffectiveContextWindow(-1)).toBe(0);
    });
  });

  describe("触发判断回归保护", () => {
    it("开缓存场景：旧逻辑(只input/全窗口)不触发，新逻辑(四字段/有效窗口)触发", () => {
      const usage = { input_tokens: 2000, cache_read_input_tokens: 80000, cache_creation_input_tokens: 5000, output_tokens: 3000 };
      const window = 128000;

      const oldRatio = (usage.input_tokens) / window;            // 旧 runtime
      const newRatio = getContextTokensFromUsage(usage) / getEffectiveContextWindow(window);

      expect(oldRatio).toBeLessThan(0.1);   // 旧逻辑 1.6% — 永远不触发（bug）
      expect(newRatio).toBeGreaterThan(0.8); // 新逻辑 94.5% — 正确触发
    });
  });

  describe("estimateTokenCount", () => {
    it("length / 4", () => {
      expect(estimateTokenCount("")).toBe(0);
      expect(estimateTokenCount("abcd")).toBe(1);
      expect(estimateTokenCount("a".repeat(400))).toBe(100);
    });
  });

  describe("tokenCountWithEstimation — API 值四字段 + 增量估算", () => {
    it("无 API usage 时全量本地估算", () => {
      const messages = [{ content: "a".repeat(400) }];
      expect(tokenCountWithEstimation(messages)).toBe(100);
    });

    it("有 API usage 时取 max(四字段, 本地估算)", () => {
      const messages = [{ content: "a".repeat(400) }]; // 本地 100
      const usage = { inputTokens: 2000, cacheReadTokens: 80000, cacheCreationTokens: 5000, outputTokens: 3000 };
      // apiTotal = 90000 > 本地 100 → 取 90000
      expect(tokenCountWithEstimation(messages, usage)).toBe(90000);
    });
  });
});
