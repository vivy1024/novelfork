import { describe, expect, it } from "vitest";

import { buildAbortEnvelope, buildAckEnvelope, buildMessageEnvelope } from "./session-actions";
import {
  applySessionHistory,
  createInitialAgentConversationRuntimeState,
  getResumeFromSeq,
  reduceSessionEnvelope,
} from "./ws-envelope-reducer";
import { appendStreamChunk, mergeSessionMessages, normalizeSessionMessage } from "./message-transforms";
import type {
  NarratorSessionChatHistory,
  NarratorSessionChatMessage,
  NarratorSessionChatSnapshot,
  NarratorSessionRecord,
} from "../../../shared/session-types";

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

describe("ws-envelope-reducer", () => {
  it("hydrates snapshot and tracks resume seq from cursor", () => {
    const state = reduceSessionEnvelope(createInitialAgentConversationRuntimeState(), {
      type: "session:snapshot",
      snapshot: makeSnapshot({
        messages: [makeMessage({ id: "message-1", content: "快照消息", seq: 7 })],
        cursor: { lastSeq: 7, ackedSeq: 5 },
      }),
      recovery: { state: "idle", reason: "initial-hydration" },
    });

    expect(state.session?.id).toBe("session-1");
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.content).toBe("快照消息");
    expect(state.cursor).toEqual({ lastSeq: 7, ackedSeq: 5 });
    expect(state.lastSeq).toBe(7);
    expect(getResumeFromSeq(state)).toBe(7);
    expect(state.recovery).toEqual({ state: "idle", reason: "initial-hydration" });
  });

  it("updates session state without dropping existing messages", () => {
    const hydrated = reduceSessionEnvelope(createInitialAgentConversationRuntimeState(), {
      type: "session:snapshot",
      snapshot: makeSnapshot(),
    });

    const state = reduceSessionEnvelope(hydrated, {
      type: "session:state",
      session: makeSession({ title: "新标题", messageCount: 9 }),
      cursor: { lastSeq: 9, ackedSeq: 8 },
      recovery: { state: "replaying", reason: "reconnect" },
    });

    expect(state.session?.title).toBe("新标题");
    expect(state.messages).toHaveLength(1);
    expect(state.cursor).toEqual({ lastSeq: 9, ackedSeq: 8 });
    expect(state.lastSeq).toBe(9);
    expect(state.recovery.state).toBe("replaying");
  });

  it("appends new messages and ignores duplicate replayed messages", () => {
    const initial = reduceSessionEnvelope(createInitialAgentConversationRuntimeState(), {
      type: "session:snapshot",
      snapshot: makeSnapshot({ messages: [], cursor: { lastSeq: 0 } }),
    });

    const appended = reduceSessionEnvelope(initial, {
      type: "session:message",
      sessionId: "session-1",
      message: makeMessage({ id: "message-2", content: "新增", seq: 2 }),
      cursor: { lastSeq: 2 },
    });
    const replayed = reduceSessionEnvelope(appended, {
      type: "session:message",
      sessionId: "session-1",
      message: makeMessage({ id: "message-2", content: "重复", seq: 2 }),
      cursor: { lastSeq: 2 },
    });

    expect(appended.messages.map((message) => message.content)).toEqual(["新增"]);
    expect(appended.session?.messageCount).toBe(1);
    expect(replayed.messages.map((message) => message.content)).toEqual(["新增"]);
  });

  it("accumulates stream chunks into a transient assistant message", () => {
    const first = reduceSessionEnvelope(createInitialAgentConversationRuntimeState(), {
      type: "session:stream",
      sessionId: "session-1",
      content: "第一个",
    });
    const second = reduceSessionEnvelope(first, {
      type: "session:stream",
      sessionId: "session-1",
      content: "片段",
    });

    expect(second.messages).toHaveLength(1);
    expect(second.messages[0]?.role).toBe("assistant");
    expect(second.messages[0]?.content).toBe("第一个片段");
    expect(second.streamingMessageId).toBe(second.messages[0]?.id);
  });

  it("records server errors and moves recovery to failed", () => {
    const state = reduceSessionEnvelope(createInitialAgentConversationRuntimeState(), {
      type: "session:error",
      sessionId: "session-1",
      error: "模型调用失败",
      code: "provider_failed",
      runtime: { providerId: "provider-a" },
    });

    expect(state.error).toEqual({ message: "模型调用失败", code: "provider_failed", runtime: { providerId: "provider-a" } });
    expect(state.recovery).toEqual({ state: "failed", reason: "websocket-error" });
  });

  it("applies replay history and marks resetRequired gaps without fabricating messages", () => {
    const hydrated = reduceSessionEnvelope(createInitialAgentConversationRuntimeState(), {
      type: "session:snapshot",
      snapshot: makeSnapshot({
        messages: [makeMessage({ id: "message-1", seq: 1 })],
        cursor: { lastSeq: 1 },
      }),
    });
    const replayed = applySessionHistory(hydrated, {
      sessionId: "session-1",
      sinceSeq: 1,
      availableFromSeq: 1,
      resetRequired: false,
      messages: [makeMessage({ id: "message-2", content: "回放", seq: 2 })],
      cursor: { lastSeq: 2 },
    } satisfies NarratorSessionChatHistory);
    const resetRequired = applySessionHistory(replayed, {
      sessionId: "session-1",
      sinceSeq: 2,
      availableFromSeq: 6,
      resetRequired: true,
      messages: [makeMessage({ id: "message-ignored", content: "不应合并", seq: 7 })],
      cursor: { lastSeq: 7 },
    } satisfies NarratorSessionChatHistory);

    expect(replayed.messages.map((message) => message.id)).toEqual(["message-1", "message-2"]);
    expect(replayed.recovery.state).toBe("idle");
    expect(resetRequired.resetRequired).toBe(true);
    expect(resetRequired.recovery).toEqual({ state: "resetting", reason: "history-gap" });
    expect(resetRequired.messages.map((message) => message.id)).toEqual(["message-1", "message-2"]);
  });
});

describe("session-actions", () => {
  it("builds message envelopes with ack and canvasContext", () => {
    expect(buildMessageEnvelope({
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
  });

  it("builds ack and abort envelopes", () => {
    expect(buildAckEnvelope({ sessionId: "session-1", ack: 12 })).toEqual({
      type: "session:ack",
      sessionId: "session-1",
      ack: 12,
    });
    expect(buildAbortEnvelope({ sessionId: "session-1" })).toEqual({
      type: "session:abort",
      sessionId: "session-1",
    });
  });
});

describe("message-transforms", () => {
  it("normalizes messages, tool calls, streams, and replay merges", () => {
    const normalized = normalizeSessionMessage(makeMessage({
      id: "message-1",
      content: "工具结果",
      toolCalls: [{ toolName: "write_file", input: { path: "a.txt" }, result: { allowed: true } }],
      runtime: { providerId: "provider-a", modelId: "model-a" },
    }));
    const streamed = appendStreamChunk([], "session-1", "片段", 123);
    const merged = mergeSessionMessages([normalized], [
      makeMessage({ id: "message-1", content: "重复" }),
      makeMessage({ id: "message-2", content: "新增" }),
    ]);

    expect(normalized.runtime).toBeUndefined();
    expect(normalized.toolCalls?.[0]).toMatchObject({ toolName: "write_file", allowed: true });
    expect(streamed.messages[0]?.content).toBe("片段");
    expect(merged.map((message) => message.id)).toEqual(["message-1", "message-2"]);
  });
});
