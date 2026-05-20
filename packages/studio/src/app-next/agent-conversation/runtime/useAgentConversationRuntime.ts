import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import {
  buildSessionWebSocketUrl,
  createFetchJsonContractClient,
  createSessionClient,
  parseSessionServerEnvelope,
  serializeSessionClientEnvelope,
  type ContractResult,
} from "../../backend-contract";
import type { CanvasContext } from "../../../shared/agent-native-workspace";
import type { NarratorSessionChatSnapshot } from "../../../shared/session-types";
import { buildAbortEnvelope, buildAckEnvelope, buildMessageEnvelope, type BuildMessageEnvelopeInput } from "./session-actions";
import {
  createInitialAgentConversationRuntimeState,
  getResumeFromSeq,
  reduceSessionEnvelope,
  type SessionServerEnvelope,
} from "./ws-envelope-reducer";

export interface AgentConversationRuntimeSocket {
  readonly readyState?: number;
  onmessage: ((event: any) => void) | null;
  onopen?: ((event?: any) => void) | null;
  onerror?: ((event: any) => void) | null;
  onclose?: ((event: any) => void) | null;
  send(payload: string): void;
  close(): void;
}

export interface AgentConversationRuntimeClient {
  getChatState(sessionId: string): Promise<ContractResult<NarratorSessionChatSnapshot>>;
}

export interface UseAgentConversationRuntimeOptions {
  sessionId?: string;
  sessionMode?: BuildMessageEnvelopeInput["sessionMode"];
  canvasContext?: CanvasContext;
  baseUrl?: string;
  client?: AgentConversationRuntimeClient;
  createWebSocket?: (url: string) => AgentConversationRuntimeSocket;
  createMessageId?: () => string;
}

function createDefaultRuntimeClient(): AgentConversationRuntimeClient {
  return createSessionClient(createFetchJsonContractClient());
}

function createDefaultWebSocket(url: string): AgentConversationRuntimeSocket {
  return new WebSocket(url);
}

function createDefaultMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `client-${Date.now()}`;
}

function contractResultErrorMessage(result: ContractResult<unknown>, fallback: string): string {
  if (result.ok) return fallback;
  const error = result.error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (record.error && typeof record.error === "object") {
      const nested = record.error as Record<string, unknown>;
      if (typeof nested.message === "string") return nested.message;
    }
  }
  if (typeof error === "string") return error;
  return result.code ? `${fallback}：${result.code}` : fallback;
}

const WEB_SOCKET_OPEN = 1;

/** Reconnection config */
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_MAX_ATTEMPTS = 10;

function dispatchRuntimeError(dispatch: (envelope: SessionServerEnvelope) => void, sessionId: string | undefined, message: string, runtime?: unknown) {
  dispatch({ type: "session:error", sessionId, error: message, code: "runtime-error", runtime });
}

function isRuntimeSocketOpen(socket: AgentConversationRuntimeSocket): boolean {
  return typeof socket.readyState !== "number" || socket.readyState === WEB_SOCKET_OPEN;
}

export function useAgentConversationRuntime(options: UseAgentConversationRuntimeOptions = {}) {
  const {
    sessionId,
    sessionMode,
    canvasContext,
    baseUrl,
    client,
    createWebSocket = createDefaultWebSocket,
    createMessageId = createDefaultMessageId,
  } = options;
  const [state, dispatch] = useReducer(reduceSessionEnvelope, undefined, createInitialAgentConversationRuntimeState);
  const socketRef = useRef<AgentConversationRuntimeSocket | null>(null);
  const pendingClientEnvelopesRef = useRef<string[]>([]);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  const lastSeqRef = useRef(0);

  // Keep lastSeqRef in sync with state for reconnection sync checks
  useEffect(() => {
    lastSeqRef.current = state.lastSeq;
  }, [state.lastSeq]);

  const applyEnvelope = useCallback((envelope: SessionServerEnvelope) => dispatch(envelope), []);
  const flushPendingClientEnvelopes = useCallback((socket: AgentConversationRuntimeSocket | null = socketRef.current) => {
    if (!socket || !isRuntimeSocketOpen(socket)) return;
    const pending = pendingClientEnvelopesRef.current.splice(0);
    for (const payload of pending) {
      socket.send(payload);
    }
  }, []);

  const connectWebSocket = useCallback((sid: string, resumeFromSeq: number, runtimeClient: AgentConversationRuntimeClient) => {
    const socket = createWebSocket(buildSessionWebSocketUrl(sid, { baseUrl, resumeFromSeq }));
    socketRef.current = socket;
    intentionalCloseRef.current = false;

    socket.onmessage = (event) => {
      try {
        dispatch(parseSessionServerEnvelope(event.data) as SessionServerEnvelope);
      } catch (error) {
        dispatchRuntimeError(dispatch, sid, error instanceof Error ? error.message : String(error), error);
      }
    };

    socket.onopen = () => {
      reconnectAttemptRef.current = 0;
      if (socketRef.current === socket) flushPendingClientEnvelopes(socket);
    };

    socket.onerror = (event) => {
      dispatchRuntimeError(dispatch, sid, "会话 WebSocket 连接失败", event);
    };

    socket.onclose = () => {
      if (intentionalCloseRef.current || socketRef.current !== socket) return;

      // Auto-reconnect with exponential backoff
      const attempt = reconnectAttemptRef.current;
      if (attempt >= RECONNECT_MAX_ATTEMPTS) {
        dispatchRuntimeError(dispatch, sid, "WebSocket 重连次数已达上限，请刷新页面");
        return;
      }

      const delay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt), RECONNECT_MAX_DELAY_MS);
      reconnectAttemptRef.current = attempt + 1;

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (intentionalCloseRef.current) return;
        connectWebSocket(sid, lastSeqRef.current, runtimeClient);
      }, delay);
    };

    return socket;
  }, [baseUrl, createWebSocket, flushPendingClientEnvelopes]);

  useEffect(() => {
    if (!sessionId) return undefined;

    // Reset state immediately when sessionId changes to avoid showing stale data
    dispatch({ type: "session:reset" });

    let cancelled = false;
    intentionalCloseRef.current = false;
    reconnectAttemptRef.current = 0;
    const runtimeClient = client ?? createDefaultRuntimeClient();

    void runtimeClient.getChatState(sessionId).then(
      (result) => {
        if (cancelled) return;
        if (!result.ok) {
          dispatchRuntimeError(dispatch, sessionId, contractResultErrorMessage(result, "会话快照加载失败"));
          return;
        }

        const snapshot = result.data;
        dispatch({ type: "session:snapshot", snapshot, recovery: { state: "idle", reason: "initial-hydration" } });
        const resumeFromSeq = snapshot.cursor?.lastSeq ?? Math.max(0, ...snapshot.messages.map((message) => message.seq ?? 0));
        connectWebSocket(sessionId, resumeFromSeq, runtimeClient);
      },
      (error: unknown) => {
        if (!cancelled) dispatchRuntimeError(dispatch, sessionId, error instanceof Error ? error.message : String(error), error);
      },
    );

    // Visibility change detection: reconnect when tab becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const socket = socketRef.current;
      // If socket is closed/closing, trigger reconnect
      if (!socket || (typeof socket.readyState === "number" && socket.readyState > WEB_SOCKET_OPEN)) {
        // Clear any pending reconnect timer and reconnect immediately
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        reconnectAttemptRef.current = 0;
        connectWebSocket(sessionId, lastSeqRef.current, runtimeClient);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      intentionalCloseRef.current = true;
      pendingClientEnvelopesRef.current = [];
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [baseUrl, connectWebSocket, flushPendingClientEnvelopes, sessionId]);

  const sendClientEnvelope = useCallback((envelope: ReturnType<typeof buildMessageEnvelope> | ReturnType<typeof buildAckEnvelope> | ReturnType<typeof buildAbortEnvelope>) => {
    const payload = serializeSessionClientEnvelope(envelope);
    const socket = socketRef.current;
    if (!socket) return envelope;
    if (!isRuntimeSocketOpen(socket)) {
      pendingClientEnvelopesRef.current.push(payload);
      return envelope;
    }
    socket.send(payload);
    return envelope;
  }, []);

  const sendMessage = useCallback(
    (content: string, attachments?: Array<{ type: "image"; mimeType: string; data: string; fileName?: string }>) => {
      if (!sessionId) return null;
      dispatch({ type: "client:message-sent" });
      return sendClientEnvelope(buildMessageEnvelope({
        sessionId,
        messageId: createMessageId(),
        content,
        sessionMode,
        ack: getResumeFromSeq(state),
        canvasContext,
        attachments,
      }));
    },
    [canvasContext, createMessageId, sendClientEnvelope, sessionId, sessionMode, state],
  );

  const ack = useCallback((ackSeq = getResumeFromSeq(state)) => {
    if (!sessionId) return null;
    return sendClientEnvelope(buildAckEnvelope({ sessionId, ack: ackSeq }));
  }, [sendClientEnvelope, sessionId, state]);

  const abort = useCallback(() => {
    if (!sessionId) return null;
    return sendClientEnvelope(buildAbortEnvelope({ sessionId }));
  }, [sendClientEnvelope, sessionId]);

  const clearError = useCallback(() => dispatch({ type: "client:clear-error" }), []);

  return useMemo(
    () => ({
      state,
      applyEnvelope,
      clearError,
      getResumeFromSeq: () => getResumeFromSeq(state),
      buildMessageEnvelope: (input: BuildMessageEnvelopeInput) => buildMessageEnvelope(input),
      buildAckEnvelope,
      buildAbortEnvelope,
      sendMessage,
      ack,
      abort,
    }),
    [abort, ack, applyEnvelope, clearError, sendMessage, state],
  );
}
