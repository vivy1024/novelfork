import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  });

  afterEach(async () => {
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
    expect(assistantEnvelope).toMatchObject({
      type: "session:message",
      message: {
        id: "client-message-1-assistant",
        role: "assistant",
        seq: 2,
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
  });

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

  it("marks history replay as reset-required when the requested seq falls behind the retained buffer", async () => {
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
    expect(history?.availableFromSeq).toBe(11);
    expect(history?.resetRequired).toBe(true);
    expect(history?.messages).toEqual([]);
  });
});
