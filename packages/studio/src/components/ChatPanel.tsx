import { useEffect, useState } from "react";
import { MessageSquare, Trash2 } from "lucide-react";

import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { useMessageEdit } from "../hooks/useMessageEdit";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface ChatPanelProps {
  bookId: string;
  onClose?: () => void;
}

export function ChatPanel({ bookId, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const { editingMessageId, startEdit, cancelEdit, saveEdit } = useMessageEdit();
  const lastMessage = messages[messages.length - 1];
  const lastMessageTime = lastMessage
    ? new Date(lastMessage.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "--:--";

  // Load message history
  useEffect(() => {
    fetch(`/api/chat/${bookId}/messages`)
      .then((res) => res.json())
      .then((data) => {
        if (data.messages) {
          setMessages(data.messages);
        }
      })
      .catch((err) => console.error("Failed to load messages:", err));
  }, [bookId]);

  const handleSend = async (content: string) => {
    // Add user message immediately
    const userMsg: Message = {
      id: `${Date.now()}-user`,
      role: "user",
      content,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    setIsStreaming(true);

    try {
      const response = await fetch(`/api/chat/${bookId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.message) {
        setMessages((prev) => [...prev, data.message]);
      } else if (data.error) {
        console.error("API error:", data.error);
      }
    } catch (error) {
      console.error("Failed to send message:", error);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleClear = async () => {
    if (!confirm("Clear all messages?")) return;

    try {
      await fetch(`/api/chat/${bookId}/messages`, { method: "DELETE" });
      setMessages([]);
    } catch (error) {
      console.error("Failed to clear messages:", error);
    }
  };

  const handleSaveEdit = async (messageId: string, newContent: string) => {
    const newMessages = saveEdit(messageId, newContent, messages, setMessages);
    if (!newMessages) return;

    // Regenerate from edited message
    const editedMessage = newMessages.find((m) => m.id === messageId);
    if (editedMessage && editedMessage.role === "user") {
      setIsStreaming(true);

      try {
        const response = await fetch(`/api/chat/${bookId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newContent }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.message) {
          setMessages((prev) => [...prev, data.message]);
        } else if (data.error) {
          console.error("API error:", data.error);
        }
      } catch (error) {
        console.error("Failed to regenerate message:", error);
      } finally {
        setIsStreaming(false);
      }
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-start justify-between gap-4 border-b border-border bg-secondary/10 px-4 py-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <MessageSquare size={18} className="text-primary" />
            <h2 className="text-sm font-semibold">会话消息</h2>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              辅助面板
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            书籍 {bookId} 的轻量消息入口，保留对话历史与编辑能力，但正式对象组织仍以会话中心为主。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary"
            title="Clear messages"
          >
            <Trash2 size={14} className="inline-block -translate-y-px" />
            清空
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary"
              title="Close panel"
            >
              关闭
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-2 border-b border-border/50 bg-muted/20 px-4 py-3 text-[10px] text-muted-foreground sm:grid-cols-3">
        <SummaryBlock label="消息数" value={String(messages.length)} />
        <SummaryBlock label="最近活动" value={lastMessageTime} />
        <SummaryBlock label="状态" value={isStreaming ? "生成中" : "空闲"} />
      </div>

      {/* Messages */}
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        editingMessageId={editingMessageId}
        onEdit={startEdit}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={cancelEdit}
      />

      {/* Input */}
      <div className="border-t border-border bg-background p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          <span className="rounded-full border border-border px-2 py-0.5">书籍对象</span>
          <span className="rounded-full border border-border px-2 py-0.5">编辑可回写</span>
          <span className="rounded-full border border-border px-2 py-0.5">轻量辅助</span>
        </div>
        <ChatInput onSend={handleSend} disabled={isStreaming} placeholder="输入消息或指令..." />
      </div>
    </div>
  );
}

function SummaryBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="truncate text-xs font-medium text-foreground">{value}</div>
    </div>
  );
}
