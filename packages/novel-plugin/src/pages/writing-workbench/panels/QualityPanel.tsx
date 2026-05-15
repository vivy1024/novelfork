import { useState, useEffect, useMemo } from "react";
import { Loader2, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, Line, LineChart } from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QualityTrendEntry {
  readonly number: number;
  readonly qualityScore: number | null;
  readonly aiTastePercent: number | null;
  readonly auditStatus: "passed" | "failed" | null;
  readonly driftScore: number | null;
}

interface QualityTrendResponse {
  readonly chapters: readonly QualityTrendEntry[];
}

export interface QualityPanelProps {
  readonly bookId: string;
}

// ---------------------------------------------------------------------------
// Chart configs
// ---------------------------------------------------------------------------

const aiTasteChartConfig: ChartConfig = {
  aiTaste: { label: "AI味", color: "var(--chart-2)" },
};

const driftChartConfig: ChartConfig = {
  drift: { label: "文风漂移", color: "var(--chart-4)" },
};

const qualityChartConfig: ChartConfig = {
  quality: { label: "质量评分", color: "var(--chart-1)" },
};

interface HealthMetric {
  readonly status: string;
  readonly value: number;
  readonly source?: string;
}

interface BookHealthData {
  readonly rhythmDiversity: HealthMetric | null;
  readonly consistencyScore: HealthMetric | null;
  readonly hookRecoveryRate: HealthMetric | null;
  readonly totalWords: HealthMetric | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QualityPanel({ bookId }: QualityPanelProps) {
  const [chapters, setChapters] = useState<readonly QualityTrendEntry[]>([]);
  const [healthData, setHealthData] = useState<BookHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetch(`/api/books/${bookId}/quality-trend?limit=20`).then((r) => {
        if (!r.ok) throw new Error("trend API error");
        return r.json() as Promise<QualityTrendResponse>;
      }),
      fetch(`/api/books/${bookId}/health`).then((r) => {
        if (!r.ok) throw new Error("health API error");
        return r.json();
      }),
    ])
      .then(([trendData, rawHealth]) => {
        if (cancelled) return;
        const sorted = [...trendData.chapters].sort((a, b) => a.number - b.number);
        setChapters(sorted);
        const h = rawHealth.health ?? {};
        setHealthData({
          rhythmDiversity: h.rhythmDiversity ?? null,
          consistencyScore: h.consistencyScore ?? null,
          hookRecoveryRate: h.hookRecoveryRate ?? null,
          totalWords: h.totalWords ?? null,
        });
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [bookId]);

  // Derived stats
  const stats = useMemo(() => {
    const audited = chapters.filter((c) => c.auditStatus !== null);
    const passed = audited.filter((c) => c.auditStatus === "passed");
    const passRate = audited.length > 0 ? Math.round((passed.length / audited.length) * 100) : null;

    const aiTasteValues = chapters.map((c) => c.aiTastePercent).filter((v): v is number => v !== null);
    const aiTasteAvg = aiTasteValues.length > 0 ? aiTasteValues.reduce((s, v) => s + v, 0) / aiTasteValues.length : null;

    const driftValues = chapters.map((c) => c.driftScore).filter((v): v is number => v !== null);
    const driftAvg = driftValues.length > 0 ? driftValues.reduce((s, v) => s + v, 0) / driftValues.length : null;

    return { passRate, aiTasteAvg, driftAvg, totalChapters: chapters.length };
  }, [chapters]);

  // Chart data
  const chartData = useMemo(() => {
    return chapters.map((ch) => ({
      chapter: `${ch.number}`,
      aiTaste: ch.aiTastePercent ?? undefined,
      drift: ch.driftScore ?? undefined,
      quality: ch.qualityScore ?? undefined,
    }));
  }, [chapters]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || chapters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <BarChart3 className="size-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">暂无质量数据</p>
        <p className="text-xs text-muted-foreground">写作并审校章节后，质量趋势将在此显示</p>
      </div>
    );
  }

  const hasAiTaste = chartData.some((d) => d.aiTaste !== undefined);
  const hasDrift = chartData.some((d) => d.drift !== undefined);
  const hasQuality = chartData.some((d) => d.quality !== undefined);

  return (
    <div className="space-y-3">
      {/* Top stats row */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="AI味均值" value={stats.aiTasteAvg !== null ? `${stats.aiTasteAvg.toFixed(0)}%` : "—"} />
        <StatCard label="审校通过率" value={stats.passRate !== null ? `${stats.passRate}%` : "—"} />
        <StatCard label="章节数" value={String(stats.totalChapters)} />
      </div>

      {/* Secondary stats: rhythm, consistency, hooks */}
      {healthData && (
        <div className="grid grid-cols-3 gap-2">
          <StatCard
            label="节奏多样性"
            value={healthData.rhythmDiversity?.value != null ? `${(healthData.rhythmDiversity.value * 100).toFixed(0)}%` : "—"}
          />
          <StatCard
            label="人设一致性"
            value={healthData.consistencyScore?.value != null ? `${(healthData.consistencyScore.value * 100).toFixed(0)}%` : "—"}
          />
          <StatCard
            label="伏笔回收率"
            value={healthData.hookRecoveryRate?.value != null ? `${(healthData.hookRecoveryRate.value * 100).toFixed(0)}%` : "—"}
          />
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-2 gap-3">
        {/* AI味趋势 */}
        {hasAiTaste && (
          <div className="rounded-md border border-border p-2">
            <p className="text-[10px] text-muted-foreground mb-1">AI味趋势 (最近20章)</p>
            <ChartContainer config={aiTasteChartConfig} className="h-[80px] w-full">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="chapter" tick={false} axisLine={false} />
                <YAxis hide domain={[0, "auto"]} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="aiTaste"
                  stroke="var(--color-aiTaste)"
                  fill="var(--color-aiTaste)"
                  fillOpacity={0.15}
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ChartContainer>
          </div>
        )}

        {/* 文风漂移 */}
        {hasDrift && (
          <div className="rounded-md border border-border p-2">
            <p className="text-[10px] text-muted-foreground mb-1">文风漂移 (与基线偏离)</p>
            <ChartContainer config={driftChartConfig} className="h-[80px] w-full">
              <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="chapter" tick={false} axisLine={false} />
                <YAxis hide domain={[0, "auto"]} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  type="monotone"
                  dataKey="drift"
                  stroke="var(--color-drift)"
                  strokeWidth={1.5}
                  dot={{ r: 2 }}
                />
              </LineChart>
            </ChartContainer>
          </div>
        )}
      </div>

      {/* Quality score chart (full width) */}
      {hasQuality && (
        <div className="rounded-md border border-border p-2">
          <p className="text-[10px] text-muted-foreground mb-1">质量评分趋势</p>
          <ChartContainer config={qualityChartConfig} className="h-[60px] w-full">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="chapter" tick={false} axisLine={false} />
              <YAxis hide domain={[0, 100]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                type="monotone"
                dataKey="quality"
                stroke="var(--color-quality)"
                fill="var(--color-quality)"
                fillOpacity={0.1}
                strokeWidth={1.5}
              />
            </AreaChart>
          </ChartContainer>
        </div>
      )}

      {/* Chapter quality table */}
      <div className="border border-border rounded-md overflow-hidden max-h-40 overflow-y-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50 border-b border-border sticky top-0">
              <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">章节</th>
              <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">质量</th>
              <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">AI味</th>
              <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">漂移</th>
              <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">审校</th>
            </tr>
          </thead>
          <tbody>
            {[...chapters].reverse().map((ch) => (
              <tr key={ch.number} className="border-b border-border last:border-0">
                <td className="px-2 py-1.5">第{ch.number}章</td>
                <td className="text-center px-2 py-1.5">
                  {ch.qualityScore !== null ? (
                    <span className={cn(
                      "font-medium",
                      ch.qualityScore >= 80 ? "text-green-600" : ch.qualityScore >= 60 ? "text-yellow-600" : "text-red-500"
                    )}>
                      {ch.qualityScore}
                    </span>
                  ) : "—"}
                </td>
                <td className="text-center px-2 py-1.5">
                  {ch.aiTastePercent !== null ? `${ch.aiTastePercent}%` : "—"}
                </td>
                <td className="text-center px-2 py-1.5">
                  {ch.driftScore !== null ? ch.driftScore.toFixed(1) : "—"}
                </td>
                <td className="text-center px-2 py-1.5">
                  {ch.auditStatus === "passed" && "✅"}
                  {ch.auditStatus === "failed" && "⚠"}
                  {ch.auditStatus === null && "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-2 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}
