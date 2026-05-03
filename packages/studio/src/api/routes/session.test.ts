import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let generateSessionReplyMock: ReturnType<typeof vi.fn>;
let executeSessionToolMock: ReturnType<typeof vi.fn>;

vi.mock("../lib/llm-runtime-service.js", () => ({
  generateSessionReply: (...args: unknown[]) =>
    (globalThis as typeof globalThis & { __novelforkGenerateSessionReplyMock: (...args: unknown[]) => unknown })
      .__novelforkGenerateSessionReplyMock(...args),
}));

vi.mock("../lib/session-tool-executor.js", () => ({
  createSessionToolExecutor: () => ({
    execute: (...args: unknown[]) =>
      (globalThis as typeof globalThis & { __novelforkExecuteSessionToolMock: (...args: unknown[]) => unknown })
        .__novelforkExecuteSessionToolMock(...args),
  }),
}));

import sessionRouter from "./session";
import {
  attachSessionChatTransport,
  handleSessionChatTransportMessage,
} from "../lib/session-chat-service";

class MockTransport {
  readonly sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }

  close() {}
}

describe("sessionRouter", () => {
  let sessionStoreDir: string;

  beforeEach(async () => {
    sessionStoreDir = await mkdtemp(join(tmpdir(), "novelfork-session-route-"));
    process.env.NOVELFORK_SESSION_STORE_DIR = sessionStoreDir;
    generateSessionReplyMock = vi.fn().mockResolvedValue({
      success: true,
      type: "message",
      content: "运行时真实回复",
      metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
    });
    (globalThis as typeof globalThis & { __novelforkGenerateSessionReplyMock: typeof generateSessionReplyMock })
      .__novelforkGenerateSessionReplyMock = generateSessionReplyMock;
    executeSessionToolMock = vi.fn().mockResolvedValue({
      ok: true,
      summary: "工具执行完成。",
      data: { status: "ok" },
      durationMs: 9,
    });
    (globalThis as typeof globalThis & { __novelforkExecuteSessionToolMock: typeof executeSessionToolMock })
      .__novelforkExecuteSessionToolMock = executeSessionToolMock;
  });

  afterEach(async () => {
    const { __testing } = await import("../lib/session-service");
    __testing.resetSessionStoreMutationQueue();
    generateSessionReplyMock.mockReset();
    executeSessionToolMock.mockReset();
    delete (globalThis as typeof globalThis & { __novelforkGenerateSessionReplyMock?: typeof generateSessionReplyMock })
      .__novelforkGenerateSessionReplyMock;
    delete (globalThis as typeof globalThis & { __novelforkExecuteSessionToolMock?: typeof executeSessionToolMock })
      .__novelforkExecuteSessionToolMock;
    delete process.env.NOVELFORK_SESSION_STORE_DIR;
    await rm(sessionStoreDir, { recursive: true, force: true });
  });

  it("creates and returns formal narrator session records", async () => {
    const createResponse = await sessionRouter.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Planner 会话",
        agentId: "planner",
        kind: "standalone",
        sessionMode: "plan",
        worktree: "feature/session-core",
        sessionConfig: {
          providerId: "anthropic",
          modelId: "claude-sonnet-4-6",
          permissionMode: "ask",
          reasoningEffort: "high",
        },
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();

    expect(created).toMatchObject({
      title: "Planner 会话",
      agentId: "planner",
      kind: "standalone",
      sessionMode: "plan",
      worktree: "feature/session-core",
      status: "active",
      sortOrder: 0,
      sessionConfig: {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-6",
        permissionMode: "ask",
        reasoningEffort: "high",
      },
    });
    expect(typeof created.id).toBe("string");
    expect(typeof created.createdAt).toBe("string");
    expect(typeof created.lastModified).toBe("string");

    const stateResponse = await sessionRouter.request(`http://localhost/${created.id}/chat/state`);
    expect(stateResponse.status).toBe(200);

    const state = await stateResponse.json();
    expect(state).toMatchObject({
      session: {
        id: created.id,
        agentId: "planner",
        kind: "standalone",
        sessionMode: "plan",
        sessionConfig: {
          providerId: "anthropic",
          modelId: "claude-sonnet-4-6",
        },
      },
      messages: [],
      cursor: {
        lastSeq: 0,
      },
    });

    const listResponse = await sessionRouter.request("http://localhost/");
    expect(listResponse.status).toBe(200);

    const sessions = await listResponse.json();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: created.id,
      agentId: "planner",
      kind: "standalone",
      sessionMode: "plan",
      sessionConfig: {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-6",
      },
    });
  });

  it("filters the session center list by binding, resource, status, search, and recent activity", async () => {
    const create = async (body: Record<string, unknown>) => {
      const response = await sessionRouter.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(201);
      return response.json();
    };

    const standalone = await create({ title: "自由讨论", agentId: "planner", kind: "standalone", sessionMode: "plan" });
    const bookBound = await create({ title: "灵潮纪元 · 叙述者", agentId: "writer", kind: "standalone", projectId: "book-1", sessionMode: "chat" });
    const chapterBound = await create({ title: "第二章入城 · 修订", agentId: "reviser", kind: "chapter", projectId: "book-1", chapterId: "2", sessionMode: "chat" });
    const archived = await create({ title: "旧书归档会话", agentId: "auditor", kind: "standalone", projectId: "book-2", sessionMode: "chat" });

    const archiveResponse = await sessionRouter.request(`http://localhost/${archived.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    expect(archiveResponse.status).toBe(200);

    const projectResponse = await sessionRouter.request("http://localhost/?projectId=book-1&status=active&sort=recent");
    expect(projectResponse.status).toBe(200);
    const projectSessions = await projectResponse.json();
    expect(projectSessions.map((session: { id: string }) => session.id)).toEqual([chapterBound.id, bookBound.id]);

    const chapterResponse = await sessionRouter.request("http://localhost/?kind=chapter&chapterId=2");
    const chapterSessions = await chapterResponse.json();
    expect(chapterSessions.map((session: { id: string }) => session.id)).toEqual([chapterBound.id]);

    const bindingResponse = await sessionRouter.request("http://localhost/?binding=book&projectId=book-1");
    const bindingSessions = await bindingResponse.json();
    expect(bindingSessions.map((session: { id: string }) => session.id)).toEqual([bookBound.id]);

    const archivedResponse = await sessionRouter.request("http://localhost/?status=archived");
    const archivedSessions = await archivedResponse.json();
    expect(archivedSessions.map((session: { id: string }) => session.id)).toEqual([archived.id]);

    const searchResponse = await sessionRouter.request("http://localhost/?search=%E7%81%B5%E6%BD%AE");
    const searchSessions = await searchResponse.json();
    expect(searchSessions.map((session: { id: string }) => session.id)).toEqual([bookBound.id]);

    const standaloneResponse = await sessionRouter.request("http://localhost/?binding=standalone");
    const standaloneSessions = await standaloneResponse.json();
    expect(standaloneSessions.map((session: { id: string }) => session.id)).toEqual([standalone.id]);
  });

  it("archives and restores sessions without deleting chat history", async () => {
    const createResponse = await sessionRouter.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "可恢复会话", agentId: "writer", sessionMode: "chat" }),
    });
    const created = await createResponse.json();

    await sessionRouter.request(`http://localhost/${created.id}/chat/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ id: "history-kept", role: "user", content: "保留这条历史", timestamp: 1710000000000 }] }),
    });

    const archiveResponse = await sessionRouter.request(`http://localhost/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    expect(archiveResponse.status).toBe(200);
    expect(await archiveResponse.json()).toMatchObject({ id: created.id, status: "archived" });

    const restoreResponse = await sessionRouter.request(`http://localhost/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    expect(restoreResponse.status).toBe(200);
    expect(await restoreResponse.json()).toMatchObject({ id: created.id, status: "active" });

    const stateResponse = await sessionRouter.request(`http://localhost/${created.id}/chat/state`);
    const state = await stateResponse.json();
    expect(state.messages).toMatchObject([{ id: "history-kept", content: "保留这条历史" }]);
  });

  it("serves incremental chat history by sinceSeq", async () => {
    const createResponse = await sessionRouter.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Writer 会话",
        agentId: "writer",
        sessionMode: "chat",
      }),
    });
    const created = await createResponse.json();

    const transport = new MockTransport();
    expect(await attachSessionChatTransport(created.id, transport)).toBe(true);

    await handleSessionChatTransportMessage(
      created.id,
      transport,
      JSON.stringify({
        type: "session:message",
        messageId: "history-message-1",
        content: "第一句",
        sessionMode: "chat",
      }),
    );
    await handleSessionChatTransportMessage(
      created.id,
      transport,
      JSON.stringify({
        type: "session:message",
        messageId: "history-message-2",
        content: "第二句",
        sessionMode: "chat",
      }),
    );

    const historyResponse = await sessionRouter.request(`http://localhost/${created.id}/chat/history?sinceSeq=2`);
    expect(historyResponse.status).toBe(200);

    const history = await historyResponse.json();
    expect(history).toMatchObject({
      sessionId: created.id,
      sinceSeq: 2,
      availableFromSeq: 1,
      resetRequired: false,
      cursor: {
        lastSeq: 4,
      },
    });
    expect(history.messages).toHaveLength(2);
    expect(history.messages[0]).toMatchObject({
      id: "history-message-2",
      role: "user",
      seq: 3,
    });
    expect(history.messages[1]).toMatchObject({
      id: "history-message-2-assistant",
      role: "assistant",
      seq: 4,
    });
  });

  it("replaces chat state through the dedicated server-first endpoint", async () => {
    const createResponse = await sessionRouter.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "压缩会话",
        agentId: "writer",
        sessionMode: "chat",
      }),
    });
    const created = await createResponse.json();

    const replaceResponse = await sessionRouter.request(`http://localhost/${created.id}/chat/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { id: "summary-1", role: "system", content: "已压缩较早消息", timestamp: 1710000000000 },
          { id: "msg-2", role: "assistant", content: "保留消息", timestamp: 1710000001000 },
        ],
      }),
    });
    expect(replaceResponse.status).toBe(200);

    const snapshot = await replaceResponse.json();
    expect(snapshot).toMatchObject({
      session: {
        id: created.id,
        messageCount: 2,
      },
      messages: [
        { id: "summary-1", role: "system", content: "已压缩较早消息", seq: 1 },
        { id: "msg-2", role: "assistant", content: "保留消息", seq: 2 },
      ],
      cursor: {
        lastSeq: 2,
      },
    });

    const stateResponse = await sessionRouter.request(`http://localhost/${created.id}/chat/state`);
    expect(stateResponse.status).toBe(200);
    const state = await stateResponse.json();
    expect(state.messages).toMatchObject([
      { id: "summary-1", role: "system", content: "已压缩较早消息", seq: 1 },
      { id: "msg-2", role: "assistant", content: "保留消息", seq: 2 },
    ]);
  });

  it("replays persisted history even when the in-memory runtime buffer has been trimmed", async () => {
    const createResponse = await sessionRouter.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Long Writer 会话",
        agentId: "writer",
        sessionMode: "chat",
      }),
    });
    const created = await createResponse.json();

    const transport = new MockTransport();
    expect(await attachSessionChatTransport(created.id, transport)).toBe(true);

    for (let index = 0; index < 30; index += 1) {
      await handleSessionChatTransportMessage(
        created.id,
        transport,
        JSON.stringify({
          type: "session:message",
          messageId: `trimmed-message-${index + 1}`,
          content: `第 ${index + 1} 句`,
          sessionMode: "chat",
        }),
      );
    }

    const historyResponse = await sessionRouter.request(`http://localhost/${created.id}/chat/history?sinceSeq=1`);
    expect(historyResponse.status).toBe(200);

    const history = await historyResponse.json();
    expect(history).toMatchObject({
      sessionId: created.id,
      sinceSeq: 1,
      availableFromSeq: 1,
      resetRequired: false,
      cursor: {
        lastSeq: 60,
      },
    });
    expect(history.messages).toHaveLength(59);
    expect(history.messages[0]).toMatchObject({
      id: "trimmed-message-1-assistant",
      seq: 2,
      role: "assistant",
    });
    expect(history.messages.at(-1)).toMatchObject({
      id: "trimmed-message-30-assistant",
      seq: 60,
      role: "assistant",
    });
  });

  it("lists pending tool confirmations from the session tools API", async () => {
    generateSessionReplyMock.mockResolvedValueOnce({
      success: true,
      type: "tool_use",
      toolUses: [{ id: "tool-use-confirm-route", name: "guided.exit", input: { bookId: "book-1", sessionId: "guided-session-1", guidedStateId: "guided-state-1", plan: { title: "计划" } } }],
      metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
    });
    executeSessionToolMock.mockResolvedValueOnce({
      ok: true,
      renderer: "guided.plan",
      summary: "工具 guided.exit 需要确认后执行。",
      data: { status: "pending-confirmation" },
      confirmation: {
        id: "confirm-route-1",
        toolName: "guided.exit",
        target: "book-1",
        risk: "confirmed-write",
        summary: "退出引导模式并执行计划",
        diff: { plannedWrites: 1 },
        options: ["approve", "reject", "open-in-canvas"],
        sessionId: "guided-session-1",
        createdAt: "2026-05-02T00:00:00.000Z",
      },
      durationMs: 6,
    });
    const createResponse = await sessionRouter.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "确认门 API 会话", agentId: "writer", sessionMode: "chat" }),
    });
    const created = await createResponse.json();
    const transport = new MockTransport();

    expect(await attachSessionChatTransport(created.id, transport)).toBe(true);
    await handleSessionChatTransportMessage(
      created.id,
      transport,
      JSON.stringify({ type: "session:message", messageId: "confirm-api-1", content: "执行这个计划", sessionMode: "chat" }),
    );

    const toolsResponse = await sessionRouter.request(`http://localhost/${created.id}/tools`);
    expect(toolsResponse.status).toBe(200);
    const toolsBody = await toolsResponse.json();

    expect(toolsBody.pendingConfirmations).toEqual([
      expect.objectContaining({
        id: "confirm-route-1",
        sessionId: created.id,
        toolName: "guided.exit",
        toolUseId: "tool-use-confirm-route",
        target: "book-1",
        risk: "confirmed-write",
        summary: "退出引导模式并执行计划",
        diff: { plannedWrites: 1 },
        status: "pending",
      }),
    ]);
    expect(toolsBody.pendingConfirmations[0].input).toMatchObject({ bookId: "book-1", guidedStateId: "guided-state-1" });

    const stateResponse = await sessionRouter.request(`http://localhost/${created.id}/chat/state`);
    const state = await stateResponse.json();
    expect(state.session.recovery).toMatchObject({ pendingToolCallCount: 1 });
    expect(state.messages.at(-1)).toMatchObject({
      metadata: {
        confirmation: expect.objectContaining({ id: "confirm-route-1" }),
        toolResult: expect.objectContaining({ data: { status: "pending-confirmation" } }),
      },
    });

  });

  it("approves and rejects pending tool confirmations through the session tools API", async () => {
    generateSessionReplyMock
      .mockResolvedValueOnce({
        success: true,
        type: "tool_use",
        toolUses: [{ id: "tool-use-approve", name: "guided.exit", input: { bookId: "book-1", sessionId: "guided-session-1", guidedStateId: "guided-state-1", plan: { title: "计划" } } }],
        metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
      })
      .mockResolvedValueOnce({
        success: true,
        type: "message",
        content: "已按批准继续执行。",
        metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
      });
    executeSessionToolMock
      .mockResolvedValueOnce({
        ok: true,
        renderer: "guided.plan",
        summary: "工具 guided.exit 需要确认后执行。",
        data: { status: "pending-confirmation" },
        confirmation: { id: "confirm-approve-1", toolName: "guided.exit", target: "book-1", risk: "confirmed-write", summary: "等待批准", options: ["approve", "reject", "open-in-canvas"], sessionId: "guided-session-1" },
        durationMs: 4,
      })
      .mockResolvedValueOnce({
        ok: true,
        renderer: "guided.plan",
        summary: "已执行批准后的 guided.exit。",
        data: { status: "executed", artifactId: "candidate-1" },
        durationMs: 11,
      });
    const createResponse = await sessionRouter.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "批准确认会话", agentId: "writer", sessionMode: "chat" }),
    });
    const created = await createResponse.json();
    const transport = new MockTransport();

    expect(await attachSessionChatTransport(created.id, transport)).toBe(true);
    await handleSessionChatTransportMessage(
      created.id,
      transport,
      JSON.stringify({ type: "session:message", messageId: "confirm-approve-message", content: "执行计划", sessionMode: "chat" }),
    );

    const approveResponse = await sessionRouter.request(`http://localhost/${created.id}/tools/guided.exit/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approve", confirmationId: "confirm-approve-1", reason: "计划可执行" }),
    });
    expect(approveResponse.status).toBe(200);
    const approved = await approveResponse.json();
    expect(approved.decision).toMatchObject({ confirmationId: "confirm-approve-1", decision: "approved", reason: "计划可执行", sessionId: created.id });
    expect(executeSessionToolMock).toHaveBeenLastCalledWith(expect.objectContaining({
      toolName: "guided.exit",
      confirmationDecision: expect.objectContaining({ confirmationId: "confirm-approve-1", decision: "approved" }),
    }));
    expect(approved.snapshot.messages.at(-2)).toMatchObject({
      content: "已执行批准后的 guided.exit。",
      metadata: expect.objectContaining({
        confirmationDecision: expect.objectContaining({ decision: "approved" }),
        toolResult: expect.objectContaining({ ok: true, data: { status: "executed", artifactId: "candidate-1" } }),
      }),
    });
    expect(approved.snapshot.messages.at(-1)).toMatchObject({ role: "assistant", content: "已按批准继续执行。" });
    expect(approved.snapshot.session.recovery).toMatchObject({ pendingToolCallCount: 0 });

    generateSessionReplyMock
      .mockResolvedValueOnce({
        success: true,
        type: "tool_use",
        toolUses: [{ id: "tool-use-reject", name: "guided.exit", input: { bookId: "book-2", sessionId: "guided-session-2", guidedStateId: "guided-state-2", plan: { title: "另一个计划" } } }],
        metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
      })
      .mockResolvedValueOnce({
        success: true,
        type: "message",
        content: "已记录拒绝原因并停止写入。",
        metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
      });
    executeSessionToolMock.mockResolvedValueOnce({
      ok: true,
      renderer: "guided.plan",
      summary: "工具 guided.exit 需要确认后执行。",
      data: { status: "pending-confirmation" },
      confirmation: { id: "confirm-reject-1", toolName: "guided.exit", target: "book-2", risk: "confirmed-write", summary: "等待拒绝或批准", options: ["approve", "reject", "open-in-canvas"], sessionId: "guided-session-2" },
      durationMs: 4,
    });
    await handleSessionChatTransportMessage(
      created.id,
      transport,
      JSON.stringify({ type: "session:message", messageId: "confirm-reject-message", content: "执行另一个计划", sessionMode: "chat" }),
    );
    const callCountBeforeReject = executeSessionToolMock.mock.calls.length;

    const rejectResponse = await sessionRouter.request(`http://localhost/${created.id}/tools/guided.exit/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "reject", confirmationId: "confirm-reject-1", reason: "先改计划" }),
    });
    expect(rejectResponse.status).toBe(200);
    const rejected = await rejectResponse.json();
    expect(executeSessionToolMock).toHaveBeenCalledTimes(callCountBeforeReject);
    expect(rejected.decision).toMatchObject({ confirmationId: "confirm-reject-1", decision: "rejected", reason: "先改计划", sessionId: created.id });
    expect(rejected.snapshot.messages.at(-2)).toMatchObject({
      content: "用户已拒绝执行 guided.exit：先改计划",
      toolCalls: [
        expect.objectContaining({ status: "error", error: "confirmation-rejected" }),
      ],
      metadata: expect.objectContaining({
        confirmationDecision: expect.objectContaining({ decision: "rejected" }),
        toolResult: expect.objectContaining({ ok: false, error: "confirmation-rejected" }),
      }),
    });
    expect(rejected.snapshot.messages.at(-1)).toMatchObject({ role: "assistant", content: "已记录拒绝原因并停止写入。" });
    expect(rejected.snapshot.session.recovery).toMatchObject({ pendingToolCallCount: 0 });

    const postRejectToolsResponse = await sessionRouter.request(`http://localhost/${created.id}/tools`);
    const postRejectToolsBody = await postRejectToolsResponse.json();
    expect(postRejectToolsBody.pendingConfirmations).toEqual([]);
  });
});
