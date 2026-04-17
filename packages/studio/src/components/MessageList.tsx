import { useRef, useEffect } from "react";
import { MessageItem } from "./MessageItem";
import { BotMessageSquare } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface MessageListProps {
  messages: Message[];
  isStreaming?: boolean;
  editingMessageId?: string | null;
  onEdit?: (messageId: string) => void;
  onSaveEdit?: (messageId: string, newContent: string) => void;
  onCancelEdit?: () => void;
}

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center opacity-40 select-none">
      <div className="w-14 h-14 rounded-2xl border border-dashed border-border flex items-center justify-center mb-4 bg-secondary/30">
        <BotMessageSquare size={24} className="text-muted-foreground" />
      </div>
      <p className="text-sm italic font-serif mb-1">Start a conversation</p>
      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest">Ask me anything about your novel</p>
    </div>
  );
}

export function MessageList({
  messages,
  isStreaming,
  editingMessageId,
  onEdit,
  onSaveEdit,
  onCancelEdit
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages.length]);

  if (messages.length === 0 && !isStreaming) {
    return <EmptyState />;
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto">
      {messages.map((msg) => (
        <MessageItem
          key={msg.id}
          message={msg}
          isEditing={editingMessageId === msg.id}
          onEdit={onEdit}
          onSaveEdit={onSaveEdit}
          onCancelEdit={onCancelEdit}
        />
      ))}
      {isStreaming && (
        <div className="px-4 py-4 bg-secondary/20 text-sm text-muted-foreground italic">
          Thinking...
        </div>
      )}
    </div>
  );
}
