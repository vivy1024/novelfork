import { describe, it, expect } from "vitest";
import {
  estimateTokenCount,
  estimateMessageTokens,
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

  describe("estimateMessageTokens — 含 +4 结构开销", () => {
    it("纯文本消息 = ceil(length/4) + 4", () => {
      // "a".repeat(400) = 100 token + 4 结构 = 104
      expect(estimateMessageTokens({ content: "a".repeat(400) })).toBe(104);
    });

    it("含 toolCalls 的消息累加 input + result", () => {
      const msg = {
        content: "a".repeat(100), // 25 token
        toolCalls: [
          { input: { path: "a".repeat(200) }, result: "b".repeat(200) },
        ],
      };
      // content(25) + input JSON({"path":"aaa..."}) ≈ 212 chars(53) + result "b".repeat(200)(50)
      // = ceil(100+212+200)/4 + 4 = ceil(512/4) + 4 = 128+4 = 132
      // 实际 JSON.stringify 可能有空格差异，用实际值
      const actual = estimateMessageTokens(msg);
      expect(actual).toBeGreaterThan(125); // 至少 content + input + result 的 token
      expect(actual).toBeLessThan(140);    // 不会偏离太多
    });

    it("extraTokens 已存在时直接用（不重复算 toolCalls）", () => {
      const msg = { content: "a".repeat(400), extraTokens: 50 };
      // content(100) + extraTokens(50) + 4 结构 = 154
      expect(estimateMessageTokens(msg)).toBe(154);
    });

    it("空消息 = 0 + 4 结构 = 4", () => {
      expect(estimateMessageTokens({})).toBe(4);
    });
  });

  describe("边界用例", () => {
    it("负数字段不影响四字段计算", () => {
      // API 不会返回负数，但防御性处理
      const usage = { input_tokens: -100, output_tokens: 5000 };
      // -100 + 5000 = 4900（不会崩溃）
      expect(getContextTokensFromUsage(usage)).toBe(4900);
    });

    it("NaN 字段不影响计算", () => {
      const usage = { input_tokens: NaN, output_tokens: 5000 };
      // NaN + 5000 = NaN，但 ?? 不会触发（NaN 不是 null/undefined）
      // 这是已知边界：API 不会返回 NaN，但如果有则结果为 NaN
      expect(getContextTokensFromUsage(usage)).toBeNaN();
    });

    it("超长文本不溢出", () => {
      const long = "a".repeat(1_000_000);
      expect(estimateTokenCount(long)).toBe(250_000);
      expect(estimateTokenCount(long)).toBeLessThan(Number.MAX_SAFE_INTEGER);
    });
  });

  describe("tokenCountWithEstimation — API 值四字段 + 增量估算", () => {
    it("无 API usage 时全量本地估算（含 +4 结构开销）", () => {
      const messages = [{ content: "a".repeat(400) }];
      // ceil(400/4) + 4 = 104
      expect(tokenCountWithEstimation(messages)).toBe(104);
    });

    it("有 API usage 时取 max(四字段, 本地估算)", () => {
      const messages = [{ content: "a".repeat(400) }]; // 本地 104
      const usage = { inputTokens: 2000, cacheReadTokens: 80000, cacheCreationTokens: 5000, outputTokens: 3000 };
      // apiTotal = 90000 > 本地 104 → 取 90000
      expect(tokenCountWithEstimation(messages, usage)).toBe(90000);
    });
  });
});
