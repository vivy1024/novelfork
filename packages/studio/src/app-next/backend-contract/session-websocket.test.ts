import { describe, expect, it } from "vitest";

import {
  applySessionWebSocketHistory,
  buildSessionAbortEnvelope,
  buildSessionAckEnvelope,
  buildSessionMessageEnvelope,
  buildSessionWebSocketUrl,
  createInitialSessionWebSocketState,
  getSessionResumeFromSeq,
  parseSessionServerEnvelope,
  reduceSessionServerEnvelope,
} from "./session-client";
import type {
  NarratorSessionChatHistory,
  NarratorSessionChatMessage,
  NarratorSessionChatSnapshot,
  NarratorSessionRecord,
} from "../../shared/session-types";

function makeSession(overrides: Partial<NarratorSessionRecord> = {}): NarratorSessionRecord {
  return {
    id: "session-1",
    title: "叙述者会话",
    agentId: "writer",
    kind: "standalone",
    sessionMode: "chat",
    status: "active",
    createdAt: "2026-05-04T00:00:00.000Z",
    lastModified: "2026-05-04T00:00:00.000Z",
    messageCount: 0,
    sortOrder: 0,
    sessionConfig: {
      providerId: "provider-a",
      modelId: "model-a",
      permissionMode: "edit",
      reasoningEffort: "medium",
    },
    ...overrides,
  };
}

function makeMessage(overrides: Partial<NarratorSessionChatMessage> = {}): NarratorSessionChatMessage {
  return {
    id: "message-1",
    role: "assistant",
    content: "正文",
    timestamp: 1_775_000_000_000,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<NarratorSessionChatSnapshot> = {}): NarratorSessionChatSnapshot {
  const messages = overrides.messages ?? [makeMessage({ id: "message-1", content: "已恢复", seq: 1 })];
  return {
    session: makeSession({ messageCount: messages.length }),
    messages,
    cursor: { lastSeq: 1, ackedSeq: 0 },
    ...overrides,
  };
}

describe("session WebSocket contract helper", () => {
  it("builds encoded WebSocket URLs with resumeFromSeq query", () => {
    expect(buildSessionWebSocketUrl("session/1", { baseUrl: "http://localhost:4567/studio", resumeFromSeq: 9 })).toBe(
      "ws://localhost:4567/api/sessions/session%2F1/chat?resumeFromSeq=9",
    );
    expect(buildSessionWebSocketUrl("s 2", { baseUrl: "https://novelfork.local", resumeFromSeq: 0 })).toBe(
      "wss://novelfork.local/api/sessions/s%202/chat",
    );
  });

  it("builds typed message, ack, and abort client envelopes", () => {
    expect(buildSessionMessageEnvelope({
      sessionId: "session-1",
      messageId: "message-1",
      content: "继续写",
      sessionMode: "chat",
      ack: 9,
      canvasContext: {
        activeTabId: "tab-1",
        activeResource: { kind: "chapter", id: "chapter-1", title: "第一章" },
        dirty: true,
      },
    })).toEqual({
      type: "session:message",
      sessionId: "session-1",
      messageId: "message-1",
      content: "继续写",
      sessionMode: "chat",
      ack: 9,
      canvasContext: {
        activeTabId: "tab-1",
        activeResource: { kind: "chapter", id: "chapter-1", title: "第一章" },
        dirty: true,
      },
    });
    expect(buildSessionAckEnvelope({ sessionId: "session-1", ack: 12 })).toEqual({
      type: "session:ack",
      sessionId: "session-1",
      ack: 12,
    });
    expect(buildSessionAbortEnvelope({ sessionId: "session-1" })).toEqual({
      type: "session:abort",
      sessionId: "session-1",
    });
  });

  it("parses server envelopes without dropping snapshot, stream, state, or error semantics", () => {
    const snapshot = makeSnapshot({ messages: [makeMessage({ seq: 7, content: "快照" })], cursor: { lastSeq: 7, ackedSeq: 5 } });

    expect(parseSessionServerEnvelope(JSON.stringify({
      type: "session:snapshot",
      snapshot,
      recovery: { state: "idle", reason: "initial-hydration" },
    }))).toEqual({
      type: "session:snapshot",
      snapshot,
      recovery: { state: "idle", reason: "initial-hydration" },
    });
    expect(parseSessionServerEnvelope(JSON.stringify({ type: "session:stream", sessionId: "session-1", content: "片段" }))).toEqual({
      type: "session:stream",
      sessionId: "session-1",
      content: "片段",
    });
    expect(parseSessionServerEnvelope(JSON.stringify({ type: "session:error", sessionId: "session-1", error: "模型失败", code: "model-unavailable", runtime: { providerId: "p1" } }))).toEqual({
      type: "session:error",
      sessionId: "session-1",
      error: "模型失败",
      code: "model-unavailable",
      runtime: { providerId: "p1" },
    });
  });

  it("hydrates snapshot, accumulates stream chunks, and tracks resume seq", () => {
    const hydrated = reduceSessionServerEnvelope(createInitialSessionWebSocketState(), {
      type: "session:snapshot",
      snapshot: makeSnapshot({ messages: [makeMessage({ id: "message-1", content: "快照", seq: 7 })], cursor: { lastSeq: 7, ackedSeq: 5 } }),
      recovery: { state: "idle", reason: "initial-hydration" },
    });
    const streamed = reduceSessionServerEnvelope(hydrated, { type: "session:stream", sessionId: "session-1", content: "第一个" });
    const nextStreamed = reduceSessionServerEnvelope(streamed, { type: "session:stream", sessionId: "session-1", content: "片段" });
    const errored = reduceSessionServerEnvelope(nextStreamed, { type: "session:error", sessionId: "session-1", error: "模型失败", code: "provider_failed" });

    expect(hydrated.messages.map((message) => message.content)).toEqual(["快照"]);
    expect(hydrated.cursor).toEqual({ lastSeq: 7, ackedSeq: 5 });
    expect(getSessionResumeFromSeq(hydrated)).toBe(7);
    expect(nextStreamed.messages.at(-1)).toMatchObject({ role: "assistant", content: "第一个片段" });
    expect(errored.error).toEqual({ message: "模型失败", code: "provider_failed", runtime: undefined });
    expect(errored.recovery).toEqual({ state: "failed", reason: "websocket-error" });
  });

  it("applies replay history and marks resetRequired gaps without fabricating messages", () => {
    const hydrated = reduceSessionServerEnvelope(createInitialSessionWebSocketState(), {
      type: "session:snapshot",
      snapshot: makeSnapshot({ messages: [makeMessage({ id: "message-1", seq: 1 })], cursor: { lastSeq: 1 } }),
    });
    const replayed = applySessionWebSocketHistory(hydrated, {
      sessionId: "session-1",
      sinceSeq: 1,
      availableFromSeq: 1,
      resetRequired: false,
      messages: [makeMessage({ id: "message-2", content: "回放", seq: 2 })],
      cursor: { lastSeq: 2 },
    } satisfies NarratorSessionChatHistory);
    const resetRequired = applySessionWebSocketHistory(replayed, {
      sessionId: "session-1",
      sinceSeq: 2,
      availableFromSeq: 6,
      resetRequired: true,
      messages: [makeMessage({ id: "message-ignored", content: "不应合并", seq: 7 })],
      cursor: { lastSeq: 7 },
    } satisfies NarratorSessionChatHistory);

    expect(replayed.messages.map((message) => message.id)).toEqual(["message-1", "message-2"]);
    expect(resetRequired.resetRequired).toBe(true);
    expect(resetRequired.recovery).toEqual({ state: "resetting", reason: "history-gap" });
    expect(resetRequired.messages.map((message) => message.id)).toEqual(["message-1", "message-2"]);
  });
});
