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

  it("serves lifecycle continue, fork, and restore endpoints with real snapshots", async () => {
    const create = async (body: Record<string, unknown>) => {
      const response = await sessionRouter.request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(201);
      return response.json();
    };

    const bookSession = await create({ title: "主线叙述者", agentId: "writer", projectId: "book-1", sessionMode: "chat" });
    await create({ title: "其他书", agentId: "writer", projectId: "book-2", sessionMode: "chat" });
    const archived = await create({ title: "归档叙述者", agentId: "writer", projectId: "book-1", sessionMode: "chat" });
    await sessionRouter.request(`http://localhost/${archived.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    await sessionRouter.request(`http://localhost/${bookSession.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageCount: 3 }),
    });
    await sessionRouter.request(`http://localhost/${bookSession.id}/chat/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ id: "source-message", role: "user", content: "主线历史", timestamp: 1710000000000 }] }),
    });

    const latestResponse = await sessionRouter.request("http://localhost/lifecycle/latest?projectId=book-1");
    expect(latestResponse.status).toBe(200);
    const latest = await latestResponse.json();
    expect(latest).toMatchObject({ ok: true, readonly: false, session: { id: bookSession.id }, snapshot: { session: { id: bookSession.id } } });

    const forkResponse = await sessionRouter.request(`http://localhost/${bookSession.id}/fork`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "支线叙述者", inheritanceNote: "保留宗门追杀线" }),
    });
    expect(forkResponse.status).toBe(201);
    const forked = await forkResponse.json();
    expect(forked.session).toMatchObject({ title: "支线叙述者", projectId: "book-1", status: "active" });
    expect(forked.session.id).not.toBe(bookSession.id);
    expect(forked.snapshot.messages).toHaveLength(1);
    expect(forked.snapshot.messages[0].content).toContain(bookSession.id);
    expect(forked.snapshot.messages[0].content).toContain("保留宗门追杀线");

    const restoreResponse = await sessionRouter.request(`http://localhost/${archived.id}/restore`, { method: "POST" });
    expect(restoreResponse.status).toBe(200);
    const restored = await restoreResponse.json();
    expect(restored).toMatchObject({ ok: true, readonly: false, session: { id: archived.id, status: "active" } });
  });

  it("rejects session config permission modes that are unsupported by the session mode", async () => {
    const createResponse = await sessionRouter.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "规划会话",
        agentId: "planner",
        sessionMode: "plan",
        sessionConfig: { providerId: "sub2api", modelId: "gpt-5.4", permissionMode: "plan", reasoningEffort: "medium" },
      }),
    });
    const created = await createResponse.json();

    const updateResponse = await sessionRouter.request(`http://localhost/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionConfig: { permissionMode: "allow" } }),
    });

    expect(updateResponse.status).toBe(400);
    await expect(updateResponse.json()).resolves.toMatchObject({ code: "UNSUPPORTED_PERMISSION_MODE", error: { code: "UNSUPPORTED_PERMISSION_MODE", message: expect.stringContaining("规划会话不允许全部允许") } });
  });

  it("serves session tool policy visibility and persists updates through session config", async () => {
    const createResponse = await sessionRouter.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Policy 会话",
        agentId: "writer",
        sessionMode: "chat",
        sessionConfig: {
          providerId: "sub2api",
          modelId: "gpt-5.4",
          permissionMode: "edit",
          reasoningEffort: "medium",
          toolPolicy: { allow: ["cockpit.*"], deny: ["candidate.create_chapter"], ask: ["guided.exit"] },
        },
      }),
    });
    const created = await createResponse.json();

    const toolsResponse = await sessionRouter.request(`http://localhost/${created.id}/tools`);
    expect(toolsResponse.status).toBe(200);
    const toolsState = await toolsResponse.json();
    expect(toolsState.policy).toEqual({ allow: ["cockpit.*"], deny: ["candidate.create_chapter"], ask: ["guided.exit"] });
    expect(toolsState.tools.find((tool: { name: string }) => tool.name === "candidate.create_chapter")).toBeUndefined();
    expect(toolsState.tools.find((tool: { name: string; policy?: { action?: string } }) => tool.name === "guided.exit")?.policy).toMatchObject({ action: "ask", source: "sessionConfig.toolPolicy.ask" });

    const updateResponse = await sessionRouter.request(`http://localhost/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionConfig: { toolPolicy: { deny: ["guided.*"] } } }),
    });
    expect(updateResponse.status).toBe(200);
    const updated = await updateResponse.json();
    expect(updated.sessionConfig.toolPolicy).toEqual({ allow: [], deny: ["guided.*"], ask: [] });
  });

  it("serves headless chat as stream-json and persists the created session", async () => {
    const response = await sessionRouter.request("http://localhost/headless-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "写下一章",
        outputFormat: "stream-json",
        sessionConfig: { providerId: "anthropic", modelId: "claude-sonnet-4-6", permissionMode: "edit", reasoningEffort: "medium" },
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines[0]).toMatchObject({ type: "user_message", content: "写下一章", ephemeral: false });
    expect(lines.some((line: { type: string; content?: string }) => line.type === "assistant_message" && line.content === "运行时真实回复")).toBe(true);
    expect(lines.at(-1)).toMatchObject({ type: "result", success: true, stop_reason: "completed", exit_code: 0 });

    const sessionId = lines.at(-1).session_id;
    const sessionResponse = await sessionRouter.request(`http://localhost/${sessionId}`);
    expect(sessionResponse.status).toBe(200);
    const session = await sessionResponse.json();
    expect(session.messageCount).toBeGreaterThanOrEqual(2);
  });

  it("serves stream-json input and no-session-persistence without creating a stored session", async () => {
    const response = await sessionRouter.request("http://localhost/headless-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputFormat: "stream-json",
        outputFormat: "json",
        noSessionPersistence: true,
        sessionConfig: { providerId: "anthropic", modelId: "claude-sonnet-4-6", permissionMode: "read", reasoningEffort: "medium" },
        events: [{ type: "user_message", content: "审校第十二章" }],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ephemeral).toBe(true);
    expect(body.sessionId).toMatch(/^ephemeral:/);
    expect(body.events[0]).toMatchObject({ type: "user_message", content: "审校第十二章", ephemeral: true });
    expect(body.events.at(-1)).toMatchObject({ type: "result", success: true, ephemeral: true });

    const sessionResponse = await sessionRouter.request(`http://localhost/${encodeURIComponent(body.sessionId)}`);
    expect(sessionResponse.status).toBe(404);
  });

  it("serves session compact endpoint with summary, budget, and preserved history on failure", async () => {
    const createResponse = await sessionRouter.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Compact 会话",
        agentId: "writer",
        sessionMode: "chat",
        sessionConfig: { providerId: "sub2api", modelId: "gpt-5.4", permissionMode: "edit", reasoningEffort: "medium" },
      }),
    });
    const created = await createResponse.json();
    await sessionRouter.request(`http://localhost/${created.id}/chat/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { id: "m1", role: "user", content: "旧历史".repeat(80), timestamp: 1710000000001, seq: 1 },
          { id: "m2", role: "assistant", content: "旧回复".repeat(80), timestamp: 1710000000002, seq: 2 },
          { id: "m3", role: "user", content: "最近消息", timestamp: 1710000000003, seq: 3 },
        ],
      }),
    });

    const compactResponse = await sessionRouter.request(`http://localhost/${created.id}/compact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preserveRecentMessages: 1, instructions: "保留旧历史主线" }),
    });
    expect(compactResponse.status).toBe(200);
    const compacted = await compactResponse.json();
    expect(compacted).toMatchObject({ ok: true, compactedMessageCount: 2, afterMessageCount: 2, budget: { maxRecentMessages: 1, preservedMessages: 1 } });
    expect(compacted.summary).toContain("保留旧历史主线");
    expect(compacted.snapshot.messages[0].metadata.kind).toBe("session-compact-summary");
    expect(compacted.snapshot.messages[1].id).toBe("m3");

    const tooShortResponse = await sessionRouter.request(`http://localhost/${created.id}/compact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preserveRecentMessages: 8 }),
    });
    expect(tooShortResponse.status).toBe(400);
    expect(await tooShortResponse.json()).toEqual({ ok: false, status: 400, code: "not_enough_messages", error: "Not enough messages to compact" });
    const stateResponse = await sessionRouter.request(`http://localhost/${created.id}/chat/state`);
    const state = await stateResponse.json();
    expect(state.messages.map((message: { id: string }) => message.id)).toEqual(compacted.snapshot.messages.map((message: { id: string }) => message.id));
  });

  it("serves session memory boundary status without pretending missing writers are available", async () => {
    const createResponse = await sessionRouter.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Memory 会话", agentId: "writer", projectId: "book-1", sessionMode: "chat" }),
    });
    const created = await createResponse.json();

    const statusResponse = await sessionRouter.request(`http://localhost/${created.id}/memory/status`);
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toMatchObject({
      ok: true,
      sessionId: created.id,
      status: "readonly",
      writable: false,
      reason: "memory_writer_not_configured",
      categories: ["user-preference", "project-fact", "temporary-story-draft"],
    });

    const commitResponse = await sessionRouter.request(`http://localhost/${created.id}/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classification: "user-preference",
        content: "以后默认用第三人称有限视角。",
        source: { kind: "message", messageId: "m1", seq: 1 },
        confirmation: { mode: "explicit", confirmedBy: "author" },
        createdBy: "user",
      }),
    });
    expect(commitResponse.status).toBe(503);
    expect(await commitResponse.json()).toMatchObject({ ok: false, status: 503, code: "memory_writer_not_configured", recoverable: true });

    const missingResponse = await sessionRouter.request("http://localhost/missing-session/memory/status");
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toEqual({ error: "Session not found" });
  });

  it("returns lifecycle errors without creating empty fork sessions", async () => {
    const latestResponse = await sessionRouter.request("http://localhost/lifecycle/latest?projectId=missing-book");
    expect(latestResponse.status).toBe(404);
    expect(await latestResponse.json()).toEqual({ ok: false, status: 404, code: "session_not_found", error: "Session not found" });

    const forkResponse = await sessionRouter.request("http://localhost/missing-session/fork", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "不应创建" }),
    });
    expect(forkResponse.status).toBe(404);
    expect(await forkResponse.json()).toEqual({ ok: false, status: 404, code: "source_session_not_found", error: "Source session not found" });

    const listResponse = await sessionRouter.request("http://localhost/");
    expect(await listResponse.json()).toEqual([]);
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
