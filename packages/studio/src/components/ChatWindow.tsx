import { useEffect, useRef, useState } from "react";
import { Bot, Wifi, WifiOff } from "lucide-react";
import type { Theme } from "../hooks/use-theme";
import { useColors } from "../hooks/use-colors";
import { WindowControls } from "./WindowControls";
import { useWindowStore } from "../stores/windowStore";
import type { ChatMessage } from "../stores/windowStore";
import { ToolCallCard } from "./ToolCall/ToolCallCard";

interface ChatWindowProps {
  windowId: string;
  theme: Theme;
}

export function ChatWindow({ windowId, theme }: ChatWindowProps) {
  const c = useColors(theme);
  const chatWindow = useWindowStore((state) => state.windows.find((w) => w.id === windowId));
  const isActive = useWindowStore((state) => state.activeWindowId === windowId);
  const removeWindow = useWindowStore((state) => state.removeWindow);
  const toggleMinimize = useWindowStore((state) => state.toggleMinimize);
  const addMessage = useWindowStore((state) => state.addMessage);
  const setWsConnected = useWindowStore((state) => state.setWsConnected);
  const setActiveWindow = useWindowStore((state) => state.setActiveWindow);

  const [input, setInput] = useState("");
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
            const message: ChatMessage = {
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              role: "assistant",
              content: data.content || data.message || event.data,
              timestamp: Date.now(),
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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatWindow?.messages]);

  if (!chatWindow) return null;

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

  return (
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

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {chatWindow.messages.map((msg) => (
              <div key={msg.id} className="space-y-2">
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
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="space-y-2 ml-4">
                    {msg.toolCalls.map((toolCall, idx) => (
                      <ToolCallCard key={`${msg.id}-tool-${idx}`} toolCall={toolCall} theme={c} />
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
