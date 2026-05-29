import { useState, useCallback, useEffect, useMemo } from "react";
import { useApi, fetchJson } from "../../../hooks/use-api";
import { InlineError } from "../../components/feedback";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Filter, X, ArrowUp, ArrowDown, Calendar } from "lucide-react";

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

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
  const [trendMetric, setTrendMetric] = useState<"tokens" | "requests" | "errors">("tokens");
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
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filtersApplied, setFiltersApplied] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // Load trend data
  useEffect(() => {
    setTrendLoading(true);
    fetchJson<TrendResponse>(`/usage/trend?granularity=${granularity}&metric=${trendMetric}`)
      .then((data) => setTrendData(data.points))
      .catch(() => setTrendData([]))
      .finally(() => setTrendLoading(false));
  }, [granularity, trendMetric]);

  // Load requests
  useEffect(() => {
    setRequestsLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (filtersApplied) {
      if (filterProvider) params.set("provider", filterProvider);
      if (filterModel) params.set("model", filterModel);
      if (filterStatus && filterStatus !== "all") params.set("status", filterStatus);
      if (filterDateFrom) params.set("from", filterDateFrom);
      if (filterDateTo) params.set("to", filterDateTo);
    }
    fetchJson<RequestsResponse>(`/usage/requests?${params}`)
      .then(setRequests)
      .catch(() => setRequests(null))
      .finally(() => setRequestsLoading(false));
  }, [page, filtersApplied, filterProvider, filterModel, filterStatus, filterDateFrom, filterDateTo]);

  const applyFilters = () => { setPage(1); setFiltersApplied(true); };
  const resetFilters = () => { setFilterProvider(""); setFilterModel(""); setFilterStatus("all"); setFilterDateFrom(""); setFilterDateTo(""); setFiltersApplied(false); setPage(1); };

  // Computed cache totals from summary entries
  const totalCacheRead = useMemo(() => summaryData?.entries.reduce((sum, e) => sum + (e.cacheReadTokens ?? 0), 0) ?? 0, [summaryData]);
  const totalCacheWrite = useMemo(() => summaryData?.entries.reduce((sum, e) => sum + (e.cacheCreationTokens ?? 0), 0) ?? 0, [summaryData]);

  // Unique providers and models for filter datalists — load from summary (covers all data, not just current page)
  const uniqueProviders = useMemo(() => {
    if (!summaryData?.entries) return [];
    return [...new Set(summaryData.entries.map(e => e.providerName || e.providerId).filter(Boolean))];
  }, [summaryData]);

  const uniqueModels = useMemo(() => {
    if (!summaryData?.entries) return [];
    return [...new Set(summaryData.entries.map(e => e.modelId).filter(Boolean))];
  }, [summaryData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold mb-1 text-foreground">使用历史</h2>
          <p className="text-sm text-muted-foreground">按时间展示请求、Tokens 与趋势。</p>
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
            <StatCard label="请求数" value={formatTokenCount(requests?.total ?? summaryData.totalTurns)} detail={`精确值：${(requests?.total ?? summaryData.totalTurns).toLocaleString()}`} />
            <StatCard label="总 Tokens" value={formatTokenCount(summaryData.totalInputTokens + summaryData.totalOutputTokens)} detail={`输入 ${formatTokenCount(summaryData.totalInputTokens)} · 输出 ${formatTokenCount(summaryData.totalOutputTokens)}`} />
            <StatCard label="平均 TTFT" value={requests?.summary.averageTtftMs != null ? formatDuration(requests.summary.averageTtftMs) : "—"} detail="首 Token 响应时间" />
            <StatCard label="平均耗时" value={requests?.summary.averageDuration != null ? formatDuration(requests.summary.averageDuration) : "—"} detail="请求平均耗时" />
            <StatCard label="推理 Tokens" value={formatTokenCount(summaryData.totalOutputTokens)} detail="输出 Token 总量" />
            <StatCard label="缓存读取" value={formatTokenCount(totalCacheRead)} detail="命中缓存 Tokens" />
            <StatCard label="缓存写入" value={formatTokenCount(totalCacheWrite)} detail="写入缓存 Tokens" />
            <StatCard label="会话数" value={summaryData.totalSessions} detail="活跃会话总数" />
          </div>

          {/* 趋势图 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold">使用趋势</h3>
                <SimpleSelect
                  value={trendMetric}
                  onValueChange={(v) => setTrendMetric(v as typeof trendMetric)}
                  options={[
                    { value: "tokens", label: "Tokens" },
                    { value: "requests", label: "请求数" },
                    { value: "errors", label: "错误数" },
                  ]}
                  aria-label="趋势指标"
                />
              </div>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
              {/* 提供商 — 可输入筛选 */}
              <div className="relative">
                <input
                  type="text"
                  value={filterProvider}
                  onChange={(e) => setFilterProvider(e.target.value)}
                  placeholder="提供商"
                  list="usage-provider-list"
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <datalist id="usage-provider-list">
                  {uniqueProviders.map((p) => <option key={p} value={p} />)}
                </datalist>
              </div>
              {/* 模型 — 可输入筛选 */}
              <div className="relative">
                <input
                  type="text"
                  value={filterModel}
                  onChange={(e) => setFilterModel(e.target.value)}
                  placeholder="模型"
                  list="usage-model-list"
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <datalist id="usage-model-list">
                  {uniqueModels.map((m) => <option key={m} value={m} />)}
                </datalist>
              </div>
              {/* 日期范围 */}
              <div className="flex items-center gap-1">
                <Calendar className="size-3.5 text-muted-foreground shrink-0" />
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  className="flex-1 h-9 px-2 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <span className="text-muted-foreground text-xs">-</span>
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  className="flex-1 h-9 px-2 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              {/* 状态 */}
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
                <div className="rounded-lg border border-border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">时间</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">叙述者</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">供应商</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">模型</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Tokens</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">TTFT</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">耗时</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.items.map((item) => (
                        <tr key={item.id} className={`border-b border-border last:border-0 ${item.error ? "bg-destructive/5" : "hover:bg-muted/30"}`}>
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                            <div>{formatTime(item.timestamp)}</div>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="text-foreground truncate max-w-[140px]">{item.narrator ?? "—"}</div>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{item.provider ?? "—"}</td>
                          <td className="px-3 py-2 font-mono truncate max-w-[140px]">{item.model ?? "—"}</td>
                          <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              <ArrowUp className="size-3 text-blue-500" />
                              <span>{item.inputTokens != null ? formatTokenCount(item.inputTokens) : "—"}</span>
                            </div>
                            <div className="flex items-center justify-end gap-1">
                              <ArrowDown className="size-3 text-emerald-500" />
                              <span>{item.outputTokens != null ? formatTokenCount(item.outputTokens) : "0"}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{item.ttftMs != null ? formatDuration(item.ttftMs) : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{formatDuration(item.duration)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {item.error ? (
                              <button
                                onClick={() => { void navigator.clipboard.writeText(item.error!); }}
                                title="点击复制错误信息"
                                className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive font-medium hover:bg-destructive/20 cursor-pointer max-w-[120px]"
                              >
                                <span className="truncate">{item.error}</span>
                              </button>
                            ) : (
                              <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 font-medium">{item.status}</span>
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

          {/* 按模型分组表格 */}
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
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">缓存读取</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">缓存写入</th>
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
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">{entry.cacheReadTokens > 0 ? formatTokenCount(entry.cacheReadTokens) : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">{entry.cacheCreationTokens > 0 ? formatTokenCount(entry.cacheCreationTokens) : "—"}</td>
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
