import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let generateSessionReplyMock: ReturnType<typeof vi.fn>;

vi.mock("./user-config-service.js", () => ({
  loadUserConfig: vi.fn(async () => ({
    runtimeControls: {
      defaultPermissionMode: "allow",
      defaultReasoningEffort: "medium",
    },
    modelDefaults: {
      defaultSessionModel: "anthropic:claude-sonnet-4-6",
      summaryModel: "anthropic:claude-haiku-4-5",
      subagentModelPool: ["anthropic:claude-sonnet-4-6"],
    },
  })),
}));

vi.mock("./llm-runtime-service.js", () => ({
  generateSessionReply: (...args: unknown[]) =>
    (globalThis as typeof globalThis & { __novelforkGenerateSessionReplyMock: (...args: unknown[]) => unknown })
      .__novelforkGenerateSessionReplyMock(...args),
}));

async function loadSessionServices() {
  const sessionService = await import("./session-service");
  const chatService = await import("./session-chat-service");
  return {
    ...sessionService,
    ...chatService,
  };
}

class MockTransport {
  readonly sent: string[] = [];
  closed: Array<{ code?: number; reason?: string }> = [];

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closed.push({ code, reason });
  }
}

describe("session-chat-service", () => {
  let sessionStoreDir: string;

  beforeEach(async () => {
    sessionStoreDir = await mkdtemp(join(tmpdir(), "novelfork-session-chat-"));
    process.env.NOVELFORK_SESSION_STORE_DIR = sessionStoreDir;
    generateSessionReplyMock = vi.fn().mockResolvedValue({
      success: true,
      content: "运行时真实回复",
      metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
    });
    (globalThis as typeof globalThis & { __novelforkGenerateSessionReplyMock: typeof generateSessionReplyMock })
      .__novelforkGenerateSessionReplyMock = generateSessionReplyMock;
  });

  afterEach(async () => {
    const { __testing } = await import("./session-service");
    __testing.resetSessionStoreMutationQueue();
    generateSessionReplyMock.mockReset();
    delete (globalThis as typeof globalThis & { __novelforkGenerateSessionReplyMock?: typeof generateSessionReplyMock })
      .__novelforkGenerateSessionReplyMock;
    delete process.env.NOVELFORK_SESSION_STORE_DIR;
    await rm(sessionStoreDir, { recursive: true, force: true });
  });

  it("publishes per-session seq envelopes and accepts client ack", async () => {
    const {
      createSession,
      getSessionById,
      attachSessionChatTransport,
      getSessionChatSnapshot,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();

    const session = await createSession({
      title: "Planner 会话",
      agentId: "planner",
      sessionMode: "plan",
    });
    const transport = new MockTransport();

    const attached = await attachSessionChatTransport(session.id, transport);
    expect(attached).toBe(true);

    const initialEnvelopes = transport.sent.map((entry) => JSON.parse(entry));
    expect(initialEnvelopes[0]).toMatchObject({
      type: "session:snapshot",
      snapshot: {
        session: {
          id: session.id,
          title: "Planner 会话",
          sessionMode: "plan",
        },
        messages: [],
        cursor: {
          lastSeq: 0,
          ackedSeq: 0,
        },
      },
    });
    expect(initialEnvelopes[1]).toMatchObject({
      type: "session:state",
      session: {
        id: session.id,
        messageCount: 0,
      },
      cursor: {
        lastSeq: 0,
        ackedSeq: 0,
      },
    });

    await handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({
        type: "session:message",
        messageId: "client-message-1",
        content: "继续这一章",
        sessionMode: "plan",
      }),
    );

    const envelopes = transport.sent.map((entry) => JSON.parse(entry));
    const userEnvelope = envelopes.find(
      (entry) => entry.type === "session:message" && entry.message?.role === "user",
    );
    const assistantEnvelope = envelopes.find(
      (entry) => entry.type === "session:message" && entry.message?.role === "assistant",
    );

    expect(userEnvelope).toMatchObject({
      type: "session:message",
      message: {
        id: "client-message-1",
        role: "user",
        seq: 1,
      },
      cursor: {
        lastSeq: 1,
      },
    });
    expect(generateSessionReplyMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionConfig: expect.objectContaining({ providerId: "anthropic", modelId: "claude-sonnet-4-6" }),
      messages: expect.arrayContaining([
        expect.objectContaining({ id: "client-message-1", role: "user", content: "继续这一章" }),
      ]),
    }));
    expect(assistantEnvelope).toMatchObject({
      type: "session:message",
      message: {
        id: "client-message-1-assistant",
        role: "assistant",
        content: "运行时真实回复",
        seq: 2,
        runtime: {
          providerId: "anthropic",
          providerName: "Anthropic",
          modelId: "claude-sonnet-4-6",
        },
      },
      cursor: {
        lastSeq: 2,
      },
    });
    expect(envelopes.at(-1)).toMatchObject({
      type: "session:state",
      session: {
        id: session.id,
        messageCount: 2,
      },
      cursor: {
        lastSeq: 2,
        ackedSeq: 0,
      },
    });

    await handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({
        type: "session:ack",
        ack: 2,
      }),
    );

    const ackEnvelope = JSON.parse(transport.sent.at(-1) ?? "{}");
    expect(ackEnvelope).toMatchObject({
      type: "session:state",
      session: {
        id: session.id,
        messageCount: 2,
      },
      cursor: {
        lastSeq: 2,
        ackedSeq: 2,
      },
    });

    const updatedSession = await getSessionById(session.id);
    expect(updatedSession?.messageCount).toBe(2);

    const snapshot = await getSessionChatSnapshot(session.id);
    expect(snapshot?.cursor.lastSeq).toBe(2);
    expect(snapshot?.messages).toHaveLength(2);
    expect(snapshot?.messages[0]).toMatchObject({
      id: "client-message-1",
      role: "user",
      content: "继续这一章",
      seq: 1,
    });
    expect(snapshot?.messages[1]).toMatchObject({
      role: "assistant",
      seq: 2,
    });
  }, 10000);

  it("sends an error envelope without fake assistant content when llm runtime fails", async () => {
    generateSessionReplyMock.mockResolvedValueOnce({
      success: false,
      code: "model-unavailable",
      error: "Runtime model is not available: anthropic:claude-sonnet-4-6",
      metadata: { providerId: "anthropic", modelId: "claude-sonnet-4-6" },
    });
    const {
      createSession,
      attachSessionChatTransport,
      getSessionChatSnapshot,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();

    const session = await createSession({
      title: "失败会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const transport = new MockTransport();

    expect(await attachSessionChatTransport(session.id, transport)).toBe(true);
    await handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({
        type: "session:message",
        messageId: "client-message-failed",
        content: "继续写",
        sessionMode: "chat",
      }),
    );

    const envelopes = transport.sent.map((entry) => JSON.parse(entry));
    expect(envelopes.some((entry) => entry.type === "session:message" && entry.message?.role === "assistant")).toBe(false);
    expect(envelopes.find((entry) => entry.type === "session:error")).toMatchObject({
      type: "session:error",
      code: "model-unavailable",
      error: "Runtime model is not available: anthropic:claude-sonnet-4-6",
    });

    const snapshot = await getSessionChatSnapshot(session.id);
    expect(snapshot?.cursor.lastSeq).toBe(1);
    expect(snapshot?.messages).toHaveLength(1);
    expect(snapshot?.messages[0]).toMatchObject({
      id: "client-message-failed",
      role: "user",
      content: "继续写",
      seq: 1,
    });
    expect(snapshot?.session.recovery?.lastFailure).toMatchObject({
      reason: "model-unavailable",
      message: "Runtime model is not available: anthropic:claude-sonnet-4-6",
    });
  }, 10000);

  it("backfills reconnect history from sinceSeq without forcing a full snapshot", async () => {
    const {
      createSession,
      attachSessionChatTransport,
      detachSessionChatTransport,
      getSessionChatHistory,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();

    const session = await createSession({
      title: "重连会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const primaryTransport = new MockTransport();
    const collaboratorTransport = new MockTransport();

    expect(await attachSessionChatTransport(session.id, primaryTransport)).toBe(true);

    await handleSessionChatTransportMessage(
      session.id,
      primaryTransport,
      JSON.stringify({
        type: "session:message",
        messageId: "resume-message-1",
        content: "第一段",
        sessionMode: "chat",
      }),
    );

    await handleSessionChatTransportMessage(
      session.id,
      primaryTransport,
      JSON.stringify({
        type: "session:ack",
        ack: 2,
      }),
    );
    detachSessionChatTransport(session.id, primaryTransport);

    expect(await attachSessionChatTransport(session.id, collaboratorTransport)).toBe(true);
    await handleSessionChatTransportMessage(
      session.id,
      collaboratorTransport,
      JSON.stringify({
        type: "session:message",
        messageId: "resume-message-2",
        content: "第二段",
        sessionMode: "chat",
      }),
    );

    const reconnectTransport = new MockTransport();
    const reattached = await attachSessionChatTransport(session.id, reconnectTransport, {
      resumeFromSeq: 2,
    });
    expect(reattached).toBe(true);

    const reconnectEnvelopes = reconnectTransport.sent.map((entry) => JSON.parse(entry));
    expect(reconnectEnvelopes).toHaveLength(1);
    expect(reconnectEnvelopes[0]).toMatchObject({
      type: "session:state",
      session: {
        id: session.id,
        messageCount: 4,
      },
      cursor: {
        lastSeq: 4,
        ackedSeq: 2,
      },
    });

    const history = await getSessionChatHistory(session.id, 2);
    expect(history).toMatchObject({
      sessionId: session.id,
      sinceSeq: 2,
      availableFromSeq: 1,
      resetRequired: false,
      cursor: {
        lastSeq: 4,
      },
    });
    expect(history?.messages.map((message) => ({ id: message.id, seq: message.seq, role: message.role }))).toEqual([
      { id: "resume-message-2", seq: 3, role: "user" },
      { id: "resume-message-2-assistant", seq: 4, role: "assistant" },
    ]);
  });

  it("serves server-first snapshots from runtime state when persisted metadata is stale", async () => {
    const {
      createSession,
      getSessionById,
      attachSessionChatTransport,
      getSessionChatSnapshot,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();
    const session = await createSession({
      title: "运行态优先会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const primaryTransport = new MockTransport();

    expect(await attachSessionChatTransport(session.id, primaryTransport)).toBe(true);

    await handleSessionChatTransportMessage(
      session.id,
      primaryTransport,
      JSON.stringify({
        type: "session:message",
        messageId: "runtime-message-1",
        content: "请接着上一段",
        sessionMode: "chat",
      }),
    );

    const persistedSession = await getSessionById(session.id);
    expect(persistedSession?.messageCount).toBe(2);

    await writeFile(
      join(sessionStoreDir, "sessions.json"),
      JSON.stringify(
        [
          {
            ...persistedSession,
            messageCount: 0,
            recentMessages: [],
          },
        ],
        null,
        2,
      ),
      "utf-8",
    );

    const reconnectTransport = new MockTransport();
    expect(await attachSessionChatTransport(session.id, reconnectTransport)).toBe(true);

    const reconnectEnvelopes = reconnectTransport.sent.map((entry) => JSON.parse(entry));
    expect(reconnectEnvelopes[0]).toMatchObject({
      type: "session:snapshot",
      snapshot: {
        session: {
          id: session.id,
          messageCount: 2,
        },
        messages: [
          {
            id: "runtime-message-1",
            role: "user",
            seq: 1,
          },
          {
            id: "runtime-message-1-assistant",
            role: "assistant",
            seq: 2,
          },
        ],
        cursor: {
          lastSeq: 2,
          ackedSeq: 0,
        },
      },
    });
    expect(reconnectEnvelopes[1]).toMatchObject({
      type: "session:state",
      session: {
        id: session.id,
        messageCount: 2,
      },
      cursor: {
        lastSeq: 2,
        ackedSeq: 0,
      },
    });

    const snapshot = await getSessionChatSnapshot(session.id);
    expect(snapshot?.session.messageCount).toBe(2);
    expect(snapshot?.session.recentMessages).toHaveLength(2);
    expect(snapshot?.messages).toHaveLength(2);
    expect(snapshot?.cursor.lastSeq).toBe(2);
  });

  it("preserves tool calls through persisted recent messages and snapshots", async () => {
    const { createSession, getSessionChatSnapshot, updateSession } = await loadSessionServices();
    const session = await createSession({
      title: "透明化会话",
      agentId: "writer",
      sessionMode: "chat",
    });

    await updateSession(session.id, {
      messageCount: 1,
      recentMessages: [
        {
          id: "assistant-tool-1",
          role: "assistant",
          content: "我先检查一下工作区。",
          timestamp: Date.now(),
          toolCalls: [
            {
              id: "tool-bash-1",
              toolName: "Bash",
              status: "error",
              command: "git status --short",
              output: " M packages/studio/src/components/ChatWindow.tsx",
              duration: 420,
              error: "Tool falls back to defaultPermissionMode=ask",
              result: {
                allowed: false,
                confirmationRequired: true,
                source: "runtimeControls.defaultPermissionMode",
                reasonKey: "default-prompt",
                reason: "Tool falls back to defaultPermissionMode=ask",
              },
            },
          ],
        },
      ],
    });

    const snapshot = await getSessionChatSnapshot(session.id);
    expect(snapshot?.messages[0]).toMatchObject({
      id: "assistant-tool-1",
      toolCalls: [
        expect.objectContaining({
          toolName: "Bash",
          command: "git status --short",
          error: "Tool falls back to defaultPermissionMode=ask",
          result: expect.objectContaining({
            allowed: false,
            confirmationRequired: true,
            source: "runtimeControls.defaultPermissionMode",
            reasonKey: "default-prompt",
            reason: "Tool falls back to defaultPermissionMode=ask",
          }),
        }),
      ],
    });
    expect(snapshot?.session.recentMessages?.[0]).toMatchObject({
      toolCalls: [
        expect.objectContaining({
          toolName: "Bash",
          result: expect.objectContaining({
            allowed: false,
            confirmationRequired: true,
            source: "runtimeControls.defaultPermissionMode",
            reasonKey: "default-prompt",
          }),
        }),
      ],
    });
  });

  it("restores recent messages from persisted session state after runtime reload", async () => {
    const firstLoad = await loadSessionServices();
    const session = await firstLoad.createSession({
      title: "持久化会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const transport = new MockTransport();

    expect(await firstLoad.attachSessionChatTransport(session.id, transport)).toBe(true);

    await firstLoad.handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({
        type: "session:message",
        messageId: "persisted-message-1",
        content: "请继续写下去",
        sessionMode: "chat",
      }),
    );

    firstLoad.__testing.resetSessionStoreMutationQueue();
    vi.resetModules();
    const reloaded = await loadSessionServices();
    const snapshot = await reloaded.getSessionChatSnapshot(session.id);

    expect(snapshot?.messages).toHaveLength(2);
    expect(snapshot?.messages[0]).toMatchObject({
      id: "persisted-message-1",
      role: "user",
      content: "请继续写下去",
      seq: 1,
    });
    expect(snapshot?.messages[1]).toMatchObject({
      role: "assistant",
      seq: 2,
    });
    expect(snapshot?.cursor.lastSeq).toBe(2);
  });

  it("serves full replay history from the persisted history store when runtime buffer has been trimmed", async () => {
    const {
      createSession,
      attachSessionChatTransport,
      getSessionChatHistory,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();

    const session = await createSession({
      title: "长会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const transport = new MockTransport();

    expect(await attachSessionChatTransport(session.id, transport)).toBe(true);

    for (let index = 0; index < 30; index += 1) {
      await handleSessionChatTransportMessage(
        session.id,
        transport,
        JSON.stringify({
          type: "session:message",
          messageId: `bulk-message-${index + 1}`,
          content: `第 ${index + 1} 轮`,
          sessionMode: "chat",
        }),
      );
    }

    const history = await getSessionChatHistory(session.id, 2);
    expect(history?.cursor.lastSeq).toBe(60);
    expect(history?.availableFromSeq).toBe(1);
    expect(history?.resetRequired).toBe(false);
    expect(history?.messages[0]).toMatchObject({
      id: "bulk-message-2",
      seq: 3,
      role: "user",
    });
    expect(history?.messages.at(-1)).toMatchObject({
      id: "bulk-message-30-assistant",
      seq: 60,
      role: "assistant",
    });
    expect(history?.messages).toHaveLength(58);
  });

  it("forces resetRequired when sinceSeq is beyond the current session cursor", async () => {
    const {
      createSession,
      attachSessionChatTransport,
      getSessionChatHistory,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();

    const session = await createSession({
      title: "越界重置会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const transport = new MockTransport();

    expect(await attachSessionChatTransport(session.id, transport)).toBe(true);

    await handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({
        type: "session:message",
        messageId: "overflow-message-1",
        content: "第一句",
        sessionMode: "chat",
      }),
    );

    const history = await getSessionChatHistory(session.id, 999);
    expect(history).toMatchObject({
      sessionId: session.id,
      sinceSeq: 999,
      availableFromSeq: 1,
      resetRequired: true,
      messages: [],
      cursor: {
        lastSeq: 2,
      },
    });
  });

  it("marks out-of-range websocket resume requests as server reset recovery", async () => {
    const {
      createSession,
      attachSessionChatTransport,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();

    const session = await createSession({
      title: "越界重连会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const transport = new MockTransport();
    expect(await attachSessionChatTransport(session.id, transport)).toBe(true);

    await handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({
        type: "session:message",
        messageId: "resume-overflow-1",
        content: "第一句",
        sessionMode: "chat",
      }),
    );

    const reconnectTransport = new MockTransport();
    expect(await attachSessionChatTransport(session.id, reconnectTransport, { resumeFromSeq: 999 })).toBe(true);

    const envelopes = reconnectTransport.sent.map((entry) => JSON.parse(entry));
    expect(envelopes.at(-1)).toMatchObject({
      type: "session:state",
      cursor: {
        lastSeq: 2,
        ackedSeq: 2,
      },
      recovery: {
        state: "resetting",
        reason: "history-gap",
      },
    });
  });

  it("broadcasts server reset recovery before replacing the authoritative snapshot", async () => {
    const {
      createSession,
      attachSessionChatTransport,
      replaceSessionChatState,
    } = await loadSessionServices();

    const session = await createSession({
      title: "服务端重置会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const transport = new MockTransport();
    expect(await attachSessionChatTransport(session.id, transport)).toBe(true);
    transport.sent.length = 0;

    const snapshot = await replaceSessionChatState(session.id, [
      { id: "reset-summary", role: "system", content: "重新同步正式快照", timestamp: 1710000000000 },
    ]);

    expect(snapshot?.cursor.lastSeq).toBe(1);
    const envelopes = transport.sent.map((entry) => JSON.parse(entry));
    expect(envelopes[0]).toMatchObject({
      type: "session:state",
      recovery: {
        state: "resetting",
        reason: "server-reset",
      },
    });
    expect(envelopes[1]).toMatchObject({
      type: "session:snapshot",
      snapshot: {
        messages: [
          { id: "reset-summary", role: "system", seq: 1 },
        ],
        cursor: {
          lastSeq: 1,
        },
      },
      recovery: {
        state: "idle",
        reason: "server-reset",
      },
    });
  });

  it("persists the acknowledged recovery boundary and pending metadata in SQLite", async () => {
    const firstLoad = await loadSessionServices();
    const session = await firstLoad.createSession({
      title: "确认边界会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const transport = new MockTransport();

    expect(await firstLoad.attachSessionChatTransport(session.id, transport)).toBe(true);
    await firstLoad.handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({
        type: "session:message",
        messageId: "acked-boundary-1",
        content: "第一句",
        sessionMode: "chat",
      }),
    );

    const pendingSnapshot = await firstLoad.getSessionChatSnapshot(session.id);
    expect(pendingSnapshot?.cursor).toMatchObject({ lastSeq: 2, ackedSeq: 0 });
    expect(pendingSnapshot?.session.recovery).toMatchObject({
      lastSeq: 2,
      lastAckedSeq: 0,
      pendingMessageCount: 2,
      pendingToolCallCount: 0,
    });

    await firstLoad.handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({ type: "session:ack", ack: 2 }),
    );

    const ackedSnapshot = await firstLoad.getSessionChatSnapshot(session.id);
    expect(ackedSnapshot?.cursor).toMatchObject({ lastSeq: 2, ackedSeq: 2 });
    expect(ackedSnapshot?.session.recovery).toMatchObject({
      lastSeq: 2,
      lastAckedSeq: 2,
      pendingMessageCount: 0,
    });

    firstLoad.__testing.resetSessionStoreMutationQueue();
    vi.resetModules();
    const reloaded = await loadSessionServices();
    const restoredSnapshot = await reloaded.getSessionChatSnapshot(session.id);

    expect(restoredSnapshot?.cursor).toMatchObject({ lastSeq: 2, ackedSeq: 2 });
    expect(restoredSnapshot?.session.recovery).toMatchObject({
      lastSeq: 2,
      lastAckedSeq: 2,
      pendingMessageCount: 0,
    });
  });

  it("uses the persisted ack boundary when a refreshed websocket opens without an explicit resume cursor", async () => {
    const firstLoad = await loadSessionServices();
    const session = await firstLoad.createSession({
      title: "刷新恢复会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const transport = new MockTransport();

    expect(await firstLoad.attachSessionChatTransport(session.id, transport)).toBe(true);
    await firstLoad.handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({
        type: "session:message",
        messageId: "refresh-boundary-1",
        content: "已确认消息",
        sessionMode: "chat",
      }),
    );
    await firstLoad.handleSessionChatTransportMessage(session.id, transport, JSON.stringify({ type: "session:ack", ack: 2 }));
    await firstLoad.handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({
        type: "session:message",
        messageId: "refresh-boundary-2",
        content: "未确认消息",
        sessionMode: "chat",
      }),
    );

    firstLoad.__testing.resetSessionStoreMutationQueue();
    vi.resetModules();
    const reloaded = await loadSessionServices();
    const refreshedTransport = new MockTransport();
    expect(await reloaded.attachSessionChatTransport(session.id, refreshedTransport)).toBe(true);

    const envelopes = refreshedTransport.sent.map((entry) => JSON.parse(entry));
    expect(envelopes[0]).toMatchObject({
      type: "session:snapshot",
      snapshot: {
        cursor: { lastSeq: 4, ackedSeq: 2 },
        session: {
          recovery: {
            lastSeq: 4,
            lastAckedSeq: 2,
            pendingMessageCount: 2,
          },
        },
      },
      recovery: { state: "idle", reason: "initial-hydration" },
    });
    expect(envelopes.at(-1)).toMatchObject({
      type: "session:state",
      cursor: { lastSeq: 4, ackedSeq: 2 },
    });
  });

  it("registers a Bun websocket route that matches concrete session chat paths", async () => {
    const { setupSessionChatWebSocket } = await loadSessionServices();
    const registerWebSocketRoute = vi.fn();

    setupSessionChatWebSocket({
      runtime: "bun",
      registerWebSocketRoute,
    });

    expect(registerWebSocketRoute).toHaveBeenCalledTimes(1);
    const route = registerWebSocketRoute.mock.calls[0]?.[0];
    expect(route).toMatchObject({ path: "/api/sessions/:id/chat" });
    expect(route.matchPath("/api/sessions/demo-session/chat")).toBe(true);
    expect(route.matchPath("/api/sessions/demo-session/chat/state")).toBe(false);
  });
});
