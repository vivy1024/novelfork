import { useEffect, useMemo, useState } from "react";
import { Clock3, FileText, RefreshCw, Search, TimerReset } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRunDetails, useRunListStream } from "@/hooks/use-run-events";
import type { StudioRun } from "@/shared/contracts";
import type { RequestLog, RequestSummary } from "../../shared/request-observability";
import { fetchJson } from "../../hooks/use-api";

interface RequestsFilters {
  runId?: string | null;
  provider?: string;
  model?: string;
  status?: string;
  scope?: string;
  bookId?: string;
  sessionId?: string;
}

interface RequestsResponse {
  logs: RequestLog[];
  total: number;
  summary?: RequestSummary;
  filters?: RequestsFilters;
}

interface RequestsTabProps {
  runId?: string;
  onInspectRun?: (runId: string) => void;
  onNavigateSection?: (section: "logs" | "requests" | "resources", options?: { runId?: string }) => void;
  onOpenRun?: (runId: string) => void;
}

export function RequestsTab({ runId, onInspectRun, onNavigateSection, onOpenRun }: RequestsTabProps = {}) {
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [summary, setSummary] = useState<RequestSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(100);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [scope, setScope] = useState("ai");
  const [providerFilter, setProviderFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [bookFilter, setBookFilter] = useState("");
  const [sessionFilter, setSessionFilter] = useState("");
  const liveRuns = useRunListStream();
  const selectedRunDetails = useRunDetails(selectedRunId);

  useEffect(() => {
    void loadLogs();
  }, [limit, runId, scope, providerFilter, statusFilter, bookFilter, sessionFilter]);

  useEffect(() => {
    setSelectedRunId((current) => {
      if (liveRuns.length === 0) {
        return null;
      }
      if (current && liveRuns.some((run) => run.id === current)) {
        return current;
      }
      return liveRuns[0]?.id ?? null;
    });
  }, [liveRuns]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (runId) {
        params.set("runId", runId);
      }
      if (scope) params.set("scope", scope);
      if (providerFilter) params.set("provider", providerFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (bookFilter) params.set("bookId", bookFilter);
      if (sessionFilter) params.set("sessionId", sessionFilter);
      const data = await fetchJson<RequestsResponse>(`/api/admin/requests?${params.toString()}`);
      setLogs(data.logs);
      setSummary(data.summary ?? null);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  };

  const fallbackSummary = useMemo<RequestSummary>(() => {
    const successful = logs.filter((log) => log.status >= 200 && log.status < 400).length;
    const successRate = logs.length === 0 ? 0 : Math.round((successful / logs.length) * 100);
    const slowRequests = logs.filter((log) => log.duration >= 2000).length;
    const errorRequests = logs.filter((log) => log.status >= 400).length;
    const averageDuration = logs.length === 0 ? 0 : Math.round(logs.reduce((sum, log) => sum + log.duration, 0) / logs.length);

    return {
      successRate,
      slowRequests,
      errorRequests,
      averageDuration,
      averageTtftMs: null,
      totalTokens: 0,
      totalCostUsd: 0,
      cacheHitRate: null,
      topEndpoints: [],
      topNarrators: [],
    };
  }, [logs]);

  const requestSummary = summary ?? fallbackSummary;
  const providerOptions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.provider).filter((value): value is string => Boolean(value)))).sort((left, right) => left.localeCompare(right, "zh-CN")),
    [logs],
  );

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

  const selectedRun = useMemo(() => {
    const fallback = liveRuns.find((run) => run.id === selectedRunId) ?? null;
    return selectedRunDetails ?? fallback;
  }, [liveRuns, selectedRunDetails, selectedRunId]);

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

  const extractRunId = (log: RequestLog) => {
    const candidate = [log.details, log.endpoint, log.narrator].find((value) => typeof value === "string" && /run-[\w-]+/.test(value));
    return candidate?.match(/run-[\w-]+/)?.[0];
  };

  if (loading) {
    return <div className="py-10 text-center text-sm text-muted-foreground">正在加载请求历史…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-foreground">请求历史</h2>
            {runId ? <Badge variant="secondary">当前聚焦 {runId}</Badge> : null}
          </div>
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
        <SummaryCard title="成功率" value={`${requestSummary.successRate}%`} description="2xx / 3xx 请求占比" icon={Clock3} />
        <SummaryCard title="慢请求" value={String(requestSummary.slowRequests)} description="耗时大于等于 2000ms" icon={TimerReset} />
        <SummaryCard title="平均耗时" value={`${requestSummary.averageDuration}ms`} description="最近请求的平均响应时间" icon={RefreshCw} />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard
          title="平均 TTFT"
          value={requestSummary.averageTtftMs === null ? "未上报" : `${requestSummary.averageTtftMs}ms`}
          description={requestSummary.averageTtftMs === null ? "当前范围内还没有首 token 时间。" : "仅统计已上报 TTFT 的请求"}
          icon={Clock3}
        />
        <SummaryCard
          title="缓存命中率"
          value={requestSummary.cacheHitRate === null ? "—" : `${requestSummary.cacheHitRate}%`}
          description={requestSummary.cacheHitRate === null ? "当前范围内没有可计算命中率的请求。" : "命中 / 可缓存请求占比"}
          icon={TimerReset}
        />
        <SummaryCard
          title="热点 narrator"
          value={requestSummary.topNarrators[0]?.label ?? "—"}
          description={requestSummary.topNarrators[0] ? `${requestSummary.topNarrators[0].count} 次请求` : "当前范围内没有 narrator 聚合"}
          icon={FileText}
        />
        <SummaryCard
          title="Token 总量"
          value={requestSummary.totalTokens > 0 ? `${requestSummary.totalTokens}` : "—"}
          description={requestSummary.totalTokens > 0 ? `累计成本 $${requestSummary.totalCostUsd.toFixed(4)}` : "当前范围内没有 token 统计"}
          icon={RefreshCw}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>请求筛选</CardTitle>
          <CardDescription>管理中心默认聚焦 AI 请求；作者主界面不会暴露这些调试指标。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">范围</span>
            <select value={scope} onChange={(event) => setScope(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
              <option value="ai">仅 AI 请求</option>
              <option value="admin">仅管理请求</option>
              <option value="">全部请求</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">供应商</span>
            <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
              <option value="">全部</option>
              {providerOptions.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">状态</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
              <option value="">全部</option>
              <option value="success">成功</option>
              <option value="error">失败</option>
              <option value="partial">部分成功</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">书籍</span>
            <input value={bookFilter} onChange={(event) => setBookFilter(event.target.value)} placeholder="bookId" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">会话</span>
            <input value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)} placeholder="sessionId" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" />
          </label>
        </CardContent>
      </Card>

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
              {runSummary.latestRuns.map((run) => {
                const isSelected = run.id === selectedRunId;
                return (
                  <div key={run.id} className={`rounded-lg border p-3 text-sm ${isSelected ? "border-primary/40 bg-primary/5" : "border-border/60 bg-muted/30"}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedRunId(run.id)}
                      className="w-full text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={run.status === "failed" ? "destructive" : run.status === "succeeded" ? "secondary" : "outline"}>{run.status}</Badge>
                        <span className="font-mono text-foreground">{run.id}</span>
                        <span className="text-muted-foreground">{run.action}</span>
                        <span className="text-muted-foreground">{run.stage}</span>
                      </div>
                      {run.error ? <div className="mt-2 text-xs text-destructive">{run.error}</div> : null}
                    </button>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="outline" size="xs" onClick={() => onInspectRun?.(run.id)} aria-label={`定位运行 ${run.id}`}>
                        <Search className="size-3.5" />
                        定位运行
                      </Button>
                      <Button variant="outline" size="xs" onClick={() => onNavigateSection?.("logs", { runId: run.id })} aria-label={`查看日志 ${run.id}`}>
                        查看日志
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedRunId ? (
        <Card>
          <CardHeader>
            <CardTitle>运行事实详情</CardTitle>
            <CardDescription>和 ToolCall 共用同一条 runStore 事实源，直接查看当前运行的定位、阶段与日志。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedRunId && onOpenRun ? (
              <div className="flex justify-end">
                <Button type="button" variant="outline" onClick={() => onOpenRun(selectedRunId)}>
                  打开 Pipeline
                </Button>
              </div>
            ) : null}
            {!selectedRun ? (
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">正在订阅运行事实…</div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={selectedRun.status === "failed" ? "destructive" : selectedRun.status === "succeeded" ? "secondary" : "outline"}>{selectedRun.status}</Badge>
                  <Badge variant="outline">{selectedRun.action}</Badge>
                  <span className="font-mono text-sm text-foreground">{selectedRun.id}</span>
                  <span className="text-sm text-muted-foreground">{selectedRun.stage}</span>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <RunFactField label="书籍" value={selectedRun.bookId} />
                  <RunFactField label="章节" value={formatRunChapter(selectedRun)} />
                  <RunFactField label="开始" value={formatDateTime(selectedRun.startedAt ?? selectedRun.createdAt)} />
                  <RunFactField label="结束" value={selectedRun.finishedAt ? formatDateTime(selectedRun.finishedAt) : "进行中"} />
                </div>

                {selectedRun.error ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{selectedRun.error}</div>
                ) : null}

                <section className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">运行日志</div>
                  {selectedRun.logs.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">当前运行还没有产生日志。</div>
                  ) : (
                    <div className="space-y-2">
                      {selectedRun.logs.map((entry, index) => (
                        <div key={`${entry.timestamp}-${entry.message}-${index}`} className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{formatDateTime(entry.timestamp)}</span>
                            <Badge variant={entry.level === "error" ? "destructive" : entry.level === "warn" ? "outline" : "secondary"}>{entry.level}</Badge>
                          </div>
                          <div className="mt-2 whitespace-pre-wrap break-words text-foreground">{entry.message}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {selectedRun.result !== undefined ? (
                  <section className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">运行结果</div>
                    <pre className="overflow-x-auto rounded-lg border border-border/60 bg-muted/20 p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-foreground">
                      {formatRunResult(selectedRun.result)}
                    </pre>
                  </section>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

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
                  <th className="py-3 pr-4 font-medium">请求</th>
                  <th className="py-3 pr-4 font-medium">状态</th>
                  <th className="py-3 pr-4 font-medium">耗时 / TTFT</th>
                  <th className="py-3 font-medium">关联</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const logRunId = extractRunId(log);
                  return (
                    <tr key={log.id} className="border-b border-border/60 align-top last:border-b-0">
                      <td className="py-3 pr-4 text-muted-foreground">{new Date(log.timestamp).toLocaleString()}</td>
                      <td className="py-3 pr-4"><Badge variant={methodVariant(log.method)}>{log.method}</Badge></td>
                      <td className="py-3 pr-4 font-mono text-foreground">
                        <div>{log.endpoint}</div>
                        {(log.requestKind || log.narrator || log.provider || log.model || log.cache || log.tokens || log.details || log.errorSummary) ? (
                          <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-normal">
                            {log.requestKind ? <Badge variant="outline">{log.requestKind}</Badge> : null}
                            {log.narrator ? <Badge variant="outline">{log.narrator}</Badge> : null}
                            {log.provider ? <Badge variant="secondary">{log.provider}</Badge> : null}
                            {log.model ? <Badge variant="outline">{log.model}</Badge> : null}
                            {log.aiStatus ? <Badge variant={log.aiStatus === "error" ? "destructive" : "secondary"}>{log.aiStatus}</Badge> : null}
                            {log.cache ? <Badge variant={log.cache.status === "hit" ? "secondary" : "outline"}>缓存 {log.cache.status}</Badge> : null}
                            {log.tokens?.total ? <Badge variant="outline">{formatTokenBadge(log)}</Badge> : null}
                            {log.costUsd ? <Badge variant="outline">${log.costUsd.toFixed(4)}</Badge> : null}
                          </div>
                        ) : null}
                        {log.errorSummary ? <div className="mt-2 text-xs text-destructive">{log.errorSummary}</div> : null}
                        {log.details ? <div className="mt-2 text-xs text-muted-foreground">{log.details}</div> : null}
                      </td>
                      <td className={`py-3 pr-4 font-semibold ${statusClassName(log.status)}`}>{log.aiStatus === "error" ? "失败" : log.status}</td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        <div>{log.duration}ms</div>
                        <div className="mt-1 text-xs text-muted-foreground/80">TTFT {typeof log.ttftMs === "number" ? `${log.ttftMs}ms` : "未上报"}</div>
                      </td>
                      <td className="py-3 text-muted-foreground">
                        <div>{log.bookId ?? log.userId}</div>
                        <div className="mt-1 text-xs">{log.sessionId ? `会话 ${log.sessionId}` : "无会话关联"}</div>
                        {logRunId ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button variant="outline" size="xs" onClick={() => onInspectRun?.(logRunId)}>
                              定位运行
                            </Button>
                            <Button variant="outline" size="xs" onClick={() => onNavigateSection?.("logs", { runId: logRunId })}>
                              查看日志
                            </Button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
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

function RunFactField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm text-foreground">{value}</div>
    </div>
  );
}

function formatRunChapter(run: Pick<StudioRun, "chapterNumber" | "chapter">) {
  const chapterNumber = run.chapterNumber ?? run.chapter;
  return typeof chapterNumber === "number" ? `第 ${chapterNumber} 章` : "—";
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN");
}

function formatRunResult(result: unknown) {
  if (typeof result === "string") {
    return result;
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function formatTokenBadge(log: RequestLog) {
  const total = log.tokens?.total ?? ((log.tokens?.input ?? 0) + (log.tokens?.output ?? 0));
  if (!total) return "0 tokens";
  return `${total} tokens${log.tokens?.estimated ? " · 估算" : ""}`;
}
