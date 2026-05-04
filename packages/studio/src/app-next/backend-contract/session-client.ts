import type {
  CreateNarratorSessionInput,
  NarratorSessionChatAbortClientEnvelope,
  NarratorSessionChatAckClientEnvelope,
  NarratorSessionChatClientMessage,
  NarratorSessionChatHistory,
  NarratorSessionChatMessage,
  NarratorSessionChatMessageClientEnvelope,
  NarratorSessionChatServerEnvelope,
  NarratorSessionChatSnapshot,
  NarratorSessionChatStreamEnvelope,
  NarratorSessionChatErrorEnvelope,
  NarratorSessionRecord,
  NarratorSessionRecoveryEnvelope,
  UpdateNarratorSessionInput,
} from "../../shared/session-types";
import type { CanvasContext, ToolConfirmationDecision, ToolConfirmationRequest } from "../../shared/agent-native-workspace";
import type { ContractClient } from "./contract-client";

export interface ChatWebSocketUrlOptions {
  baseUrl?: string | URL;
  protocol?: "ws:" | "wss:";
  resumeFromSeq?: number;
}

export interface BuildSessionMessageEnvelopeInput {
  sessionId: string;
  messageId: string;
  content: string;
  sessionMode?: NarratorSessionChatMessageClientEnvelope["sessionMode"];
  ack?: number;
  canvasContext?: CanvasContext;
}

export interface SessionWebSocketRuntimeState {
  session: NarratorSessionRecord | null;
  messages: NarratorSessionChatMessage[];
  cursor: NarratorSessionChatSnapshot["cursor"] | null;
  lastSeq: number;
  streamingMessageId: string | null;
  error: { message: string; code?: string; runtime?: unknown } | null;
  recovery: NarratorSessionRecoveryEnvelope;
  resetRequired: boolean;
}

function chatPath(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/chat`;
}

function browserLocationBase(): string | undefined {
  const location = globalThis.location;
  return location ? location.href : undefined;
}

export function buildChatWebSocketUrl(sessionId: string, options: ChatWebSocketUrlOptions = {}): string {
  return buildSessionWebSocketUrl(sessionId, options);
}

export function buildSessionWebSocketUrl(sessionId: string, options: ChatWebSocketUrlOptions = {}): string {
  const path = chatPath(sessionId);
  const baseUrl = options.baseUrl?.toString() ?? browserLocationBase();
  const appendResumeFromSeq = (value: string): string => {
    if (!options.resumeFromSeq || !Number.isFinite(options.resumeFromSeq) || options.resumeFromSeq <= 0) return value;
    const separator = value.includes("?") ? "&" : "?";
    return `${value}${separator}resumeFromSeq=${encodeURIComponent(String(Math.floor(options.resumeFromSeq)))}`;
  };

  if (!baseUrl) return appendResumeFromSeq(path);

  const url = new URL(path, baseUrl);
  url.protocol = options.protocol ?? (url.protocol === "https:" ? "wss:" : "ws:");
  if (options.resumeFromSeq && Number.isFinite(options.resumeFromSeq) && options.resumeFromSeq > 0) {
    url.searchParams.set("resumeFromSeq", String(Math.floor(options.resumeFromSeq)));
  }
  return url.toString();
}

export function buildSessionMessageEnvelope(input: BuildSessionMessageEnvelopeInput): NarratorSessionChatMessageClientEnvelope {
  return {
    type: "session:message",
    sessionId: input.sessionId,
    messageId: input.messageId,
    content: input.content,
    sessionMode: input.sessionMode,
    ack: input.ack,
    canvasContext: input.canvasContext,
  };
}

export function buildSessionAckEnvelope(input: { sessionId: string; ack: number }): NarratorSessionChatAckClientEnvelope {
  return {
    type: "session:ack",
    sessionId: input.sessionId,
    ack: input.ack,
  };
}

export function buildSessionAbortEnvelope(input: { sessionId: string }): NarratorSessionChatAbortClientEnvelope {
  return {
    type: "session:abort",
    sessionId: input.sessionId,
  };
}

export function serializeSessionClientEnvelope(envelope: NarratorSessionChatClientMessage): string {
  return JSON.stringify(envelope);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseSessionServerEnvelope(payload: string | ArrayBuffer | Uint8Array): NarratorSessionChatServerEnvelope {
  const text = typeof payload === "string" ? payload : new TextDecoder().decode(payload);
  const parsed = JSON.parse(text) as unknown;
  if (!isObject(parsed) || typeof parsed.type !== "string") {
    throw new Error("Invalid session WebSocket envelope");
  }

  switch (parsed.type) {
    case "session:snapshot":
      return parsed as unknown as NarratorSessionChatServerEnvelope;
    case "session:state":
      return parsed as unknown as NarratorSessionChatServerEnvelope;
    case "session:message":
      return parsed as unknown as NarratorSessionChatServerEnvelope;
    case "session:stream":
      return parsed as unknown as NarratorSessionChatStreamEnvelope;
    case "session:error":
      return parsed as unknown as NarratorSessionChatErrorEnvelope;
    default:
      throw new Error(`Unsupported session WebSocket envelope: ${parsed.type}`);
  }
}

export function createInitialSessionWebSocketState(): SessionWebSocketRuntimeState {
  return {
    session: null,
    messages: [],
    cursor: null,
    lastSeq: 0,
    streamingMessageId: null,
    error: null,
    recovery: { state: "idle" },
    resetRequired: false,
  };
}

function normalizeSessionMessage(message: NarratorSessionChatMessage): NarratorSessionChatMessage {
  const { runtime: _runtime, toolCalls, ...rest } = message as NarratorSessionChatMessage & { runtime?: unknown; toolCalls?: Array<Record<string, unknown>> };
  return {
    ...rest,
    toolCalls: toolCalls?.map((toolCall) => {
      const result = isObject(toolCall.result) ? toolCall.result as Record<string, unknown> : undefined;
      return {
        ...toolCall,
        allowed: result?.allowed,
      };
    }) as NarratorSessionChatMessage["toolCalls"],
  };
}

function mergeSessionMessages(
  current: readonly NarratorSessionChatMessage[],
  incoming: readonly NarratorSessionChatMessage[],
): NarratorSessionChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    if (!byId.has(message.id)) byId.set(message.id, normalizeSessionMessage(message));
  }
  return Array.from(byId.values()).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

function appendStreamChunk(
  messages: readonly NarratorSessionChatMessage[],
  sessionId: string,
  content: string,
  timestamp = Date.now(),
): { messages: NarratorSessionChatMessage[]; streamingMessageId: string } {
  const existing = messages.find((message) => message.id.startsWith(`stream:${sessionId}:`));
  const streamingMessageId = existing?.id ?? `stream:${sessionId}:${timestamp}`;

  if (existing) {
    return {
      streamingMessageId,
      messages: messages.map((message) => (message.id === streamingMessageId ? { ...message, content: `${message.content}${content}` } : message)),
    };
  }

  return {
    streamingMessageId,
    messages: [
      ...messages,
      {
        id: streamingMessageId,
        role: "assistant",
        content,
        timestamp,
      } as NarratorSessionChatMessage,
    ],
  };
}

function lastSeqFrom(cursor: SessionWebSocketRuntimeState["cursor"], messages: readonly NarratorSessionChatMessage[], fallback: number): number {
  return cursor?.lastSeq ?? Math.max(fallback, ...messages.map((message) => message.seq ?? 0));
}

export function reduceSessionServerEnvelope(
  state: SessionWebSocketRuntimeState,
  envelope: NarratorSessionChatServerEnvelope,
): SessionWebSocketRuntimeState {
  switch (envelope.type) {
    case "session:snapshot": {
      const cursor = envelope.snapshot.cursor ?? null;
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
      const messages = mergeSessionMessages(state.messages, [envelope.message]);
      const cursor = envelope.cursor ?? state.cursor;
      return {
        ...state,
        messages,
        session: state.session ? { ...state.session, messageCount: messages.length } : state.session,
        cursor,
        lastSeq: lastSeqFrom(cursor, messages, state.lastSeq),
        streamingMessageId: null,
      };
    }
    case "session:stream": {
      const streamed = appendStreamChunk(state.messages, envelope.sessionId, envelope.content);
      return {
        ...state,
        messages: streamed.messages,
        streamingMessageId: streamed.streamingMessageId,
      };
    }
    case "session:error":
      return {
        ...state,
        error: { message: envelope.error, code: envelope.code, runtime: envelope.runtime },
        recovery: { state: "failed", reason: "websocket-error" },
      };
  }
}

export function applySessionWebSocketHistory(
  state: SessionWebSocketRuntimeState,
  history: NarratorSessionChatHistory,
): SessionWebSocketRuntimeState {
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

export function getSessionResumeFromSeq(state: SessionWebSocketRuntimeState): number {
  return state.cursor?.lastSeq ?? state.lastSeq;
}

export function createSessionClient(contract: ContractClient) {
  return {
    listActiveSessions: <T = readonly NarratorSessionRecord[]>() => contract.get<T>("/api/sessions?sort=recent&status=active", { capability: { id: "sessions.active", status: "current" } }),
    createSession: <T = NarratorSessionRecord>(payload: CreateNarratorSessionInput) => contract.post<T>("/api/sessions", payload, { capability: { id: "sessions.create", status: "current" } }),
    updateSession: <T = NarratorSessionRecord>(sessionId: string, payload: UpdateNarratorSessionInput) =>
      contract.put<T>(`/api/sessions/${encodeURIComponent(sessionId)}`, payload, { capability: { id: "sessions.update", status: "current" } }),
    deleteSession: <T = { success: true }>(sessionId: string) =>
      contract.delete<T>(`/api/sessions/${encodeURIComponent(sessionId)}`, { capability: { id: "sessions.delete", status: "current" } }),
    getChatState: <T = NarratorSessionChatSnapshot>(sessionId: string) =>
      contract.get<T>(`/api/sessions/${encodeURIComponent(sessionId)}/chat/state`, { capability: { id: "sessions.chat.state", status: "current" } }),
    getChatHistory: <T = NarratorSessionChatHistory>(sessionId: string, sinceSeq?: number) => {
      const query = sinceSeq === undefined ? "" : `?sinceSeq=${encodeURIComponent(String(sinceSeq))}`;
      return contract.get<T>(`/api/sessions/${encodeURIComponent(sessionId)}/chat/history${query}`, { capability: { id: "sessions.chat.history", status: "current" } });
    },
    listPendingTools: <T = { pending: readonly ToolConfirmationRequest[] }>(sessionId: string) =>
      contract.get<T>(`/api/sessions/${encodeURIComponent(sessionId)}/tools`, { capability: { id: "sessions.tools.pending", status: "current" } }),
    confirmTool: <T = { ok: true }>(sessionId: string, toolName: string, payload: ToolConfirmationDecision | Record<string, unknown>) =>
      contract.post<T>(`/api/sessions/${encodeURIComponent(sessionId)}/tools/${encodeURIComponent(toolName)}/confirm`, payload, {
        capability: { id: "sessions.tools.confirm", status: "current" },
      }),
  };
}
