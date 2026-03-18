import { useEffect, useRef, useCallback, useState } from "react";

export interface SSEMessage {
  readonly event: string;
  readonly data: unknown;
  readonly timestamp: number;
}

export function useSSE(url = "/api/events") {
  const [messages, setMessages] = useState<ReadonlyArray<SSEMessage>>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const handleEvent = (e: MessageEvent) => {
      try {
        const data = e.data ? JSON.parse(e.data) : null;
        setMessages((prev) => [...prev.slice(-99), { event: e.type, data, timestamp: Date.now() }]);
      } catch {
        // ignore parse errors
      }
    };

    const events = [
      "write:start", "write:complete", "write:error",
      "draft:start", "draft:complete", "draft:error",
      "log", "llm:progress", "ping",
    ];
    for (const event of events) {
      es.addEventListener(event, handleEvent);
    }

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [url]);

  const clear = useCallback(() => setMessages([]), []);

  return { messages, connected, clear };
}
