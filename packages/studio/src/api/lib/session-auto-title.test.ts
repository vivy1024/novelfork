import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let generateSessionReplyMock: ReturnType<typeof vi.fn>;

vi.mock("./user-config-service.js", () => ({
  loadUserConfig: vi.fn(),
}));

vi.mock("./llm-runtime-service.js", () => ({
  generateSessionReply: (...args: unknown[]) => generateSessionReplyMock(...args),
}));

import { loadUserConfig } from "./user-config-service.js";
import type { NarratorSessionChatMessage } from "../../shared/session-types.js";

const loadUserConfigMock = loadUserConfig as ReturnType<typeof vi.fn>;

async function loadModule() {
  return import("./session-auto-title.js");
}

function makeMessage(role: "user" | "assistant", content: string, id?: string): NarratorSessionChatMessage {
  return {
    id: id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: Date.now(),
  };
}

describe("session-auto-title", () => {
  beforeEach(() => {
    generateSessionReplyMock = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("摘要模型已配置 → 调用 LLM 生成标题", async () => {
    loadUserConfigMock.mockResolvedValue({
      modelDefaults: { summaryModel: "anthropic:claude-haiku-4-5" },
    });
    generateSessionReplyMock.mockResolvedValue({
      success: true,
      type: "message",
      content: "修仙世界的冒险之旅",
      metadata: { providerId: "anthropic", modelId: "claude-haiku-4-5" },
    });

    const { generateSessionTitle } = await loadModule();
    const title = await generateSessionTitle([
      makeMessage("user", "帮我写一个修仙世界的冒险故事"),
      makeMessage("assistant", "好的，让我来构思一个修仙世界的冒险故事。"),
    ]);

    expect(title).toBe("修仙世界的冒险之旅");
    expect(generateSessionReplyMock).toHaveBeenCalledTimes(1);
    const callArg = generateSessionReplyMock.mock.calls[0][0];
    expect(callArg.sessionConfig.providerId).toBe("anthropic");
    expect(callArg.sessionConfig.modelId).toBe("claude-haiku-4-5");
  });

  it("摘要模型未配置 → 使用用户消息前 30 字符", async () => {
    loadUserConfigMock.mockResolvedValue({
      modelDefaults: { summaryModel: "" },
    });

    const { generateSessionTitle } = await loadModule();
    const title = await generateSessionTitle([
      makeMessage("user", "帮我写一个修仙世界的冒险故事，主角是一个普通少年"),
    ]);

    expect(title).toBe("帮我写一个修仙世界的冒险故事，主角是一个普通少年".slice(0, 30));
    expect(generateSessionReplyMock).not.toHaveBeenCalled();
  });

  it("空消息 → 返回 Untitled Session", async () => {
    loadUserConfigMock.mockResolvedValue({
      modelDefaults: { summaryModel: "anthropic:claude-haiku-4-5" },
    });

    const { generateSessionTitle } = await loadModule();
    const title = await generateSessionTitle([]);

    expect(title).toBe("Untitled Session");
    expect(generateSessionReplyMock).not.toHaveBeenCalled();
  });

  it("标题超过 30 字符 → 截断", async () => {
    const longTitle = "这是一个非常非常非常非常非常非常非常非常非常非常非常非常长的标题用来测试截断功能";
    loadUserConfigMock.mockResolvedValue({
      modelDefaults: { summaryModel: "openai:gpt-4o-mini" },
    });
    generateSessionReplyMock.mockResolvedValue({
      success: true,
      type: "message",
      content: longTitle,
      metadata: { providerId: "openai", modelId: "gpt-4o-mini" },
    });

    const { generateSessionTitle } = await loadModule();
    const title = await generateSessionTitle([
      makeMessage("user", "写一个很长的故事"),
    ]);

    expect(title.length).toBeLessThanOrEqual(30);
    expect(title).toBe(longTitle.slice(0, 30));
  });

  it("LLM 调用失败 → fallback 到用户消息前 30 字符", async () => {
    loadUserConfigMock.mockResolvedValue({
      modelDefaults: { summaryModel: "anthropic:claude-haiku-4-5" },
    });
    generateSessionReplyMock.mockRejectedValue(new Error("API error"));

    const { generateSessionTitle } = await loadModule();
    const title = await generateSessionTitle([
      makeMessage("user", "帮我写一个修仙故事"),
    ]);

    expect(title).toBe("帮我写一个修仙故事");
  });

  it("LLM 返回空内容 → fallback 到用户消息前 30 字符", async () => {
    loadUserConfigMock.mockResolvedValue({
      modelDefaults: { summaryModel: "anthropic:claude-haiku-4-5" },
    });
    generateSessionReplyMock.mockResolvedValue({
      success: true,
      type: "message",
      content: "   ",
      metadata: { providerId: "anthropic", modelId: "claude-haiku-4-5" },
    });

    const { generateSessionTitle } = await loadModule();
    const title = await generateSessionTitle([
      makeMessage("user", "帮我写一个修仙故事"),
    ]);

    expect(title).toBe("帮我写一个修仙故事");
  });

  it("仅有 assistant 消息无 user 消息 → 返回 Untitled Session", async () => {
    loadUserConfigMock.mockResolvedValue({
      modelDefaults: { summaryModel: "anthropic:claude-haiku-4-5" },
    });

    const { generateSessionTitle } = await loadModule();
    const title = await generateSessionTitle([
      makeMessage("assistant", "你好，有什么可以帮你的？"),
    ]);

    expect(title).toBe("Untitled Session");
  });
});
