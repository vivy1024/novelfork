import { describe, expect, it } from "vitest";

import type { NarratorSessionChatMessage } from "../../../shared/session-types.js";
import {
  buildSessionRecoveryMetadata,
  createSessionChatCursor,
  normalizeSessionMessages,
} from "./recovery.js";

describe("session-runtime recovery", () => {
  it("normalizes persisted messages into a monotonic seq stream", () => {
    const messages = normalizeSessionMessages([
      { id: "old-seq", role: "user", content: "旧序号会被前移", timestamp: "2026-05-05T00:00:00.000Z" as unknown as number, seq: 1 },
      { id: "kept-seq", role: "assistant", content: "显式较大序号保留", timestamp: 1777939201000, seq: 10 },
      { id: "next-seq", role: "user", content: "缺省序号接续", timestamp: "invalid" as unknown as number },
    ], 5);

    expect(messages.map((message) => ({ id: message.id, seq: message.seq }))).toEqual([
      { id: "old-seq", seq: 3 },
      { id: "kept-seq", seq: 10 },
      { id: "next-seq", seq: 11 },
    ]);
    expect(messages[0]?.timestamp).toBe(1777939200000);
    expect(typeof messages[2]?.timestamp).toBe("number");
  });

  it("creates cursors that clamp acked seq to the server-authoritative last seq", () => {
    const messages: NarratorSessionChatMessage[] = [
      { id: "message-1", role: "user", content: "一", timestamp: 1777939200000, seq: 1 },
      { id: "message-2", role: "assistant", content: "二", timestamp: 1777939200001, seq: 2 },
    ];

    expect(createSessionChatCursor({ messageCount: 2, messages, persistedAckedSeq: 99 })).toEqual({
      lastSeq: 2,
      ackedSeq: 2,
    });
    expect(createSessionChatCursor({ messageCount: 9, messages, persistedAckedSeq: -1 }, 4)).toEqual({
      lastSeq: 9,
      ackedSeq: 4,
    });
  });

  it("builds deterministic recovery metadata for pending replay and failure state", () => {
    const messages: NarratorSessionChatMessage[] = [
      { id: "acked", role: "user", content: "已确认", timestamp: 1777939200000, seq: 4 },
      {
        id: "pending-tools",
        role: "assistant",
        content: "等待工具",
        timestamp: 1777939200001,
        seq: 6,
        toolCalls: [
          { id: "tool-1", toolName: "guided.exit", status: "pending" },
          { id: "tool-2", toolName: "candidate.create_chapter", status: "running" },
          { id: "tool-3", toolName: "cockpit.get_snapshot", status: "success" },
        ],
      },
      { id: "pending-message", role: "assistant", content: "未确认", timestamp: 1777939200002, seq: 7 },
    ];

    const failure = {
      reason: "provider-unavailable",
      message: "上游暂不可用",
      at: "2026-05-05T00:00:03.000Z",
    };

    expect(buildSessionRecoveryMetadata(
      { messageCount: 7, messages, persistedAckedSeq: 5, availableFromSeq: 2 },
      messages,
      failure,
      { now: () => "2026-05-05T00:00:04.000Z" },
    )).toEqual({
      lastSeq: 7,
      lastAckedSeq: 5,
      availableFromSeq: 2,
      pendingMessageCount: 2,
      pendingToolCallCount: 2,
      pendingToolCallSummary: ["guided.exit:pending", "candidate.create_chapter:running"],
      lastFailure: failure,
      updatedAt: "2026-05-05T00:00:04.000Z",
    });
  });
});
