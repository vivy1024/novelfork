import { useState } from "react";
import { useApi, putApi } from "@/hooks/use-api";
import { Flame, Settings, Target } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProgressConfig {
  readonly dailyTarget: number;
  readonly weeklyTarget?: number;
}

interface DailyProgressData {
  readonly today: {
    readonly written: number;
    readonly target: number;
    readonly completed: boolean;
  };
  readonly streak: number;
  readonly last30Days: ReadonlyArray<{
    readonly date: string;
    readonly wordCount: number;
  }>;
}

interface ProgressResponse {
  readonly config: ProgressConfig;
  readonly progress: DailyProgressData;
  readonly trend: ReadonlyArray<{ date: string; wordCount: number }>;
}

// ---------------------------------------------------------------------------
// Mini bar chart (SVG, last 7 days)
// ---------------------------------------------------------------------------

function WeeklyTrendChart({ data, target }: { data: ReadonlyArray<{ date: string; wordCount: number }>; target: number }) {
  const last7 = data.slice(-7);
  if (last7.length === 0) return null;

  const maxVal = Math.max(target, ...last7.map((d) => d.wordCount), 1);
  const barWidth = 20;
  const gap = 6;
  const chartHeight = 48;
  const totalWidth = last7.length * (barWidth + gap) - gap;

  return (
    <svg width={totalWidth} height={chartHeight + 14} className="block" aria-label="最近7天写作趋势">
      {/* target line */}
      <line
        x1={0}
        y1={chartHeight - (target / maxVal) * chartHeight}
        x2={totalWidth}
        y2={chartHeight - (target / maxVal) * chartHeight}
        stroke="currentColor"
        strokeDasharray="3 2"
        className="text-muted-foreground/40"
        strokeWidth={1}
      />
      {last7.map((day, i) => {
        const h = (day.wordCount / maxVal) * chartHeight;
        const x = i * (barWidth + gap);
        const met = day.wordCount >= target;
        return (
          <g key={day.date}>
            <rect
              x={x}
              y={chartHeight - h}
              width={barWidth}
              height={Math.max(h, 1)}
              rx={3}
              className={met ? "fill-primary" : "fill-muted-foreground/30"}
            />
            <text
              x={x + barWidth / 2}
              y={chartHeight + 12}
              textAnchor="middle"
              className="fill-muted-foreground text-[8px]"
              fontSize={8}
            >
              {day.date.slice(-2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// DailyProgressCard
// ---------------------------------------------------------------------------

export function DailyProgressCard() {
  const { data, loading, refetch } = useApi<ProgressResponse>("/api/progress");
  const [editing, setEditing] = useState(false);
  const [targetInput, setTargetInput] = useState("");
  const [saving, setSaving] = useState(false);

  if (loading) {
    return (
      <div className="rounded-lg border border-border p-3 animate-pulse">
        <div className="h-4 w-24 bg-muted rounded" />
      </div>
    );
  }

  if (!data) return null;

  const { progress, config, trend } = data;
  const pct = progress.today.target > 0
    ? Math.min(100, Math.round((progress.today.written / progress.today.target) * 100))
    : 0;

  async function handleSaveTarget() {
    const val = parseInt(targetInput, 10);
    if (!val || val < 100) return;
    setSaving(true);
    try {
      await putApi("/api/progress/config", { dailyTarget: val });
      await refetch();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2.5" data-testid="daily-progress-card">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Target className="size-3.5" />
          日更进度
        </h3>
        <button
          type="button"
          onClick={() => { setEditing(!editing); setTargetInput(String(config.dailyTarget)); }}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="设置日更目标"
        >
          <Settings className="size-3.5" />
        </button>
      </div>

      {/* Edit target inline */}
      {editing && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={100}
            step={500}
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            className="w-20 rounded border border-border bg-background px-2 py-0.5 text-xs"
            placeholder="字数"
          />
          <span className="text-[10px] text-muted-foreground">字/天</span>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSaveTarget()}
            className="text-[10px] text-primary hover:underline disabled:opacity-50"
          >
            保存
          </button>
        </div>
      )}

      {/* Today stats */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold tabular-nums">{progress.today.written.toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground">/ {progress.today.target.toLocaleString()} 字</span>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
            <div
              className={`h-full rounded-full transition-all ${progress.today.completed ? "bg-green-500" : "bg-primary"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        {/* Streak */}
        {progress.streak > 0 && (
          <div className="flex items-center gap-1 shrink-0" title="连续达标天数">
            <Flame className="size-3.5 text-orange-500" />
            <span className="text-xs font-semibold tabular-nums">{progress.streak}</span>
          </div>
        )}
      </div>

      {/* 7-day trend */}
      {trend.length > 0 && (
        <WeeklyTrendChart data={trend} target={config.dailyTarget} />
      )}
    </div>
  );
}
