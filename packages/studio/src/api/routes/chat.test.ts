import { describe, expect, it, beforeEach, vi } from "vitest";

const chatCompletionMock = vi.fn();

vi.mock("@vivy1024/novelfork-core", () => ({
  chatCompletion: (...args: unknown[]) => chatCompletionMock(...args),
}));

import { createChatRouter } from "./chat";
import type { RouterContext } from "./context";

function createTestContext(): RouterContext {
  return {
    root: "",
    state: {
      loadBookConfig: vi.fn(async () => ({ title: "测试书" })),
    },
    broadcast: vi.fn(),
    buildPipelineConfig: vi.fn(async () => ({
      client: { provider: "test-provider" },
      model: "test-model",
      logger: undefined,
    })),
    getSessionLlm: vi.fn(async () => undefined),
    runStore: {},
    getStartupSummary: vi.fn(() => null),
    setStartupSummary: vi.fn(),
    setStartupRecoveryRunner: vi.fn(),
  } as unknown as RouterContext;
}

describe("chat route process-memory transparency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatCompletionMock.mockResolvedValue({ content: "真实模型回复", usage: { totalTokens: 12 } });
  });

  it("marks lightweight chat history as process-memory in read, write, and clear responses", async () => {
    const app = createChatRouter(createTestContext());

    const initialResponse = await app.request("http://localhost/api/chat/book-1/messages");
    await expect(initialResponse.json()).resolves.toMatchObject({
      messages: [],
      persistence: "process-memory",
    });

    const sendResponse = await app.request("http://localhost/api/chat/book-1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "帮我分析主角动机" }),
    });
    await expect(sendResponse.json()).resolves.toMatchObject({
      persistence: "process-memory",
      message: {
        role: "assistant",
        content: "真实模型回复",
      },
    });

    const historyResponse = await app.request("http://localhost/api/chat/book-1/messages");
    await expect(historyResponse.json()).resolves.toMatchObject({
      persistence: "process-memory",
      messages: [
        { role: "user", content: "帮我分析主角动机" },
        { role: "assistant", content: "真实模型回复" },
      ],
    });

    const clearResponse = await app.request("http://localhost/api/chat/book-1/messages", { method: "DELETE" });
    await expect(clearResponse.json()).resolves.toMatchObject({
      status: "cleared",
      persistence: "process-memory",
    });
  });
});
