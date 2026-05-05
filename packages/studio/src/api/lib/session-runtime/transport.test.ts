import { describe, expect, it, vi } from "vitest";

import type { NarratorSessionChatServerEnvelope } from "../../../shared/session-types.js";
import {
  normalizeSessionTransportPayload,
  parseSessionClientMessage,
  sendSessionEnvelope,
  serializeSessionEnvelope,
} from "./transport.js";

function snapshotEnvelope(): NarratorSessionChatServerEnvelope {
  return {
    type: "session:snapshot",
    snapshot: {
      session: {
        id: "session-1",
        title: "叙述者会话",
        agentId: "writer",
        kind: "standalone",
        sessionMode: "chat",
        status: "active",
        createdAt: "2026-05-05T00:00:00.000Z",
        lastModified: "2026-05-05T00:00:01.000Z",
        messageCount: 1,
        sortOrder: 0,
        sessionConfig: {
          providerId: "anthropic",
          modelId: "claude-sonnet-4-6",
          permissionMode: "ask",
          reasoningEffort: "medium",
        },
        recovery: {
          lastSeq: 1,
          lastAckedSeq: 0,
          availableFromSeq: 1,
          pendingMessageCount: 1,
          pendingToolCallCount: 0,
          updatedAt: "2026-05-05T00:00:02.000Z",
        },
      },
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "继续写下一章",
          timestamp: 1777939200000,
          seq: 1,
        },
      ],
      cursor: {
        lastSeq: 1,
        ackedSeq: 0,
      },
    },
    recovery: {
      state: "idle",
      reason: "initial-hydration",
    },
  };
}

describe("session-runtime transport", () => {
  it("serializes WebSocket envelopes without changing the public contract", () => {
    expect(serializeSessionEnvelope(snapshotEnvelope())).toBe("{\"type\":\"session:snapshot\",\"snapshot\":{\"session\":{\"id\":\"session-1\",\"title\":\"叙述者会话\",\"agentId\":\"writer\",\"kind\":\"standalone\",\"sessionMode\":\"chat\",\"status\":\"active\",\"createdAt\":\"2026-05-05T00:00:00.000Z\",\"lastModified\":\"2026-05-05T00:00:01.000Z\",\"messageCount\":1,\"sortOrder\":0,\"sessionConfig\":{\"providerId\":\"anthropic\",\"modelId\":\"claude-sonnet-4-6\",\"permissionMode\":\"ask\",\"reasoningEffort\":\"medium\"},\"recovery\":{\"lastSeq\":1,\"lastAckedSeq\":0,\"availableFromSeq\":1,\"pendingMessageCount\":1,\"pendingToolCallCount\":0,\"updatedAt\":\"2026-05-05T00:00:02.000Z\"}},\"messages\":[{\"id\":\"message-1\",\"role\":\"user\",\"content\":\"继续写下一章\",\"timestamp\":1777939200000,\"seq\":1}],\"cursor\":{\"lastSeq\":1,\"ackedSeq\":0}},\"recovery\":{\"state\":\"idle\",\"reason\":\"initial-hydration\"}}");
  });

  it("returns false instead of throwing when a transport rejects an envelope", () => {
    const failingTransport = {
      send: vi.fn(() => {
        throw new Error("socket closed");
      }),
      close: vi.fn(),
    };

    expect(sendSessionEnvelope(failingTransport, {
      type: "session:error",
      sessionId: "session-1",
      error: "Session not found",
      code: "not-found",
    })).toBe(false);
    expect(failingTransport.send).toHaveBeenCalledWith("{\"type\":\"session:error\",\"sessionId\":\"session-1\",\"error\":\"Session not found\",\"code\":\"not-found\"}");
  });

  it("normalizes transport payloads and preserves ack/abort/message client envelopes", async () => {
    expect(await normalizeSessionTransportPayload(new Uint8Array(Buffer.from("二进制消息")))).toBe("二进制消息");
    expect(await normalizeSessionTransportPayload(null)).toBeNull();

    expect(parseSessionClientMessage("{\"type\":\"session:ack\",\"sessionId\":\"session-1\",\"ack\":\"004\"}")).toEqual({
      type: "session:ack",
      sessionId: "session-1",
      ack: 4,
    });
    expect(parseSessionClientMessage("{\"type\":\"session:abort\",\"sessionId\":\"session-1\"}")).toEqual({
      type: "session:abort",
      sessionId: "session-1",
    });
    expect(parseSessionClientMessage("{\"type\":\"session:message\",\"messageId\":\"message-2\",\"content\":\"  继续  \",\"ack\":3}")).toMatchObject({
      type: "session:message",
      messageId: "message-2",
      content: "  继续  ",
      ack: 3,
    });
    expect(parseSessionClientMessage("\"纯文本消息\"")).toEqual({ content: "纯文本消息" });
    expect(parseSessionClientMessage("不是 JSON 也按正文处理")).toEqual({ content: "不是 JSON 也按正文处理" });
  });
});
