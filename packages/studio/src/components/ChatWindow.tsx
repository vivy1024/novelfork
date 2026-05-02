import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Braces,
  ChevronRight,
  Clock3,
  Cpu,
  GitBranch,
  PlusCircle,
  Settings2,
  Wifi,
  WifiOff,
  Wrench,
} from "lucide-react";

import type { StudioRun } from "../shared/contracts";
import type { Theme } from "../hooks/use-theme";
import { useColors } from "../hooks/use-colors";
import { WindowControls } from "./WindowControls";
import { useWindowRuntimeStore, type WindowRecoveryState } from "../stores/windowRuntimeStore";
import { RecoveryBadge } from "./RecoveryBadge";
import { useWindowStore } from "../stores/windowStore";
import type { ChatMessage, ToolCall } from "../shared/session-types";
import type { ChatWindow as ChatWindowState } from "../stores/windowStore";
import {
  buildToolCallSummary,
  formatToolCallDuration,
  getToolCallStatusLabel,
  normalizeToolCall,
  parseAssistantPayload,
  ToolCallBlock,
} from "./ToolCall";
import { ContextPanel, type ContextEntry } from "./ContextPanel";
import { Button } from "./ui/button";
import { fetchJson } from "../hooks/use-api";
import { notify } from "@/lib/notify";
import { maybeShowClosedWindowHint } from "@/lib/closed-window-hint";
import {
  findRuntimeModelByRef,
  runtimeModelLabel,
  runtimeModelRef,
  splitRuntimeModelRef,
  usableRuntimeModels,
  type RuntimeModelOption,
} from "@/lib/runtime-model-options";
import { useRunDetails } from "../hooks/use-run-events";
import {
  SESSION_PERMISSION_MODE_OPTIONS,
  getRecommendedSessionPermissionMode,
  getSessionPermissionModeOption,
  normalizeSessionPermissionMode,
  type NarratorSessionChatHistory,
  type NarratorSessionChatMessage,
  type NarratorSessionChatServerEnvelope,
  type NarratorSessionChatSnapshot,
  type NarratorSessionRecord,
  type SessionPermissionMode,
  type SessionReasoningEffort,
} from "../shared/session-types";

interface ChatWindowProps {
  windowId: string;
  theme: Theme;
}

const REASONING_OPTIONS: Array<{ value: SessionReasoningEffort; label: string }> = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

export function ChatWindow({ windowId, theme }: ChatWindowProps) {
  const c = useColors(theme);
  const chatWindow = useWindowStore((state) => state.windows.find((w) => w.id === windowId));
  const isActive = useWindowStore((state) => state.activeWindowId === windowId);
  const removeWindow = useWindowStore((state) => state.removeWindow);
  const toggleMinimize = useWindowStore((state) => state.toggleMinimize);
  const setActiveWindow = useWindowStore((state) => state.setActiveWindow);
  const updateWindow = useWindowStore((state) => state.updateWindow);
  const addWindow = useWindowStore((state) => state.addWindow);
  const wsConnected = useWindowRuntimeStore((state) => state.wsConnections[windowId] ?? false);
  const authoritativeRecoveryState = useWindowRuntimeStore((state) => state.recoveryStates[windowId] ?? "idle");
  const authoritativeSnapshot = useWindowRuntimeStore((state) => state.chatSnapshots[windowId] ?? null);
  const setWsConnected = useWindowRuntimeStore((state) => state.setWsConnected);
  const setRecoveryState = useWindowRuntimeStore((state) => state.setRecoveryState);
  const setChatSnapshot = useWindowRuntimeStore((state) => state.setChatSnapshot);
  const clearWindowRuntime = useWindowRuntimeStore((state) => state.clearWindowRuntime);

  const [input, setInput] = useState("");
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [executionChainExpanded, setExecutionChainExpanded] = useState(false);
  const [recoveryFailure, setRecoveryFailure] = useState<string | null>(null);
  const [runtimeModels, setRuntimeModels] = useState<RuntimeModelOption[] | null>(null);
  const sessionMessagesRef = useRef<ChatMessage[]>([]);
  const sessionRecordRef = useRef<NarratorSessionRecord | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const lastSessionSeqRef = useRef(0);
  const manualReconnectRef = useRef<(() => void) | null>(null);

  const syncSessionRecord = useCallback(
    (nextSession: NarratorSessionRecord) => {
      sessionRecordRef.current = nextSession;
      updateWindow(windowId, {
        title: nextSession.title,
        sessionMode: nextSession.sessionMode,
      });
    },
    [updateWindow, windowId],
  );

  const syncSessionMessages = useCallback((nextMessages: ChatMessage[]) => {
    sessionMessagesRef.current = nextMessages;
  }, []);

  const syncAuthoritativeSnapshot = useCallback((
    nextSession: NarratorSessionRecord,
    nextMessages: ChatMessage[],
    nextSeq?: number,
  ) => {
    setChatSnapshot(windowId, {
      session: nextSession,
      messages: nextMessages.map(toNarratorSessionChatMessage),
      cursor: {
        lastSeq: typeof nextSeq === "number" && Number.isFinite(nextSeq)
          ? Math.max(0, Math.floor(nextSeq))
          : getLastSessionSeq(nextMessages.map(toNarratorSessionChatMessage)),
      },
    });
  }, [setChatSnapshot, windowId]);

  const syncSessionSeq = useCallback((nextSeq?: number) => {
    if (typeof nextSeq !== "number" || !Number.isFinite(nextSeq)) {
      return;
    }

    lastSessionSeqRef.current = Math.max(lastSessionSeqRef.current, Math.floor(nextSeq));
  }, []);

  const getCurrentSessionRecord = useCallback(() => {
    return sessionRecordRef.current ?? useWindowRuntimeStore.getState().chatSnapshots[windowId]?.session ?? null;
  }, [windowId]);

  const ackSessionSeq = useCallback(() => {
    if (!chatWindow?.sessionId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || lastSessionSeqRef.current <= 0) {
      return;
    }

    wsRef.current.send(
      JSON.stringify({
        type: "session:ack",
        sessionId: chatWindow.sessionId,
        ack: lastSessionSeqRef.current,
      }),
    );
  }, [chatWindow?.sessionId]);

  const updateRecoveryState = useCallback((nextState: WindowRecoveryState) => {
    if (nextState !== "failed") {
      setRecoveryFailure(null);
    }
    setRecoveryState(windowId, nextState);
  }, [setRecoveryState, windowId]);

  useEffect(() => {
    if (!authoritativeSnapshot) {
      return;
    }

    sessionRecordRef.current = authoritativeSnapshot.session;
    syncSessionMessages(authoritativeSnapshot.messages.map(toChatWindowMessage));
    syncSessionSeq(authoritativeSnapshot.cursor?.ackedSeq ?? authoritativeSnapshot.cursor?.lastSeq ?? getLastSessionSeq(authoritativeSnapshot.messages));
  }, [authoritativeSnapshot, syncSessionMessages, syncSessionSeq]);

  useEffect(() => {
    lastSessionSeqRef.current = 0;
    sessionMessagesRef.current = [];
    sessionRecordRef.current = null;
    setChatSnapshot(windowId, null);
    updateRecoveryState("idle");
    setRecoveryFailure(null);
    setExecutionChainExpanded(false);
  }, [chatWindow?.sessionId, setChatSnapshot, updateRecoveryState, windowId]);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ models?: RuntimeModelOption[] }>("/api/providers/models")
      .then((response) => {
        if (!cancelled) {
          setRuntimeModels(usableRuntimeModels(response.models));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRuntimeModels([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const persistSessionMessages = useCallback(
    async (nextMessages: ChatMessage[]) => {
      if (!chatWindow?.sessionId) {
        syncSessionMessages(nextMessages);
        return;
      }

      const snapshot = await fetchJson<NarratorSessionChatSnapshot>(`/api/sessions/${chatWindow.sessionId}/chat/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(toNarratorSessionChatMessage),
        }),
      });

      if (!snapshot?.session?.sessionConfig) {
        return;
      }

      const syncedMessages = snapshot.messages.map(toChatWindowMessage);
      const nextSeq = snapshot.cursor?.lastSeq ?? getLastSessionSeq(snapshot.messages);
      syncSessionRecord(snapshot.session);
      syncSessionSeq(nextSeq);
      syncSessionMessages(syncedMessages);
      syncAuthoritativeSnapshot(snapshot.session, syncedMessages, nextSeq);
      ackSessionSeq();
    },
    [ackSessionSeq, chatWindow?.sessionId, syncAuthoritativeSnapshot, syncSessionMessages, syncSessionRecord, syncSessionSeq],
  );

  const handleSessionTransportMessage = useCallback(
    async (rawData: unknown) => {
      const rawText = await normalizeSessionChatPayloadText(rawData);
      if (!rawText) {
        return;
      }

      const envelope = parseSessionChatEnvelope(rawText);
      if (envelope) {
        if (envelope.type === "session:snapshot") {
          updateRecoveryState(envelope.recovery?.state ?? "idle");
          const nextMessages = envelope.snapshot.messages.map(toChatWindowMessage);
          const nextSeq = envelope.snapshot.cursor?.ackedSeq ?? envelope.snapshot.cursor?.lastSeq ?? getLastSessionSeq(envelope.snapshot.messages);
          syncSessionRecord(envelope.snapshot.session);
          syncSessionSeq(nextSeq);
          syncSessionMessages(nextMessages);
          syncAuthoritativeSnapshot(envelope.snapshot.session, nextMessages, nextSeq);
          ackSessionSeq();
          return;
        }

        if (envelope.type === "session:state") {
          if (envelope.recovery?.state) {
            updateRecoveryState(envelope.recovery.state);
          }
          syncSessionRecord(envelope.session);
          syncSessionSeq(envelope.cursor?.ackedSeq ?? envelope.cursor?.lastSeq);
          syncAuthoritativeSnapshot(envelope.session, sessionMessagesRef.current, envelope.cursor?.ackedSeq ?? envelope.cursor?.lastSeq);
          return;
        }

        if (envelope.type === "session:message") {
          updateRecoveryState("idle");
          syncSessionSeq(envelope.message.seq ?? envelope.cursor?.lastSeq);
          const nextMessage = toChatWindowMessage(envelope.message);
          if (sessionMessagesRef.current.some((message) => message.id === nextMessage.id)) {
            ackSessionSeq();
            return;
          }
          const nextMessages = [...sessionMessagesRef.current, nextMessage];
          syncSessionMessages(nextMessages);
          const nextSession = getCurrentSessionRecord();
          if (nextSession) {
            syncAuthoritativeSnapshot(
              {
                ...nextSession,
                messageCount: Math.max(nextSession.messageCount, nextMessages.length),
              },
              nextMessages,
              envelope.message.seq ?? envelope.cursor?.lastSeq,
            );
          }
          ackSessionSeq();
          return;
        }

        if (envelope.type === "session:error") {
          console.error("Session chat error:", envelope.error);
          setWsConnected(windowId, false);
          setRecoveryFailure(envelope.error);
          updateRecoveryState("failed");
          return;
        }
      }

      try {
        updateRecoveryState("idle");
        const parsed = parseAssistantPayload(JSON.parse(rawText), rawText);
        const message: ChatMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: "assistant",
          content: parsed.content,
          timestamp: Date.now(),
          toolCalls: parsed.toolCalls.length > 0 ? parsed.toolCalls : undefined,
        };
        const nextMessages = [...sessionMessagesRef.current, message];
        syncSessionMessages(nextMessages);
        const nextSession = getCurrentSessionRecord();
        if (nextSession) {
          syncAuthoritativeSnapshot(
            {
              ...nextSession,
              messageCount: Math.max(nextSession.messageCount, nextMessages.length),
            },
            nextMessages,
          );
        }
      } catch {
        updateRecoveryState("idle");
        const message: ChatMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: "assistant",
          content: rawText,
          timestamp: Date.now(),
        };
        const nextMessages = [...sessionMessagesRef.current, message];
        syncSessionMessages(nextMessages);
        const nextSession = getCurrentSessionRecord();
        if (nextSession) {
          syncAuthoritativeSnapshot(
            {
              ...nextSession,
              messageCount: Math.max(nextSession.messageCount, nextMessages.length),
            },
            nextMessages,
          );
        }
      }
    },
    [ackSessionSeq, getCurrentSessionRecord, setWsConnected, syncAuthoritativeSnapshot, syncSessionMessages, syncSessionRecord, syncSessionSeq, updateRecoveryState, windowId],
  );

  useEffect(() => {
    const sessionId = chatWindow?.sessionId;
    if (!sessionId) {
      return;
    }

    let cancelled = false;
    updateRecoveryState("recovering");
    void fetchJson<NarratorSessionChatSnapshot>(`/api/sessions/${sessionId}/chat/state`)
      .then((snapshot) => {
        if (cancelled || !snapshot?.session?.sessionConfig) {
          return;
        }

        const nextMessages = snapshot.messages.map(toChatWindowMessage);
        const nextSeq = snapshot.cursor?.ackedSeq ?? snapshot.cursor?.lastSeq ?? getLastSessionSeq(snapshot.messages);
        syncSessionRecord(snapshot.session);
        syncSessionSeq(nextSeq);
        syncSessionMessages(nextMessages);
        syncAuthoritativeSnapshot(snapshot.session, nextMessages, nextSeq);
        updateRecoveryState("idle");
      })
      .catch((error) => {
        if (!cancelled) {
          setRecoveryFailure(error instanceof Error ? error.message : "无法加载正式会话快照");
          updateRecoveryState("failed");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chatWindow?.sessionId, syncAuthoritativeSnapshot, syncSessionRecord, syncSessionSeq, syncSessionMessages, updateRecoveryState, windowId]);

  const hydrateReconnectHistory = useCallback(
    async (sessionId: string, sinceSeq: number) => {
      if (sinceSeq <= 0) {
        updateRecoveryState("idle");
        return;
      }

      try {
        if (useWindowRuntimeStore.getState().recoveryStates[windowId] !== "resetting") {
          updateRecoveryState("replaying");
        }
        const history = await fetchJson<Partial<NarratorSessionChatHistory>>(`/api/sessions/${sessionId}/chat/history?sinceSeq=${sinceSeq}`);
        if (!history || !Array.isArray(history.messages)) {
          throw new Error("会话历史响应缺少 messages");
        }
        if (history.resetRequired) {
          updateRecoveryState("resetting");
          const snapshot = await fetchJson<NarratorSessionChatSnapshot>(`/api/sessions/${sessionId}/chat/state`);
          const nextMessages = snapshot.messages.map(toChatWindowMessage);
          const nextSeq = snapshot.cursor?.ackedSeq ?? snapshot.cursor?.lastSeq ?? getLastSessionSeq(snapshot.messages);
          syncSessionRecord(snapshot.session);
          syncSessionSeq(nextSeq);
          syncSessionMessages(nextMessages);
          syncAuthoritativeSnapshot(snapshot.session, nextMessages, nextSeq);
          ackSessionSeq();
          updateRecoveryState("idle");
          return;
        }

        const nextSeq = history.cursor?.lastSeq ?? getLastSessionSeq(history.messages);
        syncSessionSeq(nextSeq);
        if (history.messages.length === 0) {
          const nextSession = getCurrentSessionRecord();
          if (nextSession) {
            syncAuthoritativeSnapshot(nextSession, sessionMessagesRef.current, nextSeq);
          }
          ackSessionSeq();
          updateRecoveryState("idle");
          return;
        }

        const nextMessages = mergeSessionMessages(sessionMessagesRef.current, history.messages);
        syncSessionMessages(nextMessages);
        const nextSession = getCurrentSessionRecord();
        if (nextSession) {
          syncAuthoritativeSnapshot(
            {
              ...nextSession,
              messageCount: Math.max(nextSession.messageCount, nextMessages.length),
            },
            nextMessages,
            nextSeq,
          );
        }
        ackSessionSeq();
        updateRecoveryState("idle");
      } catch (error) {
        setRecoveryFailure(error instanceof Error ? error.message : "会话历史回放失败");
        updateRecoveryState("failed");
      }
    },
    [ackSessionSeq, getCurrentSessionRecord, syncAuthoritativeSnapshot, syncSessionRecord, syncSessionSeq, syncSessionMessages, updateRecoveryState, windowId],
  );

  useEffect(() => {
    const sessionId = chatWindow?.sessionId;
    if (!sessionId) {
      return;
    }

    let disposed = false;
    const sessionMode = sessionRecordRef.current?.sessionMode ?? authoritativeSnapshot?.session.sessionMode ?? chatWindow?.sessionMode ?? "chat";

    const connectWs = () => {
      if (disposed) {
        return;
      }

      const protocol = globalThis.window.location.protocol === "https:" ? "wss:" : "ws:";
      const params = new URLSearchParams();
      params.set("mode", sessionMode);
      if (lastSessionSeqRef.current > 0) {
        params.set("resumeFromSeq", String(lastSessionSeqRef.current));
      }
      const wsUrl = `${protocol}//${globalThis.window.location.host}/api/sessions/${sessionId}/chat?${params.toString()}`;

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setWsConnected(windowId, true);
          if (reconnectTimerRef.current !== null) {
            globalThis.clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
          if (lastSessionSeqRef.current > 0) {
            if (useWindowRuntimeStore.getState().recoveryStates[windowId] !== "resetting") {
              updateRecoveryState("replaying");
            }
          } else {
            updateRecoveryState("idle");
          }
          void hydrateReconnectHistory(sessionId, lastSessionSeqRef.current);
        };

        ws.onmessage = (event) => {
          void handleSessionTransportMessage(event.data);
        };

        ws.onerror = () => {
          setWsConnected(windowId, false);
        };

        ws.onclose = () => {
          setWsConnected(windowId, false);
          if (disposed) {
            return;
          }
          updateRecoveryState("reconnecting");
          if (reconnectTimerRef.current !== null) {
            globalThis.clearTimeout(reconnectTimerRef.current);
          }
          reconnectTimerRef.current = globalThis.window.setTimeout(connectWs, 5000);
        };
      } catch (error) {
        console.error("WebSocket connection failed:", error);
        setWsConnected(windowId, false);
      }
    };

    // Expose the connect function so the UI can trigger an immediate retry
    // instead of waiting for the 5s auto-reconnect timer. Detach the old ws's
    // handlers before closing, otherwise its async `onclose` would still flip
    // `wsConnected`/`recoveryState` back and schedule a redundant 5s reconnect
    // timer on top of the fresh connection we are about to create.
    manualReconnectRef.current = () => {
      if (disposed) return;
      if (reconnectTimerRef.current !== null) {
        globalThis.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const previous = wsRef.current;
      if (previous) {
        previous.onopen = null;
        previous.onmessage = null;
        previous.onerror = null;
        previous.onclose = null;
        if (previous.readyState !== WebSocket.CLOSED) {
          try {
            previous.close();
          } catch {
            // close() can throw in some browsers when the socket is already
            // closing; the handler detach above is what actually matters.
          }
        }
        wsRef.current = null;
      }
      connectWs();
    };

    connectWs();

    return () => {
      disposed = true;
      manualReconnectRef.current = null;
      clearWindowRuntime(windowId);
      if (reconnectTimerRef.current !== null) {
        globalThis.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [chatWindow?.sessionId, chatWindow?.sessionMode, clearWindowRuntime, handleSessionTransportMessage, hydrateReconnectHistory, setWsConnected, windowId]);

  const effectiveMessages = authoritativeSnapshot?.messages.map(toChatWindowMessage) ?? [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [effectiveMessages]);

  const handleReplayToolCall = useCallback(async (toolCall: ToolCall) => {
    const toolKind = normalizeReplayToolKind(toolCall.toolName);
    const input = asRecord(toolCall.input) ?? {};

    let replayResponse: unknown;
    if (toolKind === "mcp") {
      const serverId = typeof input.serverId === "string" ? input.serverId : undefined;
      const tool = typeof input.tool === "string" ? input.tool : undefined;
      if (!serverId || !tool) {
        return;
      }

      replayResponse = await fetchJson(`/api/mcp/servers/${serverId}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool,
          arguments: asRecord(input.arguments) ?? {},
        }),
      });
    } else {
      replayResponse = await fetchJson("/api/tools/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolName: toolCall.toolName,
          params: input,
        }),
      });
    }

    const replayMessage = buildReplayAssistantMessage(toolCall, replayResponse);
    await persistSessionMessages([...sessionMessagesRef.current, replayMessage]);
  }, [persistSessionMessages]);

  const recentExecutionChain = buildRecentExecutionChain(effectiveMessages);
  const recentExecutionRunId = useMemo(
    () => extractRecentExecutionRunId(recentExecutionChain?.calls),
    [recentExecutionChain?.calls],
  );
  const recentExecutionRun = useRunDetails(recentExecutionRunId);
  const recentExecutionFacts = useMemo(
    () => buildRecentExecutionFacts(recentExecutionRunId, recentExecutionRun),
    [recentExecutionRun, recentExecutionRunId],
  );

  if (!chatWindow) return null;

  const runtimeModelOptions = runtimeModels ?? [];
  const defaultRuntimeModel = runtimeModelOptions[0] ?? null;
  const defaultRuntimeModelSelection = defaultRuntimeModel ? splitRuntimeModelRef(defaultRuntimeModel) : null;
  const sessionState = authoritativeSnapshot?.session ?? {
    title: chatWindow.title,
    sessionMode: chatWindow.sessionMode ?? "chat",
    sessionConfig: {
      providerId: defaultRuntimeModelSelection?.providerId ?? "",
      modelId: defaultRuntimeModelSelection?.modelId ?? "",
      permissionMode: getRecommendedSessionPermissionMode({
        agentId: chatWindow.agentId,
        sessionMode: chatWindow.sessionMode ?? "chat",
      }),
      reasoningEffort: "medium" as SessionReasoningEffort,
    },
    messageCount: effectiveMessages.length,
  };
  const storedModelRef = runtimeModelRef(sessionState.sessionConfig.providerId, sessionState.sessionConfig.modelId);
  const selectedRuntimeModel = findRuntimeModelByRef(runtimeModelOptions, storedModelRef);
  const activeRuntimeModel = selectedRuntimeModel ?? defaultRuntimeModel;
  const activeRuntimeModelSelection = activeRuntimeModel ? splitRuntimeModelRef(activeRuntimeModel) : null;
  const sessionConfig = {
    ...sessionState.sessionConfig,
    providerId: activeRuntimeModelSelection?.providerId ?? sessionState.sessionConfig.providerId ?? "",
    modelId: activeRuntimeModelSelection?.modelId ?? sessionState.sessionConfig.modelId ?? "",
    permissionMode: normalizeSessionPermissionMode(
      sessionState.sessionConfig.permissionMode,
      getRecommendedSessionPermissionMode({ agentId: chatWindow.agentId, sessionMode: sessionState.sessionMode }),
    ),
  };
  const selectedPermission = getSessionPermissionModeOption(sessionConfig.permissionMode);

  const activeModelRefValue = activeRuntimeModelSelection?.modelRef ?? "";
  const hasRuntimeModels = runtimeModelOptions.length > 0;
  const modelPoolEmpty = runtimeModels !== null && !hasRuntimeModels;
  const tokenBudget = activeRuntimeModel?.contextWindow ?? 200000;
  const contextSummary = buildSessionContextSummary(effectiveMessages, tokenBudget);
  const contextEntries = buildContextEntries(effectiveMessages);
  const contextSeverityLabel =
    contextSummary.percentage >= 80 ? "临界" : contextSummary.percentage >= 60 ? "警告" : "安全";
  const contextSeverityClassName =
    contextSummary.percentage >= 80
      ? "text-red-600"
      : contextSummary.percentage >= 60
        ? "text-amber-600"
        : "text-emerald-600";
  const sessionBreadcrumb = buildSessionBreadcrumb(chatWindow);

  const handleSend = () => {
    if (modelPoolEmpty || !input.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const userMessage: ChatMessage = {
      id: messageId,
      role: "user",
      content: input,
      timestamp: Date.now(),
    };

    const nextMessages = [...sessionMessagesRef.current, userMessage];
    syncSessionMessages(nextMessages);
    const nextSession = getCurrentSessionRecord();
    if (nextSession) {
      syncAuthoritativeSnapshot(
        {
          ...nextSession,
          messageCount: Math.max(nextSession.messageCount, nextMessages.length),
        },
        nextMessages,
      );
    }
    wsRef.current.send(
      JSON.stringify({
        type: "session:message",
        messageId,
        content: input,
        sessionId: chatWindow.sessionId,
        sessionMode: sessionState.sessionMode,
        ack: lastSessionSeqRef.current,
      }),
    );
    setInput("");
  };

  const handleMaximize = () => {
    useWindowStore.getState().updateLayout(windowId, { x: 0, y: 0, w: 12, h: 12 });
  };

  const lastMessage = effectiveMessages[effectiveMessages.length - 1];
  const lastMessageTime = lastMessage
    ? new Date(lastMessage.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "--:--";
  const updateSessionConfig = (updates: Partial<NarratorSessionRecord["sessionConfig"]>) => {
    const nextSessionConfig = {
      ...sessionConfig,
      ...updates,
    };

    const currentSession = getCurrentSessionRecord();
    if (currentSession) {
      syncAuthoritativeSnapshot(
        {
          ...currentSession,
          sessionConfig: nextSessionConfig,
        },
        sessionMessagesRef.current,
        lastSessionSeqRef.current,
      );
    }

    if (chatWindow.sessionId) {
      void fetchJson<NarratorSessionRecord>(`/api/sessions/${chatWindow.sessionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionConfig: nextSessionConfig,
        }),
      })
        .then((session) => {
          if (!session?.sessionConfig) {
            return;
          }
          syncSessionRecord(session);
          syncAuthoritativeSnapshot(session, sessionMessagesRef.current, lastSessionSeqRef.current);
        })
        .catch(() => {
          // keep local state even if the persistence write fails
        });
    }
  };

  const retryRecovery = async () => {
    if (!chatWindow.sessionId) return;
    setRecoveryFailure(null);
    updateRecoveryState("recovering");
    try {
      const snapshot = await fetchJson<NarratorSessionChatSnapshot>(`/api/sessions/${chatWindow.sessionId}/chat/state`);
      const nextMessages = snapshot.messages.map(toChatWindowMessage);
      const nextSeq = snapshot.cursor?.ackedSeq ?? snapshot.cursor?.lastSeq ?? getLastSessionSeq(snapshot.messages);
      syncSessionRecord(snapshot.session);
      syncSessionSeq(nextSeq);
      syncSessionMessages(nextMessages);
      syncAuthoritativeSnapshot(snapshot.session, nextMessages, nextSeq);
      ackSessionSeq();
      manualReconnectRef.current?.();
      updateRecoveryState("idle");
    } catch (error) {
      setRecoveryFailure(error instanceof Error ? error.message : "会话恢复重试失败");
      updateRecoveryState("failed");
    }
  };

  const archiveFailedSession = async () => {
    if (!chatWindow.sessionId) return;
    const session = await fetchJson<NarratorSessionRecord>(`/api/sessions/${chatWindow.sessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    syncSessionRecord(session);
    syncAuthoritativeSnapshot(session, sessionMessagesRef.current, lastSessionSeqRef.current);
    notify.info("会话已归档", { description: "可在会话中心切到“仅看已归档”重新恢复。" });
  };

  const createRecoverySession = async () => {
    const session = await fetchJson<NarratorSessionRecord>("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `${sessionState.title} · 恢复新会话`,
        agentId: chatWindow.agentId,
        sessionMode: sessionState.sessionMode,
        sessionConfig,
      }),
    });

    addWindow({
      agentId: chatWindow.agentId,
      title: session.title,
      sessionId: session.id,
      sessionMode: session.sessionMode,
    });
  };

  return (
    <>
      <div
        className={`flex h-full flex-col overflow-hidden rounded-lg shadow-lg transition-shadow ${isActive ? "ring-1 ring-primary/20" : ""}`}
        style={{ backgroundColor: c.bg, border: `1px solid ${c.border}` }}
        onClick={() => setActiveWindow(windowId)}
      >
        <div
          className="cursor-move px-3 py-2"
          style={{ backgroundColor: c.bgSecondary, borderBottom: `1px solid ${c.border}` }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <Bot size={16} style={{ color: c.accent }} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="shrink-0 rounded-sm border border-border/60 bg-background/70 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
                    title="这是会话的工作台视图 · 关闭窗口不会结束会话"
                  >
                    工作台
                  </span>
                  <span className="max-w-[180px] truncate text-sm font-medium" style={{ color: c.text }}>
                    {sessionState.title}
                  </span>
                  {isActive && (
                    <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      聚焦
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                  <span>Agent {chatWindow.agentId}</span>
                  <span>•</span>
                  {/* 5.7.1 sessionMode as a colored chip so users can distinguish modes at a glance. */}
                  <span
                    className={`rounded-full border px-1.5 py-0.5 font-medium ${
                      sessionState.sessionMode === "plan"
                        ? "border-violet-500/30 bg-violet-500/10 text-violet-700"
                        : "border-sky-500/30 bg-sky-500/10 text-sky-700"
                    }`}
                  >
                    {sessionState.sessionMode === "plan" ? "计划模式" : "对话模式"}
                  </span>
                  <span>•</span>
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-700">
                    {selectedPermission.shortLabel}
                  </span>
                  <span>•</span>
                  <span>{sessionState.messageCount} 条消息</span>
                  {chatWindow.sessionId ? (
                    <>
                      <span>•</span>
                      {/* 5.7.1 click-to-copy sessionId gives a tangible "session is the object" signal. */}
                      <button
                        type="button"
                        title={`点击复制完整 session ID: ${chatWindow.sessionId}`}
                        onClick={async (e) => {
                          e.stopPropagation();
                          const sid = chatWindow.sessionId;
                          if (!sid) return;
                          try {
                            await navigator.clipboard.writeText(sid);
                            notify.success("会话 ID 已复制");
                          } catch {
                            notify.error("复制失败", { description: "浏览器拒绝了剪贴板写入" });
                          }
                        }}
                        className="rounded border border-transparent px-1 font-mono hover:border-border hover:bg-muted/60 transition-colors"
                      >
                        #{shortSessionId(chatWindow.sessionId)}
                      </button>
                    </>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                  {sessionBreadcrumb.map((segment, index) => (
                    <Fragment key={`${segment}-${index}`}>
                      {index > 0 ? <ChevronRight className="size-3 opacity-50" /> : null}
                      <span className="rounded-full border border-border/60 bg-background/70 px-2 py-0.5">{segment}</span>
                    </Fragment>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {wsConnected ? (
                <span title="已连接">
                  <Wifi size={12} style={{ color: "#10b981" }} />
                </span>
              ) : (
                <span title="未连接">
                  <WifiOff size={12} style={{ color: "#ef4444" }} />
                </span>
              )}
              {(() => {
                // 5.7.2 / 5.7.3 — close-button affordance reflects whether the window
                // carries real content. We do not want a toast on "opened and closed
                // immediately" flows (empty window), but we do want exactly one
                // "session is kept" hint the first time a user closes a populated window.
                const hasContent =
                  (sessionState.messageCount ?? 0) > 0 || effectiveMessages.length > 0;
                const closeTooltip = hasContent
                  ? "关闭窗口 · 会话仍保留在会话中心"
                  : "关闭窗口（会话为空）";
                const handleClose = () => {
                  maybeShowClosedWindowHint({ hasContent });
                  clearWindowRuntime(windowId);
                  removeWindow(windowId);
                };
                return (
                  <WindowControls
                    theme={theme}
                    minimized={chatWindow.minimized}
                    onMinimize={() => toggleMinimize(windowId)}
                    onMaximize={handleMaximize}
                    onClose={handleClose}
                    closeTooltip={closeTooltip}
                  />
                );
              })()}
            </div>
          </div>
        </div>

        {!chatWindow.minimized && (
          <>
            <RecoveryBadge
              recoveryState={authoritativeRecoveryState}
              wsConnected={wsConnected}
              variant="banner"
              action={
                authoritativeRecoveryState === "failed"
                  ? {
                      label: "重试恢复",
                      title: "重新拉取服务端快照并重建 WebSocket",
                      onClick: () => void retryRecovery(),
                    }
                  : (!wsConnected || authoritativeRecoveryState === "reconnecting") &&
                    authoritativeRecoveryState !== "resetting"
                    ? {
                        label: "立即重连",
                        title: "跳过 5 秒退避，立即重新握手",
                        onClick: () => manualReconnectRef.current?.(),
                      }
                    : undefined
              }
            />

            {authoritativeRecoveryState === "failed" ? (
              <div className="border-b border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-700">
                <div className="font-medium">恢复失败原因：{recoveryFailure ?? "服务端未返回具体原因"}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="xs" onClick={() => void retryRecovery()}>
                    重试恢复
                  </Button>
                  <Button type="button" variant="outline" size="xs" onClick={() => void archiveFailedSession()}>
                    归档会话
                  </Button>
                  <Button type="button" variant="outline" size="xs" onClick={() => void createRecoverySession()}>
                    新开会话
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="grid gap-2 border-b px-3 py-2 text-[10px] sm:grid-cols-5" style={{ borderColor: c.border, backgroundColor: c.bgSecondary }}>
              <SessionMetric label="连接" value={wsConnected ? "在线" : "离线"} />
              <SessionMetric label="确认边界" value={`ack:${authoritativeSnapshot?.cursor?.ackedSeq ?? lastSessionSeqRef.current}/${authoritativeSnapshot?.cursor?.lastSeq ?? lastSessionSeqRef.current}`} />
              <SessionMetric label="位置" value={`x:${chatWindow.position.x} y:${chatWindow.position.y}`} />
              <SessionMetric label="权限" value={selectedPermission.shortLabel} />
              <SessionMetric label="最近活动" value={lastMessageTime} />
            </div>

            <div className="border-b px-3 py-3" style={{ borderColor: c.border, backgroundColor: c.bgSecondary }}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Settings2 className="size-4 text-primary" />
                    当前会话控制
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    对齐 NarraFork：让上下文、模型、权限和推理强度直接暴露在当前会话里，而不是藏到设置页。
                  </p>
                </div>
                <div className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                  会话控制
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,1fr)]">
                <div className="space-y-3">
                  <div className="rounded-xl border border-border/70 bg-background/80 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">上下文</div>
                        <div className={`mt-1 text-2xl font-semibold ${contextSeverityClassName}`}>{contextSummary.percentage}%</div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <div>
                          {contextSummary.totalTokens.toLocaleString()} / {tokenBudget.toLocaleString()}
                        </div>
                        <div>{sessionState.messageCount} 条消息</div>
                      </div>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all ${contextSummary.percentage >= 80 ? "bg-red-500" : contextSummary.percentage >= 60 ? "bg-amber-500" : "bg-emerald-500"}`}
                        style={{ width: `${Math.min(contextSummary.percentage, 100)}%` }}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className={`rounded-full px-2 py-1 ${contextSummary.percentage >= 80 ? "bg-red-500/10 text-red-600" : contextSummary.percentage >= 60 ? "bg-amber-500/10 text-amber-600" : "bg-emerald-500/10 text-emerald-600"}`}>
                        {contextSeverityLabel}
                      </span>
                      <button
                        type="button"
                        onClick={() => setContextPanelOpen(true)}
                        className="rounded-full border border-border/70 bg-background px-2 py-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                        aria-label="上下文详情"
                      >
                        上下文详情
                      </button>
                      <button
                        type="button"
                        onClick={() => persistSessionMessages(compressMessages(effectiveMessages))}
                        className="rounded-full border border-border/70 bg-background px-2 py-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                      >
                        压缩
                      </button>
                      <button
                        type="button"
                        onClick={() => persistSessionMessages(truncateMessages(effectiveMessages))}
                        className="rounded-full border border-border/70 bg-background px-2 py-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                      >
                        裁剪
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const session = await fetchJson<NarratorSessionRecord>("/api/sessions", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              title: `${sessionState.title} · 新会话`,
                              agentId: chatWindow.agentId,
                              sessionMode: sessionState.sessionMode,
                              sessionConfig,
                            }),
                          });

                          addWindow({
                            agentId: chatWindow.agentId,
                            title: `${sessionState.title} · 新会话`,
                            sessionId: session.id,
                            sessionMode: session.sessionMode,
                          });
                        }}
                        className="rounded-full border border-border/70 bg-background px-2 py-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                      >
                        <span className="inline-flex items-center gap-1">
                          <PlusCircle className="size-3.5" />
                          新开会话
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/70 bg-background/80 p-3" data-testid="execution-chain-card">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          <GitBranch className="size-3.5 text-primary" />
                          最近执行链
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          把最近一轮工具动作串成主链，至少能看见 AI 刚才查了什么、改了什么、耗时多久。
                        </p>
                      </div>
                      <span className="rounded-full border border-border/70 bg-background px-2 py-1 text-[10px] text-muted-foreground">
                        {recentExecutionChain ? `${recentExecutionChain.calls.length} 步主链` : "等待执行"}
                      </span>
                    </div>

                    {recentExecutionChain ? (
                      <>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                          {recentExecutionChain.calls.map((call, index) => (
                            <Fragment key={call.id ?? `${call.toolName}-${index}`}>
                              {index > 0 ? <ChevronRight className="size-3 text-muted-foreground" /> : null}
                              <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2 py-1 text-foreground">
                                <Wrench className="size-3 text-primary" />
                                {call.toolName}
                              </span>
                            </Fragment>
                          ))}
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          <MiniInfoTile label="最近状态" value={recentExecutionChain.statusLabel} tone={recentExecutionChain.tone} />
                          <MiniInfoTile
                            label="总耗时"
                            value={recentExecutionChain.totalDurationLabel}
                            tone={recentExecutionChain.tone}
                          />
                          <MiniInfoTile label="最近时间" value={recentExecutionChain.timeLabel} />
                        </div>
                        {recentExecutionFacts ? (
                          <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="rounded-full border border-border/60 bg-background px-2 py-1 font-mono text-foreground">
                                {recentExecutionFacts.runId}
                              </span>
                              {recentExecutionFacts.stage ? (
                                <span className="rounded-full border border-border/60 bg-background px-2 py-1 text-foreground">
                                  {recentExecutionFacts.stage}
                                </span>
                              ) : null}
                              {recentExecutionFacts.bookId ? (
                                <span className="rounded-full border border-border/60 bg-background px-2 py-1">
                                  {recentExecutionFacts.bookId}
                                </span>
                              ) : null}
                              {recentExecutionFacts.chapterLabel ? (
                                <span className="rounded-full border border-border/60 bg-background px-2 py-1">
                                  {recentExecutionFacts.chapterLabel}
                                </span>
                              ) : null}
                            </div>
                            {recentExecutionFacts.latestLog ? (
                              <div className="mt-2">最近日志：{recentExecutionFacts.latestLog}</div>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                          <div className="font-medium text-foreground">{recentExecutionChain.headline}</div>
                          <div className="mt-1 flex items-center gap-1">
                            <Clock3 className="size-3.5" />
                            {recentExecutionChain.detail}
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <div className="text-[11px] font-medium text-muted-foreground">链路详情</div>
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() => setExecutionChainExpanded((prev) => !prev)}
                            aria-label={executionChainExpanded ? "收起最近执行链" : "展开最近执行链"}
                          >
                            {executionChainExpanded ? "收起最近执行链" : "展开最近执行链"}
                          </Button>
                        </div>
                        {executionChainExpanded ? (
                          <div className="mt-3 space-y-2 rounded-xl border border-border/60 bg-muted/10 p-2">
                            {recentExecutionChain.calls.map((toolCall, idx) => (
                              <ToolCallBlock
                                key={`execution-chain-${toolCall.id ?? `${toolCall.toolName}-${idx}`}`}
                                toolCall={toolCall}
                                defaultExpanded={toolCall.status === "error" || toolCall.status === "running"}
                                onReplay={handleReplayToolCall}
                              />
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="mt-3 rounded-lg border border-dashed border-border/60 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
                        当前还没有工具主链；一旦助手发起 Read / Bash / Grep / Write 等动作，这里会立即展示过程轨迹。
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="rounded-xl border border-border/70 bg-background/80 p-3 text-xs text-muted-foreground">
                    <span className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      <Bot className="size-3.5 text-primary" />
                      模型
                    </span>
                    {modelPoolEmpty ? (
                      <div className="mb-2 rounded-lg border border-dashed border-border/60 bg-muted/10 px-2 py-2 text-[10px] text-muted-foreground">
                        尚未配置可用模型
                      </div>
                    ) : null}
                    <select
                      aria-label="模型选择器"
                      value={activeModelRefValue}
                      disabled={modelPoolEmpty}
                      onChange={(event) => {
                        const model = findRuntimeModelByRef(runtimeModelOptions, event.target.value);
                        if (!model) return;
                        const nextModel = splitRuntimeModelRef(model);
                        if (!nextModel.providerId || !nextModel.modelId) return;
                        updateSessionConfig({ providerId: nextModel.providerId, modelId: nextModel.modelId });
                      }}
                      className="w-full rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground disabled:opacity-60"
                    >
                      {modelPoolEmpty ? <option value="">无可用模型</option> : null}
                      {runtimeModelOptions.map((model) => {
                        const optionRef = splitRuntimeModelRef(model);
                        return (
                          <option key={optionRef.modelRef} value={optionRef.modelRef}>
                            {runtimeModelLabel(model)}
                          </option>
                        );
                      })}
                    </select>
                    <div className="mt-2 text-[10px] text-muted-foreground">
                      {activeRuntimeModel ? `${((activeRuntimeModel.contextWindow ?? 0) / 1000).toFixed(0)}K context` : "模型信息不可用"}
                    </div>
                  </label>

                  <label className="rounded-xl border border-border/70 bg-background/80 p-3 text-xs text-muted-foreground">
                    <span className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      <Braces className="size-3.5 text-primary" />
                      权限
                    </span>
                    <select
                      aria-label="权限模式选择器"
                      value={sessionConfig.permissionMode}
                      onChange={(event) => updateSessionConfig({ permissionMode: event.target.value as SessionPermissionMode })}
                      className="w-full rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground"
                    >
                      {SESSION_PERMISSION_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <div className="mt-2 text-[10px] leading-4 text-muted-foreground">
                      当前：{selectedPermission.label} · {selectedPermission.description}
                    </div>
                  </label>

                  <label className="rounded-xl border border-border/70 bg-background/80 p-3 text-xs text-muted-foreground">
                    <span className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      <Cpu className="size-3.5 text-primary" />
                      推理
                    </span>
                    <select
                      aria-label="推理强度选择器"
                      value={sessionConfig.reasoningEffort}
                      onChange={(event) => updateSessionConfig({ reasoningEffort: event.target.value as SessionReasoningEffort })}
                      className="w-full rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground"
                    >
                      {REASONING_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <div className="mt-2 text-[10px] text-muted-foreground">
                      当前：{REASONING_OPTIONS.find((option) => option.value === sessionConfig.reasoningEffort)?.label}
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {effectiveMessages.map((msg) => (
                <div key={msg.id} className="space-y-2">
                  {msg.content ? (
                    <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className="max-w-[80%] rounded-lg px-3 py-2 text-sm"
                        style={{
                          backgroundColor: msg.role === "user" ? c.accent : c.bgSecondary,
                          color: msg.role === "user" ? "#fff" : c.text,
                        }}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ) : null}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="ml-4 space-y-2 rounded-xl border border-border/40 bg-muted/20 p-2">
                      <div className="flex items-center justify-between gap-2 px-1">
                        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                          工具调用日志
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {msg.toolCalls.length} 步 · {sumToolCallDurations(msg.toolCalls)}
                        </div>
                      </div>
                      {msg.toolCalls.map((toolCall, idx) => (
                        <ToolCallBlock
                          key={toolCall.id ?? `${msg.id}-tool-${idx}`}
                          toolCall={toolCall}
                          defaultExpanded={toolCall.status === "error" || toolCall.status === "running"}
                          onReplay={handleReplayToolCall}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="border-t px-3 py-2" style={{ borderColor: c.border }}>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                <span className="rounded-full border border-border px-2 py-0.5">对象化会话</span>
                <span className="rounded-full border border-border px-2 py-0.5">Agent {chatWindow.agentId}</span>
                <span className="rounded-full border border-border px-2 py-0.5">权限 {selectedPermission.label}</span>
                <span className="rounded-full border border-border px-2 py-0.5">{sessionState.messageCount} 条消息</span>
                {activeRuntimeModel ? <span className="rounded-full border border-border px-2 py-0.5">{activeRuntimeModel.providerName}</span> : null}
              </div>
              {(() => {
                // 5.6.3 — recovery-state-aware input affordance:
                //   - `resetting`  → disable entirely, show why in the placeholder
                //   - `reconnecting` / `replaying` → allow typing but defer send until healthy
                //   - otherwise fall back to wsConnected gate
                const isResetting = authoritativeRecoveryState === "resetting";
                const isReconnecting = authoritativeRecoveryState === "reconnecting";
                const isReplaying = authoritativeRecoveryState === "replaying";
                const inputDisabled = isResetting;
                const sendBlocked = modelPoolEmpty || !wsConnected || isResetting || isReconnecting || isReplaying;
                // Connection-offline state is already surfaced by the RecoveryBadge
                // banner + chip; do not repeat it in the placeholder so the baseline
                // "输入消息..." text stays stable for both humans and tests.
                const placeholder = isResetting
                  ? "会话重置中，稍候…"
                  : isReconnecting
                    ? "连接中断，正在重连…（可先输入）"
                    : isReplaying
                      ? "正在回放历史…（可先输入）"
                      : "输入消息...";
                const sendTooltip = modelPoolEmpty
                  ? "尚未配置可用模型"
                  : isResetting
                    ? "会话正在重置，暂不可发送"
                    : isReconnecting || isReplaying
                      ? "等待连接恢复后发送"
                      : !wsConnected
                        ? "连接已断开"
                        : "发送消息";
                return (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !sendBlocked && handleSend()}
                      placeholder={placeholder}
                      className="flex-1 rounded px-3 py-2 text-sm transition-opacity disabled:opacity-60"
                      style={{
                        backgroundColor: c.bgSecondary,
                        color: c.text,
                        border: `1px solid ${c.border}`,
                      }}
                      disabled={inputDisabled}
                      aria-label="消息输入框"
                    />
                    <button
                      onClick={handleSend}
                      disabled={sendBlocked || !input.trim()}
                      title={sendTooltip}
                      className="rounded px-4 py-2 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ backgroundColor: c.accent, color: "#fff" }}
                    >
                      发送
                    </button>
                  </div>
                );
              })()}
            </div>
          </>
        )}
      </div>

      <ContextPanel
        mode="session"
        visible={contextPanelOpen}
        onClose={() => setContextPanelOpen(false)}
        sessionTitle={sessionState.title}
        sessionEntries={contextEntries}
        sessionSummary={{
          totalTokens: contextSummary.totalTokens,
          budgetMax: tokenBudget,
          messageCount: sessionState.messageCount,
        }}
        onCompress={() => persistSessionMessages(compressMessages(effectiveMessages))}
        onTruncate={() => persistSessionMessages(truncateMessages(effectiveMessages))}
        onClear={() => persistSessionMessages([])}
      />
    </>
  );
}

function SessionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/80 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="truncate text-[11px] font-medium text-foreground">{value}</div>
    </div>
  );
}

function MiniInfoTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "default" | "error" | "running";
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-sm font-medium ${tone === "error" ? "text-red-600" : tone === "running" ? "text-amber-600" : "text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );
}

function buildSessionContextSummary(messages: ChatMessage[], budgetMax: number) {
  const totalTokens = messages.reduce((sum, message) => sum + approximateMessageTokens(message), 0);
  const percentage = budgetMax > 0 ? Math.min(Math.round((totalTokens / budgetMax) * 100), 999) : 0;
  return {
    totalTokens,
    percentage,
    messageCount: messages.length,
  };
}

function buildContextEntries(messages: ChatMessage[]): ContextEntry[] {
  return messages.flatMap((message) => {
    const entries: ContextEntry[] = [
      {
        id: message.id,
        source: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user",
        layer: message.role === "system" ? "system" : "session",
        label: formatMessageLabel(message),
        description: buildMessageDescription(message),
        content: message.content || "（无文本内容）",
        tokens: approximateTokens(message.content),
        active: true,
      },
    ];

    if (message.toolCalls?.length) {
      entries.push(
        ...message.toolCalls.map((toolCall, index) => {
          const content = buildToolCallContextContent(toolCall);
          return {
            id: `${message.id}-${toolCall.id ?? `tool-${index}`}`,
            source: toolCall.toolName,
            layer: "tool" as const,
            label: `${toolCall.toolName} · ${getToolCallStatusLabel(toolCall.status)}`,
            description: buildToolCallSummary(toolCall),
            content,
            tokens: approximateTokens(content),
            active: true,
          };
        }),
      );
    }

    return entries;
  });
}

function formatMessageLabel(message: ChatMessage) {
  const time = new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${message.role === "assistant" ? "助手" : message.role === "system" ? "系统" : "用户"} · ${time}`;
}

function buildMessageDescription(message: ChatMessage) {
  if (message.toolCalls?.length) {
    return `包含 ${message.toolCalls.length} 个工具步骤`;
  }

  return message.role === "system" ? "系统注入内容" : "会话消息";
}

function buildToolCallContextContent(toolCall: ToolCall) {
  const sections = [
    `工具：${toolCall.toolName}`,
    `状态：${getToolCallStatusLabel(toolCall.status)}`,
    toolCall.command ? `命令：${toolCall.command}` : undefined,
    toolCall.output?.trim() ? `输出：\n${toolCall.output.trim()}` : undefined,
    toolCall.error?.trim() ? `错误：\n${toolCall.error.trim()}` : undefined,
  ].filter((section): section is string => Boolean(section));

  return sections.join("\n\n");
}

function approximateMessageTokens(message: ChatMessage) {
  return approximateTokens(message.content) + (message.toolCalls?.reduce((sum, toolCall) => sum + approximateTokens(buildToolCallContextContent(toolCall)), 0) ?? 0);
}

function approximateTokens(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function compressMessages(messages: ChatMessage[]) {
  if (messages.length <= 4) return messages;
  return [
    {
      id: `summary-${Date.now()}`,
      role: "system" as const,
      content: `已压缩较早消息，共保留最近 ${Math.min(4, messages.length)} 条对话。`,
      timestamp: Date.now(),
    },
    ...messages.slice(-4),
  ];
}

function truncateMessages(messages: ChatMessage[]) {
  if (messages.length <= 2) return messages;
  return messages.slice(-2);
}

function buildRecentExecutionChain(messages: ChatMessage[]) {
  const latestMessageWithTools = [...messages].reverse().find((message) => message.toolCalls?.length);

  if (!latestMessageWithTools?.toolCalls?.length) {
    return null;
  }

  const calls = latestMessageWithTools.toolCalls;
  const totalDuration = calls.reduce((sum, toolCall) => sum + (toolCall.duration ?? 0), 0);
  const hasDuration = calls.some((toolCall) => typeof toolCall.duration === "number");
  const status = calls.some((toolCall) => toolCall.status === "error")
    ? "error"
    : calls.some((toolCall) => toolCall.status === "running" || toolCall.status === "pending")
      ? "running"
      : "success";
  const errorCount = calls.filter((toolCall) => toolCall.status === "error").length;

  return {
    calls,
    headline: `${calls[0]?.toolName ?? "工具"} → ${calls[calls.length - 1]?.toolName ?? "工具"}`,
    statusLabel:
      status === "error"
        ? `${errorCount} 步失败`
        : status === "running"
          ? "执行中"
          : `${calls.length} 步完成`,
    detail: calls
      .map((toolCall) => `${toolCall.toolName}：${buildToolCallSummary(toolCall)}`)
      .slice(0, 2)
      .join("；"),
    timeLabel: new Date(latestMessageWithTools.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    totalDurationLabel: hasDuration ? formatToolCallDuration(totalDuration) : "未上报",
    tone: status === "error" ? "error" : status === "running" ? "running" : "default",
  } as const;
}

function buildSessionBreadcrumb(chatWindow: ChatWindowState) {
  return [
    "NovelFork Studio",
    `Agent / ${chatWindow.agentId}`,
    chatWindow.sessionId ? `Session / ${shortSessionId(chatWindow.sessionId)}` : "临时窗口",
  ];
}

function extractRecentExecutionRunId(calls?: readonly ToolCall[] | null) {
  if (!calls?.length) {
    return undefined;
  }

  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const execution = extractToolExecution(calls[index]);
    if (execution?.runId) {
      return execution.runId;
    }
  }

  return undefined;
}

function buildRecentExecutionFacts(runId: string | undefined, run: StudioRun | null) {
  if (!runId) {
    return null;
  }

  const chapterNumber = run?.chapterNumber ?? run?.chapter ?? null;
  const latestLog = run?.logs.length ? run.logs[run.logs.length - 1]?.message : undefined;

  return {
    runId,
    stage: run?.stage,
    bookId: run?.bookId,
    chapterLabel: typeof chapterNumber === "number" ? `第 ${chapterNumber} 章` : undefined,
    latestLog,
  };
}

function extractToolExecution(toolCall: ToolCall) {
  const resultRecord = asRecord(toolCall.result);
  const executionRecord = asRecord(resultRecord?.execution) ?? asRecord(toolCall.execution);
  const runId = typeof executionRecord?.runId === "string" ? executionRecord.runId : undefined;

  if (!runId) {
    return undefined;
  }

  return {
    runId,
  };
}

function shortSessionId(sessionId: string) {
  return sessionId.length > 10 ? `${sessionId.slice(0, 8)}…` : sessionId;
}

function sumToolCallDurations(toolCalls: ToolCall[]) {
  const total = toolCalls.reduce((sum, toolCall) => sum + (toolCall.duration ?? 0), 0);
  return toolCalls.some((toolCall) => typeof toolCall.duration === "number") ? formatToolCallDuration(total) : "未上报";
}

function normalizeReplayToolKind(toolName: string) {
  return toolName.trim().toLowerCase().includes("mcp") ? "mcp" : "builtin";
}

function buildReplayAssistantMessage(toolCall: ToolCall, replayResponse: unknown): ChatMessage {
  const replayCall = normalizeReplayResult(toolCall, replayResponse);
  return {
    id: `replay-${toolCall.id ?? toolCall.toolName}-${Date.now()}`,
    role: "assistant",
    content: `已重跑 ${toolCall.toolName}`,
    timestamp: Date.now(),
    toolCalls: replayCall ? [replayCall] : undefined,
  };
}

function normalizeReplayResult(toolCall: ToolCall, replayResponse: unknown): ToolCall | undefined {
  const payload = asRecord(replayResponse);
  if (!payload) {
    return undefined;
  }

  const resultRecord = asRecord(payload.result);
  const success = payload.success === true || resultRecord?.success === true;
  const output = extractReplayOutput(payload);
  const normalized = normalizeToolCall({
    id: `${toolCall.id ?? toolCall.toolName}-replay`,
    toolName: toolCall.toolName,
    status: success ? "success" : "error",
    summary: success ? `重跑完成：${toolCall.toolName}` : `重跑失败：${toolCall.toolName}`,
    command: toolCall.command,
    input: toolCall.input,
    output,
    result: {
      ...(resultRecord ?? {}),
      allowed: typeof payload.allowed === "boolean" ? payload.allowed : undefined,
      confirmationRequired: payload.confirmationRequired === true,
      source: typeof payload.source === "string" ? payload.source : undefined,
      reason: typeof payload.reason === "string" ? payload.reason : undefined,
      reasonKey: typeof payload.reasonKey === "string" ? payload.reasonKey : undefined,
      execution: payload.execution,
    },
    error: typeof payload.error === "string" ? payload.error : undefined,
  });

  return normalized ?? undefined;
}

function extractReplayOutput(payload: Record<string, unknown>) {
  const resultRecord = asRecord(payload.result);
  const directData = typeof resultRecord?.data === "string" ? resultRecord.data : undefined;
  const directOutput = typeof resultRecord?.output === "string" ? resultRecord.output : undefined;
  if (directData || directOutput) {
    return directData ?? directOutput;
  }

  if (typeof payload.error === "string") {
    return payload.error;
  }

  return stringifyUnknown(resultRecord ?? payload);
}

function stringifyUnknown(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return undefined;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function toChatWindowMessage(message: NarratorSessionChatMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    seq: message.seq,
    toolCalls: message.toolCalls,
  };
}

function toNarratorSessionChatMessage(message: ChatMessage): NarratorSessionChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    seq: message.seq,
    toolCalls: message.toolCalls,
  };
}

function mergeSessionMessages(existingMessages: ChatMessage[], snapshotMessages: NarratorSessionChatMessage[]) {
  const seenIds = new Set(existingMessages.map((message) => message.id));
  return [
    ...existingMessages,
    ...snapshotMessages
      .filter((message) => !seenIds.has(message.id))
      .map(toChatWindowMessage),
  ];
}

function getLastSessionSeq(messages: NarratorSessionChatMessage[] | undefined) {
  return (messages ?? []).reduce((maxSeq, message) => Math.max(maxSeq, message.seq ?? 0), 0);
}

async function normalizeSessionChatPayloadText(rawData: unknown): Promise<string | null> {
  if (typeof rawData === "string") {
    return rawData;
  }

  if (typeof Blob !== "undefined" && rawData instanceof Blob) {
    return rawData.text();
  }

  if (rawData instanceof Uint8Array) {
    return new TextDecoder().decode(rawData);
  }

  if (rawData instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(rawData));
  }

  if (ArrayBuffer.isView(rawData)) {
    return new TextDecoder().decode(new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength));
  }

  if (typeof rawData === "object" && rawData !== null && "toString" in rawData) {
    const text = String(rawData);
    return text === "[object Object]" ? null : text;
  }

  return null;
}

function parseSessionChatEnvelope(rawText: string): NarratorSessionChatServerEnvelope | null {
  try {
    const parsed = JSON.parse(rawText) as NarratorSessionChatServerEnvelope | { type?: string };
    if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") {
      return null;
    }

    if (parsed.type === "session:snapshot" && "snapshot" in parsed) {
      return parsed as NarratorSessionChatServerEnvelope;
    }

    if (parsed.type === "session:state" && "session" in parsed) {
      return parsed as NarratorSessionChatServerEnvelope;
    }

    if (parsed.type === "session:message" && "message" in parsed) {
      return parsed as NarratorSessionChatServerEnvelope;
    }

    if (parsed.type === "session:error" && "error" in parsed) {
      return parsed as NarratorSessionChatServerEnvelope;
    }
  } catch {
    return null;
  }

  return null;
}
