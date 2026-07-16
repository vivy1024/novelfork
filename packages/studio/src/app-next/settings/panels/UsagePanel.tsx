import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Braces,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coins,
  DatabaseZap,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  createUsageHistoryClient,
  type UsageHistoryFilters,
  type UsageHistoryGranularity,
  type UsageHistoryRecord,
  type UsageHistoryStats,
  type UsageHistoryTimeSeriesResponse,
} from "@/app-next/runtime-admin";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const usageClient = createUsageHistoryClient();
const PAGE_SIZE = 25;

const chartConfig = {
  totalTokens: { label: "Token 数", color: "hsl(var(--primary))" },
  requestCount: { label: "请求数", color: "hsl(var(--muted-foreground))" },
  errorCount: { label: "错误数", color: "hsl(var(--destructive))" },
} satisfies ChartConfig;

interface UsageListState {
  readonly records: readonly UsageHistoryRecord[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

interface FilterDraft {
  readonly provider: string;
  readonly model: string;
  readonly kind: string;
  readonly startDate: string;
  readonly endDate: string;
}

const EMPTY_FILTERS: FilterDraft = { provider: "", model: "", kind: "", startDate: "", endDate: "" };

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(2)} 秒` : `${Math.round(value)} 毫秒`;
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function formatAxisTime(value: string, granularity: UsageHistoryGranularity): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (granularity === "hour") return date.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit" });
  if (granularity === "month") return date.toLocaleString("zh-CN", { year: "2-digit", month: "short" });
  return date.toLocaleString("zh-CN", { month: "short", day: "numeric" });
}

function toRuntimeFilters(filters: FilterDraft): UsageHistoryFilters {
  return {
    provider: filters.provider || undefined,
    model: filters.model || undefined,
    kind: filters.kind || undefined,
    startDate: filters.startDate ? new Date(`${filters.startDate}T00:00:00`).toISOString() : undefined,
    endDate: filters.endDate ? new Date(`${filters.endDate}T23:59:59.999`).toISOString() : undefined,
  };
}

function errorMessage(error: unknown): string {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 403) return `403：查看使用历史需要 Runtime 管理员权限。${message}`;
  return status ? `${status}：${message}` : message;
}

function MetricCard({ label, value, detail, icon: Icon }: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly icon: typeof Clock3;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground" />{label}</CardTitle>
        <CardDescription>{detail}</CardDescription>
      </CardHeader>
      <CardContent className="font-mono text-xl font-semibold tabular-nums">{value}</CardContent>
    </Card>
  );
}

export function UsagePanel() {
  const [providers, setProviders] = useState<readonly string[]>([]);
  const [filters, setFilters] = useState<FilterDraft>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FilterDraft>(EMPTY_FILTERS);
  const [granularity, setGranularity] = useState<UsageHistoryGranularity>("day");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<UsageListState | null>(null);
  const [stats, setStats] = useState<UsageHistoryStats | null>(null);
  const [timeseries, setTimeseries] = useState<UsageHistoryTimeSeriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<UsageHistoryRecord | null>(null);

  useEffect(() => {
    usageClient.providers()
      .then((result) => setProviders(result.providers))
      .catch((caught) => setError(errorMessage(caught)));
  }, [refreshNonce]);

  const loadUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    const runtimeFilters = toRuntimeFilters(appliedFilters);
    try {
      const [nextList, nextStats, nextTimeseries] = await Promise.all([
        usageClient.list({ ...runtimeFilters, page, pageSize: PAGE_SIZE }),
        usageClient.stats(runtimeFilters),
        usageClient.timeseries(runtimeFilters, granularity),
      ]);
      setList(nextList);
      setStats(nextStats);
      setTimeseries(nextTimeseries);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, granularity, page]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage, refreshNonce]);

  const modelSuggestions = useMemo(
    () => [...new Set((list?.records ?? []).map((record) => record.model).filter((value): value is string => Boolean(value)))],
    [list],
  );
  const kindSuggestions = useMemo(
    () => [...new Set((list?.records ?? []).map((record) => record.kind).filter(Boolean))],
    [list],
  );

  const applyFilters = () => {
    setPage(1);
    setAppliedFilters(filters);
  };

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const openDetail = async (record: UsageHistoryRecord) => {
    setDetail(record);
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      setDetail(await usageClient.detail(record.id));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDetailLoading(false);
    }
  };

  const chartData = (timeseries?.points ?? []).map((point) => ({
    ...point,
    label: formatAxisTime(point.timestamp, granularity),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">使用历史</h2>
          <p className="mt-1 text-sm text-muted-foreground">查看 Runtime 请求历史、提供商筛选、聚合统计和服务端时间序列。</p>
        </div>
        <Button variant="outline" onClick={() => setRefreshNonce((value) => value + 1)} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />刷新
        </Button>
      </div>

      {error && (
        <Alert className="border-destructive/40 bg-destructive/5">
          <AlertTitle>Runtime 使用历史请求失败</AlertTitle>
          <AlertDescription className="text-destructive">{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Search className="size-4 text-primary" />筛选条件</CardTitle>
          <CardDescription>筛选条件会同时发送给 Runtime 列表、统计和时间序列接口。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">提供商</span>
              <Select value={filters.provider || "__all__"} onValueChange={(value) => setFilters((current) => ({ ...current, provider: value === "__all__" ? "" : value }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="全部提供商" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部提供商</SelectItem>
                  {providers.map((provider) => <SelectItem key={provider} value={provider}>{provider}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">模型</span>
              <Input value={filters.model} onChange={(event) => setFilters((current) => ({ ...current, model: event.currentTarget.value }))} placeholder="精确模型名称" list="usage-models" />
              <datalist id="usage-models">{modelSuggestions.map((model) => <option key={model} value={model} />)}</datalist>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">请求类型</span>
              <Input value={filters.kind} onChange={(event) => setFilters((current) => ({ ...current, kind: event.currentTarget.value }))} placeholder="请求类型" list="usage-kinds" />
              <datalist id="usage-kinds">{kindSuggestions.map((kind) => <option key={kind} value={kind} />)}</datalist>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">开始日期</span>
              <Input type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.currentTarget.value }))} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">结束日期</span>
              <Input type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.currentTarget.value }))} />
            </label>
          </div>
          <div className="flex gap-2">
            <Button onClick={applyFilters}><Search />应用筛选</Button>
            <Button variant="outline" onClick={resetFilters}><RotateCcw />重置</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="请求数" value={stats ? formatCompact(stats.totalRequests) : "—"} detail="符合条件的 Runtime 请求" icon={DatabaseZap} />
        <MetricCard label="Token 总数" value={stats ? formatCompact(stats.totalTokens) : "—"} detail={stats ? `输入 ${formatCompact(stats.totalInputTokens)} · 输出 ${formatCompact(stats.totalOutputTokens)}` : "输入与输出"} icon={ArrowUp} />
        <MetricCard label="缓存读取" value={stats ? formatCompact(stats.totalCacheReadTokens) : "—"} detail={stats ? `缓存写入 ${formatCompact(stats.totalCacheCreationTokens)}` : "Runtime 缓存 Token"} icon={ArrowDown} />
        <MetricCard label="推理 Token" value={stats ? formatCompact(stats.totalReasoningTokens) : "—"} detail="推理 Token 数量" icon={Braces} />
        <MetricCard label="总费用" value={stats ? formatCurrency(stats.totalCost) : "—"} detail="提供商报告的美元费用" icon={Coins} />
        <MetricCard label="平均耗时" value={stats ? formatDuration(stats.averageDurationMs) : "—"} detail="请求端到端耗时" icon={Clock3} />
        <MetricCard label="平均首 Token 时间" value={stats ? formatDuration(stats.averageTtftMs) : "—"} detail="从请求到首个 Token 的时间" icon={Clock3} />
        <MetricCard label="时间范围" value={timeseries ? `${timeseries.bucketCount} 个时间桶` : "—"} detail={timeseries ? `${formatDateTime(timeseries.effectiveStartDate)} → ${formatDateTime(timeseries.effectiveEndDate)}` : "Runtime 实际统计范围"} icon={CalendarDays} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>时间序列</CardTitle>
          <CardDescription>由 Runtime 聚合。Token 使用左侧刻度，请求数和错误数使用右侧刻度。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Tabs value={granularity} onValueChange={(value) => { setGranularity(value as UsageHistoryGranularity); setPage(1); }}>
            <TabsList>
              <TabsTrigger value="hour">小时</TabsTrigger>
              <TabsTrigger value="day">天</TabsTrigger>
              <TabsTrigger value="month">月</TabsTrigger>
            </TabsList>
          </Tabs>
          {timeseries?.truncated && (
            <Alert><AlertTriangle className="mb-2 size-4" /><AlertTitle>时间序列已截断</AlertTitle><AlertDescription>当前范围达到 Runtime 上限，共返回 {timeseries.maxBuckets} 个时间桶。</AlertDescription></Alert>
          )}
          {loading ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />正在加载 Runtime 使用数据…</div>
          ) : chartData.length === 0 ? (
            <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">没有符合当前筛选条件的时间序列数据点。</div>
          ) : (
            <ChartContainer config={chartConfig} className="h-72 w-full aspect-auto" initialDimension={{ width: 720, height: 288 }}>
              <BarChart data={chartData} margin={{ left: 4, right: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} />
                <YAxis yAxisId="tokens" tickLine={false} axisLine={false} tickFormatter={formatCompact} width={48} />
                <YAxis yAxisId="requests" orientation="right" tickLine={false} axisLine={false} allowDecimals={false} width={36} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar yAxisId="tokens" dataKey="totalTokens" fill="var(--color-totalTokens)" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="requests" dataKey="requestCount" fill="var(--color-requestCount)" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="requests" dataKey="errorCount" fill="var(--color-errorCount)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>请求记录</CardTitle>
          <CardDescription>{list ? `共 ${list.total.toLocaleString("zh-CN")} 条符合条件的记录` : "由 Runtime 分页的历史记录"}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">时间</TableHead>
                <TableHead>请求类型</TableHead>
                <TableHead>提供商 / 模型</TableHead>
                <TableHead>叙述者 / 章节</TableHead>
                <TableHead className="text-right">Token</TableHead>
                <TableHead className="text-right">首 Token 时间</TableHead>
                <TableHead className="text-right">耗时</TableHead>
                <TableHead className="pr-4 text-right">详情</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list?.records ?? []).map((record) => (
                <TableRow key={record.id} className={record.errorMessage ? "bg-destructive/5" : undefined}>
                  <TableCell className="pl-4 text-xs text-muted-foreground">{formatDateTime(record.createdAt)}</TableCell>
                  <TableCell><Badge variant="outline">{record.kind}</Badge></TableCell>
                  <TableCell>
                    <div>{record.provider ?? "—"}</div>
                    <div className="max-w-56 truncate font-mono text-xs text-muted-foreground">{record.model ?? "—"}</div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-48 truncate">{record.narratorTitle ?? record.narratorId ?? "—"}</div>
                    <div className="max-w-48 truncate text-xs text-muted-foreground">{record.chapterTitle ?? "—"}</div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    <div>输入 {formatCompact(record.inputTokens)}</div>
                    <div className="text-muted-foreground">输出 {formatCompact(record.outputTokens)}</div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatDuration(record.ttftMs)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatDuration(record.durationMs)}</TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button size="sm" variant={record.errorMessage ? "destructive" : "outline"} onClick={() => void openDetail(record)}>
                      <Braces />{record.hasRawDump ? "原始转储" : "详情"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && (list?.records.length ?? 0) === 0 && (
                <TableRow><TableCell colSpan={8} className="h-28 text-center text-muted-foreground">没有符合当前筛选条件的使用记录。</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-3 px-4">
            <span className="text-xs text-muted-foreground">第 {list?.page ?? page} / {Math.max(list?.totalPages ?? 1, 1)} 页</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft />上一页</Button>
              <Button size="sm" variant="outline" disabled={loading || page >= (list?.totalPages ?? 1)} onClick={() => setPage((value) => value + 1)}>下一页<ChevronRight /></Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>使用记录详情</DialogTitle>
            <DialogDescription>Runtime 记录 {detail?.id ?? ""}</DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex h-28 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />正在加载原始详情…</div>
          ) : detail ? (
            <div className="flex flex-col gap-4 text-sm">
              {detail.errorMessage && (
                <Alert className="border-destructive/40 bg-destructive/5"><AlertTitle>请求错误</AlertTitle><AlertDescription className="whitespace-pre-wrap text-destructive">{detail.errorMessage}</AlertDescription></Alert>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <DetailRow label="创建时间" value={formatDateTime(detail.createdAt)} />
                <DetailRow label="请求类型" value={detail.kind} />
                <DetailRow label="提供商" value={detail.provider ?? "—"} />
                <DetailRow label="凭据" value={detail.credentialName ?? detail.credentialId ?? "—"} />
                <DetailRow label="模型" value={detail.model ?? "—"} />
                <DetailRow label="费用" value={formatCurrency(detail.costUsd)} />
                <DetailRow label="Token" value={`输入 ${detail.inputTokens} · 输出 ${detail.outputTokens} · 推理 ${detail.reasoningTokens}`} />
                <DetailRow label="缓存" value={`读取 ${detail.cachedInputTokens} · 写入 ${detail.cacheCreationInputTokens}`} />
              </div>
              <div>
                <h3 className="mb-2 font-medium text-foreground">原始转储</h3>
                {detail.rawDump ? (
                  <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground">{JSON.stringify(detail.rawDump, null, 2)}</pre>
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-4 text-muted-foreground">此记录不包含原始转储。</p>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-mono text-xs text-foreground">{value}</div>
    </div>
  );
}
