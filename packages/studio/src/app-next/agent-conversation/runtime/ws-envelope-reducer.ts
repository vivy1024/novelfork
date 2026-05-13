import type {
  NarratorSessionChatCursor,
  NarratorSessionChatHistory,
  NarratorSessionChatMessage,
  NarratorSessionChatSnapshot,
  NarratorSessionRecord,
} from "../../../shared/session-types";

import { appendStreamChunk, mergeSessionMessages, normalizeSessionMessage } from "./message-transforms";

export interface AgentConversationRuntimeState {
  session: NarratorSessionRecord | null;
  messages: NarratorSessionChatMessage[];
  cursor: NarratorSessionChatCursor | null;
  lastSeq: number;
  streamingMessageId: string | null;
  error: { message: string; code?: string; runtime?: unknown } | null;
  recovery: { state: string; reason?: string };
  resetRequired: boolean;
  /** Set to true when user sends a message, cleared on first server response */
  waitingForResponse: boolean;
}

export type SessionServerEnvelope =
  | { type: "session:snapshot"; snapshot: NarratorSessionChatSnapshot; cursor?: NarratorSessionChatCursor; recovery?: AgentConversationRuntimeState["recovery"] }
  | { type: "session:state"; session: NarratorSessionRecord; cursor?: NarratorSessionChatCursor; recovery?: AgentConversationRuntimeState["recovery"] }
  | { type: "session:message"; sessionId: string; message: NarratorSessionChatMessage; cursor?: NarratorSessionChatCursor }
  | { type: "session:stream"; sessionId: string; content: string; timestamp?: number }
  | { type: "session:tool-stream"; sessionId: string; toolCallId: string; content: string }
  | { type: "session:error"; sessionId?: string; error: string; code?: string; runtime?: unknown }
  | { type: "client:message-sent" };

export function createInitialAgentConversationRuntimeState(): AgentConversationRuntimeState {
  return {
    session: null,
    messages: [],
    cursor: null,
    lastSeq: 0,
    streamingMessageId: null,
    error: null,
    recovery: { state: "idle" },
    resetRequired: false,
    waitingForResponse: false,
  };
}

function lastSeqFrom(cursor: NarratorSessionChatCursor | null | undefined, messages: readonly NarratorSessionChatMessage[], fallback: number): number {
  return cursor?.lastSeq ?? Math.max(fallback, ...messages.map((message) => message.seq ?? 0));
}

export function reduceSessionEnvelope(
  state: AgentConversationRuntimeState,
  envelope: SessionServerEnvelope,
): AgentConversationRuntimeState {
  switch (envelope.type) {
    case "session:snapshot": {
      const cursor = envelope.cursor ?? envelope.snapshot.cursor ?? null;
      const messages = envelope.snapshot.messages.map(normalizeSessionMessage);
      return {
        ...state,
        session: envelope.snapshot.session,
        messages,
        cursor,
        lastSeq: lastSeqFrom(cursor, messages, state.lastSeq),
        streamingMessageId: null,
        error: null,
        recovery: envelope.recovery ?? state.recovery,
        resetRequired: false,
      };
    }
    case "session:state": {
      const cursor = envelope.cursor ?? state.cursor;
      return {
        ...state,
        session: envelope.session,
        cursor,
        lastSeq: lastSeqFrom(cursor, state.messages, state.lastSeq),
        recovery: envelope.recovery ?? state.recovery,
      };
    }
    case "session:message": {
      // Remove streaming message before merging (it's replaced by the final message)
      const baseMessages = state.streamingMessageId
        ? state.messages.filter((m) => m.id !== state.streamingMessageId)
        : state.messages;
      const nextMessages = mergeSessionMessages(baseMessages, [envelope.message]);
      const cursor = envelope.cursor ?? state.cursor;
      return {
        ...state,
        messages: nextMessages,
        session: state.session ? { ...state.session, messageCount: nextMessages.length } : state.session,
        cursor,
        lastSeq: lastSeqFrom(cursor, nextMessages, state.lastSeq),
        streamingMessageId: null,
        waitingForResponse: false,
      };
    }
    case "session:stream": {
      // Streaming chunks are appended in arrival order. WebSocket guarantees
      // ordered delivery within a single connection, so no timestamp-based
      // reordering is needed here — chunks are naturally sequential.
      const streamed = appendStreamChunk(state.messages, envelope.sessionId, envelope.content, envelope.timestamp);
      return {
        ...state,
        messages: streamed.messages,
        streamingMessageId: streamed.streamingMessageId,
        waitingForResponse: false,
      };
    }
    case "session:tool-stream": {
      // Append stdout chunk to the matching tool call message's output
      const updatedMessages = state.messages.map((msg) => {
        if (!msg.toolCalls?.length) return msg;
        const matchingTool = msg.toolCalls.find((tc) => tc.id === envelope.toolCallId);
        if (!matchingTool) return msg;
        // Append to the tool call's streaming output
        const updatedToolCalls = msg.toolCalls.map((tc) =>
          tc.id === envelope.toolCallId
            ? { ...tc, _streamingOutput: ((tc as Record<string, unknown>)._streamingOutput as string ?? "") + envelope.content }
            : tc,
        );
        return { ...msg, toolCalls: updatedToolCalls };
      });
      return { ...state, messages: updatedMessages };
    }
    case "session:error":
      return {
        ...state,
        error: { message: envelope.error, code: envelope.code, runtime: envelope.runtime },
        recovery: { state: "failed", reason: "websocket-error" },
        waitingForResponse: false,
      };
    case "client:message-sent":
      return {
        ...state,
        waitingForResponse: true,
      };
  }
}

export function applySessionHistory(
  state: AgentConversationRuntimeState,
  history: NarratorSessionChatHistory,
): AgentConversationRuntimeState {
  if (history.resetRequired) {
    return {
      ...state,
      cursor: history.cursor ?? state.cursor,
      lastSeq: lastSeqFrom(history.cursor ?? state.cursor, state.messages, state.lastSeq),
      resetRequired: true,
      recovery: { state: "resetting", reason: "history-gap" },
    };
  }

  const messages = mergeSessionMessages(state.messages, history.messages);
  return {
    ...state,
    messages,
    cursor: history.cursor ?? state.cursor,
    lastSeq: lastSeqFrom(history.cursor ?? state.cursor, messages, state.lastSeq),
    resetRequired: false,
    recovery: { state: "idle" },
  };
}

export function getResumeFromSeq(state: AgentConversationRuntimeState): number {
  return state.cursor?.lastSeq ?? state.lastSeq;
}
