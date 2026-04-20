import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Braces, Cpu, PlusCircle, Settings2, Wifi, WifiOff } from "lucide-react";

import type { Theme } from "../hooks/use-theme";
import { useColors } from "../hooks/use-colors";
import { WindowControls } from "./WindowControls";
import { useWindowStore } from "../stores/windowStore";
import type {
  ChatMessage,
  ChatWindow as ChatWindowState,
  SessionPermissionMode,
  SessionReasoningEffort,
} from "../stores/windowStore";
import { ToolCallBlock, parseAssistantPayload } from "./ToolCall";
import { ContextPanel, type ContextEntry } from "./ContextPanel";
import { fetchJson } from "../hooks/use-api";
import { getDefaultModel, getDefaultProvider, getModel, getProvider, PROVIDERS } from "../shared/provider-catalog";
import type { NarratorSessionRecord } from "../shared/session-types";

interface ChatWindowProps {
  windowId: string;
  theme: Theme;
}

const MODEL_OPTIONS = PROVIDERS.flatMap((provider) =>
  provider.models.map((model) => ({
    providerId: provider.id,
    modelId: model.id,
    label: `${provider.name} · ${model.name}`,
  })),
);

const PERMISSION_OPTIONS: Array<{ value: SessionPermissionMode; label: string }> = [
  { value: "allow", label: "全部允许" },
  { value: "ask", label: "审批确认" },
  { value: "deny", label: "全部拒绝" },
];

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
  const addMessage = useWindowStore((state) => state.addMessage);
  const setWsConnected = useWindowStore((state) => state.setWsConnected);
  const setActiveWindow = useWindowStore((state) => state.setActiveWindow);
  const updateWindow = useWindowStore((state) => state.updateWindow);
  const addWindow = useWindowStore((state) => state.addWindow);

  const [input, setInput] = useState("");
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!chatWindow) return;

    const connectWs = () => {
      const protocol = globalThis.window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${globalThis.window.location.host}/api/agent/${chatWindow.agentId}/chat`;

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setWsConnected(windowId, true);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            const parsed = parseAssistantPayload(data, event.data);
            const message: ChatMessage = {
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              role: "assistant",
              content: parsed.content,
              timestamp: Date.now(),
              toolCalls: parsed.toolCalls.length > 0 ? parsed.toolCalls : undefined,
            };
            addMessage(windowId, message);
          } catch {
            const message: ChatMessage = {
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              role: "assistant",
              content: event.data,
              timestamp: Date.now(),
            };
            addMessage(windowId, message);
          }
        };

        ws.onerror = () => {
          setWsConnected(windowId, false);
        };

        ws.onclose = () => {
          setWsConnected(windowId, false);
          setTimeout(connectWs, 5000);
        };
      } catch (error) {
        console.error("WebSocket connection failed:", error);
        setWsConnected(windowId, false);
      }
    };

    connectWs();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [windowId, chatWindow?.agentId, addMessage, setWsConnected]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [chatWindow?.messages]);

  if (!chatWindow) return null;

  const defaultProvider = getDefaultProvider();
  const defaultModel = getDefaultModel(defaultProvider.id);
  const sessionConfig = chatWindow.sessionConfig ?? {
    providerId: defaultProvider.id,
    modelId: defaultModel?.id ?? "",
    permissionMode: "allow" as SessionPermissionMode,
    reasoningEffort: "medium" as SessionReasoningEffort,
  };

  const selectedProvider = getProvider(sessionConfig.providerId);
  const selectedModel = getModel(sessionConfig.providerId, sessionConfig.modelId);
  const tokenBudget = selectedModel?.contextWindow ?? 200000;
  const contextSummary = buildSessionContextSummary(chatWindow, tokenBudget);
  const contextEntries = buildContextEntries(chatWindow.messages);
  const contextSeverityLabel =
    contextSummary.percentage >= 80 ? "临界" : contextSummary.percentage >= 60 ? "警告" : "安全";
  const contextSeverityClassName =
    contextSummary.percentage >= 80
      ? "text-red-600"
      : contextSummary.percentage >= 60
        ? "text-amber-600"
        : "text-emerald-600";

  const handleSend = () => {
    if (!input.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      role: "user",
      content: input,
      timestamp: Date.now(),
    };

    addMessage(windowId, userMessage);
    wsRef.current.send(JSON.stringify({ content: input }));
    setInput("");
  };

  const handleMaximize = () => {
    useWindowStore.getState().updateLayout(windowId, { x: 0, y: 0, w: 12, h: 12 });
  };

  const lastMessage = chatWindow.messages[chatWindow.messages.length - 1];
  const lastMessageTime = lastMessage
    ? new Date(lastMessage.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "--:--";

  const updateSessionConfig = (updates: Partial<NonNullable<ChatWindowState["sessionConfig"]>>) => {
    updateWindow(windowId, {
      sessionConfig: {
        ...sessionConfig,
        ...updates,
      },
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
          className="flex items-center justify-between px-3 py-2 cursor-move"
          style={{ backgroundColor: c.bgSecondary, borderBottom: `1px solid ${c.border}` }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Bot size={16} style={{ color: c.accent }} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="max-w-[180px] truncate text-sm font-medium" style={{ color: c.text }}>
                  {chatWindow.title}
                </span>
                {isActive && (
                  <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    聚焦
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>Agent {chatWindow.agentId}</span>
                <span>•</span>
                <span>{chatWindow.messages.length} 条消息</span>
              </div>
            </div>
            {chatWindow.wsConnected ? (
              <span title="已连接">
                <Wifi size={12} style={{ color: "#10b981" }} />
              </span>
            ) : (
              <span title="未连接">
                <WifiOff size={12} style={{ color: "#ef4444" }} />
              </span>
            )}
          </div>
          <WindowControls
            theme={theme}
            minimized={chatWindow.minimized}
            onMinimize={() => toggleMinimize(windowId)}
            onMaximize={handleMaximize}
            onClose={() => removeWindow(windowId)}
          />
        </div>

        {!chatWindow.minimized && (
          <>
            <div className="grid gap-2 border-b px-3 py-2 text-[10px] sm:grid-cols-3" style={{ borderColor: c.border, backgroundColor: c.bgSecondary }}>
              <SessionMetric label="连接" value={chatWindow.wsConnected ? "在线" : "离线"} />
              <SessionMetric label="位置" value={`x:${chatWindow.position.x} y:${chatWindow.position.y}`} />
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
                  Session Control
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,1fr)]">
                <div className="rounded-xl border border-border/70 bg-background/80 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Context</div>
                      <div className={`mt-1 text-2xl font-semibold ${contextSeverityClassName}`}>{contextSummary.percentage}%</div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div>{contextSummary.totalTokens.toLocaleString()} / {tokenBudget.toLocaleString()}</div>
                      <div>{contextSummary.messageCount} 条消息</div>
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
                      onClick={() => updateWindow(windowId, { messages: compressMessages(chatWindow.messages) })}
                      className="rounded-full border border-border/70 bg-background px-2 py-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                    >
                      压缩
                    </button>
                    <button
                      type="button"
                      onClick={() => updateWindow(windowId, { messages: truncateMessages(chatWindow.messages) })}
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
                            title: `${chatWindow.title} · 新会话`,
                            agentId: chatWindow.agentId,
                            sessionConfig,
                          }),
                        });

                        addWindow({
                          agentId: chatWindow.agentId,
                          title: `${chatWindow.title} · 新会话`,
                          sessionId: session.id,
                          sessionConfig: session.sessionConfig,
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

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="rounded-xl border border-border/70 bg-background/80 p-3 text-xs text-muted-foreground">
                    <span className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      <Bot className="size-3.5 text-primary" />
                      模型
                    </span>
                    <select
                      aria-label="模型选择器"
                      value={`${sessionConfig.providerId}:${sessionConfig.modelId}`}
                      onChange={(event) => {
                        const [providerId, modelId] = event.target.value.split(":");
                        if (!providerId || !modelId) return;
                        updateSessionConfig({ providerId, modelId });
                      }}
                      className="w-full rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground"
                    >
                      {MODEL_OPTIONS.map((option) => (
                        <option key={`${option.providerId}:${option.modelId}`} value={`${option.providerId}:${option.modelId}`}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <div className="mt-2 text-[10px] text-muted-foreground">
                      {selectedModel ? `${(selectedModel.contextWindow / 1000).toFixed(0)}K context` : "模型信息不可用"}
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
                      {PERMISSION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <div className="mt-2 text-[10px] text-muted-foreground">
                      当前：{PERMISSION_OPTIONS.find((option) => option.value === sessionConfig.permissionMode)?.label}
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

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {chatWindow.messages.map((msg) => (
                <div key={msg.id} className="space-y-2">
                  {msg.content ? (
                    <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className="max-w-[80%] px-3 py-2 rounded-lg text-sm"
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
                      <div className="px-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        工具调用日志
                      </div>
                      {msg.toolCalls.map((toolCall, idx) => (
                        <ToolCallBlock
                          key={toolCall.id ?? `${msg.id}-tool-${idx}`}
                          toolCall={toolCall}
                          defaultExpanded={toolCall.status === "error" || toolCall.status === "running"}
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
                <span className="rounded-full border border-border px-2 py-0.5">{chatWindow.messages.length} 条消息</span>
                {selectedProvider ? <span className="rounded-full border border-border px-2 py-0.5">{selectedProvider.name}</span> : null}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder="输入消息..."
                  className="flex-1 rounded px-3 py-2 text-sm"
                  style={{
                    backgroundColor: c.bgSecondary,
                    color: c.text,
                    border: `1px solid ${c.border}`,
                  }}
                  disabled={!chatWindow.wsConnected}
                />
                <button
                  onClick={handleSend}
                  disabled={!chatWindow.wsConnected || !input.trim()}
                  className="rounded px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
                  style={{ backgroundColor: c.accent, color: "#fff" }}
                >
                  发送
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <ContextPanel
        mode="session"
        visible={contextPanelOpen}
        onClose={() => setContextPanelOpen(false)}
        sessionTitle={chatWindow.title}
        sessionEntries={contextEntries}
        sessionSummary={{
          totalTokens: contextSummary.totalTokens,
          budgetMax: tokenBudget,
          messageCount: contextSummary.messageCount,
        }}
        onCompress={() => updateWindow(windowId, { messages: compressMessages(chatWindow.messages) })}
        onTruncate={() => updateWindow(windowId, { messages: truncateMessages(chatWindow.messages) })}
        onClear={() => updateWindow(windowId, { messages: [] })}
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

function buildSessionContextSummary(chatWindow: ChatWindowState, budgetMax: number) {
  const totalTokens = chatWindow.messages.reduce((sum, message) => sum + approximateTokens(message.content), 0);
  const percentage = budgetMax > 0 ? Math.min(Math.round((totalTokens / budgetMax) * 100), 999) : 0;
  return {
    totalTokens,
    percentage,
    messageCount: chatWindow.messages.length,
  };
}

function buildContextEntries(messages: ChatMessage[]): ContextEntry[] {
  return messages.map((message) => ({
    id: message.id,
    source: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user",
    label: formatMessageLabel(message),
    content: message.content || "（无文本内容）",
    tokens: approximateTokens(message.content),
    active: true,
  }));
}

function formatMessageLabel(message: ChatMessage) {
  const time = new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${message.role === "assistant" ? "助手" : message.role === "system" ? "系统" : "用户"} · ${time}`;
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
