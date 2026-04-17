import { useState, useEffect, useRef } from "react";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { Trash2, MessageSquare } from "lucide-react";

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
  const [streamingContent, setStreamingContent] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);

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

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

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
    setStreamingContent("");

    try {
      // Send message and get SSE stream
      const response = await fetch(`/api/chat/${bookId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (!reader) {
        throw new Error("No response body");
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));

            if (data.type === "delta") {
              setStreamingContent((prev) => prev + data.content);
            } else if (data.type === "done") {
              // Finalize assistant message
              setIsStreaming(false);
              setMessages((prev) => [
                ...prev,
                {
                  id: data.messageId,
                  role: "assistant",
                  content: streamingContent,
                  timestamp: Date.now(),
                },
              ]);
              setStreamingContent("");
            } else if (data.type === "error") {
              console.error("Stream error:", data.error);
              setIsStreaming(false);
              setStreamingContent("");
            }
          }
        }
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      setIsStreaming(false);
      setStreamingContent("");
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
      <MessageList messages={messages} isStreaming={isStreaming} streamingContent={streamingContent} />

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </div>
  );
}
