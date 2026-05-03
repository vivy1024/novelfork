import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentTurnEvent, AgentTurnRuntimeInput } from "./agent-turn-runtime.js";
import type { SessionToolExecutionResult } from "../../shared/agent-native-workspace.js";
import type { NarratorSessionRecord, SessionConfig } from "../../shared/session-types.js";

const createSessionMock = vi.hoisted(() => vi.fn());
const getSessionByIdMock = vi.hoisted(() => vi.fn());
const runAgentTurnMock = vi.hoisted(() => vi.fn());
const generateSessionReplyMock = vi.hoisted(() => vi.fn());
const getAgentSystemPromptMock = vi.hoisted(() => vi.fn());
const buildAgentContextMock = vi.hoisted(() => vi.fn());
const getEnabledSessionToolsMock = vi.hoisted(() => vi.fn());

vi.mock("./session-service.js", () => ({
  createSession: createSessionMock,
  getSessionById: getSessionByIdMock,
}));

vi.mock("./agent-turn-runtime.js", () => ({
  runAgentTurn: runAgentTurnMock,
}));

vi.mock("./llm-runtime-service.js", () => ({
  generateSessionReply: generateSessionReplyMock,
}));

vi.mock("@vivy1024/novelfork-core", () => ({
  getAgentSystemPrompt: getAgentSystemPromptMock,
}));

vi.mock("./agent-context.js", () => ({
  buildAgentContext: buildAgentContextMock,
}));

vi.mock("./session-tool-registry.js", () => ({
  getEnabledSessionTools: getEnabledSessionToolsMock,
}));

vi.mock("./session-tool-executor.js", () => ({
  createSessionToolExecutor: () => ({
    execute: vi.fn(async () => ({ ok: true, summary: "工具执行成功", data: {} })),
  }),
}));

import { executeHeadless, type HeadlessExecInput, type HeadlessExecResult } from "./headless-exec-service.js";

function makeSession(overrides: Partial<NarratorSessionRecord> = {}): NarratorSessionRecord {
  return {
    id: "session-1",
    title: "Headless Session",
    agentId: "writer",
    kind: "standalone",
    sessionMode: "chat",
    status: "active",
    createdAt: "2026-05-01T00:00:00.000Z",
    lastModified: "2026-05-01T00:00:00.000Z",
    messageCount: 0,
    sortOrder: 0,
    sessionConfig: {
      providerId: "provider-1",
      modelId: "model-1",
      permissionMode: "allow",
      reasoningEffort: "medium",
    },
    recentMessages: [],
    ...overrides,
  };
}

afterEach(() => { vi.clearAllMocks(); });

beforeEach(() => {
  getAgentSystemPromptMock.mockReturnValue("你是一个写作助手。");
  buildAgentContextMock.mockResolvedValue("");
  getEnabledSessionToolsMock.mockReturnValue([]);
});

describe("executeHeadless", () => {
  it("creates a new session and returns the final assistant message on success", async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const events: AgentTurnEvent[] = [
      { type: "assistant_message", content: "这是第三章的候选稿。", runtime: { providerId: "provider-1", providerName: "Test", modelId: "model-1" } },
      { type: "turn_completed" },
    ];
    runAgentTurnMock.mockResolvedValue(events);

    const result = await executeHeadless({ prompt: "为当前书生成下一章候选稿" });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.finalMessage).toBe("这是第三章的候选稿。");
    expect(result.sessionId).toBe("session-1");
    expect(result.events).toHaveLength(2);
    expect(createSessionMock).toHaveBeenCalledOnce();
  });

  it("returns model-unavailable failure when session has no provider or model configured", async () => {
    const session = makeSession({
      sessionConfig: { providerId: "", modelId: "", permissionMode: "allow", reasoningEffort: "medium" },
    });
    createSessionMock.mockResolvedValue(session);

    runAgentTurnMock.mockResolvedValue([
      { type: "turn_failed", reason: "model-unavailable", message: "未配置模型，请先选择真实模型。" },
    ]);

    const result = await executeHeadless({ prompt: "写一章" });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("model-unavailable");
  });

  it("stops with pending confirmation when a tool requires user approval", async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const confirmationResult: SessionToolExecutionResult = {
      ok: false,
      summary: "候选稿需要确认",
      error: "confirmation-required",
      confirmation: {
        id: "confirm-1",
        toolName: "candidate.create_chapter",
        target: "chapter-3",
        risk: "confirmed-write",
        summary: "创建第三章候选稿",
        options: ["approve", "reject"],
      },
    };

    const events: AgentTurnEvent[] = [
      { type: "tool_call", id: "tc-1", toolName: "candidate.create_chapter", input: { bookId: "b1" }, runtime: { providerId: "p1", providerName: "T", modelId: "m1" } },
      { type: "confirmation_required", id: "tc-1", toolName: "candidate.create_chapter", result: confirmationResult },
    ];
    runAgentTurnMock.mockResolvedValue(events);

    const result = await executeHeadless({ prompt: "生成候选稿" });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.pendingConfirmation).toEqual({ toolName: "candidate.create_chapter", id: "tc-1" });
  });

  it("returns tool chain summary when a tool execution fails", async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const events: AgentTurnEvent[] = [
      { type: "tool_call", id: "tc-1", toolName: "cockpit.get_snapshot", input: { bookId: "b1" }, runtime: { providerId: "p1", providerName: "T", modelId: "m1" } },
      { type: "tool_result", id: "tc-1", toolName: "cockpit.get_snapshot", result: { ok: false, summary: "书籍不存在", error: "not-found" } },
      { type: "turn_failed", reason: "tool-failure", message: "工具执行失败", data: { lastToolName: "cockpit.get_snapshot" } },
    ];
    runAgentTurnMock.mockResolvedValue(events);

    const result = await executeHeadless({ prompt: "获取快照" });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.toolChainSummary).toContain("cockpit.get_snapshot");
  });

  it("appends stdin context to the agent context", async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    runAgentTurnMock.mockResolvedValue([
      { type: "assistant_message", content: "已处理附加上下文。", runtime: { providerId: "p1", providerName: "T", modelId: "m1" } },
      { type: "turn_completed" },
    ]);

    await executeHeadless({
      prompt: "分析这段文本",
      stdinContext: "这是从管道传入的小说片段。",
    });

    expect(runAgentTurnMock).toHaveBeenCalledOnce();
    const turnInput: AgentTurnRuntimeInput = runAgentTurnMock.mock.calls[0][0];
    expect(turnInput.context).toContain("这是从管道传入的小说片段。");
  });

  it("reuses an existing session when sessionId is provided", async () => {
    const session = makeSession({ id: "existing-session" });
    getSessionByIdMock.mockResolvedValue(session);

    runAgentTurnMock.mockResolvedValue([
      { type: "assistant_message", content: "继续上次的工作。", runtime: { providerId: "p1", providerName: "T", modelId: "m1" } },
      { type: "turn_completed" },
    ]);

    const result = await executeHeadless({
      prompt: "继续写",
      sessionId: "existing-session",
    });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe("existing-session");
    expect(getSessionByIdMock).toHaveBeenCalledWith("existing-session");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("fails when the specified session does not exist", async () => {
    getSessionByIdMock.mockResolvedValue(null);

    const result = await executeHeadless({
      prompt: "继续写",
      sessionId: "nonexistent",
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("nonexistent");
  });

  it("passes sessionConfig overrides to the created session", async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    runAgentTurnMock.mockResolvedValue([
      { type: "assistant_message", content: "ok", runtime: { providerId: "p2", providerName: "T", modelId: "m2" } },
      { type: "turn_completed" },
    ]);

    await executeHeadless({
      prompt: "写",
      sessionConfig: { providerId: "provider-2", modelId: "model-2" },
    });

    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionConfig: expect.objectContaining({
          providerId: "provider-2",
          modelId: "model-2",
        }),
      }),
    );
  });

  it("collects tool results from the event stream", async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const toolResult: SessionToolExecutionResult = {
      ok: true,
      summary: "快照已获取",
      data: { chapters: 5 },
    };

    const events: AgentTurnEvent[] = [
      { type: "tool_call", id: "tc-1", toolName: "cockpit.get_snapshot", input: { bookId: "b1" }, runtime: { providerId: "p1", providerName: "T", modelId: "m1" } },
      { type: "tool_result", id: "tc-1", toolName: "cockpit.get_snapshot", result: toolResult },
      { type: "assistant_message", content: "书籍有5章。", runtime: { providerId: "p1", providerName: "T", modelId: "m1" } },
      { type: "turn_completed" },
    ];
    runAgentTurnMock.mockResolvedValue(events);

    const result = await executeHeadless({ prompt: "获取快照" });

    expect(result.success).toBe(true);
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]).toEqual({ toolName: "cockpit.get_snapshot", result: toolResult });
  });

  it("uses the specified projectId for book context", async () => {
    const session = makeSession({ projectId: "book-42" });
    createSessionMock.mockResolvedValue(session);
    buildAgentContextMock.mockResolvedValue("《测试书》共5章");

    runAgentTurnMock.mockResolvedValue([
      { type: "assistant_message", content: "ok", runtime: { providerId: "p1", providerName: "T", modelId: "m1" } },
      { type: "turn_completed" },
    ]);

    await executeHeadless({ prompt: "写", projectId: "book-42" });

    expect(buildAgentContextMock).toHaveBeenCalledWith(expect.objectContaining({ bookId: "book-42" }));
  });
});
