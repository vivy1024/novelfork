import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let generateSessionReplyMock: ReturnType<typeof vi.fn>;

vi.mock("./llm-runtime-service.js", () => ({
  generateSessionReply: (...args: unknown[]) => generateSessionReplyMock(...args),
}));

async function loadModule() {
  return import("./thinking-translator.js");
}

describe("thinking-translator", () => {
  beforeEach(() => {
    generateSessionReplyMock = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("检测 <thinking> 标签", async () => {
    generateSessionReplyMock.mockResolvedValue({
      success: true,
      type: "message",
      content: "这是翻译后的思考内容",
      metadata: { providerId: "anthropic", modelId: "claude-haiku-4-5" },
    });

    const { translateThinkingBlocks } = await loadModule();
    const result = await translateThinkingBlocks(
      "Hello <thinking>I need to analyze this problem step by step.</thinking> world",
      { summaryModel: "anthropic:claude-haiku-4-5", targetLanguage: "zh" },
    );

    expect(result.hasThinkingBlocks).toBe(true);
    expect(result.translatedContent).toContain("这是翻译后的思考内容");
    expect(result.originalContent).toContain("<thinking>I need to analyze");
  });

  it("检测 <reasoning> 标签", async () => {
    generateSessionReplyMock.mockResolvedValue({
      success: true,
      type: "message",
      content: "推理翻译结果",
      metadata: { providerId: "openai", modelId: "gpt-4o-mini" },
    });

    const { translateThinkingBlocks } = await loadModule();
    const result = await translateThinkingBlocks(
      "Before <reasoning>Let me reason about this carefully.</reasoning> after",
      { summaryModel: "openai:gpt-4o-mini", targetLanguage: "zh" },
    );

    expect(result.hasThinkingBlocks).toBe(true);
    expect(result.translatedContent).toContain("<reasoning>推理翻译结果</reasoning>");
    expect(result.originalContent).toContain("<reasoning>Let me reason about this carefully.</reasoning>");
  });

  it("无 thinking block 时直接返回", async () => {
    const { translateThinkingBlocks } = await loadModule();
    const result = await translateThinkingBlocks(
      "这是一段普通的回复内容，没有任何思考块。",
      { summaryModel: "anthropic:claude-haiku-4-5", targetLanguage: "zh" },
    );

    expect(result.hasThinkingBlocks).toBe(false);
    expect(result.translatedContent).toBe("这是一段普通的回复内容，没有任何思考块。");
    expect(result.originalContent).toBe(result.translatedContent);
    expect(generateSessionReplyMock).not.toHaveBeenCalled();
  });

  it("翻译成功 → 替换 thinking block 内容", async () => {
    generateSessionReplyMock.mockResolvedValue({
      success: true,
      type: "message",
      content: "第一步，分析问题。第二步，制定方案。",
      metadata: { providerId: "anthropic", modelId: "claude-haiku-4-5" },
    });

    const { translateThinkingBlocks } = await loadModule();
    const result = await translateThinkingBlocks(
      "<thinking>Step 1: analyze. Step 2: plan.</thinking>\n\nHere is my answer.",
      { summaryModel: "anthropic:claude-haiku-4-5", targetLanguage: "zh" },
    );

    expect(result.hasThinkingBlocks).toBe(true);
    expect(result.translatedContent).toBe(
      "<thinking>第一步，分析问题。第二步，制定方案。</thinking>\n\nHere is my answer.",
    );
    expect(generateSessionReplyMock).toHaveBeenCalledTimes(1);
    const callArg = generateSessionReplyMock.mock.calls[0][0];
    expect(callArg.sessionConfig.providerId).toBe("anthropic");
    expect(callArg.sessionConfig.modelId).toBe("claude-haiku-4-5");
  });

  it("摘要模型未配置时跳过翻译", async () => {
    const { translateThinkingBlocks } = await loadModule();
    const result = await translateThinkingBlocks(
      "<thinking>Some thinking content here.</thinking>",
      { summaryModel: "", targetLanguage: "zh" },
    );

    expect(result.hasThinkingBlocks).toBe(true);
    expect(result.translatedContent).toBe("<thinking>Some thinking content here.</thinking>");
    expect(generateSessionReplyMock).not.toHaveBeenCalled();
  });

  it("翻译失败时返回原始内容", async () => {
    generateSessionReplyMock.mockRejectedValue(new Error("API error"));

    const { translateThinkingBlocks } = await loadModule();
    const result = await translateThinkingBlocks(
      "<thinking>Some content to translate.</thinking>",
      { summaryModel: "anthropic:claude-haiku-4-5", targetLanguage: "zh" },
    );

    expect(result.hasThinkingBlocks).toBe(true);
    expect(result.translatedContent).toBe("<thinking>Some content to translate.</thinking>");
    expect(result.originalContent).toBe(result.translatedContent);
  });
});
