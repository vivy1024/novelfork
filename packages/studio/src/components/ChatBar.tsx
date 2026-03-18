import { useState, useRef, useEffect } from "react";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";

interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: number;
}

export function ChatBar({ t, sse }: {
  t: TFunction;
  sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
}) {
  const [input, setInput] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ReadonlyArray<ChatMessage>>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sse.messages.length]);

  // SSE events → assistant messages
  useEffect(() => {
    const recent = sse.messages.slice(-1)[0];
    if (!recent || recent.event === "ping") return;

    const d = recent.data as Record<string, unknown>;

    if (recent.event === "write:complete" || recent.event === "draft:complete") {
      setLoading(false);
      const title = d.title ?? `Chapter ${d.chapterNumber}`;
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `✓ ${title} (${(d.wordCount as number)?.toLocaleString() ?? "?"} chars)`,
        timestamp: Date.now(),
      }]);
    }
    if (recent.event === "write:error" || recent.event === "draft:error") {
      setLoading(false);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `✗ ${d.error ?? "Unknown error"}`,
        timestamp: Date.now(),
      }]);
    }
    if (recent.event === "log" && loading) {
      const msg = d.message as string;
      if (msg && (msg.includes("Phase") || msg.includes("streaming"))) {
        setMessages((prev) => {
          // Replace the last "thinking" message instead of appending
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.content.startsWith("⋯")) {
            return [...prev.slice(0, -1), { role: "assistant", content: `⋯ ${msg}`, timestamp: Date.now() }];
          }
          return [...prev, { role: "assistant", content: `⋯ ${msg}`, timestamp: Date.now() }];
        });
      }
    }
  }, [sse.messages.length]);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setExpanded(true);
    setMessages((prev) => [...prev, { role: "user", content: text, timestamp: Date.now() }]);
    setLoading(true);

    // Simple command routing — check if it's a direct action
    const lower = text.toLowerCase();

    try {
      if (lower.match(/^(写下一章|write next)/)) {
        // Extract book id from context or use first book
        const res = await fetch("/api/books");
        const { books } = await res.json() as { books: ReadonlyArray<{ id: string }> };
        if (books.length > 0) {
          setMessages((prev) => [...prev, { role: "assistant", content: "⋯ Starting...", timestamp: Date.now() }]);
          await fetch(`/api/books/${books[0]!.id}/write-next`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          // SSE will handle the rest
          return;
        }
      }

      // Fallback: send to agent API
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: text }),
      });
      const data = await res.json() as { response?: string; error?: string };
      setLoading(false);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: data.response ?? data.error ?? "Done",
        timestamp: Date.now(),
      }]);
    } catch (e) {
      setLoading(false);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `Error: ${e instanceof Error ? e.message : String(e)}`,
        timestamp: Date.now(),
      }]);
    }
  };

  const chatPlaceholder = t("nav.connected") === "已连接"
    ? "告诉 InkOS 你想做什么..."
    : "Tell InkOS what to do...";

  return (
    <div className="border border-border/60 bg-card/40 mx-6 mb-3 rounded-md">
      {/* Expanded message area */}
      {expanded && messages.length > 0 && (
        <div>
          <div
            ref={scrollRef}
            className="max-h-[180px] overflow-y-auto px-4 py-3 space-y-2"
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "text-foreground"
                    : msg.content.startsWith("✗")
                      ? "text-destructive"
                      : msg.content.startsWith("⋯")
                        ? "text-muted-foreground"
                        : "text-primary"
                }`}
              >
                {msg.role === "user" && <span className="text-muted-foreground mr-2">›</span>}
                {msg.content}
              </div>
            ))}
            {loading && !messages.some((m) => m.content.startsWith("⋯")) && (
              <div className="text-sm text-muted-foreground animate-pulse">⋯</div>
            )}
          </div>
        </div>
      )}

      {/* Input bar — centered to match main content */}
      <div className="px-4 py-2 flex items-center gap-3">
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => messages.length > 0 && setExpanded(true)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder={chatPlaceholder}
            disabled={loading}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
          />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {expanded && messages.length > 0 && (
            <button
              onClick={() => { setExpanded(false); setMessages([]); }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || loading}
            className="w-7 h-7 rounded-md bg-primary/70 text-primary-foreground flex items-center justify-center text-xs hover:bg-primary transition-all disabled:opacity-15"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
