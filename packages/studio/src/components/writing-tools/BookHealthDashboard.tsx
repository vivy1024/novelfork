import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useApi } from "@/hooks/use-api";

export interface BookHealthData {
  readonly consistencyScore: number;
  readonly hookRecoveryRate: number;
  readonly aiTasteMean: number;
  readonly aiTasteTrend: ReadonlyArray<{ readonly chapter: number; readonly score: number }>;
  readonly rhythmDiversity: number;
  readonly sensitiveWordCount: number;
  readonly warnings: ReadonlyArray<{ readonly type: string; readonly message: string }>;
}

interface MetricConfig {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly format: (v: number) => string;
  readonly thresholds: { readonly good: number; readonly warn: number };
}

function metricVariant(value: number, thresholds: { good: number; warn: number }): "outline" | "secondary" | "destructive" {
  if (value >= thresholds.good) return "outline";
  if (value >= thresholds.warn) return "secondary";
  return "destructive";
}

function progressColor(value: number, thresholds: { good: number; warn: number }): string {
  if (value >= thresholds.good) return "";
  if (value >= thresholds.warn) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-destructive";
}

export function BookHealthDashboard({ bookId }: { readonly bookId: string }) {
  const { data, loading, error } = useApi<BookHealthData>(`/books/${bookId}/health`);

  if (loading) {
    return <Card><CardContent className="py-6 text-sm text-muted-foreground">正在加载全书健康数据...</CardContent></Card>;
  }
  if (error) {
    return <Card><CardContent className="py-6 text-sm text-destructive">加载失败：{error}</CardContent></Card>;
  }
  if (!data) {
    return <Card><CardContent className="py-6 text-sm text-muted-foreground">暂无健康数据</CardContent></Card>;
  }

  const insufficient = data.aiTasteTrend.length < 5;

  const metrics: MetricConfig[] = [
    { label: "连续性评分", value: data.consistencyScore, max: 1, format: (v) => `${(v * 100).toFixed(0)}%`, thresholds: { good: 0.8, warn: 0.6 } },
    { label: "钩子回收率", value: data.hookRecoveryRate, max: 1, format: (v) => `${(v * 100).toFixed(0)}%`, thresholds: { good: 0.7, warn: 0.5 } },
    { label: "AI 味均值", value: data.aiTasteMean, max: 100, format: (v) => `${v.toFixed(0)}/100`, thresholds: { good: 30, warn: 60 } },
    { label: "节奏多样性", value: data.rhythmDiversity, max: 1, format: (v) => `${(v * 100).toFixed(0)}%`, thresholds: { good: 0.6, warn: 0.4 } },
    { label: "敏感词数量", value: data.sensitiveWordCount, max: Math.max(data.sensitiveWordCount, 50), format: (v) => `${v} 处`, thresholds: { good: 0, warn: 0 } },
  ];

  // AI taste: lower is better, invert for badge
  const aiTasteVariant = data.aiTasteMean <= 30 ? "outline" as const : data.aiTasteMean <= 60 ? "secondary" as const : "destructive" as const;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle>全书健康仪表盘</CardTitle>
            <CardDescription>综合评估连续性、钩子回收、AI 味、节奏多样性与敏感词。</CardDescription>
          </div>
          <Badge variant={aiTasteVariant}>AI 味 {data.aiTasteMean.toFixed(0)}</Badge>
        </div>
        {insufficient && (
          <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            数据不足（&lt;5 章），部分指标为估算值。
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {metrics.map((m) => {
            const pct = m.max > 0 ? Math.min(100, (m.value / m.max) * 100) : 0;
            // Sensitive words: lower is better
            const variant = m.label === "敏感词数量"
              ? (m.value === 0 ? "outline" as const : m.value <= 5 ? "secondary" as const : "destructive" as const)
              : m.label === "AI 味均值"
                ? aiTasteVariant
                : metricVariant(m.value, m.thresholds);
            const pColor = m.label === "敏感词数量"
              ? (m.value === 0 ? "" : m.value <= 5 ? "[&>div]:bg-amber-500" : "[&>div]:bg-destructive")
              : m.label === "AI 味均值"
                ? (data.aiTasteMean <= 30 ? "" : data.aiTasteMean <= 60 ? "[&>div]:bg-amber-500" : "[&>div]:bg-destructive")
                : progressColor(m.value, m.thresholds);
            return (
              <div key={m.label} className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{m.label}</span>
                  <Badge variant={variant} className="text-xs">{m.format(m.value)}</Badge>
                </div>
                <Progress aria-label={m.label} value={pct} className={pColor} />
              </div>
            );
          })}
        </div>

        {data.warnings.length > 0 && (
          <Alert className="border-destructive/20 bg-destructive/5">
            <AlertTitle>预警汇总（{data.warnings.length}）</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 space-y-1">
                {data.warnings.map((w) => (
                  <li key={`${w.type}-${w.message}`} className="flex items-start gap-2">
                    <Badge variant="secondary" className="shrink-0 text-xs">{w.type}</Badge>
                    <span>{w.message}</span>
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
