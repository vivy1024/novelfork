import { Activity, AlertTriangle, Loader2 } from "lucide-react";
import { useApi } from "../../hooks/use-api";

// --- Types matching GET /api/books/:bookId/health response ---

interface MeasuredMetric {
  readonly status: "measured";
  readonly value: number;
  readonly source: string;
}

interface HealthWarning {
  readonly type: string;
  readonly message: string;
}

interface BookHealthResponse {
  readonly health: {
    readonly totalChapters: MeasuredMetric;
    readonly totalWords: MeasuredMetric;
    readonly dailyWords: MeasuredMetric;
    readonly dailyTarget: MeasuredMetric;
    readonly sensitiveWordCount: MeasuredMetric;
    readonly knownConflictCount: MeasuredMetric;
    readonly consistencyScore: MeasuredMetric | null;
    readonly hookRecoveryRate: MeasuredMetric | null;
    readonly aiTasteMean: MeasuredMetric | null;
    readonly rhythmDiversity: MeasuredMetric | null;
    readonly warnings: readonly HealthWarning[];
  };
}

interface BookHealthSummaryProps {
  bookId: string;
}

// --- Score indicator ---

function MetricRow({ label, value, suffix, good }: { label: string; value: string; suffix?: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium ${good === false ? "text-red-500" : good === true ? "text-green-600" : ""}`}>
        {value}{suffix && <span className="text-muted-foreground font-normal ml-0.5">{suffix}</span>}
      </span>
    </div>
  );
}

// --- Radar-like simple indicator (5 dimensions as horizontal bars) ---

function DimensionBar({ label, value, max }: { label: string; value: number; max: number }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = percent >= 70 ? "bg-green-500" : percent >= 40 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{percent}%</span>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

// --- Main component ---

export function BookHealthSummary({ bookId }: BookHealthSummaryProps) {
  const { data, loading, error } = useApi<BookHealthResponse>(`/api/books/${bookId}/health`);

  if (loading) {
    return (
      <div className="rounded-lg border border-border p-3 flex items-center gap-2" data-testid="book-health-summary">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">加载健康度...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-border p-3" data-testid="book-health-summary">
        <p className="text-xs text-muted-foreground">健康度数据不可用</p>
      </div>
    );
  }

  const h = data.health;
  const dailyPercent = h.dailyTarget.value > 0
    ? Math.round((h.dailyWords.value / h.dailyTarget.value) * 100)
    : 0;

  // Compute overall score (0-100) from available dimensions
  const dimensions: { label: string; value: number; max: number }[] = [];

  if (h.consistencyScore) {
    dimensions.push({ label: "人设一致性", value: h.consistencyScore.value * 100, max: 100 });
  }
  if (h.hookRecoveryRate) {
    dimensions.push({ label: "伏笔回收率", value: h.hookRecoveryRate.value * 100, max: 100 });
  }
  if (h.aiTasteMean) {
    // aiTasteMean is 0-100 where lower is better (less AI taste)
    dimensions.push({ label: "去AI味", value: Math.max(0, 100 - h.aiTasteMean.value), max: 100 });
  }
  if (h.rhythmDiversity) {
    dimensions.push({ label: "节奏多样性", value: h.rhythmDiversity.value * 100, max: 100 });
  }

  // Daily progress as a dimension
  dimensions.push({ label: "今日进度", value: Math.min(dailyPercent, 100), max: 100 });

  const overallScore = dimensions.length > 0
    ? Math.round(dimensions.reduce((sum, d) => sum + (d.value / d.max) * 100, 0) / dimensions.length)
    : 0;

  const overallColor = overallScore >= 70 ? "text-green-600" : overallScore >= 40 ? "text-yellow-600" : "text-red-500";

  return (
    <div className="rounded-lg border border-border p-3 space-y-3" data-testid="book-health-summary">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Activity className="size-3.5" />
          书籍健康度
        </h3>
        <span className={`text-lg font-bold ${overallColor}`}>{overallScore}</span>
      </div>

      {/* Key metrics */}
      <div className="divide-y divide-border">
        <MetricRow label="总章节" value={String(h.totalChapters.value)} suffix="章" />
        <MetricRow
          label="今日字数"
          value={String(h.dailyWords.value)}
          suffix={`/ ${h.dailyTarget.value}`}
          good={dailyPercent >= 100}
        />
        <MetricRow
          label="敏感词"
          value={String(h.sensitiveWordCount.value)}
          suffix="处"
          good={h.sensitiveWordCount.value === 0}
        />
        <MetricRow
          label="矛盾条目"
          value={String(h.knownConflictCount.value)}
          suffix="个"
          good={h.knownConflictCount.value === 0}
        />
      </div>

      {/* Dimension bars */}
      {dimensions.length > 0 && (
        <div className="space-y-2 pt-1">
          {dimensions.map((d) => (
            <DimensionBar key={d.label} label={d.label} value={d.value} max={d.max} />
          ))}
        </div>
      )}

      {/* Warnings */}
      {h.warnings.length > 0 && (
        <div className="space-y-1 pt-1">
          {h.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[10px] text-yellow-700">
              <AlertTriangle className="size-3 shrink-0 mt-0.5" />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
