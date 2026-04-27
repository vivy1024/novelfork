import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface RhythmSentenceRange {
  readonly text: string;
  readonly length: number;
  readonly start: number;
  readonly end: number;
  readonly bucket: string;
}

export interface RhythmChartAnalysis {
  readonly sentenceLengths: ReadonlyArray<number>;
  readonly sentenceHistogram: ReadonlyArray<{ readonly range: string; readonly count: number }>;
  readonly paragraphLengths: ReadonlyArray<number>;
  readonly avgSentenceLength: number;
  readonly sentenceLengthStdDev: number;
  readonly rhythmScore: number;
  readonly issues: ReadonlyArray<{
    readonly type: string;
    readonly message: string;
    readonly affectedRanges: ReadonlyArray<{ readonly start: number; readonly end: number }>;
  }>;
  readonly sentenceRanges: ReadonlyArray<RhythmSentenceRange>;
  readonly referenceComparison?: {
    readonly refAvgSentenceLength: number;
    readonly refStdDev: number;
    readonly deviation: number;
  };
}

export interface RhythmChartProps {
  readonly analysis: RhythmChartAnalysis;
  readonly referenceHistogram?: ReadonlyArray<{ readonly range: string; readonly count: number }>;
  readonly onHighlightRanges?: (ranges: ReadonlyArray<{ readonly start: number; readonly end: number }>) => void;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function resolveReferenceCount(
  referenceHistogram: ReadonlyArray<{ readonly range: string; readonly count: number }> | undefined,
  range: string,
): number {
  return referenceHistogram?.find((bucket) => bucket.range === range)?.count ?? 0;
}

function Sparkline({ values, label }: { readonly values: ReadonlyArray<number>; readonly label: string }) {
  const width = 320;
  const height = 80;
  const max = Math.max(1, ...values);
  const points = values.length <= 1
    ? values.map((value, index) => `${index === 0 ? 0 : width},${height - (value / max) * height}`)
    : values.map((value, index) => {
        const x = (index / (values.length - 1)) * width;
        const y = height - (value / max) * height;
        return `${x},${y}`;
      });

  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} className="h-24 w-full overflow-visible">
      <polyline points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth="3" className="text-primary" />
      {values.map((value, index) => {
        const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * width;
        const y = height - (value / max) * height;
        return <circle key={`${value}-${index}`} cx={x} cy={y} r="3" className="fill-primary" />;
      })}
    </svg>
  );
}

export function RhythmChart({ analysis, referenceHistogram, onHighlightRanges }: RhythmChartProps) {
  const maxCount = Math.max(
    1,
    ...analysis.sentenceHistogram.map((bucket) => bucket.count),
    ...(referenceHistogram ?? []).map((bucket) => bucket.count),
  );

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle>段落节奏可视化</CardTitle>
            <CardDescription>句长分布、段落长度序列和参考文风偏差。</CardDescription>
          </div>
          <Badge variant={analysis.rhythmScore >= 70 ? "outline" : analysis.rhythmScore >= 45 ? "secondary" : "destructive"}>
            节奏评分 {analysis.rhythmScore}
          </Badge>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">平均句长</div>
            <div className="text-lg font-semibold">平均句长 {formatNumber(analysis.avgSentenceLength)} 字</div>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">句长标准差</div>
            <div className="text-lg font-semibold">{formatNumber(analysis.sentenceLengthStdDev)}</div>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">参考文本</div>
            <div className="text-sm font-medium">
              {analysis.referenceComparison
                ? `参考均值 ${formatNumber(analysis.referenceComparison.refAvgSentenceLength)} 字 / 标准差 ${formatNumber(analysis.referenceComparison.refStdDev)}`
                : "暂无参考文本"}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">句长分布直方图</h3>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-primary" />当前章节</span>
              {referenceHistogram ? <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm border border-dashed border-muted-foreground" />参考文本</span> : null}
            </div>
          </div>
          <div className="flex h-40 items-end gap-3 rounded-xl border border-border/60 bg-muted/20 p-4">
            {analysis.sentenceHistogram.map((bucket) => {
              const referenceCount = resolveReferenceCount(referenceHistogram, bucket.range);
              const ranges = analysis.sentenceRanges
                .filter((sentence) => sentence.bucket === bucket.range)
                .map((sentence) => ({ start: sentence.start, end: sentence.end }));
              return (
                <Button
                  key={bucket.range}
                  type="button"
                  variant="ghost"
                  aria-label={`句长区间 ${bucket.range}，共 ${bucket.count} 句`}
                  className="flex h-full flex-1 flex-col justify-end gap-2 px-1 py-0"
                  onClick={() => onHighlightRanges?.(ranges)}
                >
                  <div className="relative flex h-28 w-full items-end justify-center gap-1">
                    <div
                      className="w-4 rounded-t bg-primary"
                      style={{ height: `${Math.max(8, (bucket.count / maxCount) * 100)}%` }}
                    />
                    {referenceHistogram ? (
                      <div
                        className="w-4 rounded-t border border-dashed border-muted-foreground/70 bg-muted/40"
                        style={{ height: `${Math.max(8, (referenceCount / maxCount) * 100)}%` }}
                      />
                    ) : null}
                  </div>
                  <span className="text-[11px] text-muted-foreground">{bucket.range}</span>
                </Button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium">段落长度序列</h3>
          <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-primary">
            <Sparkline values={analysis.paragraphLengths} label="段落长度折线图" />
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {analysis.paragraphLengths.map((value, index) => (
                <span key={`${value}-${index}`} className="rounded bg-background/80 px-2 py-1">P{index + 1}: {value}</span>
              ))}
            </div>
          </div>
        </div>

        {analysis.issues.length > 0 ? (
          <div className="space-y-2">
            {analysis.issues.map((issue, index) => (
              <div key={`${issue.type}-${index}`} className={cn("rounded-xl border px-3 py-2 text-sm", "border-destructive/20 bg-destructive/5 text-destructive")}>
                {issue.message}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
