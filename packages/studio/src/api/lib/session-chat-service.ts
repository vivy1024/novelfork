import type { Server as NodeHttpServer } from "node:http";

import { WebSocketServer, type RawData, type WebSocket as NodeWebSocket } from "ws";

import type {
  BunWebSocketConnection,
  BunWebSocketRegistrar,
  StartedHttpServer,
} from "../start-http-server.js";

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
  NarratorSessionRecoveryEnvelope,
  NarratorSessionRecoveryMetadata,
  ToolCall,
} from "../../shared/session-types.js";
import {
  appendSessionChatHistory,
  getSessionChatCursor,
  loadSessionChatHistory,
  saveSessionChatHistory,
  updateSessionChatAckedSeq,
  updateSessionChatRecoveryJson,
} from "./session-history-store.js";
import { generateSessionReply, type LlmRuntimeGenerateResult } from "./llm-runtime-service.js";
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
  persistedAckedSeq: number;
  availableFromSeq: number;
  recoveryJson: string;
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
  initialAckedSeq = 0,
  initialAvailableFromSeq = 0,
  initialRecoveryJson = "{}",
): SessionChatRuntimeState {
  const normalizedMessages = normalizeSessionMessages(initialMessages, initialMessageCount);
  const lastSeq = getLastSeq(normalizedMessages);
  const messageCount = Math.max(initialMessageCount, lastSeq, normalizedMessages.length);

  return {
    messageCount,
    nextSeq: Math.max(messageCount, lastSeq) + 1,
    messages: normalizedMessages.slice(-MAX_SESSION_MESSAGES),
    transports: new Map(),
    persistedAckedSeq: Math.max(0, Math.min(initialAckedSeq, Math.max(messageCount, lastSeq))),
    availableFromSeq: initialAvailableFromSeq,
    recoveryJson: initialRecoveryJson || "{}",
  };
}

function getRuntimeState(
  sessionId: string,
  initialMessageCount = 0,
  initialMessages: NarratorSessionChatMessage[] = [],
  initialAckedSeq = 0,
  initialAvailableFromSeq = 0,
  initialRecoveryJson = "{}",
): SessionChatRuntimeState {
  const existing = runtimeStateBySessionId.get(sessionId);
  if (existing) {
    if (existing.messages.length === 0 && initialMessages.length > 0) {
      existing.messages = normalizeSessionMessages(initialMessages, initialMessageCount).slice(-MAX_SESSION_MESSAGES);
    }
    existing.messageCount = Math.max(existing.messageCount, initialMessageCount, getLastSeq(existing.messages));
    existing.nextSeq = Math.max(existing.nextSeq, existing.messageCount + 1, getLastSeq(existing.messages) + 1);
    existing.persistedAckedSeq = Math.max(existing.persistedAckedSeq, Math.min(initialAckedSeq, existing.messageCount));
    existing.availableFromSeq = initialAvailableFromSeq || existing.availableFromSeq;
    existing.recoveryJson = initialRecoveryJson || existing.recoveryJson;
    return existing;
  }

  const state = createRuntimeState(initialMessageCount, initialMessages, initialAckedSeq, initialAvailableFromSeq, initialRecoveryJson);
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

function getPendingToolCalls(messages: NarratorSessionChatMessage[]): ToolCall[] {
  return messages.flatMap((message) => message.toolCalls ?? []).filter((toolCall) => toolCall.status === "pending" || toolCall.status === "running");
}

function buildRecoveryMetadata(
  state: SessionChatRuntimeState,
  messages: NarratorSessionChatMessage[],
  failure?: NarratorSessionRecoveryMetadata["lastFailure"],
): NarratorSessionRecoveryMetadata {
  const lastSeq = Math.max(state.messageCount, getLastSeq(messages));
  const lastAckedSeq = Math.max(0, Math.min(state.persistedAckedSeq, lastSeq));
  const pendingToolCalls = getPendingToolCalls(messages);
  const pendingMessageCount = messages.filter((message) => (message.seq ?? 0) > lastAckedSeq).length;
  return {
    lastSeq,
    lastAckedSeq,
    availableFromSeq: state.availableFromSeq,
    pendingMessageCount,
    pendingToolCallCount: pendingToolCalls.length,
    pendingToolCallSummary: pendingToolCalls.slice(0, 5).map((toolCall) => `${toolCall.toolName}:${toolCall.status ?? "pending"}`),
    ...(failure ? { lastFailure: failure } : {}),
    updatedAt: new Date().toISOString(),
  };
}

function serializeRecoveryMetadata(metadata: NarratorSessionRecoveryMetadata): string {
  return JSON.stringify(metadata);
}

function buildServerFirstSession(session: NarratorSessionRecord, state: SessionChatRuntimeState): NarratorSessionRecord {
  const recentMessages = state.messages.length > 0 ? [...state.messages] : [...(session.recentMessages ?? [])];
  const messageCount = Math.max(session.messageCount, state.messageCount, getLastSeq(recentMessages), recentMessages.length);
  const recovery = buildRecoveryMetadata(state, recentMessages, session.recovery?.lastFailure);

  return {
    ...session,
    messageCount,
    recentMessages,
    recovery,
  };
}

function createCursor(state: SessionChatRuntimeState, ackedSeq = state.persistedAckedSeq): NarratorSessionChatCursor {
  const lastSeq = Math.max(state.messageCount, getLastSeq(state.messages));
  return {
    lastSeq,
    ackedSeq: Math.max(0, Math.min(Math.floor(ackedSeq), lastSeq)),
  };
}

function createSessionChatStateEnvelope(
  session: NarratorSessionRecord,
  state: SessionChatRuntimeState,
  ackedSeq?: number,
  recovery?: NarratorSessionRecoveryEnvelope,
): NarratorSessionChatStateEnvelope {
  return {
    type: "session:state",
    session,
    cursor: createCursor(state, ackedSeq),
    ...(recovery ? { recovery } : {}),
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

function broadcastStateEnvelope(
  session: NarratorSessionRecord,
  state: SessionChatRuntimeState,
  recovery?: NarratorSessionRecoveryEnvelope,
): void {
  for (const [transport, transportState] of state.transports.entries()) {
    const delivered = sendEnvelope(transport, createSessionChatStateEnvelope(session, state, transportState.ackedSeq, recovery));
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

  const persistedCursor = await getSessionChatCursor(sessionId);
  const persistedHistory = await loadSessionChatHistory(sessionId);
  const sourceMessages = persistedHistory.length > 0 ? persistedHistory : session.recentMessages;
  const normalizedRecentMessages = normalizeSessionMessages(sourceMessages, Math.max(session.messageCount, persistedCursor.lastSeq));
  const normalizedMessageCount = Math.max(session.messageCount, persistedCursor.lastSeq, getLastSeq(normalizedRecentMessages), normalizedRecentMessages.length);
  const state = getRuntimeState(
    sessionId,
    normalizedMessageCount,
    normalizedRecentMessages,
    persistedCursor.ackedSeq,
    persistedCursor.availableFromSeq,
    persistedCursor.recoveryJson,
  );

  if (state.messages.length === 0 && normalizedRecentMessages.length > 0) {
    state.messages = [...normalizedRecentMessages];
  }

  trimSessionMessages(state);
  state.messageCount = Math.max(state.messageCount, normalizedMessageCount, getLastSeq(state.messages));
  state.nextSeq = Math.max(state.nextSeq, state.messageCount + 1, getLastSeq(state.messages) + 1);

  return { session, state };
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

function createSessionChatError(
  sessionId: string,
  error: string,
  details: Partial<Omit<NarratorSessionChatErrorEnvelope, "type" | "sessionId" | "error">> = {},
): NarratorSessionChatErrorEnvelope {
  return {
    type: "session:error",
    sessionId,
    error,
    ...details,
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

async function persistSessionChatProgress(
  sessionId: string,
  session: NarratorSessionRecord,
  state: SessionChatRuntimeState,
  messages: NarratorSessionChatMessage[],
  failure?: NarratorSessionRecoveryMetadata["lastFailure"],
): Promise<NarratorSessionRecord | null> {
  const persistedHistory = await appendSessionChatHistory(
    sessionId,
    messages,
    session.recentMessages ?? state.messages,
  );

  if (persistedHistory.length > 0) {
    state.messageCount = Math.max(state.messageCount, getLastSeq(persistedHistory));
    state.nextSeq = Math.max(state.nextSeq, state.messageCount + 1);
    state.availableFromSeq = persistedHistory[0]?.seq ?? state.availableFromSeq;
  }

  const recovery = buildRecoveryMetadata(state, state.messages, failure);
  state.recoveryJson = serializeRecoveryMetadata(recovery);
  await updateSessionChatRecoveryJson(sessionId, state.recoveryJson);
  return updateSession(sessionId, {
    messageCount: state.messageCount,
    recentMessages: [...state.messages],
    recovery,
  });
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
  const cursor = createCursor(loaded.state);
  const resetRequired = normalizedSinceSeq > 0 && (
    (availableFromSeq > 0 && normalizedSinceSeq < availableFromSeq - 1)
    || normalizedSinceSeq > cursor.lastSeq
  );

  return {
    sessionId,
    sinceSeq: normalizedSinceSeq,
    availableFromSeq,
    resetRequired,
    messages: resetRequired ? [] : sourceMessages.filter((message) => (message.seq ?? 0) > normalizedSinceSeq),
    cursor,
  };
}

export async function replaceSessionChatState(
  sessionId: string,
  nextMessages: NarratorSessionChatMessage[],
): Promise<NarratorSessionChatSnapshot | null> {
  const loaded = await loadSessionState(sessionId);
  if (!loaded) {
    return null;
  }

  const normalizedMessages = normalizeSessionMessages(nextMessages, Array.isArray(nextMessages) ? nextMessages.length : 0).slice(-MAX_SESSION_MESSAGES);
  loaded.state.messages = normalizedMessages;
  loaded.state.messageCount = Math.max(normalizedMessages.length, getLastSeq(normalizedMessages));
  loaded.state.nextSeq = loaded.state.messageCount + 1;
  loaded.state.persistedAckedSeq = 0;
  loaded.state.availableFromSeq = normalizedMessages[0]?.seq ?? 0;

  for (const transportState of loaded.state.transports.values()) {
    transportState.ackedSeq = 0;
  }

  await saveSessionChatHistory(sessionId, normalizedMessages);
  const recovery = buildRecoveryMetadata(loaded.state, normalizedMessages);
  loaded.state.recoveryJson = serializeRecoveryMetadata(recovery);
  await updateSessionChatRecoveryJson(sessionId, loaded.state.recoveryJson);
  const updatedSession = await updateSession(sessionId, {
    messageCount: loaded.state.messageCount,
    recentMessages: [...normalizedMessages],
    recovery,
  });
  const serverFirstSession = buildServerFirstSession(updatedSession ?? loaded.session, loaded.state);
  const snapshot: NarratorSessionChatSnapshot = {
    session: serverFirstSession,
    messages: [...loaded.state.messages],
    cursor: createCursor(loaded.state),
  };

  for (const transport of loaded.state.transports.keys()) {
    const transportState = loaded.state.transports.get(transport);
    sendEnvelope(
      transport,
      createSessionChatStateEnvelope(serverFirstSession, loaded.state, transportState?.ackedSeq ?? 0, {
        state: "resetting",
        reason: "server-reset",
      }),
    );
    sendEnvelope(transport, {
      type: "session:snapshot",
      snapshot,
      recovery: {
        state: "idle",
        reason: "server-reset",
      },
    });
  }
  return snapshot;
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
  const hasExplicitResume = options.resumeFromSeq !== undefined;
  const requestedResumeSeq = hasExplicitResume ? sanitizeSeq(options.resumeFromSeq) : loaded.state.persistedAckedSeq;
  const cursor = createCursor(loaded.state);
  const resumeOutOfRange = requestedResumeSeq > cursor.lastSeq;
  const ackedSeq = Math.min(requestedResumeSeq, cursor.lastSeq);
  loaded.state.transports.set(transport, {
    ackedSeq,
  });

  if (!hasExplicitResume || ackedSeq === 0) {
    sendEnvelope(transport, {
      type: "session:snapshot",
      snapshot: {
        session,
        messages: [...loaded.state.messages],
        cursor: createCursor(loaded.state, ackedSeq),
      },
      recovery: {
        state: hasExplicitResume && ackedSeq === 0 ? "recovering" : "idle",
        reason: hasExplicitResume ? "reconnect" : "initial-hydration",
      },
    });
  }

  console.log(JSON.stringify({
    component: "session.recovery",
    ok: true,
    sessionId,
    route: "/api/sessions/:id/chat",
    requestedResumeSeq,
    ackedSeq,
    lastSeq: cursor.lastSeq,
    pendingMessageCount: session.recovery?.pendingMessageCount ?? 0,
    recoveryState: resumeOutOfRange ? "resetting" : "idle",
  }));

  sendEnvelope(
    transport,
    createSessionChatStateEnvelope(
      session,
      loaded.state,
      ackedSeq,
      resumeOutOfRange ? { state: "resetting", reason: "history-gap" } : undefined,
    ),
  );
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
    const updatedTransportState = updateTransportAck(loaded.state, transport, sanitizeSeq(payload.ack));
    if (updatedTransportState) {
      loaded.state.persistedAckedSeq = Math.max(loaded.state.persistedAckedSeq, updatedTransportState.ackedSeq);
      const recovery = buildRecoveryMetadata(loaded.state, loaded.state.messages);
      loaded.state.recoveryJson = serializeRecoveryMetadata(recovery);
      await updateSessionChatAckedSeq(sessionId, loaded.state.persistedAckedSeq, loaded.state.recoveryJson);
      await updateSession(sessionId, { recovery });
    }
  }

  if (payload.type === "session:ack") {
    const session = buildServerFirstSession(loaded.session, loaded.state);
    sendEnvelope(transport, createSessionChatStateEnvelope(session, loaded.state, transportState?.ackedSeq ?? loaded.state.persistedAckedSeq));
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

  let reply: LlmRuntimeGenerateResult;
  try {
    reply = await generateSessionReply({
      sessionConfig: loaded.session.sessionConfig,
      messages: loaded.state.messages,
    });
  } catch (error) {
    reply = {
      success: false,
      code: "provider-unavailable",
      error: error instanceof Error ? error.message : "LLM runtime request failed",
      metadata: {
        providerId: loaded.session.sessionConfig.providerId,
        modelId: loaded.session.sessionConfig.modelId,
      },
    };
  }

  if (!reply.success) {
    const failure = {
      reason: reply.code,
      message: reply.error,
      at: new Date().toISOString(),
    };
    const updatedSession = await persistSessionChatProgress(sessionId, loaded.session, loaded.state, [userMessage], failure);
    sendEnvelope(transport, createSessionChatError(sessionId, reply.error, {
      code: reply.code,
      runtime: reply.metadata,
    }));

    if (updatedSession) {
      broadcastStateEnvelope(buildServerFirstSession(updatedSession, loaded.state), loaded.state);
    }
    return;
  }

  const assistantMessage = appendMessageToState(loaded.state, {
    id: `${userMessage.id}-assistant`,
    role: "assistant",
    content: reply.content,
    timestamp: timestamp + 1,
    runtime: reply.metadata,
  });

  const updatedSession = await persistSessionChatProgress(sessionId, loaded.session, loaded.state, [userMessage, assistantMessage]);
  broadcastMessageEnvelope(sessionId, loaded.state, assistantMessage);

  if (updatedSession) {
    broadcastStateEnvelope(buildServerFirstSession(updatedSession, loaded.state), loaded.state);
  }
}

const SESSION_CHAT_WS_PATH = "/api/sessions/:id/chat";
const SESSION_CHAT_PATHNAME_REGEX = /^\/api\/sessions\/([^/]+)\/chat$/;

function parseSessionChatUrl(url: URL): { sessionId: string; resumeFromSeq: number | undefined } | null {
  const match = url.pathname.match(SESSION_CHAT_PATHNAME_REGEX);
  if (!match) return null;
  const sessionId = decodeURIComponent(match[1]!);
  const resumeFromSeq = sanitizeSeq(url.searchParams.get("resumeFromSeq"));
  return { sessionId, resumeFromSeq };
}

function isBunWebSocketRegistrar(server: StartedHttpServer): server is BunWebSocketRegistrar {
  return typeof server === "object" && server !== null && "runtime" in server && server.runtime === "bun";
}

export function setupSessionChatWebSocket(server: StartedHttpServer): void {
  if (isBunWebSocketRegistrar(server)) {
    const sockets = new WeakMap<BunWebSocketConnection, SessionChatTransport>();

    server.registerWebSocketRoute({
      path: SESSION_CHAT_WS_PATH,
      matchPath(pathname) {
        return SESSION_CHAT_PATHNAME_REGEX.test(pathname);
      },
      upgrade(request, bunServer) {
        const url = new URL(request.url);
        const parsed = parseSessionChatUrl(url);
        if (!parsed) return false;
        return bunServer.upgrade(request, {
          data: {
            routePath: SESSION_CHAT_WS_PATH,
            sessionId: parsed.sessionId,
            resumeFromSeq: parsed.resumeFromSeq,
          },
        });
      },
      open(socket) {
        const data = socket.data ?? {};
        const sessionId = typeof data.sessionId === "string" ? data.sessionId : null;
        if (!sessionId) {
          socket.close(4000, "missing sessionId");
          return;
        }
        const resumeFromSeq = typeof data.resumeFromSeq === "number" ? data.resumeFromSeq : undefined;
        const transport: SessionChatTransport = {
          send: (payload: string) => socket.send(payload),
          close: (code?: number, reason?: string) => socket.close(code, reason),
        };
        sockets.set(socket, transport);
        void (async () => {
          const attached = await attachSessionChatTransport(sessionId, transport, { resumeFromSeq });
          if (!attached) {
            sockets.delete(socket);
          }
        })();
      },
      message(socket, message) {
        const transport = sockets.get(socket);
        if (!transport) return;
        const sessionId = typeof socket.data?.sessionId === "string" ? socket.data.sessionId : null;
        if (!sessionId) return;
        void handleSessionChatTransportMessage(sessionId, transport, message);
      },
      close(socket) {
        const transport = sockets.get(socket);
        sockets.delete(socket);
        const sessionId = typeof socket.data?.sessionId === "string" ? socket.data.sessionId : null;
        if (transport && sessionId) {
          detachSessionChatTransport(sessionId, transport);
        }
      },
      error(socket) {
        const transport = sockets.get(socket);
        sockets.delete(socket);
        const sessionId = typeof socket.data?.sessionId === "string" ? socket.data.sessionId : null;
        if (transport && sessionId) {
          detachSessionChatTransport(sessionId, transport);
        }
      },
    });

    return;
  }

  const httpServer = server as NodeHttpServer;
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const parsed = parseSessionChatUrl(url);
    if (!parsed) {
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      void bindNodeSessionChatConnection(parsed.sessionId, ws, { resumeFromSeq: parsed.resumeFromSeq });
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
