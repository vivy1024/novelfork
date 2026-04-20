import { useEffect, useRef, useState } from "react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import type { SSEMessage } from "../hooks/use-sse";
import { shouldRefetchDaemonStatus } from "../hooks/use-book-activity";
import { useNovelFork } from "../providers/novelfork-context";

interface Nav {
  toDashboard: () => void;
}

interface DaemonLogEntry {
  readonly timestamp: string;
  readonly event: string;
  readonly message: string;
}

interface DaemonData {
  readonly running: boolean;
  readonly log?: ReadonlyArray<DaemonLogEntry>;
  readonly intervalMinutes?: number;
}

export function DaemonControl({ nav, theme, t, sse }: { nav: Nav; theme: Theme; t: TFunction; sse: { messages: ReadonlyArray<SSEMessage> } }) {
  const c = useColors(theme);
  const { data, refetch } = useApi<DaemonData>("/daemon");
  const [loading, setLoading] = useState(false);
  const [intervalMin, setIntervalMin] = useState(5);
  const { mode } = useNovelFork();
  const isTauri = mode === "tauri";
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 同步服务端返回的 interval 值
  useEffect(() => {
    if (data?.intervalMinutes) setIntervalMin(data.intervalMinutes);
  }, [data?.intervalMinutes]);

  // SSE 模式刷新（web/standalone）
  useEffect(() => {
    if (isTauri) return;
    const recent = sse.messages.at(-1);
    if (!shouldRefetchDaemonStatus(recent)) return;
    void refetch();
  }, [refetch, sse.messages, isTauri]);

  // Tauri 模式：运行时每 3 秒轮询状态和日志
  useEffect(() => {
    if (!isTauri) return;
    // 清理旧定时器
    if (pollRef.current) clearInterval(pollRef.current);
    if (data?.running) {
      pollRef.current = setInterval(() => { void refetch(); }, 3000);
    } else {
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isTauri, data?.running, refetch]);

  const handleStart = async () => {
    setLoading(true);
    try {
      await postApi("/daemon/start", { intervalMinutes: intervalMin });
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await postApi("/daemon/stop");
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const isRunning = data?.running ?? false;

  // Tauri 模式使用 bridge 返回的日志，web 模式使用 SSE
  const daemonEvents: ReadonlyArray<{ event: string; message: string; timestamp?: string }> = isTauri
    ? (data?.log ?? []).slice(-20)
    : sse.messages
        .filter((m) => m.event.startsWith("daemon:") || m.event === "log")
        .slice(-20)
        .map((msg) => {
          const d = msg.data as Record<string, unknown>;
          return { event: msg.event, message: String(d.message ?? d.bookId ?? JSON.stringify(d)) };
        });

  return (
    <PageScaffold
      title={t("daemon.title")}
      description="查看守护进程状态、切换运行状态，并持续观察最近事件流。"
      actions={
        <div className="flex items-center gap-3">
          {isTauri && !isRunning && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{t("daemon.interval")}</span>
              <input
                type="number"
                min={1}
                max={60}
                value={intervalMin}
                onChange={(e) => setIntervalMin(Math.max(1, Math.min(60, Number(e.target.value) || 5)))}
                className="w-16 rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
              />
            </label>
          )}
          <span className={`text-sm font-medium uppercase tracking-wide ${isRunning ? "text-emerald-500" : "text-muted-foreground"}`}>
            {isRunning ? t("daemon.running") : t("daemon.stopped")}
          </span>
          {isRunning ? (
            <Button onClick={handleStop} disabled={loading} variant="destructive">
              {loading ? t("daemon.stopping") : t("daemon.stop")}
            </Button>
          ) : (
            <Button onClick={handleStart} disabled={loading}>
              {loading ? t("daemon.starting") : t("daemon.start")}
            </Button>
          )}
        </div>
      }
    >
      <div className={`rounded-lg border ${c.cardStatic}`}>
        <div className="border-b border-border px-5 py-3.5">
          <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{t("daemon.eventLog")}</span>
        </div>
        <div className="max-h-[500px] overflow-y-auto p-4">
          {daemonEvents.length > 0 ? (
            <div className="space-y-1.5 font-mono text-sm">
              {daemonEvents.map((entry, i) => (
                <div key={i} className="leading-relaxed text-muted-foreground">
                  {"timestamp" in entry && entry.timestamp && (
                    <span className="mr-2 text-muted-foreground/50">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  )}
                  <span className="text-primary/50">{entry.event}</span>
                  <span className="mx-1.5 text-border">›</span>
                  <span>{entry.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <PageEmptyState
              title={isRunning ? t("daemon.waitingEvents") : t("daemon.startHint")}
              description="守护进程产生日志后会滚动出现在这里；当前为空时代表还没有新的任务事件。"
            />
          )}
        </div>
      </div>
    </PageScaffold>
  );
}
