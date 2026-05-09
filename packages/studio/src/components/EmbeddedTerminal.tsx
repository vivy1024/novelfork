/**
 * EmbeddedTerminal — 内嵌终端组件
 *
 * 使用 @xterm/xterm 在工作台内提供终端能力。
 * 对标 NarraFork 的 @xterm/xterm + bun-pty 终端嵌入。
 *
 * 当前实现：前端 xterm 渲染壳，通过 WebSocket 连接后端 PTY。
 * 后端 PTY 需要 bun-pty 或 node-pty 支持（后续接通）。
 */

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { Button } from "./ui/button";

export interface EmbeddedTerminalProps {
  /** WebSocket URL for PTY connection */
  wsUrl?: string;
  /** Terminal title */
  title?: string;
  /** CSS class for the container */
  className?: string;
  /** Called when terminal is ready */
  onReady?: (terminal: Terminal) => void;
  /** Called when terminal is closed */
  onClose?: () => void;
}

export function EmbeddedTerminal({ wsUrl, title = "终端", className = "", onReady, onClose }: EmbeddedTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: "#1e1e2e",
        foreground: "#cdd6f4",
        cursor: "#f5e0dc",
        selectionBackground: "#585b7066",
        black: "#45475a",
        red: "#f38ba8",
        green: "#a6e3a1",
        yellow: "#f9e2af",
        blue: "#89b4fa",
        magenta: "#f5c2e7",
        cyan: "#94e2d5",
        white: "#bac2de",
        brightBlack: "#585b70",
        brightRed: "#f38ba8",
        brightGreen: "#a6e3a1",
        brightYellow: "#f9e2af",
        brightBlue: "#89b4fa",
        brightMagenta: "#f5c2e7",
        brightCyan: "#94e2d5",
        brightWhite: "#a6adc8",
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(containerRef.current);

    // Connect to WebSocket PTY if URL provided
    if (wsUrl) {
      connectWebSocket(terminal, wsUrl);
    } else {
      terminal.writeln("\x1b[33m终端就绪。等待 PTY 连接...\x1b[0m");
      terminal.writeln("\x1b[90m提示：后端需要启动 PTY WebSocket 服务\x1b[0m");
    }

    onReady?.(terminal);

    return () => {
      resizeObserver.disconnect();
      wsRef.current?.close();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [wsUrl]);

  function connectWebSocket(terminal: Terminal, url: string) {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setError(null);
        terminal.writeln("\x1b[32m已连接到终端\x1b[0m\r\n");
      };

      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          terminal.write(event.data);
        } else if (event.data instanceof ArrayBuffer) {
          terminal.write(new Uint8Array(event.data));
        }
      };

      ws.onclose = () => {
        setConnected(false);
        terminal.writeln("\r\n\x1b[31m连接已断开\x1b[0m");
      };

      ws.onerror = () => {
        setError("WebSocket 连接失败");
        setConnected(false);
      };

      // Send terminal input to PTY
      terminal.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // Send resize events
      terminal.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "连接失败");
    }
  }

  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-border ${className}`}>
      {/* Terminal header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-[#1e1e2e] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div className={`size-2 rounded-full ${connected ? "bg-green-500" : "bg-gray-500"}`} />
          <span className="text-xs font-medium text-gray-300">{title}</span>
        </div>
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-gray-400 hover:bg-gray-700 hover:text-gray-200"
            onClick={onClose}
          >
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </Button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="shrink-0 bg-red-900/30 px-3 py-1 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Terminal container */}
      <div ref={containerRef} className="flex-1 min-h-[200px]" />
    </div>
  );
}
