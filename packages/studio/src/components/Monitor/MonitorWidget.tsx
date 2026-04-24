import { useEffect, useState } from "react";
import { Play, Square, AlertCircle, Pause } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { LogViewer } from "./LogViewer";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";

export type MonitorStatus = 'running' | 'stopped' | 'interrupted' | 'error';

export interface MonitorState {
  status: MonitorStatus;
  currentTask?: string;
  progress?: number;
  error?: string;
  logs: string[];
}

interface MonitorWidgetProps {
  className?: string;
}

export function MonitorWidget({ className }: MonitorWidgetProps) {
  const [state, setState] = useState<MonitorState>({
    status: 'stopped',
    logs: [],
  });

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/monitor/logs`;

    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    // Flag gated by the cleanup function so the auto-reconnect branch inside
    // `onclose` cannot rearm a zombie timer after unmount. Without this, the
    // explicit `ws.close()` in cleanup would trigger `onclose`, which would
    // schedule a 5s `connect()` that re-enters setState on an unmounted tree.
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log("Monitor WebSocket connected");
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'status') {
              setState(prev => ({
                ...prev,
                status: data.status,
                currentTask: data.currentTask,
                progress: data.progress,
                error: data.error,
              }));
            } else if (data.type === 'log') {
              setState(prev => ({
                ...prev,
                logs: [...prev.logs, data.message].slice(-100),
              }));
            }
          } catch (err) {
            console.error("Failed to parse monitor message:", err);
          }
        };

        ws.onerror = (err) => {
          console.error("Monitor WebSocket error:", err);
        };

        ws.onclose = () => {
          if (disposed) return;
          console.log("Monitor WebSocket closed, reconnecting in 5s...");
          reconnectTimer = setTimeout(connect, 5000);
        };
      } catch (err) {
        console.error("Failed to connect monitor WebSocket:", err);
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 5000);
        }
      }
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try { ws.close(); } catch { /* already closing */ }
        ws = null;
      }
    };
  }, []);

  const handleStart = async () => {
    try {
      const res = await fetch('/api/daemon/start', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        setState(prev => ({ ...prev, status: 'error', error: data.error }));
      }
    } catch (err) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  };

  const handleStop = async () => {
    try {
      const res = await fetch('/api/daemon/stop', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        setState(prev => ({ ...prev, status: 'error', error: data.error }));
      }
    } catch (err) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  };

  const handleInterrupt = () => {
    setState(prev => ({ ...prev, status: 'interrupted' }));
  };

  return (
    <div className={`flex flex-col gap-4 p-4 border rounded-lg ${className || ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusBadge status={state.status} />
          {state.currentTask && (
            <span className="text-sm text-muted-foreground">{state.currentTask}</span>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleStart}
            disabled={state.status === 'running'}
          >
            <Play className="w-4 h-4 mr-1" />
            Start
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleStop}
            disabled={state.status === 'stopped'}
          >
            <Square className="w-4 h-4 mr-1" />
            Stop
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleInterrupt}
          >
            <Pause className="w-4 h-4 mr-1" />
            Interrupt
          </Button>
        </div>
      </div>

      {state.progress !== undefined && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span>{Math.round(state.progress)}%</span>
          </div>
          <Progress value={state.progress} />
        </div>
      )}

      {state.error && (
        <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
          <AlertCircle className="w-4 h-4 text-destructive mt-0.5" />
          <span className="text-sm text-destructive">{state.error}</span>
        </div>
      )}

      <LogViewer logs={state.logs} />
    </div>
  );
}
