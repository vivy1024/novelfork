import { describe, expect, it, vi } from "vitest";

import {
  autoCompact,
  estimateTokenCount,
  shouldTriggerCompaction,
  type CompactInput,
  type CompactResult,
} from "./context-compaction";

describe("context compaction", () => {
  it("estimates token count from text length", () => {
    expect(estimateTokenCount("hello world")).toBeGreaterThan(0);
    expect(estimateTokenCount("a".repeat(4000))).toBeCloseTo(1000, -2); // ~4 chars per token
  });

  it("triggers compaction when messages exceed threshold", () => {
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: "assistant" as const,
      content: "x".repeat(800), // ~200 tokens each = 10000 total
    }));

    expect(shouldTriggerCompaction(messages, { maxTokens: 8000, thresholdPercent: 80 })).toBe(true);
    expect(shouldTriggerCompaction(messages.slice(0, 5), { maxTokens: 8000, thresholdPercent: 80 })).toBe(false);
  });

  it("compacts messages by summarizing older ones and keeping recent", async () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      id: `msg-${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: "这是一段较长的消息内容用于测试上下文压缩功能。".repeat(10), // ~200 chars each = ~50 tokens × 20 = ~1000 tokens
    }));

    const summarize = vi.fn().mockResolvedValue("这是前 15 条消息的摘要。");

    const result = await autoCompact({
      messages,
      maxContextTokens: 800, // compress at 80% = 640 tokens, messages well above
      thresholds: { truncatePercent: 60, compressPercent: 80, maxTruncateRatio: 50, keepTurns: 3 },
      summarize,
    });

    expect(result.compacted).toBe(true);
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.messages[0]?.role).toBe("system"); // Summary message
    expect(result.messages[0]?.content).toContain("摘要");
    expect(result.keptMessageCount).toBe(6); // keepTurns(3) * 2
    expect(result.compactedMessageCount).toBe(14); // 20 - 6
    expect(summarize).toHaveBeenCalledOnce();
  });

  it("does not compact when below threshold", async () => {
    const messages = [
      { id: "m1", role: "user" as const, content: "短消息" },
      { id: "m2", role: "assistant" as const, content: "短回复" },
    ];

    const result = await autoCompact({
      messages,
      maxContextTokens: 100000,
      thresholds: { truncatePercent: 60, compressPercent: 80, maxTruncateRatio: 50, keepTurns: 5 },
      summarize: vi.fn(),
    });

    expect(result.compacted).toBe(false);
    expect(result.messages).toEqual(messages);
  });

  it("preserves tool call messages in recent window", async () => {
    const messages = [
      ...Array.from({ length: 15 }, (_, i) => ({ id: `old-${i}`, role: "assistant" as const, content: "旧消息内容用于填充token数量达到压缩阈值。".repeat(5) })),
      { id: "tool-use", role: "assistant" as const, content: "调用工具", toolCalls: [{ id: "t1", toolName: "Read" }] },
      { id: "tool-result", role: "assistant" as const, content: "工具结果" },
      { id: "recent-1", role: "user" as const, content: "最近消息" },
      { id: "recent-2", role: "assistant" as const, content: "最近回复" },
    ];

    const summarize = vi.fn().mockResolvedValue("旧消息摘要。");

    const result = await autoCompact({
      messages,
      maxContextTokens: 400, // compress at 50% = 200, messages well above
      thresholds: { truncatePercent: 40, compressPercent: 50, maxTruncateRatio: 50, keepTurns: 2 },
      summarize,
    });

    expect(result.compacted).toBe(true);
    expect(result.messages.some((m) => m.id === "tool-use")).toBe(true);
  });
});
