import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, Play, RefreshCw, Square, Terminal, Workflow } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson } from "../../hooks/use-api";

interface DaemonEvent {
  timestamp: string;
  event: string;
  level: "info" | "error";
  message: string;
}

interface DaemonSnapshot {
  running: boolean;
  refreshedAt: string;
  refreshHintMs: number;
  schedule: {
    radarCron: string;
    writeCron: string;
  };
  limits: {
    maxConcurrentBooks: number;
    chaptersPerCycle: number | null;
    retryDelayMs: number | null;
    cooldownAfterChapterMs: number | null;
    maxChaptersPerDay: number | null;
  };
  recentEvents: DaemonEvent[];
  capabilities: {
    start: boolean;
    stop: boolean;
    terminal: boolean;
    container: boolean;
  };
}

interface FeedbackState {
  tone: "success" | "error";
  message: string;
}

export function DaemonTab() {
  const [snapshot, setSnapshot] = useState<DaemonSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingAction, setPendingAction] = useState<"start" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const loadSnapshot = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const data = await fetchJson<DaemonSnapshot>("/api/admin/daemon");
      setSnapshot(data);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载守护进程状态失败");
      if (!silent) {
        setSnapshot(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadSnapshot();
  }, []);

  useEffect(() => {
    const refreshHintMs = snapshot?.refreshHintMs ?? 10_000;
    const timer = window.setInterval(() => {
      void loadSnapshot({ silent: true });
    }, refreshHintMs);

    return () => window.clearInterval(timer);
  }, [snapshot?.refreshHintMs]);

  const runAction = async (action: "start" | "stop") => {
    setPendingAction(action);
    setFeedback(null);

    try {
      await fetchJson(`/api/admin/daemon/${action}`, { method: "POST" });
      setFeedback({
        tone: "success",
        message: action === "start" ? "守护进程启动指令已发送" : "守护进程停止指令已发送",
      });
      await loadSnapshot({ silent: true });
    } catch (actionError) {
      setFeedback({
        tone: "error",
        message: actionError instanceof Error ? actionError.message : `守护进程${action === "start" ? "启动" : "停止"}失败`,
      });
    } finally {
      setPendingAction(null);
    }
  };

  const statusBadge = useMemo(() => {
    if (!snapshot) return <Badge variant="outline">等待接入</Badge>;
    return snapshot.running ? <Badge variant="secondary">运行中</Badge> : <Badge variant="outline">已停止</Badge>;
  }, [snapshot]);

  if (loading && !snapshot && !error) {
    return <div className="py-10 text-center text-sm text-muted-foreground">正在加载守护进程状态…</div>;
  }

  if (error && !snapshot) {
    return (
      <PageEmptyState
        title="守护进程状态加载失败"
        description={error}
        action={
          <Button variant="outline" onClick={() => void loadSnapshot()}>
            重试
          </Button>
        }
      />
    );
  }

  if (!snapshot) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-foreground">守护进程</h2>
            {statusBadge}
            <Badge variant="outline">轮询 {Math.round(snapshot.refreshHintMs / 1000)}s</Badge>
          </div>
          <p className="text-sm text-muted-foreground">直接接入守护进程真实状态、调度配置与最近事件流，不再停留在占位页。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadSnapshot({ silent: true })} disabled={refreshing}>
            <RefreshCw className="size-4" />
            {refreshing ? "刷新中…" : "刷新状态"}
          </Button>
          {snapshot.running ? (
            <Button variant="destructive" onClick={() => void runAction("stop")} disabled={!snapshot.capabilities.stop || pendingAction !== null}>
              <Square className="size-4" />
              {pendingAction === "stop" ? "停止中…" : "停止守护进程"}
            </Button>
          ) : (
            <Button onClick={() => void runAction("start")} disabled={!snapshot.capabilities.start || pendingAction !== null}>
              <Play className="size-4" />
              {pendingAction === "start" ? "启动中…" : "启动守护进程"}
            </Button>
          )}
        </div>
      </div>

      {feedback ? (
        <Card className={feedback.tone === "success" ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"}>
          <CardContent className="py-4 text-sm text-foreground">{feedback.message}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard title="运行状态" value={snapshot.running ? "运行中" : "已停止"} description={`最近刷新 ${formatDateTime(snapshot.refreshedAt)}`} />
        <SummaryCard title="Radar Cron" value={snapshot.schedule.radarCron} description="雷达/巡检任务计划" />
        <SummaryCard title="Write Cron" value={snapshot.schedule.writeCron} description="写作任务计划" />
        <SummaryCard title="并发上限" value={String(snapshot.limits.maxConcurrentBooks)} description={snapshot.limits.chaptersPerCycle === null ? "按默认章节节奏运行" : `每轮 ${snapshot.limits.chaptersPerCycle} 章`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="size-4 text-primary" />
              最近事件
            </CardTitle>
            <CardDescription>来自守护进程运行态的真实事件流；启动、停止、章节完成和异常都会出现在这里。</CardDescription>
          </CardHeader>
          <CardContent>
            {snapshot.recentEvents.length === 0 ? (
              <PageEmptyState title="暂无守护进程事件" description="启动守护进程或等待任务执行后，这里会滚动出现最新事件。" />
            ) : (
              <div className="space-y-3">
                {snapshot.recentEvents.map((event, index) => (
                  <div key={`${event.timestamp}-${event.event}-${index}`} className="rounded-xl border border-border/70 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={event.level === "error" ? "destructive" : "secondary"}>{event.event}</Badge>
                      <span className="text-xs text-muted-foreground">{formatDateTime(event.timestamp)}</span>
                    </div>
                    <p className="mt-2 text-sm text-foreground">{event.message}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Workflow className="size-4 text-primary" />
              接入状态
            </CardTitle>
            <CardDescription>只展示当前确实落地的入口；没有真实能力的项明确标注为待接入。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusRow
              title="启动 / 停止"
              description="已直接接到 /api/admin/daemon/start 和 /api/admin/daemon/stop，操作后会回刷状态。"
              badge={<Badge variant="secondary">已接入</Badge>}
            />
            <StatusRow
              title="自动刷新"
              description={`当前按 ${Math.round(snapshot.refreshHintMs / 1000)} 秒刷新一次，运行中会持续跟进事件变化。`}
              badge={<Badge variant="secondary">已接入</Badge>}
            />
            <StatusRow
              title="终端入口"
              description="本轮未伪造 shell 打开能力，管理中心先提供状态与事件流。"
              badge={<Badge variant="outline">待接入</Badge>}
              icon={<Terminal className="size-4 text-muted-foreground" />}
            />
            <StatusRow
              title="容器入口"
              description="当前没有可验证的容器运行时适配器，因此只保留接口位，不展示虚假按钮。"
              badge={<Badge variant="outline">待接入</Badge>}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl break-all">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground">{description}</CardContent>
    </Card>
  );
}

function StatusRow({
  title,
  description,
  badge,
  icon,
}: {
  title: string;
  description: string;
  badge: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            {icon}
            {title}
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {badge}
      </div>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN");
}
