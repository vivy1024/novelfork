import { useApi, postApi } from "../hooks/use-api";
import { useEffect, useState, useRef } from "react";
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
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span className="text-foreground">{t("nav.daemon")}</span>
      </div>

      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl">{t("daemon.title")}</h1>
        <div className="flex items-center gap-3">
          {/* Tauri 模式：间隔配置 */}
          {isTauri && !isRunning && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{t("daemon.interval")}</span>
              <input
                type="number"
                min={1}
                max={60}
                value={intervalMin}
                onChange={(e) => setIntervalMin(Math.max(1, Math.min(60, Number(e.target.value) || 5)))}
                className="w-16 px-2 py-1 rounded border border-border bg-background text-foreground text-sm"
              />
            </label>
          )}
          <span className={`text-sm uppercase tracking-wide font-medium ${isRunning ? "text-emerald-500" : "text-muted-foreground"}`}>
            {isRunning ? t("daemon.running") : t("daemon.stopped")}
          </span>
          {isRunning ? (
            <button
              onClick={handleStop}
              disabled={loading}
              className={`px-4 py-2.5 text-sm rounded-md ${c.btnDanger} disabled:opacity-50`}
            >
              {loading ? t("daemon.stopping") : t("daemon.stop")}
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={loading}
              className={`px-4 py-2.5 text-sm rounded-md ${c.btnPrimary} disabled:opacity-50`}
            >
              {loading ? t("daemon.starting") : t("daemon.start")}
            </button>
          )}
        </div>
      </div>

      {/* 事件日志 */}
      <div className={`border ${c.cardStatic} rounded-lg`}>
        <div className="px-5 py-3.5 border-b border-border">
          <span className="text-sm uppercase tracking-wide text-muted-foreground font-medium">{t("daemon.eventLog")}</span>
        </div>
        <div className="p-4 max-h-[500px] overflow-y-auto">
          {daemonEvents.length > 0 ? (
            <div className="space-y-1.5 font-mono text-sm">
              {daemonEvents.map((entry, i) => (
                <div key={i} className="leading-relaxed text-muted-foreground">
                  {"timestamp" in entry && entry.timestamp && (
                    <span className="text-muted-foreground/50 mr-2">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  )}
                  <span className="text-primary/50">{entry.event}</span>
                  <span className="text-border mx-1.5">›</span>
                  <span>{entry.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground text-sm italic py-8 text-center">
              {isRunning ? t("daemon.waitingEvents") : t("daemon.startHint")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
