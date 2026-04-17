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
  const window = useWindowStore((state) => state.windows.find((w) => w.id === windowId));
  const removeWindow = useWindowStore((state) => state.removeWindow);
  const toggleMinimize = useWindowStore((state) => state.toggleMinimize);
  const addMessage = useWindowStore((state) => state.addMessage);
  const setWsConnected = useWindowStore((state) => state.setWsConnected);
  const setActiveWindow = useWindowStore((state) => state.setActiveWindow);

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // WebSocket 连接管理
  useEffect(() => {
    if (!window) return;

    const connectWs = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/agent/${window.agentId}/chat`;

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
            // 如果不是 JSON，直接作为文本消息
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
          // 5 秒后自动重连
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
  }, [windowId, window?.agentId, addMessage, setWsConnected]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [window?.messages]);

  if (!window) return null;

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
    // 最大化：占满整个网格
    useWindowStore.getState().updateLayout(windowId, { x: 0, y: 0, w: 12, h: 12 });
  };

  return (
    <div
      className="flex flex-col h-full rounded-lg shadow-lg overflow-hidden"
      style={{ backgroundColor: c.bg, border: `1px solid ${c.border}` }}
      onClick={() => setActiveWindow(windowId)}
    >
      {/* 标题栏 */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-move"
        style={{ backgroundColor: c.bgSecondary, borderBottom: `1px solid ${c.border}` }}
      >
        <div className="flex items-center gap-2">
          <Bot size={16} style={{ color: c.accent }} />
          <span className="text-sm font-medium" style={{ color: c.text }}>
            {window.title}
          </span>
          {window.wsConnected ? (
            <Wifi size={12} style={{ color: "#10b981" }} title="已连接" />
          ) : (
            <WifiOff size={12} style={{ color: "#ef4444" }} title="未连接" />
          )}
        </div>
        <WindowControls
          theme={theme}
          minimized={window.minimized}
          onMinimize={() => toggleMinimize(windowId)}
          onMaximize={handleMaximize}
          onClose={() => removeWindow(windowId)}
        />
      </div>

      {/* 消息区域 */}
      {!window.minimized && (
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {window.messages.map((msg) => (
              <div key={msg.id} className="space-y-2">
                <div
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
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
                      <ToolCallCard
                        key={`${msg.id}-tool-${idx}`}
                        toolCall={toolCall}
                        theme={c}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入区域 */}
          <div className="p-3 border-t" style={{ borderColor: c.border }}>
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="输入消息..."
                className="flex-1 px-3 py-2 rounded text-sm"
                style={{
                  backgroundColor: c.bgSecondary,
                  color: c.text,
                  border: `1px solid ${c.border}`,
                }}
                disabled={!window.wsConnected}
              />
              <button
                onClick={handleSend}
                disabled={!window.wsConnected || !input.trim()}
                className="px-4 py-2 rounded text-sm font-medium transition-opacity disabled:opacity-50"
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
