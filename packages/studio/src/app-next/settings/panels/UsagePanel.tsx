import { useState, useCallback, useEffect } from "react";
import { useApi, fetchJson } from "../../../hooks/use-api";
import { InlineError } from "../../components/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Filter, X } from "lucide-react";

// ── Types ──

interface UsageEntry {
  providerId: string;
  providerName?: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  turnCount: number;
  sessionCount: number;
}

interface UsageSummary {
  entries: UsageEntry[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTurns: number;
  totalSessions: number;
}

interface RequestItem {
  id: string;
  timestamp: string;
  narrator: string | null;
  provider: string | null;
  model: string | null;
  status: number;
  tokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  ttftMs: number | null;
  duration: number;
  costUsd: number | null;
  error: string | null;
}

interface RequestsResponse {
  items: RequestItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: {
    successRate: number;
    averageDuration: number;
    averageTtftMs: number | null;
    totalTokens: number;
    totalCostUsd: number;
    errorRequests: number;
  };
}

interface TrendPoint {
  time: string;
  value: number;
}

interface TrendResponse {
  granularity: string;
  metric: string;
  points: TrendPoint[];
}

// ── Helpers ──

function formatTokenCount(count: number): string {
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

// ── Components ──

function StatCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-mono font-semibold text-foreground">{value}</div>
      {detail && <div className="text-[10px] text-muted-foreground mt-0.5">{detail}</div>}
    </div>
  );
}

function TrendChart({ points, height = 120 }: { points: TrendPoint[]; height?: number }) {
  if (points.length === 0) {
    return <div className="flex items-center justify-center h-[120px] text-sm text-muted-foreground">暂无趋势数据</div>;
  }

  const maxValue = Math.max(...points.map((p) => p.value), 1);
  const width = 100;

  const pathPoints = points.map((p, i) => {
    const x = points.length === 1 ? 50 : (i / (points.length - 1)) * width;
    const y = height - (p.value / maxValue) * (height - 20) - 10;
    return `${x},${y}`;
  });

  const pathD = `M ${pathPoints.join(" L ")}`;

  return (
    <div className="rounded-lg border border-border p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
        <path d={pathD} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>{points[0]?.time ?? ""}</span>
        <span>{formatTokenCount(maxValue)}</span>
        <span>{points[points.length - 1]?.time ?? ""}</span>
      </div>
    </div>
  );
}

// ── Main Panel ──

export function UsagePanel() {
  const { data: summaryData, loading: summaryLoading, error: summaryError, refetch } = useApi<UsageSummary>("/usage/summary");
  const [refreshing, setRefreshing] = useState(false);

  // Trend state
  const [granularity, setGranularity] = useState<"hour" | "day" | "month">("day");
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);

  // Requests state
  const [requests, setRequests] = useState<RequestsResponse | null>(null);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [page, setPage] = useState(1);

  // Filters
  const [filterProvider, setFilterProvider] = useState("");
  const [filterModel, setFilterModel] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filtersApplied, setFiltersApplied] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // Load trend data
  useEffect(() => {
    setTrendLoading(true);
    fetchJson<TrendResponse>(`/usage/trend?granularity=${granularity}&metric=tokens`)
      .then((data) => setTrendData(data.points))
      .catch(() => setTrendData([]))
      .finally(() => setTrendLoading(false));
  }, [granularity]);

  // Load requests
  useEffect(() => {
    setRequestsLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (filtersApplied) {
      if (filterProvider) params.set("provider", filterProvider);
      if (filterModel) params.set("model", filterModel);
      if (filterStatus && filterStatus !== "all") params.set("status", filterStatus);
    }
    fetchJson<RequestsResponse>(`/usage/requests?${params}`)
      .then(setRequests)
      .catch(() => setRequests(null))
      .finally(() => setRequestsLoading(false));
  }, [page, filtersApplied, filterProvider, filterModel, filterStatus]);

  const applyFilters = () => { setPage(1); setFiltersApplied(true); };
  const resetFilters = () => { setFilterProvider(""); setFilterModel(""); setFilterStatus("all"); setFiltersApplied(false); setPage(1); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold mb-1 text-foreground">使用历史</h2>
          <p className="text-sm text-muted-foreground">请求统计、趋势和明细记录。</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="gap-1">
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      {summaryLoading && <p className="text-muted-foreground">加载中...</p>}
      {summaryError && <InlineError message={summaryError} />}

      {summaryData && (
        <>
          {/* 统计卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="请求数" value={formatTokenCount(summaryData.totalSessions)} detail={`精确值：${summaryData.totalSessions.toLocaleString()}`} />
            <StatCard label="总 Tokens" value={formatTokenCount(summaryData.totalInputTokens + summaryData.totalOutputTokens)} detail={`输入 ${formatTokenCount(summaryData.totalInputTokens)} · 输出 ${formatTokenCount(summaryData.totalOutputTokens)}`} />
            <StatCard label="总轮次" value={summaryData.totalTurns.toLocaleString()} />
            <StatCard label="会话数" value={summaryData.totalSessions.toLocaleString()} />
          </div>

          {/* 趋势图 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">使用趋势</h3>
              <Tabs value={granularity} onValueChange={(v) => setGranularity(v as typeof granularity)}>
                <TabsList>
                  <TabsTrigger value="hour">小时</TabsTrigger>
                  <TabsTrigger value="day">天</TabsTrigger>
                  <TabsTrigger value="month">月</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {trendLoading ? (
              <div className="h-[120px] flex items-center justify-center text-sm text-muted-foreground">加载趋势...</div>
            ) : (
              <TrendChart points={trendData} />
            )}
          </div>

          {/* 筛选器 */}
          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input
                placeholder="按提供商筛选"
                value={filterProvider}
                onChange={(e) => setFilterProvider(e.target.value)}
                className="text-xs"
              />
              <Input
                placeholder="按模型筛选"
                value={filterModel}
                onChange={(e) => setFilterModel(e.target.value)}
                className="text-xs"
              />
              <SimpleSelect
                value={filterStatus}
                onValueChange={setFilterStatus}
                options={[
                  { value: "all", label: "全部状态" },
                  { value: "success", label: "成功" },
                  { value: "error", label: "错误" },
                ]}
                aria-label="请求状态"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="default" size="sm" onClick={applyFilters} className="gap-1">
                <Filter className="size-3" /> 应用筛选
              </Button>
              <Button variant="outline" size="sm" onClick={resetFilters} className="gap-1">
                <X className="size-3" /> 重置
              </Button>
            </div>
          </div>

          {/* 请求明细表 */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">请求明细</h3>
            {requestsLoading ? (
              <p className="text-sm text-muted-foreground">加载中...</p>
            ) : requests && requests.items.length > 0 ? (
              <>
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">时间</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">提供商</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">模型</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Tokens</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">TTFT</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">耗时</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.items.map((item) => (
                        <tr key={item.id} className={`border-b border-border last:border-0 ${item.error ? "bg-destructive/5" : "hover:bg-muted/30"}`}>
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                            {new Date(item.timestamp).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                            {item.narrator && <div className="text-[10px] text-muted-foreground/60">{item.narrator}</div>}
                          </td>
                          <td className="px-3 py-2 font-mono">{item.provider ?? "—"}</td>
                          <td className="px-3 py-2 font-mono truncate max-w-[150px]">{item.model ?? "—"}</td>
                          <td className="px-3 py-2 text-right font-mono">{item.tokens != null ? formatTokenCount(item.tokens) : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono">{item.ttftMs != null ? formatDuration(item.ttftMs) : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatDuration(item.duration)}</td>
                          <td className="px-3 py-2 text-right">
                            {item.error ? (
                              <span className="inline-flex items-center rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">错误</span>
                            ) : (
                              <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600">{item.status}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* 分页 */}
                {requests.totalPages > 1 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      共 {requests.total} 条，第 {requests.page}/{requests.totalPages} 页
                    </span>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
                      <Button variant="outline" size="sm" disabled={page >= requests.totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-lg border border-border p-6 text-center text-muted-foreground text-sm">
                暂无请求记录。开始会话后，请求明细将在此显示。
              </div>
            )}
          </div>

          {/* 按模型分组表格（保留原有） */}
          {summaryData.entries.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">按模型分组统计</h3>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">提供商</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">模型</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">输入</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">输出</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">总计</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">轮次</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryData.entries.map((entry) => (
                      <tr key={`${entry.providerId}::${entry.modelId}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2">{entry.providerName || entry.providerId || "—"}</td>
                        <td className="px-3 py-2 font-mono">{entry.modelId || "—"}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatTokenCount(entry.inputTokens)}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatTokenCount(entry.outputTokens)}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">{formatTokenCount(entry.inputTokens + entry.outputTokens)}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">{entry.turnCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
