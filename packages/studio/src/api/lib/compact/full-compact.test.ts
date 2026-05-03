import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentTurnItem } from "../agent-turn-runtime.js";

const generateSessionReplyMock = vi.hoisted(() => vi.fn());
const loadUserConfigMock = vi.hoisted(() => vi.fn());

vi.mock("../llm-runtime-service.js", () => ({
  generateSessionReply: generateSessionReplyMock,
}));

vi.mock("../user-config-service.js", () => ({
  loadUserConfig: loadUserConfigMock,
}));

import { fullCompact, resetCompactFailures, getCompactFailureCount } from "./full-compact.js";

const defaultSessionConfig = {
  providerId: "test",
  modelId: "test-model",
  permissionMode: "allow" as const,
  reasoningEffort: "medium" as const,
};

function makeUserConfig(summaryModel = "summary-provider:summary-model") {
  return {
    modelDefaults: { summaryModel },
    runtimeControls: { contextCompressionThresholdPercent: 80, contextTruncateTargetPercent: 70 },
  };
}

const sampleMessages: AgentTurnItem[] = [
  { type: "message", role: "system", content: "你是写作助手。" },
  { type: "message", role: "user", content: "写第一章" },
  { type: "message", role: "assistant", content: "好的，我来写第一章。" },
  { type: "tool_call", id: "tc-1", name: "cockpit.get_snapshot", input: { bookId: "b1" } },
  { type: "tool_result", toolCallId: "tc-1", name: "cockpit.get_snapshot", content: "书籍状态：0章" },
  { type: "message", role: "assistant", content: "驾驶舱显示当前0章。" },
  { type: "message", role: "user", content: "继续" },
];

afterEach(() => {
  vi.clearAllMocks();
  resetCompactFailures();
});

describe("fullCompact", () => {
  it("generates a summary and returns compacted messages on success", async () => {
    loadUserConfigMock.mockResolvedValue(makeUserConfig());
    generateSessionReplyMock.mockResolvedValue({
      success: true,
      type: "message",
      content: "<summary>用户要求写第一章，驾驶舱显示0章。</summary>",
      metadata: { providerId: "sp", providerName: "SP", modelId: "sm" },
    });

    const result = await fullCompact(sampleMessages, defaultSessionConfig);

    expect(result.success).toBe(true);
    expect(result.summary).toBe("用户要求写第一章，驾驶舱显示0章。");
    expect(result.messages.length).toBeLessThan(sampleMessages.length);
    // 应该有 system + summary + 最近用户消息
    expect(result.messages.some((m) => m.type === "message" && m.role === "system")).toBe(true);
    expect(result.messages.some((m) => m.type === "message" && m.content.includes("[对话摘要]"))).toBe(true);
    expect(result.messages.some((m) => m.type === "message" && m.role === "user" && m.content === "继续")).toBe(true);
  });

  it("returns original messages when summary model is not configured", async () => {
    loadUserConfigMock.mockResolvedValue(makeUserConfig(""));

    const result = await fullCompact(sampleMessages, defaultSessionConfig);

    expect(result.success).toBe(false);
    expect(result.error).toContain("未配置摘要模型");
    expect(result.messages).toBe(sampleMessages);
  });

  it("returns original messages when LLM call fails", async () => {
    loadUserConfigMock.mockResolvedValue(makeUserConfig());
    generateSessionReplyMock.mockResolvedValue({
      success: false,
      code: "model-unavailable",
      error: "模型不可用",
    });

    const result = await fullCompact(sampleMessages, defaultSessionConfig);

    expect(result.success).toBe(false);
    expect(result.error).toContain("摘要模型调用失败");
    expect(getCompactFailureCount()).toBe(1);
  });

  it("circuit-breaks after 3 consecutive failures", async () => {
    loadUserConfigMock.mockResolvedValue(makeUserConfig());
    generateSessionReplyMock.mockResolvedValue({
      success: false,
      code: "model-unavailable",
      error: "模型不可用",
    });

    await fullCompact(sampleMessages, defaultSessionConfig);
    await fullCompact(sampleMessages, defaultSessionConfig);
    await fullCompact(sampleMessages, defaultSessionConfig);

    expect(getCompactFailureCount()).toBe(3);

    const result = await fullCompact(sampleMessages, defaultSessionConfig);
    expect(result.success).toBe(false);
    expect(result.error).toContain("熔断");
    // LLM 不应该被调用第 4 次
    expect(generateSessionReplyMock).toHaveBeenCalledTimes(3);
  });

  it("resets failure count on success", async () => {
    loadUserConfigMock.mockResolvedValue(makeUserConfig());

    // 先失败 2 次
    generateSessionReplyMock.mockResolvedValue({ success: false, code: "error", error: "fail" });
    await fullCompact(sampleMessages, defaultSessionConfig);
    await fullCompact(sampleMessages, defaultSessionConfig);
    expect(getCompactFailureCount()).toBe(2);

    // 然后成功
    generateSessionReplyMock.mockResolvedValue({
      success: true,
      type: "message",
      content: "<summary>摘要</summary>",
      metadata: { providerId: "sp", providerName: "SP", modelId: "sm" },
    });
    const result = await fullCompact(sampleMessages, defaultSessionConfig);
    expect(result.success).toBe(true);
    expect(getCompactFailureCount()).toBe(0);
  });

  it("handles response without summary tags", async () => {
    loadUserConfigMock.mockResolvedValue(makeUserConfig());
    generateSessionReplyMock.mockResolvedValue({
      success: true,
      type: "message",
      content: "这是一段没有标签的摘要内容。",
      metadata: { providerId: "sp", providerName: "SP", modelId: "sm" },
    });

    const result = await fullCompact(sampleMessages, defaultSessionConfig);

    expect(result.success).toBe(true);
    expect(result.summary).toBe("这是一段没有标签的摘要内容。");
  });

  it("returns error for malformed summary model reference", async () => {
    loadUserConfigMock.mockResolvedValue(makeUserConfig("invalid-no-colon"));

    const result = await fullCompact(sampleMessages, defaultSessionConfig);

    expect(result.success).toBe(false);
    expect(result.error).toContain("格式错误");
  });
});
