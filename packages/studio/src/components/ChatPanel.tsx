import { useState, useEffect } from "react";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { Trash2, MessageSquare } from "lucide-react";
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
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/20">
        <div className="flex items-center gap-2">
          <MessageSquare size={18} className="text-primary" />
          <h2 className="text-sm font-semibold">Chat Assistant</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            className="p-2 rounded-lg hover:bg-secondary transition-colors"
            title="Clear messages"
          >
            <Trash2 size={16} />
          </button>
        </div>
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
      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </div>
  );
}
