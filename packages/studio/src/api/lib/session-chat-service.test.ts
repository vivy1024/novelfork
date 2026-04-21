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

  it("publishes a per-session snapshot and keeps message counts in sync", async () => {
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

    const initialSnapshot = transport.sent.map((entry) => JSON.parse(entry));
    expect(initialSnapshot[0]).toMatchObject({
      type: "session:snapshot",
      snapshot: {
        session: {
          id: session.id,
          title: "Planner 会话",
          sessionMode: "plan",
        },
      },
    });
    expect(initialSnapshot[1]).toMatchObject({
      type: "session:state",
      session: {
        id: session.id,
        messageCount: 0,
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
    expect(envelopes.some((entry) => entry.type === "session:message" && entry.message?.role === "user")).toBe(true);
    expect(envelopes.some((entry) => entry.type === "session:message" && entry.message?.role === "assistant")).toBe(true);
    expect(envelopes.at(-1)).toMatchObject({
      type: "session:state",
      session: {
        id: session.id,
        messageCount: 2,
      },
    });

    const updatedSession = await getSessionById(session.id);
    expect(updatedSession?.messageCount).toBe(2);

    const snapshot = await getSessionChatSnapshot(session.id);
    expect(snapshot?.messages).toHaveLength(2);
    expect(snapshot?.messages[0]).toMatchObject({
      id: "client-message-1",
      role: "user",
      content: "继续这一章",
    });
    expect(snapshot?.messages[1]).toMatchObject({
      role: "assistant",
    });
  });

  it("serves reconnect snapshots from runtime state when persisted metadata is stale", async () => {
    const {
      createSession,
      getSessionById,
      attachSessionChatTransport,
      getSessionChatSnapshot,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();
    const session = await createSession({
      title: "重连会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const primaryTransport = new MockTransport();

    const attached = await attachSessionChatTransport(session.id, primaryTransport);
    expect(attached).toBe(true);

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
    const reattached = await attachSessionChatTransport(session.id, reconnectTransport);
    expect(reattached).toBe(true);

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
          },
          {
            id: "runtime-message-1-assistant",
            role: "assistant",
          },
        ],
      },
    });
    expect(reconnectEnvelopes[1]).toMatchObject({
      type: "session:state",
      session: {
        id: session.id,
        messageCount: 2,
      },
    });

    const snapshot = await getSessionChatSnapshot(session.id);
    expect(snapshot?.session.messageCount).toBe(2);
    expect(snapshot?.session.recentMessages).toHaveLength(2);
    expect(snapshot?.messages).toHaveLength(2);
  });

  it("restores recent messages from persisted session state after runtime reload", async () => {
    const firstLoad = await loadSessionServices();
    const session = await firstLoad.createSession({
      title: "持久化会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const transport = new MockTransport();

    const attached = await firstLoad.attachSessionChatTransport(session.id, transport);
    expect(attached).toBe(true);

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
    });
    expect(snapshot?.messages[1]).toMatchObject({
      role: "assistant",
    });
  });
});
