import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { fetchJson } from "@/hooks/use-api";

export interface DailyProgressResponse {
  readonly config: {
    readonly dailyTarget: number;
    readonly weeklyTarget?: number;
    readonly totalChaptersTarget?: number;
    readonly avgWordsPerChapter?: number;
  };
  readonly progress: {
    readonly today: {
      readonly written: number;
      readonly target: number;
      readonly completed: boolean;
    };
    readonly thisWeek: {
      readonly written: number;
      readonly target: number;
    };
    readonly streak: number;
    readonly last30Days: ReadonlyArray<{ readonly date: string; readonly wordCount: number }>;
    readonly estimatedCompletionDate?: string;
  };
  readonly trend: ReadonlyArray<{ readonly date: string; readonly wordCount: number }>;
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function CircularProgress({ value, label }: { readonly value: number; readonly label: string }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference;

  return (
    <svg role="img" aria-label={label} viewBox="0 0 80 80" className="size-20 -rotate-90">
      <circle cx="40" cy="40" r={radius} fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/70" />
      <circle
        cx="40"
        cy="40"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="text-primary transition-all"
      />
    </svg>
  );
}

function TrendChart({ trend }: { readonly trend: ReadonlyArray<{ readonly date: string; readonly wordCount: number }> }) {
  const width = 320;
  const height = 80;
  const max = Math.max(1, ...trend.map((item) => item.wordCount));
  const points = trend.length <= 1
    ? trend.map((item, index) => `${index === 0 ? 0 : width},${height - (item.wordCount / max) * height}`)
    : trend.map((item, index) => {
        const x = (index / (trend.length - 1)) * width;
        const y = height - (item.wordCount / max) * height;
        return `${x},${y}`;
      });

  return (
    <svg role="img" aria-label="最近 30 天趋势折线" viewBox={`0 0 ${width} ${height}`} className="h-24 w-full text-primary">
      <polyline points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth="3" />
      {trend.map((item, index) => {
        const x = trend.length <= 1 ? 0 : (index / (trend.length - 1)) * width;
        const y = height - (item.wordCount / max) * height;
        return <circle key={`${item.date}-${item.wordCount}`} cx={x} cy={y} r="3" className="fill-primary" />;
      })}
    </svg>
  );
}

export function DailyProgressTracker() {
  const [data, setData] = useState<DailyProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dailyTargetInput, setDailyTargetInput] = useState("6000");

  async function loadProgress() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchJson<DailyProgressResponse>("/progress");
      setData(response);
      setDailyTargetInput(String(response.config.dailyTarget));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  async function saveTarget() {
    if (!data) return;
    const dailyTarget = Number.parseInt(dailyTargetInput, 10);
    if (!Number.isInteger(dailyTarget) || dailyTarget <= 0) {
      setError("日更目标必须是正整数");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await fetchJson("/progress/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data.config, dailyTarget }),
      });
      await loadProgress();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void loadProgress();
  }, []);

  if (loading && !data) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">正在加载日更进度...</CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{error ?? "日更进度暂不可用"}</CardContent>
      </Card>
    );
  }

  const todayPercent = data.progress.today.target > 0
    ? Math.min(100, (data.progress.today.written / data.progress.today.target) * 100)
    : 0;
  const weekPercent = data.progress.thisWeek.target > 0
    ? Math.min(100, (data.progress.thisWeek.written / data.progress.thisWeek.target) * 100)
    : 0;
  const trend = data.trend.length > 0 ? data.trend : data.progress.last30Days;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle>日更进度追踪</CardTitle>
            <CardDescription>今日字数、本周完成度、连续达标与最近 30 天趋势。</CardDescription>
          </div>
          <Badge variant={data.progress.today.completed ? "outline" : "secondary"}>
            {data.progress.today.completed ? "今日已达标" : `今日完成 ${formatPercent(todayPercent)}`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">今日进度</div>
                <div className="text-2xl font-semibold">{data.progress.today.written.toLocaleString()} / {data.progress.today.target.toLocaleString()} 字</div>
                <Progress aria-label="今日进度" value={todayPercent} />
              </div>
              <div className="relative grid place-items-center">
                <CircularProgress value={todayPercent} label="今日字数环形图" />
                <span className="absolute text-xs font-bold tabular-nums">{formatPercent(todayPercent)}</span>
              </div>
            </div>
          </div>
          <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
            <div className="text-sm text-muted-foreground">本周进度</div>
            <div className="text-2xl font-semibold">{formatPercent(weekPercent)}</div>
            <Progress aria-label="本周进度" value={weekPercent} />
          </div>
          <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-4">
            <div className="text-sm text-muted-foreground">连续达标</div>
            <div className="text-2xl font-semibold">连续达标 {data.progress.streak} 天</div>
            {data.progress.estimatedCompletionDate ? <div className="text-sm text-muted-foreground">预计完成 {data.progress.estimatedCompletionDate}</div> : null}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
            <Label htmlFor="daily-progress-target">日更目标</Label>
            <Input
              id="daily-progress-target"
              type="number"
              value={dailyTargetInput}
              onChange={(event) => setDailyTargetInput(event.target.value)}
            />
            <Button type="button" onClick={() => void saveTarget()} disabled={saving}>
              {saving ? "保存中..." : "保存目标"}
            </Button>
            {error ? <div className="text-sm text-destructive">{error}</div> : null}
          </div>
          <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
            <div className="text-sm font-medium">最近 30 天趋势</div>
            <TrendChart trend={trend} />
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {trend.map((item) => <span key={item.date} className="rounded bg-background/80 px-2 py-1">{item.date}: {item.wordCount.toLocaleString()}</span>)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
