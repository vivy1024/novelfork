import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentTurnEvent, AgentTurnRuntimeInput } from "./agent-turn-runtime.js";
import type { NarratorSessionRecord } from "../../shared/session-types.js";
import type { SessionToolExecutionResult } from "../../shared/agent-native-workspace.js";

const createSessionMock = vi.hoisted(() => vi.fn());
const getSessionByIdMock = vi.hoisted(() => vi.fn());
const updateSessionMock = vi.hoisted(() => vi.fn());
const loadSessionChatHistoryMock = vi.hoisted(() => vi.fn());
const appendSessionChatHistoryMock = vi.hoisted(() => vi.fn());
const runAgentTurnMock = vi.hoisted(() => vi.fn());
const generateSessionReplyMock = vi.hoisted(() => vi.fn());
const getAgentSystemPromptMock = vi.hoisted(() => vi.fn());
const buildAgentContextMock = vi.hoisted(() => vi.fn());
const getEnabledSessionToolsMock = vi.hoisted(() => vi.fn());

vi.mock("./session-service.js", () => ({
  createSession: createSessionMock,
  getSessionById: getSessionByIdMock,
  updateSession: updateSessionMock,
}));

vi.mock("./session-history-store.js", () => ({
  loadSessionChatHistory: loadSessionChatHistoryMock,
  appendSessionChatHistory: appendSessionChatHistoryMock,
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

import { executeHeadlessChat, type HeadlessChatInput } from "./session-headless-chat-service.js";

function makeSession(overrides: Partial<NarratorSessionRecord> = {}): NarratorSessionRecord {
  return {
    id: "session-1",
    title: "Headless Chat Session",
    agentId: "writer",
    kind: "standalone",
    sessionMode: "chat",
    status: "active",
    createdAt: "2026-05-06T00:00:00.000Z",
    lastModified: "2026-05-06T00:00:00.000Z",
    messageCount: 0,
    sortOrder: 0,
    projectId: "book-1",
    sessionConfig: {
      providerId: "provider-1",
      modelId: "model-1",
      permissionMode: "edit",
      reasoningEffort: "medium",
    },
    recentMessages: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAgentSystemPromptMock.mockReturnValue("你是 NovelFork 叙述者。");
  buildAgentContextMock.mockResolvedValue("## 当前书籍\n- 测试书");
  getEnabledSessionToolsMock.mockReturnValue([]);
  loadSessionChatHistoryMock.mockResolvedValue([]);
  appendSessionChatHistoryMock.mockImplementation(async (_sessionId: string, messages: unknown[]) => messages);
  updateSessionMock.mockImplementation(async (_sessionId: string, update: Partial<NarratorSessionRecord>) => ({ ...makeSession(), ...update }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("session headless chat service", () => {
  it("creates a persistent session, emits stream-json events, and persists turn messages", async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);
    const runtimeEvents: AgentTurnEvent[] = [
      { type: "assistant_message", content: "第三章候选稿已生成。", runtime: { providerId: "provider-1", providerName: "Provider", modelId: "model-1" } },
      { type: "turn_completed" },
    ];
    runAgentTurnMock.mockResolvedValue(runtimeEvents);

    const result = await executeHeadlessChat({ prompt: "写下一章", outputFormat: "stream-json" });

    expect(createSessionMock).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining("Headless Chat"), agentId: "writer" }));
    expect(runAgentTurnMock).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-1", messages: [expect.objectContaining({ content: "写下一章" })] }));
    expect(appendSessionChatHistoryMock).toHaveBeenCalledWith(
      "session-1",
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "写下一章", seq: 1 }),
        expect.objectContaining({ role: "assistant", content: "第三章候选稿已生成。", seq: 2 }),
      ]),
      [],
    );
    expect(updateSessionMock).toHaveBeenCalledWith("session-1", expect.objectContaining({ messageCount: 2 }));
    expect(result.ephemeral).toBe(false);
    expect(result.events).toEqual([
      expect.objectContaining({ type: "user_message", session_id: "session-1", content: "写下一章" }),
      expect.objectContaining({ type: "assistant_message", session_id: "session-1", content: "第三章候选稿已生成。" }),
      expect.objectContaining({ type: "result", session_id: "session-1", success: true, stop_reason: "completed" }),
    ]);
  });

  it("returns usage/cost/permission envelope and accumulates session usage", async () => {
    const session = makeSession({
      cumulativeUsage: { totalInputTokens: 2, totalOutputTokens: 3, totalCacheCreationInputTokens: 1, totalCacheReadInputTokens: 4, turnCount: 1 },
    });
    createSessionMock.mockResolvedValue(session);
    runAgentTurnMock.mockResolvedValue([
      { type: "assistant_message", content: "完成。", runtime: { providerId: "provider-1", providerName: "Provider", modelId: "model-1", usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 } } },
      { type: "turn_completed" },
    ] satisfies AgentTurnEvent[]);

    const result = await executeHeadlessChat({ prompt: "统计用量", outputFormat: "stream-json" });

    expect(result.usage).toEqual({
      currentTurn: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 2, cacheReadInputTokens: 3, totalTokens: 20 },
      cumulative: { totalInputTokens: 12, totalOutputTokens: 8, totalCacheCreationInputTokens: 3, totalCacheReadInputTokens: 7, turnCount: 2, totalTokens: 30 },
    });
    expect(result.cost).toEqual({ status: "unknown", currency: "USD", amount: null });
    expect(result.permissionDenials).toEqual([]);
    expect(result.events.at(-1)).toMatchObject({
      type: "result",
      usage: result.usage,
      cost: result.cost,
      permission_denials: [],
      runtime_capabilities: expect.arrayContaining([
        expect.objectContaining({ id: "codex.sandboxMode", status: "planned" }),
        expect.objectContaining({ id: "codex.approvalPolicy", status: "partial" }),
        expect.objectContaining({ id: "codex.review", status: "reference-only" }),
        expect.objectContaining({ id: "codex.imageInput", status: "reference-only" }),
      ]),
    });
    expect(updateSessionMock).toHaveBeenCalledWith("session-1", expect.objectContaining({ cumulativeUsage: result.usage.cumulative }));
  });

  it("captures permission denials in the result envelope", async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);
    runAgentTurnMock.mockResolvedValue([
      { type: "tool_result", id: "tool-denied", toolName: "chapter.overwrite", result: { ok: false, summary: "工具被策略禁止。", error: "policy-denied", data: { reason: "deny-list" } } },
      { type: "turn_failed", reason: "policy-denied", message: "工具被策略禁止。" },
    ] satisfies AgentTurnEvent[]);

    const result = await executeHeadlessChat({ prompt: "覆盖正式章节" });

    expect(result.permissionDenials).toEqual([{ toolName: "chapter.overwrite", reason: "policy-denied", summary: "工具被策略禁止。" }]);
    expect(result.events.at(-1)).toMatchObject({ type: "result", permission_denials: result.permissionDenials, stop_reason: "failed" });
  });

  it("executes slash commands through the runtime command handler without sending them to the model", async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const result = await executeHeadlessChat({ prompt: "/tools", outputFormat: "stream-json" });

    expect(runAgentTurnMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, stopReason: "failed", exitCode: 1, error: "planned_command" });
    expect(result.events).toEqual([
      expect.objectContaining({ type: "user_message", session_id: "session-1", content: "/tools" }),
      expect.objectContaining({ type: "command_started", session_id: "session-1", command_id: "/tools" }),
      expect.objectContaining({ type: "command_error", session_id: "session-1", command_id: "/tools", code: "planned_command" }),
      expect.objectContaining({ type: "result", session_id: "session-1", success: false, stop_reason: "failed", exit_code: 1, error: "planned_command" }),
    ]);
  });

  it("extracts the user prompt from stream-json input events", async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);
    runAgentTurnMock.mockResolvedValue([
      { type: "assistant_message", content: "已处理 stream-json。", runtime: { providerId: "p", providerName: "P", modelId: "m" } },
      { type: "turn_completed" },
    ]);

    await executeHeadlessChat({
      inputFormat: "stream-json",
      events: [
        { type: "system", content: "ignored" },
        { type: "user_message", content: "审校第十二章" },
      ],
    } satisfies HeadlessChatInput);

    const turnInput: AgentTurnRuntimeInput = runAgentTurnMock.mock.calls[0][0];
    expect(turnInput.messages).toEqual([expect.objectContaining({ type: "message", role: "user", content: "审校第十二章" })]);
  });

  it("runs without writing session records when persistence is disabled", async () => {
    runAgentTurnMock.mockResolvedValue([
      { type: "assistant_message", content: "一次性结果。", runtime: { providerId: "p", providerName: "P", modelId: "m" } },
      { type: "turn_completed" },
    ]);

    const result = await executeHeadlessChat({
      prompt: "临时审稿",
      noSessionPersistence: true,
      sessionConfig: { providerId: "p", modelId: "m", permissionMode: "read" },
    });

    expect(result.ephemeral).toBe(true);
    expect(result.sessionId).toMatch(/^ephemeral:/);
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(appendSessionChatHistoryMock).not.toHaveBeenCalled();
    expect(updateSessionMock).not.toHaveBeenCalled();
    expect(result.events.at(-1)).toMatchObject({ type: "result", ephemeral: true, success: true });
  });

  it("maps pending confirmations to permission_request and result envelopes", async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);
    const confirmationResult: SessionToolExecutionResult = {
      ok: true,
      summary: "工具 guided.exit 需要确认后执行。",
      data: { status: "pending-confirmation" },
      confirmation: {
        id: "confirm-1",
        toolName: "guided.exit",
        target: "book-1",
        risk: "confirmed-write",
        summary: "计划需要确认",
        options: ["approve", "reject"],
      },
    };
    runAgentTurnMock.mockResolvedValue([
      { type: "tool_call", id: "tool-1", toolName: "guided.exit", input: { bookId: "book-1" }, runtime: { providerId: "p", providerName: "P", modelId: "m" } },
      { type: "tool_result", id: "tool-1", toolName: "guided.exit", result: confirmationResult, runtime: { providerId: "p", providerName: "P", modelId: "m" } },
      { type: "confirmation_required", id: "confirm-1", toolName: "guided.exit", result: confirmationResult },
    ] satisfies AgentTurnEvent[]);

    const result = await executeHeadlessChat({ prompt: "生成计划" });

    expect(result.success).toBe(false);
    expect(result.stopReason).toBe("pending_confirmation");
    expect(result.exitCode).toBe(2);
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool_use", tool_use_id: "tool-1", tool_name: "guided.exit" }),
      expect.objectContaining({ type: "tool_result", tool_use_id: "tool-1", tool_name: "guided.exit" }),
      expect.objectContaining({
        type: "permission_request",
        confirmation_id: "confirm-1",
        tool_name: "guided.exit",
        confirmation: expect.objectContaining({
          id: "confirm-1",
          targetResources: [{ kind: "guided.exit", id: "book-1" }],
          source: { sessionId: "session-1" },
          checkpoint: { required: true },
          operations: [
            { action: "approve", label: "批准" },
            { action: "reject", label: "拒绝" },
          ],
        }),
      }),
      expect.objectContaining({ type: "result", success: false, stop_reason: "pending_confirmation" }),
    ]));
  });

  it("persists canonical transcript events for resume and replay", async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);
    const checkpointCandidateResult: SessionToolExecutionResult = {
      ok: true,
      summary: "候选稿已创建并保存 checkpoint。",
      data: { checkpointId: "checkpoint-1", paths: ["chapters/0001.md"] },
      artifact: {
        id: "candidate-1",
        kind: "candidate",
        title: "第 1 章候选稿",
        resourceRef: { kind: "candidate", id: "candidate-1", bookId: "book-1" },
      },
    };
    const confirmationResult: SessionToolExecutionResult = {
      ok: true,
      summary: "等待确认。",
      data: { status: "pending-confirmation" },
      confirmation: {
        id: "confirm-1",
        toolName: "candidate.apply",
        target: "正式章节",
        risk: "confirmed-write",
        summary: "确认写入正式章节",
        options: ["approve", "reject"],
      },
    };
    runAgentTurnMock.mockResolvedValue([
      { type: "tool_call", id: "tool-1", toolName: "candidate.create_chapter", input: { bookId: "book-1" }, runtime: { providerId: "p", providerName: "P", modelId: "m" } },
      { type: "tool_result", id: "tool-1", toolName: "candidate.create_chapter", result: checkpointCandidateResult, runtime: { providerId: "p", providerName: "P", modelId: "m" } },
      { type: "assistant_message", content: "候选稿已生成。", runtime: { providerId: "p", providerName: "P", modelId: "m", usage: { input_tokens: 3, output_tokens: 5 } } },
      { type: "confirmation_required", id: "confirm-1", toolName: "candidate.apply", result: confirmationResult },
      { type: "turn_failed", reason: "pending-confirmation", message: "等待用户确认。" },
      { type: "turn_completed" },
    ] satisfies AgentTurnEvent[]);

    const result = await executeHeadlessChat({ prompt: "写下一章", outputFormat: "stream-json" });

    expect(result.canonicalEvents.map((event) => event.type)).toEqual([
      "tool_use",
      "tool_result",
      "checkpoint",
      "candidate",
      "message",
      "usage",
      "permission_request",
      "error",
      "result",
    ]);
    const persistedMessages = appendSessionChatHistoryMock.mock.calls[0][1] as Array<{ metadata?: { runtimeTranscript?: { events?: Array<{ type: string }> } } }>;
    const transcriptEvents = persistedMessages.flatMap((message) => message.metadata?.runtimeTranscript?.events ?? []);
    expect(transcriptEvents.map((event) => event.type)).toEqual([
      "tool_use",
      "tool_result",
      "checkpoint",
      "candidate",
      "message",
      "usage",
      "permission_request",
      "error",
      "result",
    ]);
  });

  it("honors maxTurns=0 without calling the model", async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const result = await executeHeadlessChat({ prompt: "写下一章", maxTurns: 0 });

    expect(runAgentTurnMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stopReason).toBe("max_turns");
    expect(result.events).toEqual([
      expect.objectContaining({ type: "user_message", content: "写下一章" }),
      expect.objectContaining({ type: "result", success: false, stop_reason: "max_turns" }),
    ]);
  });

  it("honors maxBudgetUsd=0 without calling the model", async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const result = await executeHeadlessChat({ prompt: "批量审稿", maxBudgetUsd: 0 });

    expect(runAgentTurnMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stopReason).toBe("max_budget");
    expect(result.events.at(-1)).toMatchObject({ type: "result", success: false, stop_reason: "max_budget", error: "max-budget" });
  });
});
