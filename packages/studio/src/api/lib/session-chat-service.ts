import { WebSocketServer, type RawData, type WebSocket as NodeWebSocket } from "ws";
import type { ServerType } from "@hono/node-server";

import type {
  NarratorSessionChatClientMessage,
  NarratorSessionChatCursor,
  NarratorSessionChatErrorEnvelope,
  NarratorSessionChatHistory,
  NarratorSessionChatMessage,
  NarratorSessionChatMessageEnvelope,
  NarratorSessionChatServerEnvelope,
  NarratorSessionChatSnapshot,
  NarratorSessionChatStateEnvelope,
  NarratorSessionRecord,
} from "../../shared/session-types.js";
import { appendSessionChatHistory, loadSessionChatHistory } from "./session-history-store.js";
import { getSessionById, updateSession } from "./session-service.js";

const MAX_SESSION_MESSAGES = 50;

interface SessionChatTransport {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface SessionChatTransportState {
  ackedSeq: number;
}

interface SessionChatRuntimeState {
  messageCount: number;
  nextSeq: number;
  messages: NarratorSessionChatMessage[];
  transports: Map<SessionChatTransport, SessionChatTransportState>;
}

interface AttachSessionChatTransportOptions {
  resumeFromSeq?: number;
}

const runtimeStateBySessionId = new Map<string, SessionChatRuntimeState>();

function sanitizeSeq(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function getLastSeq(messages: NarratorSessionChatMessage[]): number {
  return messages.at(-1)?.seq ?? 0;
}

function normalizeSessionMessages(
  messages: NarratorSessionChatMessage[] | undefined,
  messageCount: number,
): NarratorSessionChatMessage[] {
  const sourceMessages = Array.isArray(messages) ? messages : [];
  const effectiveCount = Math.max(messageCount, sourceMessages.length);
  let nextSeq = Math.max(1, effectiveCount - sourceMessages.length + 1);

  return sourceMessages.map((message) => {
    const candidateSeq = sanitizeSeq(message.seq);
    const seq = candidateSeq >= nextSeq ? candidateSeq : nextSeq;
    nextSeq = seq + 1;

    return {
      ...message,
      timestamp: normalizeTimestamp(message.timestamp),
      seq,
    };
  });
}

function createRuntimeState(
  initialMessageCount = 0,
  initialMessages: NarratorSessionChatMessage[] = [],
): SessionChatRuntimeState {
  const normalizedMessages = normalizeSessionMessages(initialMessages, initialMessageCount);
  const lastSeq = getLastSeq(normalizedMessages);
  const messageCount = Math.max(initialMessageCount, lastSeq, normalizedMessages.length);

  return {
    messageCount,
    nextSeq: Math.max(messageCount, lastSeq) + 1,
    messages: normalizedMessages.slice(-MAX_SESSION_MESSAGES),
    transports: new Map(),
  };
}

function getRuntimeState(
  sessionId: string,
  initialMessageCount = 0,
  initialMessages: NarratorSessionChatMessage[] = [],
): SessionChatRuntimeState {
  const existing = runtimeStateBySessionId.get(sessionId);
  if (existing) {
    if (existing.messages.length === 0 && initialMessages.length > 0) {
      existing.messages = normalizeSessionMessages(initialMessages, initialMessageCount).slice(-MAX_SESSION_MESSAGES);
    }
    existing.messageCount = Math.max(existing.messageCount, initialMessageCount, getLastSeq(existing.messages));
    existing.nextSeq = Math.max(existing.nextSeq, existing.messageCount + 1, getLastSeq(existing.messages) + 1);
    return existing;
  }

  const state = createRuntimeState(initialMessageCount, initialMessages);
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

function buildServerFirstSession(session: NarratorSessionRecord, state: SessionChatRuntimeState): NarratorSessionRecord {
  const recentMessages = state.messages.length > 0 ? [...state.messages] : [...(session.recentMessages ?? [])];
  const messageCount = Math.max(session.messageCount, state.messageCount, getLastSeq(recentMessages), recentMessages.length);

  return {
    ...session,
    messageCount,
    recentMessages,
  };
}

function createCursor(state: SessionChatRuntimeState, ackedSeq?: number): NarratorSessionChatCursor {
  const lastSeq = Math.max(state.messageCount, getLastSeq(state.messages));
  if (typeof ackedSeq !== "number") {
    return { lastSeq };
  }

  return {
    lastSeq,
    ackedSeq: Math.max(0, Math.min(Math.floor(ackedSeq), lastSeq)),
  };
}

function createSessionChatStateEnvelope(
  session: NarratorSessionRecord,
  state: SessionChatRuntimeState,
  ackedSeq?: number,
): NarratorSessionChatStateEnvelope {
  return {
    type: "session:state",
    session,
    cursor: createCursor(state, ackedSeq),
  };
}

function createSessionChatMessageEnvelope(
  sessionId: string,
  state: SessionChatRuntimeState,
  message: NarratorSessionChatMessage,
): NarratorSessionChatMessageEnvelope {
  return {
    type: "session:message",
    sessionId,
    message,
    cursor: createCursor(state),
  };
}

function broadcastMessageEnvelope(
  sessionId: string,
  state: SessionChatRuntimeState,
  message: NarratorSessionChatMessage,
  except?: SessionChatTransport,
): void {
  const envelope = createSessionChatMessageEnvelope(sessionId, state, message);
  const payload = serializeEnvelope(envelope);

  for (const transport of state.transports.keys()) {
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

function broadcastStateEnvelope(session: NarratorSessionRecord, state: SessionChatRuntimeState): void {
  for (const [transport, transportState] of state.transports.entries()) {
    const delivered = sendEnvelope(transport, createSessionChatStateEnvelope(session, state, transportState.ackedSeq));
    if (!delivered) {
      state.transports.delete(transport);
    }
  }
}

async function loadSessionState(sessionId: string): Promise<{ session: NarratorSessionRecord; state: SessionChatRuntimeState } | null> {
  const session = await getSessionById(sessionId);
  if (!session) {
    return null;
  }

  const normalizedRecentMessages = normalizeSessionMessages(session.recentMessages, session.messageCount);
  const normalizedMessageCount = Math.max(session.messageCount, getLastSeq(normalizedRecentMessages), normalizedRecentMessages.length);
  const state = getRuntimeState(sessionId, normalizedMessageCount, normalizedRecentMessages);

  if (state.messages.length === 0 && normalizedRecentMessages.length > 0) {
    state.messages = [...normalizedRecentMessages];
  }

  trimSessionMessages(state);
  state.messageCount = Math.max(state.messageCount, normalizedMessageCount, getLastSeq(state.messages));
  state.nextSeq = Math.max(state.nextSeq, state.messageCount + 1, getLastSeq(state.messages) + 1);

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
    if (parsed?.type === "session:ack") {
      return {
        type: "session:ack",
        sessionId: parsed.sessionId,
        ack: sanitizeSeq((parsed as { ack?: unknown }).ack),
      };
    }
    if (parsed && typeof (parsed as { content?: unknown }).content === "string") {
      return {
        ...(parsed as Record<string, unknown>),
        content: (parsed as { content: string }).content,
        ack: sanitizeSeq((parsed as { ack?: unknown }).ack),
      } as NarratorSessionChatClientMessage;
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

function appendMessageToState(
  state: SessionChatRuntimeState,
  message: Omit<NarratorSessionChatMessage, "seq">,
): NarratorSessionChatMessage {
  const nextMessage: NarratorSessionChatMessage = {
    ...message,
    seq: state.nextSeq,
  };

  state.nextSeq += 1;
  state.messages.push(nextMessage);
  state.messageCount = Math.max(state.messageCount, nextMessage.seq ?? 0);
  trimSessionMessages(state);
  return nextMessage;
}

function updateTransportAck(
  state: SessionChatRuntimeState,
  transport: SessionChatTransport,
  ackCandidate: number,
): SessionChatTransportState | null {
  const transportState = state.transports.get(transport);
  if (!transportState) {
    return null;
  }

  transportState.ackedSeq = Math.max(transportState.ackedSeq, Math.min(sanitizeSeq(ackCandidate), createCursor(state).lastSeq));
  return transportState;
}

export async function getSessionChatSnapshot(sessionId: string): Promise<NarratorSessionChatSnapshot | null> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    return null;
  }

  return {
    session: buildServerFirstSession(loaded.session, loaded.state),
    messages: [...loaded.state.messages],
    cursor: createCursor(loaded.state),
  };
}

export async function getSessionChatHistory(sessionId: string, sinceSeq = 0): Promise<NarratorSessionChatHistory | null> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    return null;
  }

  const normalizedSinceSeq = Math.max(0, sanitizeSeq(sinceSeq));
  const persistedHistory = await loadSessionChatHistory(sessionId);
  const sourceMessages = persistedHistory.length > 0 ? persistedHistory : loaded.state.messages;
  const availableFromSeq = sourceMessages[0]?.seq ?? 0;
  const resetRequired = normalizedSinceSeq > 0 && availableFromSeq > 0 && normalizedSinceSeq < availableFromSeq - 1;

  return {
    sessionId,
    sinceSeq: normalizedSinceSeq,
    availableFromSeq,
    resetRequired,
    messages: resetRequired ? [] : sourceMessages.filter((message) => (message.seq ?? 0) > normalizedSinceSeq),
    cursor: createCursor(loaded.state),
  };
}

export async function attachSessionChatTransport(
  sessionId: string,
  transport: SessionChatTransport,
  options: AttachSessionChatTransportOptions = {},
): Promise<boolean> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    sendEnvelope(transport, createSessionChatError(sessionId, "Session not found"));
    transport.close(1008, "Session not found");
    return false;
  }

  const session = buildServerFirstSession(loaded.session, loaded.state);
  const ackedSeq = Math.min(sanitizeSeq(options.resumeFromSeq), createCursor(loaded.state).lastSeq);
  loaded.state.transports.set(transport, {
    ackedSeq,
  });

  if (ackedSeq === 0) {
    sendEnvelope(transport, {
      type: "session:snapshot",
      snapshot: {
        session,
        messages: [...loaded.state.messages],
        cursor: createCursor(loaded.state, ackedSeq),
      },
    });
  }

  sendEnvelope(transport, createSessionChatStateEnvelope(session, loaded.state, ackedSeq));
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

  const text = await normalizeMessageText(rawMessage);
  if (!text) {
    sendEnvelope(transport, createSessionChatError(sessionId, "Empty message payload"));
    return;
  }

  const payload = parseClientMessage(text);
  const transportState = loaded.state.transports.get(transport);

  if ("ack" in payload && sanitizeSeq(payload.ack) > 0 && transportState) {
    updateTransportAck(loaded.state, transport, sanitizeSeq(payload.ack));
  }

  if (payload.type === "session:ack") {
    const session = buildServerFirstSession(loaded.session, loaded.state);
    sendEnvelope(transport, createSessionChatStateEnvelope(session, loaded.state, transportState?.ackedSeq ?? 0));
    return;
  }

  const content = payload.content.trim();
  if (!content) {
    sendEnvelope(transport, createSessionChatError(sessionId, "Empty message payload"));
    return;
  }

  const timestamp = Date.now();
  const userMessage = appendMessageToState(loaded.state, {
    id: payload.messageId?.trim() || `session-msg-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    content,
    timestamp,
  });
  broadcastMessageEnvelope(sessionId, loaded.state, userMessage);

  const assistantMessage = appendMessageToState(loaded.state, {
    id: `${userMessage.id}-assistant`,
    role: "assistant",
    content: buildAssistantReply(loaded.session, content, payload.sessionMode),
    timestamp: timestamp + 1,
  });

  const persistedHistory = await appendSessionChatHistory(
    sessionId,
    [userMessage, assistantMessage],
    loaded.session.recentMessages ?? loaded.state.messages,
  );

  const updatedSession = await updateSession(sessionId, {
    messageCount: loaded.state.messageCount,
    recentMessages: [...loaded.state.messages],
  });
  if (persistedHistory.length > 0) {
    loaded.state.messageCount = Math.max(loaded.state.messageCount, getLastSeq(persistedHistory));
    loaded.state.nextSeq = Math.max(loaded.state.nextSeq, loaded.state.messageCount + 1);
  }
  broadcastMessageEnvelope(sessionId, loaded.state, assistantMessage);

  if (updatedSession) {
    broadcastStateEnvelope(buildServerFirstSession(updatedSession, loaded.state), loaded.state);
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
    const resumeFromSeq = sanitizeSeq(url.searchParams.get("resumeFromSeq"));
    wss.handleUpgrade(request, socket, head, (ws) => {
      void bindNodeSessionChatConnection(sessionId, ws, { resumeFromSeq });
    });
  });
}

async function bindNodeSessionChatConnection(
  sessionId: string,
  ws: NodeWebSocket,
  options: AttachSessionChatTransportOptions,
): Promise<void> {
  const transport: SessionChatTransport = {
    send: (data: string) => ws.send(data),
    close: (code?: number, reason?: string) => ws.close(code, reason),
  };

  const attached = await attachSessionChatTransport(sessionId, transport, options);
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
