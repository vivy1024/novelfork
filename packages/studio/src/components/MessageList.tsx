import { useRef, useEffect } from "react";
import { FixedSizeList as List } from "react-window";
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
  streamingContent?: string;
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

export function MessageList({ messages, isStreaming, streamingContent }: MessageListProps) {
  const listRef = useRef<List>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages.length, streamingContent]);

  if (messages.length === 0 && !isStreaming) {
    return <EmptyState />;
  }

  const allMessages = [...messages];
  if (isStreaming && streamingContent) {
    allMessages.push({
      id: "streaming",
      role: "assistant",
      content: streamingContent,
      timestamp: Date.now(),
    });
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto">
      {allMessages.map((msg) => (
        <MessageItem key={msg.id} message={msg} />
      ))}
    </div>
  );
}
