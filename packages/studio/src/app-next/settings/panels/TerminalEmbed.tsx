/**
 * TerminalEmbed — xterm.js terminal attached to a running Runtime terminal via WebSocket.
 *
 * Communicates with the server's /ws/terminal endpoint using the same protocol
 * as the native NarraFork frontend (subscribe/unsubscribe/input/resize/output/scrollback/exit).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Badge } from "@/components/ui/badge";
import { getRuntimeToken } from "../../runtime/auth";

// --------------------------------------------------------------------------
// Terminal WS manager (simplified singleton for admin embed)
// --------------------------------------------------------------------------

interface TerminalWSCallbacks {
  onOutput?: (data: string) => void;
  onScrollback?: (data: string, dims: { cols: number; rows: number }) => void;
  onExit?: (code: number) => void;
  onError?: (message: string) => void;
  onRequestResize?: () => void;
}

function buildTerminalWsUrl(): string {
  const loc = window.location;
  const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${loc.host}/ws/terminal`;
}

class TerminalWSConnection {
  private ws: WebSocket | null = null;
  private terminalId: string;
  private callbacks: TerminalWSCallbacks;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempts = 0;
  private disposed = false;
  private _connected = false;
  private _disconnected = false;
  private statusListeners = new Set<() => void>();

  constructor(terminalId: string, callbacks: TerminalWSCallbacks) {
    this.terminalId = terminalId;
    this.callbacks = callbacks;
  }

  get connected() { return this._connected; }
  get disconnected() { return this._disconnected; }

  connect() {
    if (this.ws || this.disposed) return;

    const token = getRuntimeToken();
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : "";
    const ws = new WebSocket(`${buildTerminalWsUrl()}${tokenQuery}`);
    this.ws = ws;

    ws.onopen = () => {
      if (this.disposed || this.ws !== ws) { ws.close(); return; }
      this._connected = true;
      this._disconnected = false;
      this.reconnectAttempts = 0;
      this.notifyStatus();
      // Subscribe to this terminal
      this.send({ type: "subscribe", terminalIds: [this.terminalId] });
    };

    ws.onmessage = (event) => {
      if (this.disposed || this.ws !== ws) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        this.handleMessage(msg);
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      if (this.disposed || this.ws !== ws) return;
      this.ws = null;
      this._connected = false;
      this.notifyStatus();
      this.scheduleReconnect();
    };

    ws.onerror = () => { /* onclose fires after */ };
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectAttempts >= 20) {
      this._disconnected = true;
      this.notifyStatus();
      return;
    }
    if (this.reconnectAttempts >= 3 && !this._disconnected) {
      this._disconnected = true;
      this.notifyStatus();
    }
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private handleMessage(msg: Record<string, unknown>) {
    const type = msg.type as string;
    const terminalId = msg.terminalId as string | undefined;
    if (terminalId !== this.terminalId) return;

    switch (type) {
      case "output":
        this.callbacks.onOutput?.(msg.data as string);
        break;
      case "scrollback":
        this.callbacks.onScrollback?.(msg.data as string, {
          cols: (msg.cols as number) || 80,
          rows: (msg.rows as number) || 24,
        });
        break;
      case "exit":
        this.callbacks.onExit?.(msg.code as number);
        break;
      case "error":
        this.callbacks.onError?.(
          (msg.message as string) ?? (msg.reason as string) ?? "终端错误",
        );
        break;
      case "requestResize":
        this.callbacks.onRequestResize?.();
        break;
    }
  }

  sendInput(data: string) {
    this.send({ type: "input", terminalId: this.terminalId, data });
  }

  sendResize(cols: number, rows: number) {
    this.send({ type: "resize", terminalId: this.terminalId, cols, rows });
  }

  onStatusChange(cb: () => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private send(msg: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private notifyStatus() {
    for (const cb of this.statusListeners) cb();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      // Unsubscribe cleanly
      this.send({ type: "unsubscribe", terminalIds: [this.terminalId] });
      this.ws.close();
      this.ws = null;
    }
    this.statusListeners.clear();
  }
}

// --------------------------------------------------------------------------
// TerminalEmbed component
// --------------------------------------------------------------------------

const TERMINAL_BG = "#1a1b26";
const SCROLLBACK_LINES = 2000;

export function TerminalEmbed({ terminalId }: { readonly terminalId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const connRef = useRef<TerminalWSConnection | null>(null);
  const writingRef = useRef(false);
  const [disconnected, setDisconnected] = useState(false);

  const scheduleFit = useCallback((notifyResize: boolean) => {
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;
    requestAnimationFrame(() => {
      const prev = { cols: term.cols, rows: term.rows };
      fitAddon.fit();
      if (notifyResize && (term.cols !== prev.cols || term.rows !== prev.rows)) {
        connRef.current?.sendResize(term.cols, term.rows);
      }
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      scrollback: SCROLLBACK_LINES,
      theme: { background: TERMINAL_BG },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Fit to container
    requestAnimationFrame(() => fitAddon.fit());

    // WS connection
    const conn = new TerminalWSConnection(terminalId, {
      onOutput: (data) => {
        writingRef.current = true;
        try { term.write(data); } finally { writingRef.current = false; }
      },
      onScrollback: (data, dims) => {
        writingRef.current = true;
        try {
          term.resize(dims.cols, dims.rows);
          term.reset();
          term.write(data);
        } finally { writingRef.current = false; }
        // Fit back and notify
        scheduleFit(true);
      },
      onExit: (code) => {
        writingRef.current = true;
        try { term.write(`\r\n[进程已退出，代码: ${code}]\r\n`); }
        finally { writingRef.current = false; }
      },
      onError: (message) => {
        writingRef.current = true;
        try { term.write(`\r\n[错误: ${message}]\r\n`); }
        finally { writingRef.current = false; }
      },
      onRequestResize: () => {
        if (term) connRef.current?.sendResize(term.cols, term.rows);
      },
    });
    connRef.current = conn;

    const unsubStatus = conn.onStatusChange(() => {
      setDisconnected(conn.disconnected);
    });

    conn.connect();

    // Forward keyboard input
    term.onData((data) => {
      if (writingRef.current) return;
      conn.sendInput(data);
    });

    // Resize observer
    const resizeObserver = new ResizeObserver(() => scheduleFit(true));
    resizeObserver.observe(containerRef.current);

    return () => {
      unsubStatus();
      conn.dispose();
      connRef.current = null;
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalId, scheduleFit]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ backgroundColor: TERMINAL_BG, padding: 4 }}
      />
      {disconnected ? (
        <Badge
          variant="destructive"
          className="pointer-events-none absolute top-2 right-2 text-xs"
        >
          已断开
        </Badge>
      ) : null}
    </div>
  );
}
