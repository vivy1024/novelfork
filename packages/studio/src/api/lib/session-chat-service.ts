import { WebSocketServer, type RawData, type WebSocket as NodeWebSocket } from "ws";

import type {
  NarratorSessionChatClientMessage,
  NarratorSessionChatErrorEnvelope,
  NarratorSessionChatMessage,
  NarratorSessionChatServerEnvelope,
  NarratorSessionChatSnapshot,
  NarratorSessionChatStateEnvelope,
  NarratorSessionRecord,
} from "../../shared/session-types.js";
import { appendSessionChatHistory, isSessionChatHistoryDeleted, loadSessionChatHistory } from "./session-history-store.js";
import { getSessionById, updateSession } from "./session-service.js";
import type { ServerType } from "@hono/node-server";

const MAX_SESSION_MESSAGES = 50;

interface SessionChatTransport {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface SessionChatRuntimeState {
  messageCount: number;
  messages: NarratorSessionChatMessage[];
  transports: Set<SessionChatTransport>;
}

const runtimeStateBySessionId = new Map<string, SessionChatRuntimeState>();

function getRuntimeState(sessionId: string, initialMessageCount = 0): SessionChatRuntimeState {
  const existing = runtimeStateBySessionId.get(sessionId);
  if (existing) {
    return existing;
  }

  const state: SessionChatRuntimeState = {
    messageCount: initialMessageCount,
    messages: [],
    transports: new Set(),
  };
  runtimeStateBySessionId.set(sessionId, state);
  return state;
}

function serializeEnvelope(envelope: NarratorSessionChatServerEnvelope): string {
  return JSON.stringify(envelope);
}

function sendEnvelope(transport: SessionChatTransport, envelope: NarratorSessionChatServerEnvelope): boolean {
  try {
    transport.send(serializeEnvelope(envelope));
    return true;
  } catch {
    return false;
  }
}

function trimSessionMessages(state: SessionChatRuntimeState): void {
  if (state.messages.length <= MAX_SESSION_MESSAGES) {
    return;
  }

  state.messages = state.messages.slice(-MAX_SESSION_MESSAGES);
}

function broadcastEnvelope(
  sessionId: string,
  envelope: NarratorSessionChatServerEnvelope,
  except?: SessionChatTransport,
): void {
  const state = runtimeStateBySessionId.get(sessionId);
  if (!state) {
    return;
  }

  const payload = serializeEnvelope(envelope);
  for (const transport of state.transports) {
    if (transport === except) {
      continue;
    }

    try {
      transport.send(payload);
    } catch {
      state.transports.delete(transport);
    }
  }
}

async function loadSessionState(sessionId: string): Promise<{ session: NarratorSessionRecord; state: SessionChatRuntimeState } | null> {
  const session = await getSessionById(sessionId);
  if (!session) {
    return null;
  }

  const state = getRuntimeState(sessionId, session.messageCount);
  state.messageCount = Math.max(state.messageCount, session.messageCount);
  if (state.messages.length === 0) {
    if (session.recentMessages && session.recentMessages.length > 0) {
      state.messages = [...session.recentMessages];
    } else {
      const historyMessages = await loadSessionChatHistory(sessionId);
      if (historyMessages.length > 0) {
        state.messages = historyMessages.slice(-MAX_SESSION_MESSAGES);
      }
    }
  }
  trimSessionMessages(state);
  return { session, state };
}

function buildAssistantReply(session: NarratorSessionRecord, content: string, sessionMode?: string): string {
  const modeLabel = sessionMode === "plan" ? "计划模式" : session.sessionMode === "plan" ? "计划模式" : "对话模式";
  return `【${session.title} · ${modeLabel}】已收到：${content}`;
}

function normalizeMessageText(raw: RawData | string | ArrayBuffer | ArrayBufferView | Blob | unknown): Promise<string | null> | string | null {
  if (typeof raw === "string") {
    return raw;
  }

  if (typeof Blob !== "undefined" && raw instanceof Blob) {
    return raw.text();
  }

  if (raw instanceof Uint8Array) {
    return new TextDecoder().decode(raw);
  }

  if (raw instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(raw));
  }

  if (ArrayBuffer.isView(raw)) {
    return new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
  }

  if (typeof raw === "object" && raw !== null && "toString" in raw) {
    return String(raw);
  }

  return null;
}

function parseClientMessage(text: string): NarratorSessionChatClientMessage {
  try {
    const parsed = JSON.parse(text) as Partial<NarratorSessionChatClientMessage> | string;
    if (typeof parsed === "string") {
      return { content: parsed };
    }
    if (parsed && typeof parsed.content === "string") {
      return parsed as NarratorSessionChatClientMessage;
    }
  } catch {
    // Treat raw text as a chat message payload.
  }

  return { content: text };
}

function createSessionChatError(sessionId: string, error: string): NarratorSessionChatErrorEnvelope {
  return {
    type: "session:error",
    sessionId,
    error,
  };
}

function createSessionChatStateEnvelope(session: NarratorSessionRecord): NarratorSessionChatStateEnvelope {
  return {
    type: "session:state",
    session,
  };
}

export async function getSessionChatSnapshot(sessionId: string): Promise<NarratorSessionChatSnapshot | null> {
  const state = await loadSessionState(sessionId);
  if (!state) {
    return null;
  }

  return {
    session: state.session,
    messages: [...state.state.messages],
  };
}

export async function getSessionChatHistory(sessionId: string): Promise<{
  session: NarratorSessionRecord;
  messages: NarratorSessionChatMessage[];
} | null> {
  const session = await getSessionById(sessionId);
  if (!session) {
    return null;
  }

  const messages = await loadSessionChatHistory(sessionId);
  if (messages.length > 0) {
    return {
      session,
      messages,
    };
  }

  return {
    session,
    messages: [...(session.recentMessages ?? [])],
  };
}

export async function attachSessionChatTransport(sessionId: string, transport: SessionChatTransport): Promise<boolean> {
  const state = await loadSessionState(sessionId);
  if (!state) {
    sendEnvelope(transport, createSessionChatError(sessionId, "Session not found"));
    transport.close(1008, "Session not found");
    return false;
  }

  state.state.transports.add(transport);
  sendEnvelope(transport, {
    type: "session:snapshot",
    snapshot: {
      session: state.session,
      messages: [...state.state.messages],
    },
  });
  sendEnvelope(transport, createSessionChatStateEnvelope(state.session));
  return true;
}

export function detachSessionChatTransport(sessionId: string, transport: SessionChatTransport): void {
  const state = runtimeStateBySessionId.get(sessionId);
  if (!state) {
    return;
  }

  state.transports.delete(transport);
  if (state.transports.size === 0 && state.messages.length === 0) {
    runtimeStateBySessionId.delete(sessionId);
  }
}

export async function handleSessionChatTransportMessage(
  sessionId: string,
  transport: SessionChatTransport,
  rawMessage: RawData | string | ArrayBuffer | ArrayBufferView | Blob | unknown,
): Promise<void> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    sendEnvelope(transport, createSessionChatError(sessionId, "Session not found"));
    transport.close(1008, "Session not found");
    return;
  }

  if (isSessionChatHistoryDeleted(sessionId)) {
    return;
  }

  const text = await normalizeMessageText(rawMessage);
  if (!text) {
    sendEnvelope(transport, createSessionChatError(sessionId, "Empty message payload"));
    return;
  }

  const payload = parseClientMessage(text);
  const content = payload.content.trim();
  if (!content) {
    sendEnvelope(transport, createSessionChatError(sessionId, "Empty message payload"));
    return;
  }

  const timestamp = Date.now();
  const userMessage: NarratorSessionChatMessage = {
    id: payload.messageId?.trim() || `session-msg-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    content,
    timestamp,
  };

  loaded.state.messages.push(userMessage);
  loaded.state.messageCount += 1;
  trimSessionMessages(loaded.state);
  broadcastEnvelope(sessionId, { type: "session:message", sessionId, message: userMessage });

  const assistantMessage: NarratorSessionChatMessage = {
    id: `${userMessage.id}-assistant`,
    role: "assistant",
    content: buildAssistantReply(loaded.session, content, payload.sessionMode),
    timestamp: timestamp + 1,
  };

  loaded.state.messages.push(assistantMessage);
  loaded.state.messageCount += 1;
  trimSessionMessages(loaded.state);

  await appendSessionChatHistory(sessionId, [userMessage, assistantMessage], loaded.session.recentMessages ?? []);
  const updatedSession = await updateSession(sessionId, {
    messageCount: loaded.state.messageCount,
    recentMessages: [...loaded.state.messages],
  });
  broadcastEnvelope(sessionId, { type: "session:message", sessionId, message: assistantMessage });
  if (updatedSession) {
    broadcastEnvelope(sessionId, createSessionChatStateEnvelope(updatedSession));
  }
}

export function setupSessionChatWebSocket(server: ServerType): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/chat$/);
    if (!match) {
      return;
    }

    const sessionId = decodeURIComponent(match[1]!);
    wss.handleUpgrade(request, socket, head, (ws) => {
      void bindNodeSessionChatConnection(sessionId, ws);
    });
  });
}

async function bindNodeSessionChatConnection(sessionId: string, ws: NodeWebSocket): Promise<void> {
  const transport: SessionChatTransport = {
    send: (data: string) => ws.send(data),
    close: (code?: number, reason?: string) => ws.close(code, reason),
  };

  const attached = await attachSessionChatTransport(sessionId, transport);
  if (!attached) {
    return;
  }

  ws.on("message", (data) => {
    void handleSessionChatTransportMessage(sessionId, transport, data);
  });

  ws.on("close", () => {
    detachSessionChatTransport(sessionId, transport);
  });

  ws.on("error", () => {
    detachSessionChatTransport(sessionId, transport);
  });
}
