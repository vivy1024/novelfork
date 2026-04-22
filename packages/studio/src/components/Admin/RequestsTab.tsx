import { useEffect, useMemo, useState } from "react";
import { Clock3, FileText, RefreshCw, TimerReset } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRunListStream } from "@/hooks/use-run-events";
import type { StudioRun } from "@/shared/contracts";
import { fetchJson } from "../../hooks/use-api";

interface RequestLog {
  id: string;
  timestamp: Date | string;
  method: string;
  endpoint: string;
  status: number;
  duration: number;
  userId: string;
}

export function RequestsTab() {
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(100);
  const liveRuns = useRunListStream();

  useEffect(() => {
    void loadLogs();
  }, [limit]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ logs: RequestLog[]; total: number }>(`/api/admin/requests?limit=${limit}`);
      setLogs(data.logs);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  };

  const summary = useMemo(() => {
    const successful = logs.filter((log) => log.status >= 200 && log.status < 400).length;
    const successRate = logs.length === 0 ? 0 : Math.round((successful / logs.length) * 100);
    const slowRequests = logs.filter((log) => log.duration >= 2000).length;
    const averageDuration = logs.length === 0 ? 0 : Math.round(logs.reduce((sum, log) => sum + log.duration, 0) / logs.length);

    return {
      successRate,
      slowRequests,
      averageDuration,
    };
  }, [logs]);

  const runSummary = useMemo(() => {
    const running = liveRuns.filter((run) => run.status === "running" || run.status === "queued");
    const failed = liveRuns.filter((run) => run.status === "failed");
    return {
      total: liveRuns.length,
      running: running.length,
      failed: failed.length,
      latestStage: running[0]?.stage ?? liveRuns[0]?.stage ?? "暂无运行",
      latestRuns: liveRuns.slice(0, 5),
    };
  }, [liveRuns]);

  const methodVariant = (method: string) => {
    switch (method.toUpperCase()) {
      case "GET":
        return "outline" as const;
      case "POST":
      case "PUT":
        return "secondary" as const;
      default:
        return "outline" as const;
    }
  };

  const statusClassName = (status: number) => {
    if (status >= 200 && status < 300) return "text-emerald-500";
    if (status >= 300 && status < 400) return "text-sky-500";
    if (status >= 400 && status < 500) return "text-amber-500";
    return "text-destructive";
  };

  if (loading) {
    return <div className="py-10 text-center text-sm text-muted-foreground">正在加载请求历史…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">请求历史</h2>
          <p className="text-sm text-muted-foreground">统一观察最近请求、成功率、响应耗时与异常波动。</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            <option value={50}>50 条</option>
            <option value={100}>100 条</option>
            <option value={200}>200 条</option>
            <option value={500}>500 条</option>
          </select>
          <Button variant="outline" onClick={() => void loadLogs()}>
            <RefreshCw className="size-4" />
            刷新
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard title="总请求数" value={String(total)} description="当前筛选范围内累计请求" icon={FileText} />
        <SummaryCard title="成功率" value={`${summary.successRate}%`} description="2xx / 3xx 请求占比" icon={Clock3} />
        <SummaryCard title="慢请求" value={String(summary.slowRequests)} description="耗时大于等于 2000ms" icon={TimerReset} />
        <SummaryCard title="平均耗时" value={`${summary.averageDuration}ms`} description="最近请求的平均响应时间" icon={RefreshCw} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>实时运行总览</CardTitle>
          <CardDescription>共享 run 事实源，直接观察当前工具/写作/审计任务状态。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard title="运行总数" value={String(runSummary.total)} description="当前内存 runStore 中的任务" icon={FileText} />
            <SummaryCard title="运行中" value={String(runSummary.running)} description="queued / running 状态" icon={Clock3} />
            <SummaryCard title="失败运行" value={String(runSummary.failed)} description="需要优先排查的失败 run" icon={TimerReset} />
            <SummaryCard title="最近阶段" value={runSummary.latestStage} description="最新活动 run 的阶段" icon={RefreshCw} />
          </div>
          {runSummary.latestRuns.length === 0 ? (
            <PageEmptyState title="暂无运行任务" description="当工具执行、写作、审计进入 runStore 后，这里会实时展示最新运行状态。" />
          ) : (
            <div className="space-y-2">
              {runSummary.latestRuns.map((run) => (
                <div key={run.id} className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={run.status === "failed" ? "destructive" : run.status === "succeeded" ? "secondary" : "outline"}>{run.status}</Badge>
                    <span className="font-mono text-foreground">{run.id}</span>
                    <span className="text-muted-foreground">{run.action}</span>
                    <span className="text-muted-foreground">{run.stage}</span>
                  </div>
                  {run.error ? <div className="mt-2 text-xs text-destructive">{run.error}</div> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {logs.length === 0 ? (
        <PageEmptyState title="暂无请求记录" description="接入请求追踪后，这里会显示请求明细、成功率和性能波动。" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>最近请求</CardTitle>
            <CardDescription>显示最近 {logs.length} 条，共 {total} 条记录</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  <th className="py-3 pr-4 font-medium">时间</th>
                  <th className="py-3 pr-4 font-medium">方法</th>
                  <th className="py-3 pr-4 font-medium">端点</th>
                  <th className="py-3 pr-4 font-medium">状态</th>
                  <th className="py-3 pr-4 font-medium">耗时</th>
                  <th className="py-3 font-medium">用户</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-border/60 align-top last:border-b-0">
                    <td className="py-3 pr-4 text-muted-foreground">{new Date(log.timestamp).toLocaleString()}</td>
                    <td className="py-3 pr-4"><Badge variant={methodVariant(log.method)}>{log.method}</Badge></td>
                    <td className="py-3 pr-4 font-mono text-foreground">{log.endpoint}</td>
                    <td className={`py-3 pr-4 font-semibold ${statusClassName(log.status)}`}>{log.status}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{log.duration}ms</td>
                    <td className="py-3 text-muted-foreground">{log.userId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: typeof FileText;
}) {
  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardDescription>{title}</CardDescription>
          <CardTitle className="mt-2 text-3xl">{value}</CardTitle>
        </div>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground">{description}</CardContent>
    </Card>
  );
}
