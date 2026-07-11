import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { attachRuntimeSettlement } from "./session-runtime/runtime-settlement.js";

let generateSessionReplyMock: ReturnType<typeof vi.fn>;
let executeSessionToolMock: ReturnType<typeof vi.fn>;
let sessionToolExecutorOptionsSeen: unknown[];
const sessionChatRuntimeConfig = vi.hoisted(() => ({ firstTokenTimeout: 0 }));

vi.mock("./user-config-service.js", () => ({
  loadUserConfig: vi.fn(async () => ({
    runtimeControls: {
      defaultPermissionMode: "allow",
      defaultReasoningEffort: "medium",
      maxTurnSteps: 6,
      firstTokenTimeout: sessionChatRuntimeConfig.firstTokenTimeout,
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

vi.mock("./session-tool-executor.js", () => ({
  createSessionToolExecutor: (options: unknown) => {
    (globalThis as typeof globalThis & { __novelforkSessionToolExecutorOptionsSeen?: unknown[] })
      .__novelforkSessionToolExecutorOptionsSeen?.push(options);
    return {
      execute: (...args: unknown[]) =>
        (globalThis as typeof globalThis & { __novelforkExecuteSessionToolMock: (...args: unknown[]) => unknown })
          .__novelforkExecuteSessionToolMock(...args),
    };
  },
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
  throwOnSend = false;

  send(data: string) {
    if (this.throwOnSend) {
      throw new Error("transport send failed");
    }
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closed.push({ code, reason });
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function waitForAssertion(assertion: () => void, options: { timeout?: number } = {}): Promise<void> {
  const timeout = options.timeout ?? 1_000;
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeout) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
  throw lastError ?? new Error(`Assertion did not pass within ${timeout}ms`);
}

describe("session-chat-service", () => {
  let sessionStoreDir: string;

  beforeEach(async () => {
    sessionChatRuntimeConfig.firstTokenTimeout = 0;
    sessionStoreDir = await mkdtemp(join(tmpdir(), "novelfork-session-chat-"));
    process.env.NOVELFORK_SESSION_STORE_DIR = sessionStoreDir;
    generateSessionReplyMock = vi.fn().mockResolvedValue({
      success: true,
      content: "运行时真实回复",
      metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
    });
    (globalThis as typeof globalThis & { __novelforkGenerateSessionReplyMock: typeof generateSessionReplyMock })
      .__novelforkGenerateSessionReplyMock = generateSessionReplyMock;
    sessionToolExecutorOptionsSeen = [];
    (globalThis as typeof globalThis & { __novelforkSessionToolExecutorOptionsSeen: unknown[] })
      .__novelforkSessionToolExecutorOptionsSeen = sessionToolExecutorOptionsSeen;
    executeSessionToolMock = vi.fn().mockResolvedValue({
      ok: true,
      renderer: "cockpit.snapshot",
      summary: "已读取驾驶舱快照。",
      data: { bookId: "book-1" },
      durationMs: 12,
    });
    (globalThis as typeof globalThis & { __novelforkExecuteSessionToolMock: typeof executeSessionToolMock })
      .__novelforkExecuteSessionToolMock = executeSessionToolMock;
  });

  afterEach(async () => {
    const { __testing } = await import("./session-service");
    __testing.resetSessionStoreMutationQueue();
    generateSessionReplyMock.mockReset();
    delete (globalThis as typeof globalThis & { __novelforkGenerateSessionReplyMock?: typeof generateSessionReplyMock })
      .__novelforkGenerateSessionReplyMock;
    delete (globalThis as typeof globalThis & { __novelforkExecuteSessionToolMock?: typeof executeSessionToolMock })
      .__novelforkExecuteSessionToolMock;
    delete (globalThis as typeof globalThis & { __novelforkSessionToolExecutorOptionsSeen?: unknown[] })
      .__novelforkSessionToolExecutorOptionsSeen;
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
        id: expect.stringMatching(/^client-message-1-mid-turn-\d+$/),
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
      { id: expect.stringMatching(/^resume-message-2-mid-turn-\d+$/), seq: 4, role: "assistant" },
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
            id: expect.stringMatching(/^runtime-message-1-mid-turn-\d+$/),
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
              output: " M packages/studio/src/app-next/agent-conversation/surface/ConversationSurface.tsx",
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
    const transcriptEvents = (snapshot?.messages[1]?.metadata?.runtimeTranscript as { events?: Array<{ type: string }> } | undefined)?.events ?? [];
    expect(transcriptEvents.map((event) => event.type)).toEqual(["message", "result"]);
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
      id: expect.stringMatching(/^bulk-message-30-mid-turn-\d+$/),
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

  it("executes a single runtime tool_use, persists tool result, and continues to a final assistant message", async () => {
    const runtimeMetadata = { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" };
    generateSessionReplyMock
      .mockResolvedValueOnce({
        success: true,
        type: "tool_use",
        toolUses: [
          { id: "tool-use-1", name: "cockpit.get_snapshot", input: { bookId: "book-1" } },
        ],
        metadata: runtimeMetadata,
      })
      .mockResolvedValueOnce({
        success: true,
        type: "message",
        content: "已基于驾驶舱快照继续。",
        metadata: runtimeMetadata,
      });
    const {
      createSession,
      attachSessionChatTransport,
      getSessionChatSnapshot,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();
    const session = await createSession({
      title: "工具循环会话",
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
        messageId: "tool-loop-1",
        content: "先看驾驶舱再继续",
        sessionMode: "chat",
      }),
    );

    expect(generateSessionReplyMock).toHaveBeenCalledTimes(2);
    // 非书绑定会话仅暴露通用核心工具（小说工具如 cockpit.snapshot 需书绑定 + 插件注册）。
    // 这里验证启用的核心工具确实被传给模型。
    expect(generateSessionReplyMock.mock.calls[0]?.[0]).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "Read" }),
      ]),
    });
    expect(executeSessionToolMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: session.id,
      toolName: "cockpit.get_snapshot",
      input: { bookId: "book-1" },
      permissionMode: "allow",
    }));
    expect(sessionToolExecutorOptionsSeen).toContainEqual(expect.objectContaining({
      sessionId: session.id,
      executionSessionId: session.id,
    }));
    expect(generateSessionReplyMock.mock.calls[1]?.[0]).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            toolResult: expect.objectContaining({ ok: true, summary: "已读取驾驶舱快照。" }),
          }),
        }),
      ]),
    });

    const snapshot = await getSessionChatSnapshot(session.id);
    expect(snapshot?.messages).toHaveLength(4);
    expect(snapshot?.messages[1]).toMatchObject({
      role: "assistant",
      toolCalls: [
        expect.objectContaining({
          id: "tool-use-1",
          toolName: "cockpit.get_snapshot",
          input: { bookId: "book-1" },
        }),
      ],
    });
    expect(snapshot?.messages[2]).toMatchObject({
      role: "assistant",
      content: "已读取驾驶舱快照。",
      toolCalls: [
        expect.objectContaining({
          id: "tool-use-1",
          toolName: "cockpit.get_snapshot",
          status: "success",
          renderer: "cockpit.snapshot",
          result: expect.objectContaining({ ok: true }),
        }),
      ],
      metadata: {
        renderer: "cockpit.snapshot",
        toolResult: expect.objectContaining({ ok: true }),
      },
    });
    expect(snapshot?.messages[3]).toMatchObject({
      role: "assistant",
      content: "已基于驾驶舱快照继续。",
      runtime: runtimeMetadata,
    });
  });

  it("passes sanitized canvas context into system prompt, user metadata and session tools", async () => {
    const runtimeMetadata = { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" };
    generateSessionReplyMock
      .mockResolvedValueOnce({
        success: true,
        type: "tool_use",
        toolUses: [
          { id: "tool-use-canvas", name: "pipeline.write", input: { bookId: "book-1", chapterIntent: "写下一章" } },
        ],
        metadata: runtimeMetadata,
      })
      .mockResolvedValueOnce({
        success: true,
        type: "message",
        content: "已根据当前画布上下文生成章节结果。",
        metadata: runtimeMetadata,
      });
    const {
      createSession,
      attachSessionChatTransport,
      getSessionChatSnapshot,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();
    const session = await createSession({
      title: "画布上下文会话",
      agentId: "writer",
      sessionMode: "chat",
      projectId: "book-1",
    });
    const transport = new MockTransport();

    expect(await attachSessionChatTransport(session.id, transport)).toBe(true);
    await handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({
        type: "session:message",
        messageId: "canvas-context-1",
        content: "写下一章",
        sessionMode: "chat",
        canvasContext: {
          activeTabId: "chapter:book-1:2",
          activeResource: { kind: "chapter", id: "chapter:book-1:2", bookId: "book-1", title: "第二章 入城" },
          dirty: true,
          selection: { text: "灵钥裂纹", start: 12, end: 16 },
          openTabs: [
            { id: "chapter:book-1:2", nodeId: "chapter:book-1:2", kind: "chapter-editor", title: "第二章 入城", dirty: true, source: "user", content: "不应传入正文" },
          ],
        },
      }),
    );

    expect(generateSessionReplyMock.mock.calls[0]?.[0]).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("写下一章"),
        }),
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("cockpit.snapshot → lore.read → memory.read → pgi.ask → AskUserQuestion → scene.spec → pipeline.write → memory.events"),
        }),
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("当前画布上下文"),
        }),
        expect.objectContaining({
          id: "canvas-context-1",
          metadata: expect.objectContaining({
            canvasContext: expect.objectContaining({ activeTabId: "chapter:book-1:2", dirty: true }),
          }),
        }),
      ]),
    });
    expect(JSON.stringify(generateSessionReplyMock.mock.calls[0]?.[0])).not.toContain("不应传入正文");
    expect(executeSessionToolMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: session.id,
      toolName: "pipeline.write",
      canvasContext: expect.objectContaining({
        activeResource: expect.objectContaining({ id: "chapter:book-1:2" }),
        dirty: true,
      }),
    }));

    const snapshot = await getSessionChatSnapshot(session.id);
    expect(snapshot?.messages[0]).toMatchObject({
      role: "user",
      metadata: {
        canvasContext: expect.objectContaining({ activeTabId: "chapter:book-1:2", dirty: true }),
      },
    });
  });

  it("persists failed tool results without fake success and lets the model respond to the failure", async () => {
    const runtimeMetadata = { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" };
    generateSessionReplyMock
      .mockResolvedValueOnce({
        success: true,
        type: "tool_use",
        toolUses: [
          { id: "tool-use-failed", name: "cockpit.get_snapshot", input: { bookId: "book-1" } },
        ],
        metadata: runtimeMetadata,
      })
      .mockResolvedValueOnce({
        success: true,
        type: "message",
        content: "驾驶舱读取失败，我会说明无法继续。",
        metadata: runtimeMetadata,
      });
    executeSessionToolMock.mockResolvedValueOnce({
      ok: false,
      renderer: "cockpit.snapshot",
      error: "tool-execution-failed",
      summary: "工具 cockpit.get_snapshot 执行失败：storage offline",
      durationMs: 8,
    });
    const {
      createSession,
      attachSessionChatTransport,
      getSessionChatSnapshot,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();
    const session = await createSession({ title: "工具失败会话", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();

    expect(await attachSessionChatTransport(session.id, transport)).toBe(true);
    await handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({ type: "session:message", messageId: "tool-failure-1", content: "读取驾驶舱", sessionMode: "chat" }),
    );

    const snapshot = await getSessionChatSnapshot(session.id);
    expect(snapshot?.messages[2]).toMatchObject({
      role: "assistant",
      content: "工具 cockpit.get_snapshot 执行失败：storage offline",
      toolCalls: [
        expect.objectContaining({
          id: "tool-use-failed",
          status: "error",
          error: "tool-execution-failed",
          result: expect.objectContaining({ ok: false }),
        }),
      ],
      metadata: {
        toolResult: expect.objectContaining({ ok: false, error: "tool-execution-failed" }),
      },
    });
    expect(snapshot?.messages[3]).toMatchObject({
      role: "assistant",
      content: "驾驶舱读取失败，我会说明无法继续。",
    });
  });

  it("stops the tool loop when a tool result requires pending confirmation", async () => {
    const runtimeMetadata = { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" };
    generateSessionReplyMock.mockResolvedValueOnce({
      success: true,
      type: "tool_use",
      toolUses: [
        {
          id: "tool-use-confirm",
          name: "guided.exit",
          input: { bookId: "book-1", sessionId: "session-1", guidedStateId: "guided-state-1", plan: { title: "计划" } },
        },
      ],
      metadata: runtimeMetadata,
    });
    executeSessionToolMock.mockResolvedValueOnce({
      ok: true,
      renderer: "guided.plan",
      summary: "工具 guided.exit 需要确认后执行。",
      data: { status: "pending-confirmation" },
      confirmation: {
        id: "confirm-1",
        toolName: "guided.exit",
        target: "book-1",
        risk: "confirmed-write",
        summary: "等待确认",
        options: ["approve", "reject", "open-in-canvas"],
        sessionId: "session-1",
      },
      durationMs: 6,
    });
    const {
      createSession,
      attachSessionChatTransport,
      getSessionChatSnapshot,
      getSessionToolState,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();
    const session = await createSession({ title: "确认门会话", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();

    expect(await attachSessionChatTransport(session.id, transport)).toBe(true);
    await handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({ type: "session:message", messageId: "pending-confirmation-1", content: "生成计划", sessionMode: "chat" }),
    );

    expect(generateSessionReplyMock).toHaveBeenCalledTimes(1);
    const snapshot = await getSessionChatSnapshot(session.id);
    expect(snapshot?.messages).toHaveLength(3);
    expect(snapshot?.messages[2]).toMatchObject({
      role: "assistant",
      toolCalls: [
        expect.objectContaining({
          id: "tool-use-confirm",
          toolName: "guided.exit",
          status: "pending",
          confirmation: expect.objectContaining({
            id: "confirm-1",
            risk: "confirmed-write",
            source: { sessionId: session.id, messageId: "pending-confirmation-1-tool-result-tool-use-confirm", toolUseId: "tool-use-confirm" },
            targetResources: [{ kind: "guided.exit", id: "book-1", bookId: "book-1" }],
            checkpoint: { required: true },
            operations: [
              { action: "approve", label: "批准" },
              { action: "reject", label: "拒绝" },
              { action: "open-in-canvas", label: "在画布打开" },
            ],
          }),
        }),
      ],
      metadata: {
        confirmation: expect.objectContaining({ id: "confirm-1" }),
        toolResult: expect.objectContaining({ data: { status: "pending-confirmation" } }),
      },
    });
    expect(snapshot?.session.recovery).toMatchObject({
      pendingToolCallCount: 1,
      pendingToolCallSummary: ["guided.exit:pending"],
    });
    const toolState = await getSessionToolState(session.id);
    expect(toolState?.pendingConfirmations[0]).toMatchObject({
      id: "confirm-1",
      toolName: "guided.exit",
      source: { sessionId: session.id, messageId: "pending-confirmation-1-tool-result-tool-use-confirm", toolUseId: "tool-use-confirm" },
      targetResources: [{ kind: "guided.exit", id: "book-1", bookId: "book-1" }],
      checkpoint: { required: true },
      operations: [
        { action: "approve", label: "批准" },
        { action: "reject", label: "拒绝" },
        { action: "open-in-canvas", label: "在画布打开" },
      ],
    });
  });

  it("continues the write-next chain after guided plan approval and executes chapter result creation", async () => {
    const runtimeMetadata = { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" };
    generateSessionReplyMock
      .mockResolvedValueOnce({
        success: true,
        type: "tool_use",
        toolUses: [
          { id: "tool-use-plan", name: "guided.exit", input: { bookId: "book-1", sessionId: "session-1", guidedStateId: "guided-state-1", plan: { title: "下一章计划" } } },
        ],
        metadata: runtimeMetadata,
      })
      .mockResolvedValueOnce({
        success: true,
        type: "tool_use",
        toolUses: [
          { id: "tool-use-chapter-result", name: "pipeline.write", input: { bookId: "book-1", chapterIntent: "写下一章", guidedPlanId: "guided-state-1" } },
        ],
        metadata: runtimeMetadata,
      })
      .mockResolvedValueOnce({
        success: true,
        type: "message",
        content: "下一章章节结果已创建并可在画布打开。",
        metadata: runtimeMetadata,
      });
    executeSessionToolMock
      .mockResolvedValueOnce({
        ok: true,
        renderer: "guided.plan",
        summary: "工具 guided.exit 需要确认后执行。",
        data: { status: "pending-confirmation" },
        confirmation: { id: "confirm-write-next", toolName: "guided.exit", target: "book-1", risk: "confirmed-write", summary: "等待批准", options: ["approve", "reject", "open-in-canvas"], sessionId: "session-1" },
        durationMs: 4,
      })
      .mockResolvedValueOnce({
        ok: true,
        renderer: "guided.plan",
        summary: "引导式生成计划已批准，进入执行阶段。",
        data: { status: "executing", guidedStateId: "guided-state-1" },
        durationMs: 8,
      })
      .mockResolvedValueOnce({
        ok: true,
        renderer: "pipeline.chapter",
        summary: "已创建下一章章节结果。",
        data: { resource: { id: "chapter:2", title: "第二章" } },
        artifact: { id: "chapter:2", kind: "chapter", title: "第二章", renderer: "pipeline.chapter", openInCanvas: true },
        durationMs: 15,
      });
    const {
      createSession,
      attachSessionChatTransport,
      confirmSessionToolDecision,
      getSessionChatSnapshot,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();
    const session = await createSession({ title: "写下一章确认链", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();

    expect(await attachSessionChatTransport(session.id, transport)).toBe(true);
    await handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({ type: "session:message", messageId: "write-next-confirm-chain", content: "写下一章", sessionMode: "chat" }),
    );

    const approved = await confirmSessionToolDecision(session.id, "guided.exit", { decision: "approve", confirmationId: "confirm-write-next" });

    expect(approved.ok).toBe(true);
    expect(generateSessionReplyMock.mock.calls[1]?.[0]).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          type: "tool_result",
          toolCallId: "tool-use-plan",
          name: "guided.exit",
          metadata: expect.objectContaining({
            toolResult: expect.objectContaining({ ok: true, summary: "引导式生成计划已批准，进入执行阶段。" }),
          }),
        }),
      ]),
    });
    expect(executeSessionToolMock).toHaveBeenNthCalledWith(3, expect.objectContaining({
      toolName: "pipeline.write",
      input: expect.objectContaining({ bookId: "book-1", chapterIntent: "写下一章" }),
    }));
    expect(generateSessionReplyMock).toHaveBeenCalledTimes(3);
    expect(sessionToolExecutorOptionsSeen).toHaveLength(2);
    expect(sessionToolExecutorOptionsSeen).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: session.id, executionSessionId: session.id }),
      expect.objectContaining({ sessionId: session.id, executionSessionId: session.id }),
    ]));
    const snapshot = await getSessionChatSnapshot(session.id);
    expect(snapshot?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: "已创建下一章章节结果。",
        metadata: expect.objectContaining({ toolResult: expect.objectContaining({ renderer: "pipeline.chapter" }) }),
      }),
      expect.objectContaining({ role: "assistant", content: "下一章章节结果已创建并可在画布打开。" }),
    ]));
  });

  it("lets the model respond after chapter result creation failure in the write-next chain", async () => {
    const runtimeMetadata = { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" };
    generateSessionReplyMock
      .mockResolvedValueOnce({
        success: true,
        type: "tool_use",
        toolUses: [{ id: "tool-use-plan-fail", name: "guided.exit", input: { bookId: "book-1", sessionId: "session-1", guidedStateId: "guided-state-1", plan: { title: "下一章计划" } } }],
        metadata: runtimeMetadata,
      })
      .mockResolvedValueOnce({
        success: true,
        type: "tool_use",
        toolUses: [{ id: "tool-use-chapter-result-fail", name: "pipeline.write", input: { bookId: "book-1", chapterIntent: "写下一章" } }],
        metadata: runtimeMetadata,
      })
      .mockResolvedValueOnce({
        success: true,
        type: "message",
        content: "章节结果生成失败，需要配置支持模型。",
        metadata: runtimeMetadata,
      });
    executeSessionToolMock
      .mockResolvedValueOnce({
        ok: true,
        renderer: "guided.plan",
        summary: "工具 guided.exit 需要确认后执行。",
        data: { status: "pending-confirmation" },
        confirmation: { id: "confirm-write-next-fail", toolName: "guided.exit", target: "book-1", risk: "confirmed-write", summary: "等待批准", options: ["approve", "reject", "open-in-canvas"], sessionId: "session-1" },
        durationMs: 4,
      })
      .mockResolvedValueOnce({ ok: true, renderer: "guided.plan", summary: "计划已批准。", data: { status: "executing" }, durationMs: 8 })
      .mockResolvedValueOnce({ ok: false, renderer: "pipeline.chapter", summary: "章节结果生成需要配置支持模型。", error: "unsupported-model", durationMs: 12 });
    const { createSession, attachSessionChatTransport, confirmSessionToolDecision, getSessionChatSnapshot, handleSessionChatTransportMessage } = await loadSessionServices();
    const session = await createSession({ title: "写下一章失败链", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();

    expect(await attachSessionChatTransport(session.id, transport)).toBe(true);
    await handleSessionChatTransportMessage(session.id, transport, JSON.stringify({ type: "session:message", messageId: "write-next-fail-chain", content: "写下一章", sessionMode: "chat" }));
    const approved = await confirmSessionToolDecision(session.id, "guided.exit", { decision: "approve", confirmationId: "confirm-write-next-fail" });

    expect(approved.ok).toBe(true);
    expect(generateSessionReplyMock).toHaveBeenCalledTimes(3);
    const snapshot = await getSessionChatSnapshot(session.id);
    expect(snapshot?.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "章节结果生成失败，需要配置支持模型。",
    });
  });

  it("persists an assistant error and stops when the bounded tool loop exceeds six steps", async () => {
    const runtimeMetadata = { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" };
    for (let index = 0; index < 7; index += 1) {
      generateSessionReplyMock.mockResolvedValueOnce({
        success: true,
        type: "tool_use",
        toolUses: [
          { id: `tool-use-loop-${index + 1}`, name: "cockpit.get_snapshot", input: { bookId: `book-${index + 1}` } },
        ],
        metadata: runtimeMetadata,
      });
    }
    const {
      createSession,
      attachSessionChatTransport,
      getSessionChatSnapshot,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();
    const session = await createSession({ title: "循环上限会话", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();

    expect(await attachSessionChatTransport(session.id, transport)).toBe(true);
    await handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({ type: "session:message", messageId: "tool-loop-limit-1", content: "连续查工具", sessionMode: "chat" }),
    );

    expect(generateSessionReplyMock).toHaveBeenCalledTimes(7);
    expect(executeSessionToolMock).toHaveBeenCalledTimes(6);
    const snapshot = await getSessionChatSnapshot(session.id);
    expect(snapshot?.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("工具循环超过 6 步"),
      metadata: expect.objectContaining({ toolLoop: expect.objectContaining({ error: "tool-loop-limit" }) }),
    });
    expect(snapshot?.session.recovery?.lastFailure).toMatchObject({
      reason: "tool-loop-limit",
      message: expect.stringContaining("工具循环超过 6 步"),
    });
  });

  it("restores persisted tool-use and tool-result messages after runtime reload", async () => {
    const runtimeMetadata = { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" };
    generateSessionReplyMock
      .mockResolvedValueOnce({
        success: true,
        type: "tool_use",
        toolUses: [
          { id: "tool-use-reload", name: "cockpit.get_snapshot", input: { bookId: "book-1" } },
        ],
        metadata: runtimeMetadata,
      })
      .mockResolvedValueOnce({
        success: true,
        type: "message",
        content: "已恢复工具结果。",
        metadata: runtimeMetadata,
      });
    const firstLoad = await loadSessionServices();
    const session = await firstLoad.createSession({ title: "工具恢复会话", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();

    expect(await firstLoad.attachSessionChatTransport(session.id, transport)).toBe(true);
    await firstLoad.handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({ type: "session:message", messageId: "tool-reload-1", content: "读取后恢复", sessionMode: "chat" }),
    );

    firstLoad.__testing.resetSessionStoreMutationQueue();
    vi.resetModules();
    const reloaded = await loadSessionServices();
    const snapshot = await reloaded.getSessionChatSnapshot(session.id);

    expect(snapshot?.messages).toHaveLength(4);
    expect(snapshot?.messages[1]).toMatchObject({
      toolCalls: [
        expect.objectContaining({ id: "tool-use-reload", toolName: "cockpit.get_snapshot" }),
      ],
    });
    expect(snapshot?.messages[2]).toMatchObject({
      metadata: {
        toolResult: expect.objectContaining({ ok: true, summary: "已读取驾驶舱快照。" }),
      },
    });
    expect(snapshot?.cursor.lastSeq).toBe(4);
  }, 10000);

  it("surfaces unsupported-tools failures without executing tools or faking assistant content", async () => {
    generateSessionReplyMock.mockResolvedValueOnce({
      success: false,
      code: "unsupported-tools",
      error: "当前 provider/model 不支持 session tools",
      metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
    });
    const {
      createSession,
      attachSessionChatTransport,
      getSessionChatSnapshot,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();
    const session = await createSession({ title: "工具不支持会话", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();

    expect(await attachSessionChatTransport(session.id, transport)).toBe(true);
    await handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({ type: "session:message", messageId: "unsupported-tools-1", content: "调用工具", sessionMode: "chat" }),
    );

    const envelopes = transport.sent.map((entry) => JSON.parse(entry));
    expect(envelopes.find((entry) => entry.type === "session:error")).toMatchObject({
      type: "session:error",
      code: "unsupported-tools",
      error: "当前 provider/model 不支持 session tools",
    });
    expect(envelopes.some((entry) => entry.type === "session:message" && entry.message?.role === "assistant")).toBe(false);
    expect(executeSessionToolMock).not.toHaveBeenCalled();
    const snapshot = await getSessionChatSnapshot(session.id);
    expect(snapshot?.messages).toHaveLength(1);
    expect(snapshot?.session.recovery?.lastFailure).toMatchObject({
      reason: "unsupported-tools",
      message: "当前 provider/model 不支持 session tools",
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

  it("waits for delayed Bun transport attachment before handling an immediate message", async () => {
    const { createBunSessionChatWebSocketRoute } = await loadSessionServices();
    let releaseAttach!: (attached: boolean) => void;
    const attachPromise = new Promise<boolean>((resolve) => { releaseAttach = resolve; });
    const attach = vi.fn(() => attachPromise);
    const handle = vi.fn(async () => {});
    const detach = vi.fn();
    const route = createBunSessionChatWebSocketRoute({ attach, handle, detach });
    const socket = {
      data: { sessionId: "bun-delayed-attach" },
      send: vi.fn(),
      close: vi.fn(),
    };

    route.open?.(socket);
    route.message?.(socket, "immediate-message");
    expect(handle).not.toHaveBeenCalled();

    releaseAttach(true);
    await waitForAssertion(() => expect(handle).toHaveBeenCalledWith(
      "bun-delayed-attach",
      expect.any(Object),
      "immediate-message",
    ));
    expect(detach).not.toHaveBeenCalled();
  });

  it("detaches a Bun socket closed during attachment before it can process its pending message", async () => {
    const { createBunSessionChatWebSocketRoute } = await loadSessionServices();
    let releaseAttach!: (attached: boolean) => void;
    const attachPromise = new Promise<boolean>((resolve) => { releaseAttach = resolve; });
    const attach = vi.fn(() => attachPromise);
    const handle = vi.fn(async () => {});
    const detach = vi.fn();
    const route = createBunSessionChatWebSocketRoute({ attach, handle, detach });
    const socket = {
      data: { sessionId: "bun-close-before-attach" },
      send: vi.fn(),
      close: vi.fn(),
    };

    route.open?.(socket);
    route.message?.(socket, "must-not-run");
    route.close?.(socket, 1000, "closed");
    releaseAttach(true);

    await waitForAssertion(() => expect(detach).toHaveBeenCalledWith(
      "bun-close-before-attach",
      expect.any(Object),
    ));
    expect(handle).not.toHaveBeenCalled();
    route.message?.(socket, "still-must-not-run");
    expect(handle).not.toHaveBeenCalled();
  });

  it("records per-message usage metadata and accumulates session-level cumulative usage", async () => {
    const usage1 = { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 5 };
    const usage2 = { input_tokens: 200, output_tokens: 80 };
    const runtimeMetadata1 = { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6", usage: usage1 };
    const runtimeMetadata2 = { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6", usage: usage2 };
    generateSessionReplyMock
      .mockResolvedValueOnce({
        success: true,
        content: "第一轮回复",
        metadata: runtimeMetadata1,
      })
      .mockResolvedValueOnce({
        success: true,
        content: "第二轮回复",
        metadata: runtimeMetadata2,
      });
    const {
      createSession,
      attachSessionChatTransport,
      getSessionChatSnapshot,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();
    const session = await createSession({
      title: "Token 用量会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const transport = new MockTransport();

    expect(await attachSessionChatTransport(session.id, transport)).toBe(true);

    await handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({ type: "session:message", messageId: "usage-msg-1", content: "第一句", sessionMode: "chat" }),
    );

    await handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({ type: "session:message", messageId: "usage-msg-2", content: "第二句", sessionMode: "chat" }),
    );

    const snapshot = await getSessionChatSnapshot(session.id);

    // Per-message usage metadata
    const assistantMessages = snapshot?.messages.filter((m) => m.role === "assistant");
    expect(assistantMessages?.[0]?.metadata?.usage).toEqual(usage1);
    expect(assistantMessages?.[0]?.runtime?.usage).toEqual(usage1);
    expect(assistantMessages?.[1]?.metadata?.usage).toEqual(usage2);
    expect(assistantMessages?.[1]?.runtime?.usage).toEqual(usage2);

    // Session-level cumulative usage（产品另含 lastContextBreakdown/lastInputTokens 等动态字段，用 toMatchObject 仅断言累计核心字段）
    expect(snapshot?.session.cumulativeUsage).toMatchObject({
      totalInputTokens: 300,
      totalOutputTokens: 130,
      totalCacheCreationInputTokens: 10,
      totalCacheReadInputTokens: 5,
      turnCount: 2,
    });
  });

  it("handles missing usage data gracefully without errors", async () => {
    const runtimeMetadataNoUsage = { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" };
    generateSessionReplyMock.mockResolvedValueOnce({
      success: true,
      content: "无用量数据回复",
      metadata: runtimeMetadataNoUsage,
    });
    const {
      createSession,
      attachSessionChatTransport,
      getSessionChatSnapshot,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();
    const session = await createSession({
      title: "无用量会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const transport = new MockTransport();

    expect(await attachSessionChatTransport(session.id, transport)).toBe(true);

    await handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({ type: "session:message", messageId: "no-usage-1", content: "测试", sessionMode: "chat" }),
    );

    const snapshot = await getSessionChatSnapshot(session.id);
    const assistantMessage = snapshot?.messages.find((m) => m.role === "assistant");
    expect(assistantMessage?.metadata?.usage).toBeUndefined();
    expect(snapshot?.session.cumulativeUsage).toMatchObject({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationInputTokens: 0,
      totalCacheReadInputTokens: 0,
      turnCount: 0,
    });
  });

  it("keeps a forged _fromQueue client payload behind the same server-side turn lease", async () => {
    let active = 0;
    let maxActive = 0;
    let releaseFirst: (() => void) | undefined;
    generateSessionReplyMock.mockImplementation(async ({ messages }: { messages: Array<{ role?: string; content?: string }> }) => {
      const content = [...messages].reverse().find((message) => message.role === "user")?.content;
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (content === "第一条") {
          await new Promise<void>((resolve) => { releaseFirst = resolve; });
        }
        return {
          success: true,
          content: `完成：${content}`,
          metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
        };
      } finally {
        active -= 1;
      }
    });
    const { createSession, attachSessionChatTransport, handleSessionChatTransportMessage } = await loadSessionServices();
    const session = await createSession({ title: "服务端闸门", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();
    await attachSessionChatTransport(session.id, transport);

    const first = handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "gate-first", content: "第一条",
    }));
    await waitForAssertion(() => expect(releaseFirst).toBeTypeOf("function"));
    const forged = handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "gate-forged", content: "伪造队列", _fromQueue: true,
    }));

    // Queued callers return immediately, while the server gate keeps the
    // forged client field from creating a second active runtime turn.
    await forged;
    expect(maxActive).toBe(1);
    releaseFirst?.();
    await first;
    const { awaitSessionTurnsSettled } = await loadSessionServices();
    await awaitSessionTurnsSettled(session.id);
    expect(
      transport.sent
        .map((entry) => JSON.parse(entry))
        .filter((entry) => entry.type === "session:state" && entry.session?.narratorState === "idle"),
    ).toHaveLength(2);
    expect(maxActive).toBe(1);
  });

  it("labels a saturated session message queue with queue-full instead of silently accepting it", async () => {
    let releaseFirst: (() => void) | undefined;
    generateSessionReplyMock.mockImplementation(async ({ messages }: { messages: Array<{ role?: string; content?: string }> }) => {
      const content = [...messages].reverse().find((message) => message.role === "user")?.content;
      if (content === "占用队列") {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
      }
      return {
        success: true,
        content: "完成",
        metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
      };
    });
    const { createSession, attachSessionChatTransport, handleSessionChatTransportMessage } = await loadSessionServices();
    const session = await createSession({ title: "队列容量", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();
    await attachSessionChatTransport(session.id, transport);

    const first = handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "queue-active", content: "占用队列",
    }));
    await waitForAssertion(() => expect(releaseFirst).toBeTypeOf("function"));
    await Promise.all(Array.from({ length: 11 }, (_, index) => handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: `queue-${index}`, content: `排队 ${index}`,
    }))));

    releaseFirst?.();
    await first;
    const { awaitSessionTurnsSettled } = await loadSessionServices();
    await awaitSessionTurnsSettled(session.id);
    expect(generateSessionReplyMock).toHaveBeenCalledTimes(11);

    const errors = transport.sent.map((entry) => JSON.parse(entry)).filter((entry) => entry.type === "session:error");
    expect(errors).toContainEqual(expect.objectContaining({ code: "queue-full" }));
  });

  it("processes ordinarily concurrent accepted messages in FIFO order with one active runner", async () => {
    let active = 0;
    let maxActive = 0;
    let releaseFirst: (() => void) | undefined;
    const started: string[] = [];
    generateSessionReplyMock.mockImplementation(async ({ messages }: { messages: Array<{ role?: string; content?: string }> }) => {
      const content = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
      started.push(content);
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (content === "第一条普通消息") {
          await new Promise<void>((resolve) => { releaseFirst = resolve; });
        }
        return {
          success: true,
          content: `完成：${content}`,
          metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
        };
      } finally {
        active -= 1;
      }
    });
    const { createSession, attachSessionChatTransport, handleSessionChatTransportMessage } = await loadSessionServices();
    const session = await createSession({ title: "普通并发 FIFO", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();
    await attachSessionChatTransport(session.id, transport);

    const first = handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "ordinary-first", content: "第一条普通消息",
    }));
    await waitForAssertion(() => expect(releaseFirst).toBeTypeOf("function"));
    await Promise.all([
      handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
        type: "session:message", messageId: "ordinary-second", content: "第二条普通消息",
      })),
      handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
        type: "session:message", messageId: "ordinary-third", content: "第三条普通消息",
      })),
    ]);

    expect(started).toEqual(["第一条普通消息"]);
    expect(maxActive).toBe(1);
    releaseFirst?.();
    await first;
    const { awaitSessionTurnsSettled } = await loadSessionServices();
    await awaitSessionTurnsSettled(session.id);
    expect(generateSessionReplyMock).toHaveBeenCalledTimes(3);
    expect(started).toEqual(["第一条普通消息", "第二条普通消息", "第三条普通消息"]);
    expect(maxActive).toBe(1);
  });

  it("holds the next message behind an aborted active turn until its runner actually settles", async () => {
    let active = 0;
    let maxActive = 0;
    let releaseActive: (() => void) | undefined;
    let activeSignal: AbortSignal | undefined;
    const started: string[] = [];
    generateSessionReplyMock.mockImplementation(async ({ messages, signal }: { messages: Array<{ role?: string; content?: string }>; signal?: AbortSignal }) => {
      const content = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
      started.push(content);
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (content === "等待中断完成") {
          activeSignal = signal;
          await new Promise<void>((resolve) => { releaseActive = resolve; });
        }
        return {
          success: true,
          content: `完成：${content}`,
          metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
        };
      } finally {
        active -= 1;
      }
    });
    const { createSession, attachSessionChatTransport, handleSessionChatTransportMessage } = await loadSessionServices();
    const session = await createSession({ title: "中断不抢跑", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();
    await attachSessionChatTransport(session.id, transport);

    const activeTurn = handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "abort-active", content: "等待中断完成",
    }));
    await waitForAssertion(() => expect(releaseActive).toBeTypeOf("function"));
    await handleSessionChatTransportMessage(session.id, transport, JSON.stringify({ type: "session:abort" }));
    expect(activeSignal?.aborted).toBe(true);

    const nextTurn = handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "abort-next", content: "必须等待",
    }));
    // A queued caller returns without waiting for its runner, so this assertion
    // observes the gate state without relying on elapsed wall-clock time.
    await nextTurn;
    const startedBeforeActiveSettles = [...started];
    const maxActiveBeforeActiveSettles = maxActive;

    releaseActive?.();
    await Promise.all([activeTurn, nextTurn]);
    const { awaitSessionTurnsSettled } = await loadSessionServices();
    await awaitSessionTurnsSettled(session.id);
    expect(generateSessionReplyMock).toHaveBeenCalledTimes(2);

    expect(startedBeforeActiveSettles).toEqual(["等待中断完成"]);
    expect(maxActiveBeforeActiveSettles).toBe(1);
    expect(started).toEqual(["等待中断完成", "必须等待"]);
    expect(maxActive).toBe(1);
  });

  it("Task7: provider generate receives user abort and keeps Gate closed until the old promise settles", async () => {
    const firstGenerate = deferred<{
      success: false;
      code: string;
      error: string;
      metadata: { providerId: string; providerName: string; modelId: string };
    }>();
    let firstSignal: AbortSignal | undefined;
    const started: string[] = [];
    generateSessionReplyMock.mockImplementation(async ({ messages, signal }: { messages: Array<{ role?: string; content?: string }>; signal?: AbortSignal }) => {
      const content = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
      started.push(content);
      if (content === "provider abort active") {
        firstSignal = signal;
        return firstGenerate.promise;
      }
      return {
        success: true,
        content: `完成：${content}`,
        metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
      };
    });
    const { createSession, attachSessionChatTransport, handleSessionChatTransportMessage, awaitSessionTurnsSettled } = await loadSessionServices();
    const session = await createSession({ title: "Provider abort gate", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();
    await attachSessionChatTransport(session.id, transport);

    const activeTurn = handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "provider-abort-active", content: "provider abort active",
    }));
    await waitForAssertion(() => expect(firstSignal).toBeInstanceOf(AbortSignal));
    await handleSessionChatTransportMessage(session.id, transport, JSON.stringify({ type: "session:abort" }));
    expect(firstSignal?.aborted).toBe(true);

    const nextTurn = handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "provider-abort-next", content: "provider abort next",
    }));
    await nextTurn;
    const startedBeforeProviderSettles = [...started];

    firstGenerate.resolve({
      success: false,
      code: "user-aborted",
      error: "aborted by test",
      metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
    });
    await activeTurn;
    await awaitSessionTurnsSettled(session.id);

    expect(startedBeforeProviderSettles).toEqual(["provider abort active"]);
    expect(started).toEqual(["provider abort active", "provider abort next"]);
  });

  it("Task7: non-cancellable write stays behind Gate after abort and persists typed late-completion audit instead of ordinary success", async () => {
    const writeCompletion = deferred<{ ok: true; renderer: string; summary: string; data: { resourceId: string } }>();
    const started: string[] = [];
    let writeSignal: AbortSignal | undefined;
    generateSessionReplyMock.mockImplementation(async ({ messages }: { messages: Array<{ role?: string; content?: string }> }) => {
      const content = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
      started.push(content);
      if (content === "non cancellable write") {
        return {
          success: true,
          type: "tool_use",
          toolUses: [{ id: "non-cancellable-write-tool", name: "pipeline.write", input: { bookId: "book-1", sceneSpec: { scenes: [] } } }],
          metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
        };
      }
      return {
        success: true,
        content: `完成：${content}`,
        metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
      };
    });
    executeSessionToolMock.mockImplementation(async (toolInput: { toolName?: string; signal?: AbortSignal }) => {
      if (toolInput.toolName === "pipeline.write") {
        writeSignal = toolInput.signal;
        return writeCompletion.promise;
      }
      return { ok: true, summary: "ok" };
    });
    const { createSession, attachSessionChatTransport, getSessionChatSnapshot, handleSessionChatTransportMessage, awaitSessionTurnsSettled } = await loadSessionServices();
    const session = await createSession({ title: "Non cancellable write abort", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();
    await attachSessionChatTransport(session.id, transport);

    const activeTurn = handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "non-cancellable-active", content: "non cancellable write",
    }));
    await waitForAssertion(() => expect(writeSignal).toBeInstanceOf(AbortSignal));
    await handleSessionChatTransportMessage(session.id, transport, JSON.stringify({ type: "session:abort" }));
    // pipeline.write is non-cancellable: its handler receives an isolated child
    // signal so a user abort cannot interrupt an irreversible write mid-flight.
    expect(writeSignal?.aborted).toBe(false);

    const nextTurn = handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "non-cancellable-next", content: "must wait for write completion",
    }));
    await nextTurn;
    const startedBeforeWriteSettles = [...started];

    writeCompletion.resolve({ ok: true, renderer: "pipeline.chapter-result", summary: "真实写入完成", data: { resourceId: "chapter-result-1" } });
    await activeTurn;
    await awaitSessionTurnsSettled(session.id);
    const snapshot = await getSessionChatSnapshot(session.id);
    const writeMessages = snapshot?.messages.filter((message) =>
      message.toolCalls?.some((toolCall) => toolCall.id === "non-cancellable-write-tool" && toolCall.toolName === "pipeline.write"),
    ) ?? [];
    const auditType = writeMessages
      .map((message) => (message.metadata as { toolResult?: { data?: { audit?: { type?: string } } } } | undefined)
        ?.toolResult?.data?.audit?.type)
      .find((type): type is string => typeof type === "string");
    const ordinarySuccess = writeMessages.some((message) =>
      message.toolCalls?.some((toolCall) => toolCall.status === "success"),
    );

    expect(startedBeforeWriteSettles).toEqual(["non cancellable write"]);
    expect(auditType).toMatch(/deadline-exceeded-operation-(completed|failed)/);
    expect(ordinarySuccess).toBe(false);
    expect(started).toContain("must wait for write completion");
  });

  it("Task8: process-killable Bash keeps the Gate closed until the fake child really exits", async () => {
    const fakeChildExit = deferred<{ ok: false; error: "stopped"; summary: string; data: { stopReason: "abort" } }>();
    const started: string[] = [];
    let bashSignal: AbortSignal | undefined;
    generateSessionReplyMock.mockImplementation(async ({ messages }: { messages: Array<{ role?: string; content?: string }> }) => {
      const content = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
      started.push(content);
      if (content === "bash process active") {
        return {
          success: true,
          type: "tool_use",
          toolUses: [{ id: "bash-process-tool", name: "Bash", input: { command: "fake-never-exits" } }],
          metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
        };
      }
      return {
        success: true,
        content: `完成：${content}`,
        metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
      };
    });
    executeSessionToolMock.mockImplementation(async (toolInput: { toolName?: string; signal?: AbortSignal }) => {
      if (toolInput.toolName === "Bash") {
        bashSignal = toolInput.signal;
        return fakeChildExit.promise;
      }
      return { ok: true, summary: "ok" };
    });
    const { createSession, attachSessionChatTransport, handleSessionChatTransportMessage, awaitSessionTurnsSettled } = await loadSessionServices();
    const session = await createSession({ title: "Bash process stop gate", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();
    await attachSessionChatTransport(session.id, transport);

    const activeTurn = handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "bash-process-active", content: "bash process active",
    }));
    await waitForAssertion(() => expect(bashSignal).toBeInstanceOf(AbortSignal));
    await handleSessionChatTransportMessage(session.id, transport, JSON.stringify({ type: "session:abort" }));
    expect(bashSignal?.aborted).toBe(true);

    await handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "bash-process-next", content: "must wait for real bash exit",
    }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toEqual(["bash process active"]);

    fakeChildExit.resolve({ ok: false, error: "stopped", summary: "fake child really exited", data: { stopReason: "abort" } });
    await activeTurn;
    await awaitSessionTurnsSettled(session.id);

    expect(started).toEqual(["bash process active", "must wait for real bash exit"]);
  });

  it("notifies queued transports when a session turn gate is disposed", async () => {
    let releaseActive: (() => void) | undefined;
    generateSessionReplyMock.mockImplementation(async ({ messages }: { messages: Array<{ role?: string; content?: string }> }) => {
      const content = [...messages].reverse().find((message) => message.role === "user")?.content;
      if (content === "正在执行") {
        await new Promise<void>((resolve) => { releaseActive = resolve; });
      }
      return {
        success: true,
        content: `完成：${content}`,
        metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
      };
    });
    const {
      createSession,
      attachSessionChatTransport,
      handleSessionChatTransportMessage,
      disposeSessionTurnGate,
    } = await loadSessionServices();
    const session = await createSession({ title: "释放排队消息", agentId: "writer", sessionMode: "chat" });
    const activeTransport = new MockTransport();
    const queuedTransport = new MockTransport();
    await attachSessionChatTransport(session.id, activeTransport);
    await attachSessionChatTransport(session.id, queuedTransport);

    const activeTurn = handleSessionChatTransportMessage(session.id, activeTransport, JSON.stringify({
      type: "session:message", messageId: "dispose-active", content: "正在执行",
    }));
    await waitForAssertion(() => expect(releaseActive).toBeTypeOf("function"));
    await handleSessionChatTransportMessage(session.id, queuedTransport, JSON.stringify({
      type: "session:message", messageId: "dispose-queued", content: "等待释放",
    }));

    const disposePromise = disposeSessionTurnGate(session.id);
    releaseActive?.();
    await Promise.all([activeTurn, disposePromise]);

    const queuedErrors = queuedTransport.sent
      .map((entry) => JSON.parse(entry))
      .filter((entry) => entry.type === "session:error");
    expect(queuedErrors).toContainEqual(expect.objectContaining({ code: "session-disposed" }));
  });

  it("settles a persistence mutation failure with one safe error and one idle terminal state", async () => {
    const {
      __testing,
      createSession,
      attachSessionChatTransport,
      handleSessionChatTransportMessage,
      awaitSessionTurnsSettled,
    } = await loadSessionServices();
    const session = await createSession({ title: "持久化失败终态", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();
    await attachSessionChatTransport(session.id, transport);
    transport.sent.splice(0);

    const mutationFailure = vi.fn(() => {
      throw new Error("session mutation denied");
    });
    __testing.setSessionStoreMutationHook(mutationFailure);

    await handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "persist-failure", content: "持久化会失败",
    }));
    await awaitSessionTurnsSettled(session.id);

    const envelopes = transport.sent.map((entry) => JSON.parse(entry));
    const safeErrorIndex = envelopes.findIndex((entry) => entry.type === "session:error" && entry.code === "session-persist-failed");
    const idleEnvelopes = envelopes.filter((entry) => entry.type === "session:state" && entry.session?.narratorState === "idle");
    const idleIndex = envelopes.findIndex((entry) => entry === idleEnvelopes[0]);

    // The active caller returns only after the visible terminal error and idle
    // transition are emitted. A single bounded failure-record attempt is made.
    expect(safeErrorIndex).toBeGreaterThanOrEqual(0);
    expect(envelopes.filter((entry) => entry.type === "session:error")).toHaveLength(1);
    expect(idleEnvelopes).toHaveLength(1);
    expect(idleIndex).toBeGreaterThan(safeErrorIndex);
    expect(mutationFailure).toHaveBeenCalledTimes(2);
  });

  it("drops a failed transport and prevents its queued turn from running", async () => {
    let releaseActive: (() => void) | undefined;
    generateSessionReplyMock.mockImplementation(async ({ messages }: { messages: Array<{ role?: string; content?: string }> }) => {
      const content = [...messages].reverse().find((message) => message.role === "user")?.content;
      if (content === "保持执行") {
        await new Promise<void>((resolve) => { releaseActive = resolve; });
      }
      return {
        success: true,
        content: `完成：${content}`,
        metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
      };
    });
    const {
      createSession,
      attachSessionChatTransport,
      broadcastSessionError,
      getSessionChatSnapshot,
      handleSessionChatTransportMessage,
      awaitSessionTurnsSettled,
    } = await loadSessionServices();
    const session = await createSession({ title: "断连队列取消", agentId: "writer", sessionMode: "chat" });
    const activeTransport = new MockTransport();
    const queuedTransport = new MockTransport();
    await attachSessionChatTransport(session.id, activeTransport);
    await attachSessionChatTransport(session.id, queuedTransport);

    const activeTurn = handleSessionChatTransportMessage(session.id, activeTransport, JSON.stringify({
      type: "session:message", messageId: "drop-active", content: "保持执行",
    }));
    await waitForAssertion(() => expect(releaseActive).toBeTypeOf("function"));
    await handleSessionChatTransportMessage(session.id, queuedTransport, JSON.stringify({
      type: "session:message", messageId: "drop-queued", content: "掉线后不得执行",
    }));

    queuedTransport.throwOnSend = true;
    await broadcastSessionError(session.id, "模拟广播失败", "transport-test");
    releaseActive?.();
    await activeTurn;
    await awaitSessionTurnsSettled(session.id);

    expect(generateSessionReplyMock).toHaveBeenCalledTimes(1);
    const snapshot = await getSessionChatSnapshot(session.id);
    expect(snapshot?.messages.filter((message) => message.role === "user").map((message) => message.content))
      .toEqual(["保持执行"]);
  });

  it("does not broadcast a synthetic failed/idle terminal state when a detached transport races a stale message", async () => {
    const {
      createSession,
      attachSessionChatTransport,
      detachSessionChatTransport,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();
    const session = await createSession({ title: "断连消息竞态", agentId: "writer", sessionMode: "chat" });
    const detached = new MockTransport();
    const surviving = new MockTransport();
    await attachSessionChatTransport(session.id, detached);
    await attachSessionChatTransport(session.id, surviving);
    detached.sent.splice(0);
    surviving.sent.splice(0);
    detachSessionChatTransport(session.id, detached);

    await handleSessionChatTransportMessage(session.id, detached, JSON.stringify({
      type: "session:message", messageId: "stale-after-detach", content: "断连后迟到消息",
    }));

    expect(generateSessionReplyMock).not.toHaveBeenCalled();
    expect(surviving.sent.map((entry) => JSON.parse(entry))).not.toContainEqual(expect.objectContaining({
      type: "session:state",
      session: expect.objectContaining({ narratorState: "idle", completionReason: "failed" }),
    }));
  });

  it("does not mark a normally completed turn as interrupted", async () => {
    const { createSession, attachSessionChatTransport, handleSessionChatTransportMessage } = await loadSessionServices();
    const session = await createSession({ title: "正常结束", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();
    await attachSessionChatTransport(session.id, transport);

    await handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "normal-completion", content: "正常完成",
    }));

    const idleState = transport.sent
      .map((entry) => JSON.parse(entry))
      .filter((entry) => entry.type === "session:state" && entry.session?.narratorState === "idle")
      .at(-1);
    expect(idleState?.session).toMatchObject({
      narratorState: "idle",
      completionReason: "completed",
    });
    expect(idleState?.session?.substatus).not.toBe("interrupted");
  });

  it("Task17 review: broadcasts first-token timeout as typed failed completion instead of completed", async () => {
    sessionChatRuntimeConfig.firstTokenTimeout = 0.01;
    let providerSignal: AbortSignal | undefined;
    generateSessionReplyMock.mockImplementationOnce(async ({ signal }: { signal?: AbortSignal }) => {
      providerSignal = signal;
      await new Promise<void>((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      return {
        success: false,
        code: "user-aborted",
        error: "first token deadline reached",
        metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
      };
    });
    const { createSession, attachSessionChatTransport, handleSessionChatTransportMessage } = await loadSessionServices();
    const session = await createSession({ title: "首 token 超时", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();
    await attachSessionChatTransport(session.id, transport);
    transport.sent.splice(0);

    await handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "first-token-timeout", content: "等待首 token",
    }));

    expect(providerSignal?.aborted).toBe(true);
    const envelopes = transport.sent.map((entry) => JSON.parse(entry));
    const terminalState = envelopes
      .filter((entry) => entry.type === "session:state" && entry.session?.narratorState === "idle")
      .at(-1);
    expect(terminalState?.session).toMatchObject({
      narratorState: "idle",
      completionReason: "failed",
      failureReason: "timeout",
      recovery: { lastFailure: { reason: "timeout" } },
    });
    expect(envelopes.find((entry) => entry.type === "session:error")).toMatchObject({
      type: "session:error",
      code: "timeout",
    });
  });

  it("Task17 review: first stream chunk clears the first-token deadline", async () => {
    sessionChatRuntimeConfig.firstTokenTimeout = 0.01;
    let providerSignal: AbortSignal | undefined;
    generateSessionReplyMock.mockImplementationOnce(async ({
      signal,
      onStreamChunk,
    }: {
      signal?: AbortSignal;
      onStreamChunk?: (chunk: string) => void;
    }) => {
      providerSignal = signal;
      onStreamChunk?.("首 token");
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        success: true,
        content: "首 token 后继续完成",
        metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
      };
    });
    const { createSession, attachSessionChatTransport, handleSessionChatTransportMessage } = await loadSessionServices();
    const session = await createSession({ title: "首 token 后长响应", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();
    await attachSessionChatTransport(session.id, transport);
    transport.sent.splice(0);

    await handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "first-token-clears-timeout", content: "流式返回",
    }));

    expect(providerSignal?.aborted).toBe(false);
    const envelopes = transport.sent.map((entry) => JSON.parse(entry));
    expect(envelopes).toContainEqual(expect.objectContaining({
      type: "session:message",
      message: expect.objectContaining({ role: "assistant", content: "首 token 后继续完成" }),
    }));
    expect(envelopes
      .filter((entry) => entry.type === "session:state" && entry.session?.narratorState === "idle")
      .at(-1)?.session).toMatchObject({ completionReason: "completed" });
  });

  it("broadcasts aborted only after the provider has really settled", async () => {
    const providerSettlement = deferred<{
      success: false;
      code: string;
      error: string;
      metadata: { providerId: string; providerName: string; modelId: string };
    }>();
    let providerSignal: AbortSignal | undefined;
    generateSessionReplyMock.mockImplementationOnce(async ({ signal }: { signal?: AbortSignal }) => {
      providerSignal = signal;
      return providerSettlement.promise;
    });
    const { createSession, attachSessionChatTransport, handleSessionChatTransportMessage } = await loadSessionServices();
    const session = await createSession({ title: "真实中断终态", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();
    await attachSessionChatTransport(session.id, transport);
    transport.sent.splice(0);

    const activeTurn = handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "abort-completion", content: "等待真实终止",
    }));
    await waitForAssertion(() => expect(providerSignal).toBeInstanceOf(AbortSignal));
    await handleSessionChatTransportMessage(session.id, transport, JSON.stringify({ type: "session:abort" }));

    expect(transport.sent.map((entry) => JSON.parse(entry)).some((entry) =>
      entry.type === "session:state" && entry.session?.completionReason === "aborted",
    )).toBe(false);

    providerSettlement.resolve({
      success: false,
      code: "user-aborted",
      error: "aborted by test",
      metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
    });
    await activeTurn;

    const terminalState = transport.sent
      .map((entry) => JSON.parse(entry))
      .filter((entry) => entry.type === "session:state" && entry.session?.completionReason === "aborted")
      .at(-1);
    expect(terminalState?.session).toMatchObject({
      narratorState: "idle",
      substatus: "interrupted",
      completionReason: "aborted",
    });
  });

  it("broadcasts a typed failed completion for provider failure", async () => {
    generateSessionReplyMock.mockResolvedValueOnce({
      success: false,
      code: "provider-unavailable",
      error: "provider offline",
      metadata: { providerId: "anthropic", modelId: "claude-sonnet-4-6" },
    });
    const { createSession, attachSessionChatTransport, handleSessionChatTransportMessage } = await loadSessionServices();
    const session = await createSession({ title: "Provider 失败终态", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();
    await attachSessionChatTransport(session.id, transport);
    transport.sent.splice(0);

    await handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "provider-failure-state", content: "触发 provider failure",
    }));

    const terminalState = transport.sent
      .map((entry) => JSON.parse(entry))
      .filter((entry) => entry.type === "session:state" && entry.session?.completionReason === "failed")
      .at(-1);
    expect(terminalState?.session).toMatchObject({
      narratorState: "idle",
      completionReason: "failed",
      failureReason: "provider-unavailable",
      recovery: { lastFailure: { reason: "provider-unavailable" } },
    });
    expect(terminalState?.session?.substatus).not.toBe("interrupted");
  });

  it("broadcasts a typed failed completion when a tool throws", async () => {
    generateSessionReplyMock.mockResolvedValueOnce({
      success: true,
      type: "tool_use",
      toolUses: [{ id: "throwing-tool", name: "cockpit.snapshot", input: {} }],
      metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
    });
    executeSessionToolMock.mockRejectedValueOnce(new Error("tool exploded"));
    const { createSession, attachSessionChatTransport, handleSessionChatTransportMessage } = await loadSessionServices();
    const session = await createSession({ title: "工具失败终态", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();
    await attachSessionChatTransport(session.id, transport);
    transport.sent.splice(0);

    await handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "tool-failure-state", content: "触发 tool failure",
    }));

    const terminalState = transport.sent
      .map((entry) => JSON.parse(entry))
      .filter((entry) => entry.type === "session:state" && entry.session?.completionReason === "failed")
      .at(-1);
    expect(terminalState?.session).toMatchObject({
      narratorState: "idle",
      completionReason: "failed",
      failureReason: "tool-execution-error",
      recovery: { lastFailure: { reason: "tool-execution-error" } },
    });
    expect(generateSessionReplyMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a stop-timeout turn in stopping instead of broadcasting idle", async () => {
    generateSessionReplyMock.mockResolvedValueOnce({
      success: true,
      type: "tool_use",
      toolUses: [{ id: "stuck-bash", name: "Bash", input: { command: "fake-stuck-process" } }],
      metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
    });
    executeSessionToolMock.mockResolvedValueOnce({
      ok: false,
      error: "stop-timeout",
      summary: "进程树尚未退出",
      data: { status: "stopping" },
    });
    const { createSession, attachSessionChatTransport, handleSessionChatTransportMessage } = await loadSessionServices();
    const session = await createSession({ title: "停止超时终态", agentId: "writer", sessionMode: "chat" });
    const transport = new MockTransport();
    await attachSessionChatTransport(session.id, transport);
    transport.sent.splice(0);

    await handleSessionChatTransportMessage(session.id, transport, JSON.stringify({
      type: "session:message", messageId: "stop-timeout-state", content: "触发 stop timeout",
    }));

    const states = transport.sent
      .map((entry) => JSON.parse(entry))
      .filter((entry) => entry.type === "session:state");
    expect(states.some((entry) => entry.session?.narratorState === "idle")).toBe(false);
    expect(states.at(-1)?.session).toMatchObject({
      narratorState: "working",
      substatus: "stopping",
      completionReason: "stopping",
      failureReason: "stop-timeout",
      recovery: { lastFailure: { reason: "stop-timeout" } },
    });
    expect(generateSessionReplyMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a real stopping settlement leased across transport disconnect before draining a surviving queued turn", async () => {
    const runtimeSettled = deferred();
    generateSessionReplyMock
      .mockResolvedValueOnce({
        success: true,
        type: "tool_use",
        toolUses: [{ id: "stuck-bash-disconnect", name: "Bash", input: { command: "fake-stuck-process" } }],
        metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
      })
      .mockResolvedValueOnce({
        success: true,
        content: "后续 turn 已安全启动",
        metadata: { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6" },
      });
    executeSessionToolMock.mockResolvedValueOnce(attachRuntimeSettlement({
      ok: false,
      error: "stop-timeout",
      summary: "进程树尚未退出",
      data: { status: "stopping" },
    }, runtimeSettled.promise));
    const {
      createSession,
      attachSessionChatTransport,
      detachSessionChatTransport,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();
    const session = await createSession({ title: "停止超时断连竞态", agentId: "writer", sessionMode: "chat" });
    const disconnected = new MockTransport();
    const surviving = new MockTransport();
    await attachSessionChatTransport(session.id, disconnected);
    await attachSessionChatTransport(session.id, surviving);

    await handleSessionChatTransportMessage(session.id, disconnected, JSON.stringify({
      type: "session:message", messageId: "stopping-before-disconnect", content: "触发真实 stopping",
    }));
    detachSessionChatTransport(session.id, disconnected);
    await handleSessionChatTransportMessage(session.id, surviving, JSON.stringify({
      type: "session:message", messageId: "queued-after-disconnect", content: "排队等待",
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(generateSessionReplyMock).toHaveBeenCalledTimes(1);

    runtimeSettled.resolve();
    await waitForAssertion(() => expect(generateSessionReplyMock).toHaveBeenCalledTimes(2));
    expect(surviving.sent.map((entry) => JSON.parse(entry)).some((entry) => entry.message?.content === "后续 turn 已安全启动")).toBe(true);
  });

  it("accumulates usage across tool-use turns within a single conversation round", async () => {
    const toolCallUsage = { input_tokens: 150, output_tokens: 30 };
    const finalUsage = { input_tokens: 200, output_tokens: 100 };
    const runtimeMetadata = { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6", usage: toolCallUsage };
    const finalMetadata = { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-6", usage: finalUsage };
    generateSessionReplyMock
      .mockResolvedValueOnce({
        success: true,
        type: "tool_use",
        toolUses: [
          { id: "tool-usage-1", name: "cockpit.get_snapshot", input: { bookId: "book-1" } },
        ],
        metadata: runtimeMetadata,
      })
      .mockResolvedValueOnce({
        success: true,
        type: "message",
        content: "工具调用后的回复。",
        metadata: finalMetadata,
      });
    const {
      createSession,
      attachSessionChatTransport,
      getSessionChatSnapshot,
      handleSessionChatTransportMessage,
    } = await loadSessionServices();
    const session = await createSession({
      title: "工具用量会话",
      agentId: "writer",
      sessionMode: "chat",
    });
    const transport = new MockTransport();

    expect(await attachSessionChatTransport(session.id, transport)).toBe(true);

    await handleSessionChatTransportMessage(
      session.id,
      transport,
      JSON.stringify({ type: "session:message", messageId: "tool-usage-msg", content: "查看驾驶舱", sessionMode: "chat" }),
    );

    const snapshot = await getSessionChatSnapshot(session.id);

    // Only the final assistant_message event accumulates usage (tool_call and tool_result don't)
    const finalAssistant = snapshot?.messages.find((m) => m.role === "assistant" && m.content === "工具调用后的回复。");
    expect(finalAssistant?.metadata?.usage).toEqual(finalUsage);

    expect(snapshot?.session.cumulativeUsage).toMatchObject({
      totalInputTokens: 350,
      totalOutputTokens: 130,
      totalCacheCreationInputTokens: 0,
      totalCacheReadInputTokens: 0,
      turnCount: 2,
    });
  });
});
