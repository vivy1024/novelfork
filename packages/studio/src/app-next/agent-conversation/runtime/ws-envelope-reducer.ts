import type {
  NarratorSessionChatCursor,
  NarratorSessionChatHistory,
  NarratorSessionChatMessage,
  NarratorSessionChatSnapshot,
  NarratorSessionRecord,
} from "../../../shared/session-types";

import { appendStreamChunk, mergeSessionMessages, normalizeSessionMessage } from "./message-transforms";

export interface PendingPermissionRequest {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  reason?: string;
  riskLevel: string;
}

export interface PendingDangerReflection {
  id: string;
  toolName: string;
  command: string;
  analysis: string;
  riskFactors: string[];
}

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
  /** 
   * Turn 活跃标记：用户发消息时 true，后端推送 narratorState:"idle" 时 false。
   * 中间不管发生什么都不变——解决状态栏闪烁问题。
   */
  turnActive: boolean;
  pendingPermission: PendingPermissionRequest | null;
  pendingReflection: PendingDangerReflection | null;
}

export type SessionServerEnvelope =
  | { type: "session:snapshot"; snapshot: NarratorSessionChatSnapshot; cursor?: NarratorSessionChatCursor; recovery?: AgentConversationRuntimeState["recovery"] }
  | { type: "session:state"; session: NarratorSessionRecord; cursor?: NarratorSessionChatCursor; recovery?: AgentConversationRuntimeState["recovery"] }
  | { type: "session:message"; sessionId: string; message: NarratorSessionChatMessage; cursor?: NarratorSessionChatCursor }
  | { type: "session:stream"; sessionId: string; content: string; timestamp?: number }
  | { type: "session:tool-stream"; sessionId: string; toolCallId: string; content: string }
  | { type: "session:tool-input-chunk"; sessionId: string; toolCallId: string; partialInput: string }
  | { type: "session:error"; sessionId?: string; error: string; code?: string; runtime?: unknown }
  | { type: "session:permission-request"; sessionId: string; request: { id: string; toolName: string; input: Record<string, unknown>; reason?: string; riskLevel: string } }
  | { type: "session:danger-reflection"; sessionId: string; reflection: { id: string; toolName: string; command: string; analysis: string; riskFactors: string[] } }
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
    turnActive: false,
    pendingPermission: null,
    pendingReflection: null,
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
      let messages = envelope.snapshot.messages.map(normalizeSessionMessage);
      // 加载快照时，如果 session 已 idle，把残留的 running 工具标记为 success
      const snapshotNarratorState = (envelope.snapshot.session as { narratorState?: string }).narratorState;
      if (snapshotNarratorState !== "working") {
        messages = messages.map((msg) => {
          if (!msg.toolCalls?.some((tc) => tc.status === "running")) return msg;
          return { ...msg, toolCalls: msg.toolCalls.map((tc) => tc.status === "running" ? { ...tc, status: "success" } : tc) };
        });
      }
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
        turnActive: snapshotNarratorState === "working",
      };
    }
    case "session:state": {
      const cursor = envelope.cursor ?? state.cursor;
      // When turn ends (idle) or is interrupted, mark all running tool calls as completed/cancelled
      const sessionNarratorState = (envelope.session as { narratorState?: string }).narratorState;
      const sessionSubstatus = (envelope.session as { substatus?: string }).substatus;
      let messages = state.messages;
      if (sessionNarratorState === "idle" || sessionSubstatus === "interrupted") {
        messages = state.messages.map((msg) => {
          if (!msg.toolCalls?.some((tc) => tc.status === "running")) return msg;
          return { ...msg, toolCalls: msg.toolCalls.map((tc) => tc.status === "running" ? { ...tc, status: sessionSubstatus === "interrupted" ? "error" : "success" } : tc) };
        });
      }
      // Derive turnActive from server narratorState
      const turnActive = sessionNarratorState === "working" ? true
        : (sessionNarratorState === "idle" || sessionSubstatus === "interrupted") ? false
        : state.turnActive;
      return {
        ...state,
        session: envelope.session,
        messages,
        cursor,
        lastSeq: lastSeqFrom(cursor, messages, state.lastSeq),
        recovery: envelope.recovery ?? state.recovery,
        turnActive,
      };
    }
    case "session:message": {
      // Remove streaming message before merging (it's replaced by the final message)
      const baseMessages = state.streamingMessageId
        ? state.messages.filter((m) => m.id !== state.streamingMessageId)
        : state.messages;

      // If this is a tool_result message, update the corresponding tool_call's status
      let updatedBase = baseMessages;
      const incomingToolCalls = envelope.message.toolCalls;
      if (incomingToolCalls?.length && incomingToolCalls[0].status && incomingToolCalls[0].status !== "running") {
        const resultToolId = incomingToolCalls[0].id;
        updatedBase = baseMessages.map((msg) => {
          if (!msg.toolCalls?.length) return msg;
          const match = msg.toolCalls.find((tc) => tc.id === resultToolId && tc.status === "running");
          if (!match) return msg;
          return { ...msg, toolCalls: msg.toolCalls.map((tc) => tc.id === resultToolId ? { ...tc, status: incomingToolCalls[0].status, duration: incomingToolCalls[0].duration } : tc) };
        });
      }

      const nextMessages = mergeSessionMessages(updatedBase, [envelope.message]);
      const cursor = envelope.cursor ?? state.cursor;
      // Only clear waitingForResponse for final assistant messages (not tool_call/tool_result)
      const isToolMessage = incomingToolCalls?.length && incomingToolCalls.length > 0;
      const shouldClearWaiting = !isToolMessage && envelope.message.role === "assistant";
      return {
        ...state,
        messages: nextMessages,
        session: state.session ? { ...state.session, messageCount: nextMessages.length } : state.session,
        cursor,
        lastSeq: lastSeqFrom(cursor, nextMessages, state.lastSeq),
        streamingMessageId: null,
        waitingForResponse: shouldClearWaiting ? false : state.waitingForResponse,
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
      const MAX_STREAMING_OUTPUT = 100 * 1024; // 100KB
      const updatedMessages = state.messages.map((msg) => {
        if (!msg.toolCalls?.length) return msg;
        const matchingTool = msg.toolCalls.find((tc) => tc.id === envelope.toolCallId);
        if (!matchingTool) return msg;
        // Append to the tool call's streaming output with size cap
        const updatedToolCalls = msg.toolCalls.map((tc) => {
          if (tc.id !== envelope.toolCallId) return tc;
          const currentOutput = (tc._streamingOutput ?? "") + envelope.content;
          const cappedOutput = currentOutput.length > MAX_STREAMING_OUTPUT
            ? "... (输出过长，仅显示最后部分) ...\n" + currentOutput.slice(-MAX_STREAMING_OUTPUT + 200)
            : currentOutput;
          return { ...tc, _streamingOutput: cappedOutput };
        });
        return { ...msg, toolCalls: updatedToolCalls };
      });
      return { ...state, messages: updatedMessages };
    }
    case "session:tool-input-chunk": {
      // Update the matching tool call's input field with partial JSON as it streams in
      const updatedMessages = state.messages.map((msg) => {
        if (!msg.toolCalls?.length) return msg;
        const matchingTool = msg.toolCalls.find((tc) => tc.id === envelope.toolCallId);
        if (!matchingTool) return msg;
        const updatedToolCalls = msg.toolCalls.map((tc) =>
          tc.id === envelope.toolCallId
            ? { ...tc, _streamingInput: envelope.partialInput }
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
    case "session:permission-request":
      return {
        ...state,
        pendingPermission: envelope.request,
      };
    case "session:danger-reflection":
      return {
        ...state,
        pendingReflection: envelope.reflection,
      };
    case "client:message-sent":
      return {
        ...state,
        waitingForResponse: true,
        turnActive: true,
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
