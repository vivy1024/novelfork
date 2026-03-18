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

  const isZh = t("nav.connected") === "已连接";

  const TIPS_ZH = [
    "试试：写下一章",
    "试试：审计第5章",
    "试试：帮我创建一本都市修仙小说",
    "试试：扫描市场趋势",
    "试试：导出全书为 epub",
    "试试：分析这篇文章的文风 → 导入到我的书",
    "试试：导入已有章节续写",
    "试试：创建一个玄幻题材的同人",
    "试试：查看第3章的审计问题",
    "试试：修订第5章，用 spot-fix 模式",
  ];

  const TIPS_EN = [
    "Try: write next chapter",
    "Try: audit chapter 5",
    "Try: create a LitRPG novel about a programmer",
    "Try: scan market trends",
    "Try: export book as epub",
    "Try: analyze this text's style → import to my book",
    "Try: import existing chapters to continue",
    "Try: create a progression fantasy fanfic",
    "Try: show audit issues for chapter 3",
    "Try: revise chapter 5 with spot-fix mode",
  ];

  const tips = isZh ? TIPS_ZH : TIPS_EN;
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * tips.length));

  // Rotate tips every 8 seconds when idle
  useEffect(() => {
    if (input || expanded) return;
    const timer = setInterval(() => {
      setTipIndex((i) => (i + 1) % tips.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [input, expanded, tips.length]);

  const chatPlaceholder = tips[tipIndex]!;

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
