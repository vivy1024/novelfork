import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
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

  it("seeds history from recentMessages before appending the first new message", async () => {
    const firstLoad = await loadSessionServices();
    const session = await firstLoad.createSession({
      title: "旧会话",
      agentId: "writer",
      sessionMode: "chat",
    });

    await firstLoad.updateSession(session.id, {
      messageCount: 2,
      recentMessages: [
        {
          id: "legacy-user-1",
          role: "user",
          content: "旧的第一条",
          timestamp: 100,
        },
        {
          id: "legacy-assistant-1",
          role: "assistant",
          content: "旧的第二条",
          timestamp: 101,
        },
      ],
    });

    const transport = new MockTransport();
    expect(await firstLoad.attachSessionChatTransport(session.id, transport)).toBe(true);

    await firstLoad.handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({
        messageId: "legacy-next-user",
        content: "新的第一条",
      }),
    );

    vi.resetModules();
    const reloaded = await loadSessionServices();
    const history = await reloaded.getSessionChatHistory(session.id);
    const persistedSession = await reloaded.getSessionById(session.id);

    expect(history?.messages).toHaveLength(4);
    expect(history?.messages[0]).toMatchObject({
      id: "legacy-user-1",
      role: "user",
      content: "旧的第一条",
    });
    expect(history?.messages[1]).toMatchObject({
      id: "legacy-assistant-1",
      role: "assistant",
      content: "旧的第二条",
    });
    expect(history?.messages[2]).toMatchObject({
      id: "legacy-next-user",
      role: "user",
      content: "新的第一条",
    });
    expect(history?.messages.at(-1)).toMatchObject({
      role: "assistant",
    });
    expect(persistedSession?.recentMessages).toHaveLength(4);
  });

  it("persists the full chat history separately from the recent session snapshot", async () => {
    const firstLoad = await loadSessionServices();
    const session = await firstLoad.createSession({
      title: "完整历史会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const transport = new MockTransport();

    expect(await firstLoad.attachSessionChatTransport(session.id, transport)).toBe(true);

    for (let index = 1; index <= 26; index += 1) {
      await firstLoad.handleSessionChatTransportMessage(
        session.id,
        transport,
        JSON.stringify({
          messageId: `history-message-${index}`,
          content: `第 ${index} 条消息`,
        }),
      );
    }

    vi.resetModules();
    const reloaded = await loadSessionServices();
    const history = await reloaded.getSessionChatHistory(session.id);
    const persistedSession = await reloaded.getSessionById(session.id);

    expect(history?.messages).toHaveLength(52);
    expect(history?.messages[0]).toMatchObject({
      id: "history-message-1",
      role: "user",
      content: "第 1 条消息",
    });
    expect(history?.messages.at(-1)).toMatchObject({
      role: "assistant",
    });
    expect(persistedSession?.recentMessages).toHaveLength(50);
  });

  it("keeps concurrent appends from losing history entries", async () => {
    const firstLoad = await loadSessionServices();
    const session = await firstLoad.createSession({
      title: "并发会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const transport = new MockTransport();

    expect(await firstLoad.attachSessionChatTransport(session.id, transport)).toBe(true);

    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        firstLoad.handleSessionChatTransportMessage(
          session.id,
          transport,
          JSON.stringify({
            messageId: `concurrent-message-${index + 1}`,
            content: `并发消息 ${index + 1}`,
          }),
        ),
      ),
    );

    vi.resetModules();
    const reloaded = await loadSessionServices();
    const history = await reloaded.getSessionChatHistory(session.id);

    expect(history?.messages).toHaveLength(24);
    const userMessageIds = history?.messages.filter((message) => message.role === "user").map((message) => message.id);
    expect(userMessageIds).toHaveLength(12);
    expect(new Set(userMessageIds).size).toBe(12);
    for (let index = 1; index <= 12; index += 1) {
      expect(userMessageIds).toContain(`concurrent-message-${index}`);
    }
  });
});
