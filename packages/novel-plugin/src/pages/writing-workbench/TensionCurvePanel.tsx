/**
 * 张力心电图（F1 复活+标准化）——按章节展示 AI 结算评出的张力综合分（0-10）。
 *
 * 各答一问：「节奏是否崩了」。
 * 数据源：chapter-summaries 类目 fields.tension_score（T1 双调用写入；-1=评分失败哨兵，
 * 负值按「未评估」渲染为虚线灰柱，不计入均值/峰值，绝不与低分混淆——墨枢 TensionChart 语义）。
 *
 * 工程标准：AbortController 取消上一轮 + 超时 + 刷新失败不清空已有曲线；
 * 告警两项起步：未评估计数、连续 ≥3 章 tension<4 低张力。
 * 零图表库依赖，纯 CSS 竖条渲染；点击柱子可跳对应章节。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchJson } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, RefreshCw } from "lucide-react";

const TENSION_THRESHOLD = 4;
const LOW_STREAK_ALERT_LENGTH = 3;
const FETCH_TIMEOUT_MS = 10_000;

export interface TensionDimensions {
  plot: number;
  emotional: number;
  pacing: number;
}

interface TensionEntry {
  chapterNumber: number;
  /** undefined = 未评估（评分失败或历史无分）。 */
  score?: number;
  dims?: TensionDimensions;
}

export interface TensionCurvePanelProps {
  bookId: string;
  className?: string;
  /** 点击柱子跳转对应章节（宿主透传工作台跳章通道）。 */
  onJumpToChapter?: (chapterNumber: number) => void;
}

function parseEntry(fields: Record<string, unknown>): TensionEntry | null {
  const chapterNumber = Number(fields.chapterNumber);
  if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) return null;
  const rawScore = fields.tension_score ?? fields.tensionScore;
  const parsed = typeof rawScore === "string" ? Number(rawScore) : rawScore;
  const score = typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  let dims: TensionDimensions | undefined;
  const rawDims = fields.tension_dims;
  if (rawDims && typeof rawDims === "object") {
    const record = rawDims as Record<string, unknown>;
    const pick = (key: string): number | undefined => {
      const value = Number(record[key]);
      return Number.isFinite(value) && value >= 0 ? value : undefined;
    };
    if (pick("plot") !== undefined && pick("emotional") !== undefined && pick("pacing") !== undefined) {
      dims = { plot: pick("plot")!, emotional: pick("emotional")!, pacing: pick("pacing")! };
    }
  }
  return { chapterNumber, ...(score !== undefined ? { score } : {}), ...(dims ? { dims } : {}) };
}

/** 连续低张力段检测：返回最长一段的起始章号与长度。 */
function findLongestLowStreak(entries: readonly TensionEntry[]): { start: number; length: number } | null {
  let best: { start: number; length: number } | null = null;
  let currentStart: number | null = null;
  let currentLength = 0;
  for (const entry of entries) {
    // 未评估章节不打断连击判定（无数据≠节奏好），但也不计入长度。
    if (entry.score !== undefined && entry.score < TENSION_THRESHOLD) {
      if (currentStart === null) currentStart = entry.chapterNumber;
      currentLength += 1;
      if (currentLength >= LOW_STREAK_ALERT_LENGTH && (best?.length ?? 0) < currentLength) {
        best = { start: currentStart, length: currentLength };
      }
    } else if (entry.score !== undefined) {
      currentStart = null;
      currentLength = 0;
    }
  }
  return best;
}

export function TensionCurvePanel({ bookId, className, onJumpToChapter }: TensionCurvePanelProps) {
  const [entries, setEntries] = useState<TensionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const load = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const data = await fetchJson<{ entries?: Array<{ fields?: Record<string, unknown> }> }>(
          `/api/books/${encodeURIComponent(bookId)}/jingwei/entries?category=chapter-summaries&limit=200`,
          { signal: controller.signal },
        );
        // 刷新失败不清空已有曲线：解析失败才可能走到这，成功即整体替换。
        const items = (data.entries ?? [])
          .map((entry) => parseEntry(typeof entry.fields === "object" && entry.fields !== null ? entry.fields : {}))
          .filter((entry): entry is TensionEntry => entry !== null)
          .sort((a, b) => a.chapterNumber - b.chapterNumber);
        setEntries(items);
      } finally {
        clearTimeout(timeout);
      }
    } catch (cause) {
      if (controller.signal.aborted) return; // 被新请求取代/超时：保留已有曲线，不当作错误。
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bookId 变化时重载
  }, [bookId]);

  const evaluated = useMemo(() => entries.filter((entry) => entry.score !== undefined), [entries]);
  const unevaluatedCount = entries.length - evaluated.length;
  const stats = useMemo(() => {
    if (evaluated.length === 0) return null;
    const scores = evaluated.map((entry) => entry.score!);
    const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const peakEntry = evaluated.reduce((best, entry) => (entry.score! > best.score! ? entry : best), evaluated[0]!);
    const lowEntry = evaluated.reduce((worst, entry) => (entry.score! < worst.score! ? entry : worst), evaluated[0]!);
    return {
      avg: avg.toFixed(1),
      peak: peakEntry.score!,
      lowChapter: lowEntry.chapterNumber,
      streak: findLongestLowStreak(entries),
    };
  }, [entries, evaluated]);

  const loadingBar = (
    <CardContent className="py-8 text-center text-xs text-muted-foreground" data-testid="tension-curve-loading">
      加载张力数据…
    </CardContent>
  );

  if (loading && entries.length === 0) {
    return <Card className={className}>{loadingBar}</Card>;
  }

  return (
    <Card className={className} data-testid="tension-curve-panel">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Activity className="size-4 text-orange-500" />
            张力心电图
            <span className="text-[10px] font-normal text-muted-foreground">· 节奏是否崩了</span>
          </CardTitle>
          <button
            type="button"
            onClick={() => void load()}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label="刷新张力曲线"
            disabled={loading}
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          {stats && (
            <>
              <span>均值 <strong className="text-foreground">{stats.avg}</strong></span>
              <span>峰值 <strong className="text-foreground">{stats.peak}</strong></span>
              <span>低谷 第{stats.lowChapter}章</span>
            </>
          )}
          {unevaluatedCount > 0 && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 border-dashed text-muted-foreground" data-testid="tension-unevaluated-badge">
              未评估 {unevaluatedCount} 章
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && (
          <div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive" role="alert">
            {error}
            <button type="button" onClick={() => void load()} className="ml-2 underline">重试</button>
          </div>
        )}

        {stats?.streak && (
          <div className="flex items-start gap-1 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400" data-testid="tension-low-streak-alert" role="alert">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <span>连续 {stats.streak.length} 章（第 {stats.streak.start} 章起）张力低于 {TENSION_THRESHOLD}——考虑安排一次冲突升级或信息增量。</span>
          </div>
        )}

        {entries.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground" data-testid="tension-curve-empty">
            暂无张力数据——写完章节并结算后自动生成；评分失败的章会显示为虚线灰柱。
          </p>
        ) : (
          <>
            <div
              className="flex items-end gap-[2px] h-[80px]"
              role="img"
              aria-label={`各章张力柱状图，共${entries.length}章，其中未评估${unevaluatedCount}章`}
            >
              {entries.map((entry) => {
                const unevaluated = entry.score === undefined;
                const heightPct = ((entry.score ?? 0) / 10) * 100;
                const isLow = !unevaluated && entry.score! < TENSION_THRESHOLD;
                const barTitle = unevaluated
                  ? `第${entry.chapterNumber}章：评分失败（未评估）`
                  : `${entry.dims ? `情节${entry.dims.plot}/情感${entry.dims.emotional}/节奏${entry.dims.pacing} — ` : ""}第${entry.chapterNumber}章：${entry.score}/10`;
                return (
                  <div key={entry.chapterNumber} className="flex-1 min-w-[6px] flex flex-col items-center group relative">
                    <button
                      type="button"
                      className="w-full flex flex-col items-center justify-end"
                      style={{ height: "100%" }}
                      title={barTitle}
                      aria-label={`第${entry.chapterNumber}章${unevaluated ? "未评估" : `张力 ${entry.score}/10`}`}
                      onClick={() => onJumpToChapter?.(entry.chapterNumber)}
                    >
                      <div
                        className={`w-full rounded-t-sm transition-all ${
                          unevaluated
                            ? "border border-dashed border-muted-foreground/60 bg-muted/40"
                            : isLow
                              ? "bg-red-400/70"
                              : "bg-emerald-500/70"
                        } group-hover:bg-primary`}
                        style={{ height: `${Math.max(heightPct, unevaluated ? 8 : 4)}%` }}
                      />
                      <span className="text-[8px] text-muted-foreground mt-0.5 truncate w-full text-center">{entry.chapterNumber}</span>
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-muted-foreground/60 border-t border-dashed border-red-300/40 pt-0.5">
              <span>0</span>
              <Badge variant="outline" className="text-[8px] px-1 py-0 text-red-400 border-red-300/40">告警线 {TENSION_THRESHOLD}</Badge>
              <span>10</span>
            </div>
            <p className="text-[9px] text-muted-foreground/70">
              虚线灰柱 = 该章评分失败（未评估）；实心柱点击可跳转对应章节。
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
