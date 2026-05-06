import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { normalizeCapability, type ContractResult } from "../../backend-contract";
import { useAgentConversationRuntime } from "./useAgentConversationRuntime";
import type { NarratorSessionChatMessage, NarratorSessionChatSnapshot, NarratorSessionRecord } from "../../../shared/session-types";

function ok<T>(data: T): ContractResult<T> {
  return {
    ok: true,
    data,
    raw: data,
    httpStatus: 200,
    capability: normalizeCapability({ id: "sessions.chat.state", status: "current" }),
  };
}

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
    sessionConfig: { providerId: "sub2api", modelId: "gpt-5.4", permissionMode: "edit", reasoningEffort: "medium" },
    ...overrides,
  };
}

function makeMessage(overrides: Partial<NarratorSessionChatMessage> = {}): NarratorSessionChatMessage {
  return {
    id: "message-1",
    role: "assistant",
    content: "快照消息",
    timestamp: 1_775_000_000_000,
    ...overrides,
  };
}

function makeSnapshot(): NarratorSessionChatSnapshot {
  return {
    session: makeSession({ messageCount: 1 }),
    messages: [makeMessage({ id: "message-1", seq: 7 })],
    cursor: { lastSeq: 7, ackedSeq: 6 },
  };
}

class FakeRuntimeSocket {
  readonly sent: string[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(readonly url: string) {}

  send(payload: string) {
    this.sent.push(payload);
  }

  close = vi.fn();

  emit(envelope: unknown) {
    this.onmessage?.({ data: JSON.stringify(envelope) });
  }
}

class ConnectingRuntimeSocket {
  readonly sent: string[] = [];
  readyState = 0;
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;

  constructor(readonly url: string) {}

  send(payload: string) {
    if (this.readyState !== 1) {
      throw new DOMException("Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.", "InvalidStateError");
    }
    this.sent.push(payload);
  }

  close = vi.fn();

  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

describe("useAgentConversationRuntime", () => {
  it("hydrates snapshot, opens WebSocket with resumeFromSeq, and sends acked client envelopes", async () => {
    const sockets: FakeRuntimeSocket[] = [];
    const createWebSocket = vi.fn((url: string) => {
      const socket = new FakeRuntimeSocket(url);
      sockets.push(socket);
      return socket;
    });
    const getChatState = vi.fn(async () => ok(makeSnapshot()));
    const createMessageId = vi.fn(() => "client-message-1");

    const { result } = renderHook(() =>
      useAgentConversationRuntime({
        sessionId: "session-1",
        sessionMode: "chat",
        canvasContext: { activeTabId: "tab-1", dirty: true },
        baseUrl: "http://localhost:4567/studio",
        client: { getChatState },
        createWebSocket,
        createMessageId,
      }),
    );

    await waitFor(() => expect(result.current.state.session?.id).toBe("session-1"));
    expect(getChatState).toHaveBeenCalledWith("session-1");
    expect(createWebSocket).toHaveBeenCalledWith("ws://localhost:4567/api/sessions/session-1/chat?resumeFromSeq=7");

    act(() => {
      sockets[0]?.emit({
        type: "session:message",
        sessionId: "session-1",
        message: makeMessage({ id: "message-2", content: "增量消息", seq: 8 }),
        cursor: { lastSeq: 8, ackedSeq: 7 },
      });
    });
    expect(result.current.state.messages.map((message) => message.content)).toEqual(["快照消息", "增量消息"]);

    act(() => result.current.sendMessage("继续写"));
    act(() => result.current.abort());

    expect(sockets[0]?.sent.map((payload) => JSON.parse(payload))).toEqual([
      {
        type: "session:message",
        sessionId: "session-1",
        messageId: "client-message-1",
        content: "继续写",
        sessionMode: "chat",
        ack: 8,
        canvasContext: { activeTabId: "tab-1", dirty: true },
      },
      { type: "session:abort", sessionId: "session-1" },
    ]);
  });

  it("queues ack envelopes until the WebSocket opens", async () => {
    const sockets: ConnectingRuntimeSocket[] = [];
    const createWebSocket = vi.fn((url: string) => {
      const socket = new ConnectingRuntimeSocket(url);
      sockets.push(socket);
      return socket;
    });
    const getChatState = vi.fn(async () => ok(makeSnapshot()));

    const { result } = renderHook(() =>
      useAgentConversationRuntime({
        sessionId: "session-1",
        client: { getChatState },
        createWebSocket,
      }),
    );

    await waitFor(() => expect(result.current.state.session?.id).toBe("session-1"));

    expect(() => act(() => result.current.ack(7))).not.toThrow();
    expect(sockets[0]?.sent).toEqual([]);

    act(() => sockets[0]?.open());

    expect(sockets[0]?.sent.map((payload) => JSON.parse(payload))).toEqual([
      { type: "session:ack", sessionId: "session-1", ack: 7 },
    ]);
  });
});
