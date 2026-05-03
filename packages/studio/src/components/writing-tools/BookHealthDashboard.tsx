import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useApi } from "@/hooks/use-api";

type MeasuredMetric = {
  readonly status: "measured";
  readonly value: number;
  readonly source: string;
};

type UnknownMetric = {
  readonly status: "unknown";
  readonly reason: string;
};

type HealthMetric = MeasuredMetric | UnknownMetric | null;

export interface BookHealthData {
  readonly totalChapters: HealthMetric;
  readonly totalWords: HealthMetric;
  readonly dailyWords: HealthMetric;
  readonly dailyTarget: HealthMetric;
  readonly sensitiveWordCount: HealthMetric;
  readonly knownConflictCount: HealthMetric;
  readonly consistencyScore: HealthMetric;
  readonly hookRecoveryRate: HealthMetric;
  readonly aiTasteMean: HealthMetric;
  readonly rhythmDiversity: HealthMetric;
  readonly warnings: ReadonlyArray<{ readonly type: string; readonly message: string }>;
}

interface BookHealthResponse {
  readonly health: BookHealthData;
}

interface MetricConfig {
  readonly label: string;
  readonly metric: HealthMetric;
  readonly format: (value: number) => string;
  readonly progressValue?: (value: number) => number;
  readonly lowerIsBetter?: boolean;
}

function isMeasured(metric: HealthMetric): metric is MeasuredMetric {
  return metric !== null && metric.status === "measured";
}

function metricVariant(metric: HealthMetric, lowerIsBetter = false): "outline" | "secondary" | "destructive" {
  if (!metric || !isMeasured(metric)) return "secondary";
  if (lowerIsBetter) {
    if (metric.value === 0) return "outline";
    if (metric.value <= 5) return "secondary";
    return "destructive";
  }
  return "outline";
}

function formatNullMetricLabel(): string {
  return "暂无数据";
}

function formatUnknownMetricReason(reason: string): string {
  return reason
    .replace(/尚未接入真实来源/g, "等待统计数据")
    .replace(/未接入真实统计/g, "等待统计数据")
    .replace(/未接入/g, "待评估");
}

function MetricCard({ config }: { readonly config: MetricConfig }) {
  const { label, metric, format, lowerIsBetter } = config;
  const measured = isMeasured(metric);
  const isNull = metric === null;
  const progress = measured
    ? config.progressValue?.(metric.value) ?? (lowerIsBetter ? (metric.value === 0 ? 0 : 100) : 100)
    : 0;
  const progressClass = lowerIsBetter && measured && metric.value > 0
    ? metric.value <= 5 ? "[&>div]:bg-amber-500" : "[&>div]:bg-destructive"
    : "";

  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Badge variant={metricVariant(metric, lowerIsBetter)} className="text-xs">
          {measured ? format(metric.value) : isNull ? formatNullMetricLabel() : "待评估"}
        </Badge>
      </div>
      {measured ? (
        <Progress aria-label={label} value={progress} className={progressClass} />
      ) : isNull ? (
        <p className="text-xs text-muted-foreground">暂无数据</p>
      ) : (
        <p className="text-xs text-muted-foreground">{formatUnknownMetricReason(metric.reason)}</p>
      )}
    </div>
  );
}

export function BookHealthDashboard({ bookId }: { readonly bookId: string }) {
  const { data, loading, error } = useApi<BookHealthResponse>(`/books/${bookId}/health`);

  if (loading) {
    return <Card><CardContent className="py-6 text-sm text-muted-foreground">正在加载全书健康数据...</CardContent></Card>;
  }
  if (error) {
    return <Card><CardContent className="py-6 text-sm text-destructive">加载失败：{error}</CardContent></Card>;
  }
  if (!data?.health) {
    return <Card><CardContent className="py-6 text-sm text-muted-foreground">暂无健康数据</CardContent></Card>;
  }

  const health = data.health;
  const dailyTarget = isMeasured(health.dailyTarget) ? health.dailyTarget.value : 0;
  const unknownMetrics = [health.consistencyScore, health.hookRecoveryRate, health.aiTasteMean, health.rhythmDiversity]
    .filter((metric) => metric === null || metric.status === "unknown");

  const metrics: MetricConfig[] = [
    { label: "章节数量", metric: health.totalChapters, format: (value) => `${value} 章` },
    { label: "总字数", metric: health.totalWords, format: (value) => `${value} 字` },
    {
      label: "今日字数",
      metric: health.dailyWords,
      format: (value) => dailyTarget > 0 ? `${value} / ${dailyTarget} 字` : `${value} 字`,
      progressValue: (value) => dailyTarget > 0 ? Math.min(100, (value / dailyTarget) * 100) : 0,
    },
    { label: "敏感词数量", metric: health.sensitiveWordCount, format: (value) => `${value} 处`, lowerIsBetter: true },
    { label: "已登记矛盾", metric: health.knownConflictCount, format: (value) => `${value} 个` },
    { label: "连续性评分", metric: health.consistencyScore, format: (value) => `${(value * 100).toFixed(0)}%` },
    { label: "钩子回收率", metric: health.hookRecoveryRate, format: (value) => `${(value * 100).toFixed(0)}%` },
    { label: "AI 味均值", metric: health.aiTasteMean, format: (value) => `${value.toFixed(0)}/100` },
    { label: "节奏多样性", metric: health.rhythmDiversity, format: (value) => `${(value * 100).toFixed(0)}%` },
  ];

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="space-y-1">
          <CardTitle>全书健康仪表盘</CardTitle>
          <CardDescription>展示可真实计算的章节、字数、进度、敏感词与矛盾数据；质量评分等待统计时保持透明。</CardDescription>
        </div>
        {unknownMetrics.length > 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            质量评分等待统计数据，已显示为待评估状态。
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {metrics.map((metric) => <MetricCard key={metric.label} config={metric} />)}
        </div>

        {health.warnings.length > 0 && (
          <Alert className="border-destructive/20 bg-destructive/5">
            <AlertTitle>预警汇总（{health.warnings.length}）</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 space-y-1">
                {health.warnings.map((warning) => (
                  <li key={`${warning.type}-${warning.message}`} className="flex items-start gap-2">
                    <Badge variant="secondary" className="shrink-0 text-xs">{warning.type}</Badge>
                    <span>{warning.message}</span>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
