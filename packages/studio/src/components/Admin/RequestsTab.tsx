import { useEffect, useState } from "react";
import { Activity, Clock3, DatabaseZap, FileText, RefreshCw } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson } from "../../hooks/use-api";

interface RequestTokenUsage {
  input?: number;
  output?: number;
  total?: number;
}

interface RequestCacheMeta {
  status: "hit" | "miss" | "bypass";
  scope?: string;
  ageMs?: number;
}

interface RequestLog {
  id: string;
  timestamp: Date | string;
  method: string;
  endpoint: string;
  status: number;
  duration: number;
  userId: string;
  requestKind?: string;
  narrator?: string;
  provider?: string;
  model?: string;
  tokens?: RequestTokenUsage;
  ttftMs?: number;
  costUsd?: number;
  cache?: RequestCacheMeta;
  details?: string;
}

interface RequestSummaryBucket {
  label: string;
  count: number;
}

interface RequestSummary {
  successRate: number;
  slowRequests: number;
  errorRequests: number;
  averageDuration: number;
  averageTtftMs: number | null;
  totalTokens: number;
  totalCostUsd: number;
  cacheHitRate: number | null;
  topEndpoints: RequestSummaryBucket[];
  topNarrators: RequestSummaryBucket[];
}

interface RequestsResponse {
  logs: RequestLog[];
  total: number;
  summary?: RequestSummary;
}

const EMPTY_SUMMARY: RequestSummary = {
  successRate: 0,
  slowRequests: 0,
  errorRequests: 0,
  averageDuration: 0,
  averageTtftMs: null,
  totalTokens: 0,
  totalCostUsd: 0,
  cacheHitRate: null,
  topEndpoints: [],
  topNarrators: [],
};

export function RequestsTab() {
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<RequestSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    void loadLogs();
  }, [limit]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const data = await fetchJson<RequestsResponse>(`/api/admin/requests?limit=${limit}`);
      setLogs(data.logs);
      setTotal(data.total);
      setSummary(data.summary ?? EMPTY_SUMMARY);
    } finally {
      setLoading(false);
    }
  };

  const methodVariant = (method: string) => {
    switch (method.toUpperCase()) {
      case "GET":
        return "outline" as const;
      case "POST":
      case "PUT":
        return "secondary" as const;
      case "DELETE":
        return "destructive" as const;
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
          <p className="text-sm text-muted-foreground">统一观察最近请求、缓存命中、TTFT、成本与请求归属，便于排查波动来源。</p>
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
        <SummaryCard title="缓存命中" value={summary.cacheHitRate === null ? "—" : `${summary.cacheHitRate}%`} description="仅统计命中 / 未命中请求" icon={DatabaseZap} />
        <SummaryCard title="平均 TTFT" value={summary.averageTtftMs === null ? "—" : `${summary.averageTtftMs}ms`} description={`平均耗时 ${summary.averageDuration}ms`} icon={Activity} />
      </div>

      <Card size="sm">
        <CardContent className="flex flex-wrap gap-2 pt-6 text-xs text-muted-foreground">
          <InlineMetric label="慢请求" value={`${summary.slowRequests} 条`} />
          <InlineMetric label="错误请求" value={`${summary.errorRequests} 条`} />
          <InlineMetric label="总 Tokens" value={summary.totalTokens.toLocaleString()} />
          <InlineMetric label="总成本" value={formatCost(summary.totalCostUsd)} />
          <InlineMetric label="热门端点" value={summary.topEndpoints[0] ? `${summary.topEndpoints[0].label} · ${summary.topEndpoints[0].count}` : "—"} />
          <InlineMetric label="热门 narrator" value={summary.topNarrators[0] ? `${summary.topNarrators[0].label} · ${summary.topNarrators[0].count}` : "—"} />
        </CardContent>
      </Card>

      {logs.length === 0 ? (
        <PageEmptyState title="暂无请求记录" description="接入请求追踪后，这里会显示请求明细、成功率、缓存命中与性能波动。" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>最近请求</CardTitle>
            <CardDescription>显示最近 {logs.length} 条，共 {total} 条记录</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  <th className="py-3 pr-4 font-medium">时间</th>
                  <th className="py-3 pr-4 font-medium">请求</th>
                  <th className="py-3 pr-4 font-medium">结果</th>
                  <th className="py-3 pr-4 font-medium">性能</th>
                  <th className="py-3 pr-4 font-medium">用量</th>
                  <th className="py-3 font-medium">上下文</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-border/60 align-top last:border-b-0">
                    <td className="py-3 pr-4 text-muted-foreground">{formatDateTime(log.timestamp)}</td>
                    <td className="py-3 pr-4">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={methodVariant(log.method)}>{log.method}</Badge>
                          <span className="font-mono text-foreground">{log.endpoint}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {log.provider || log.model ? `${log.provider ?? "未知 provider"} / ${log.model ?? "未知模型"}` : "未上报 provider / model"}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="space-y-2">
                        <div className={`font-semibold ${statusClassName(log.status)}`}>{log.status}</div>
                        <div className="flex flex-wrap gap-2">
                          {log.cache ? <CacheBadge cache={log.cache} /> : <Badge variant="outline">无缓存字段</Badge>}
                          <Badge variant="outline">{log.narrator ?? "narrator 未上报"}</Badge>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      <div>{log.duration}ms</div>
                      <div className="mt-1 text-xs">TTFT {log.ttftMs === undefined ? "—" : `${log.ttftMs}ms`}</div>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      <div>{formatTokens(log.tokens)}</div>
                      <div className="mt-1 text-xs">{formatCost(log.costUsd)}</div>
                    </td>
                    <td className="py-3 text-muted-foreground">
                      <div>{log.userId}</div>
                      <div className="mt-1 text-xs">{log.requestKind ?? "未分类"}</div>
                      {log.details ? <div className="mt-1 text-xs">{log.details}</div> : null}
                    </td>
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

function InlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-border/70 px-3 py-1.5">
      <span className="font-medium text-foreground">{label}</span>
      <span className="ml-2">{value}</span>
    </div>
  );
}

function CacheBadge({ cache }: { cache: RequestCacheMeta }) {
  const variant = cache.status === "hit" ? "secondary" : cache.status === "miss" ? "outline" : "destructive";
  const label = cache.status === "hit" ? "缓存命中" : cache.status === "miss" ? "缓存未命中" : "跳过缓存";
  const detail = cache.ageMs && cache.ageMs > 0 ? ` · ${cache.ageMs}ms` : "";

  return <Badge variant={variant}>{`${label}${detail}`}</Badge>;
}

function formatTokens(tokens?: RequestTokenUsage) {
  if (!tokens) return "Tokens —";
  const total = tokens.total ?? ((tokens.input ?? 0) + (tokens.output ?? 0) || undefined);
  if (total === undefined) return "Tokens —";
  return `Tokens ${total.toLocaleString()}`;
}

function formatCost(costUsd?: number) {
  if (typeof costUsd !== "number") return "成本 —";
  return `成本 $${costUsd.toFixed(costUsd >= 1 ? 2 : 4)}`;
}

function formatDateTime(value: Date | string) {
  return new Date(value).toLocaleString("zh-CN");
}
