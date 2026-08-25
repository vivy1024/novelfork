/**
 * 张力心电图——按章节展示 AI 结算时评出的 tensionScore（0-10）。
 * 数据源：chapter-summaries 类目的 fields.tension_score（E批自动写入，snake_case）。
 * 兼容读 fields.tensionScore（camelCase 旧键）。
 * 零外部图表库依赖，用纯 CSS 竖条渲染。
 */

import { useEffect, useMemo, useState } from "react";
import { fetchJson } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw } from "lucide-react";

const TENSION_THRESHOLD = 5;

interface TensionEntry {
  chapterNumber: number;
  tensionScore: number;
}

export interface TensionCurvePanelProps {
  bookId: string;
  className?: string;
}

export function TensionCurvePanel({ bookId, className }: TensionCurvePanelProps) {
  const [entries, setEntries] = useState<TensionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<{ entries?: Array<{ fields?: Record<string, unknown> }> }>(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/entries?category=chapter-summaries&limit=100`,
      );
      const items = (data.entries ?? [])
        .map((e) => {
          const fields = typeof e.fields === "object" && e.fields !== null ? e.fields : {};
          const chapterNumber = Number(fields.chapterNumber);
          // 结算端写入的是 tension_score（snake_case）；tensionScore 为旧键兼容。
          const rawScore = fields.tension_score ?? fields.tensionScore;
          const score = Number(rawScore);
          return { chapterNumber, tensionScore: score };
        })
        .filter((e) => Number.isFinite(e.chapterNumber) && Number.isFinite(e.tensionScore))
        .sort((a, b) => a.chapterNumber - b.chapterNumber);
      setEntries(items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [bookId]);

  const stats = useMemo(() => {
    if (entries.length === 0) return null;
    const scores = entries.map((e) => e.tensionScore);
    const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const peak = Math.max(...scores);
    const lowEntry = entries.find((e) => e.tensionScore === Math.min(...scores));
    return { avg: avg.toFixed(1), peak, lowChapter: lowEntry?.chapterNumber };
  }, [entries]);

  if (loading) {
    return <Card className={className}><CardContent className="py-8 text-center text-xs text-muted-foreground">加载张力数据…</CardContent></Card>;
  }
  if (error) {
    return <Card className={className}><CardContent className="py-4 text-center text-xs text-destructive">{error}</CardContent></Card>;
  }

  return (
    <Card className={className} data-testid="tension-curve-panel">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Activity className="size-4 text-orange-500" />
            张力心电图
          </CardTitle>
          <button type="button" onClick={() => void load()} className="text-muted-foreground hover:text-foreground" aria-label="刷新张力曲线">
            <RefreshCw className="size-3.5" />
          </button>
        </div>
        {stats && (
          <div className="flex gap-3 text-[10px] text-muted-foreground">
            <span>均值 <strong className="text-foreground">{stats.avg}</strong></span>
            <span>峰值 <strong className="text-foreground">{stats.peak}</strong></span>
            {stats.lowChapter !== undefined && <span>低谷 第{stats.lowChapter}章</span>}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">暂无张力数据——写完章节并结算后自动生成。</p>
        ) : (
          <>
            <div className="flex items-end gap-[2px] h-[80px]" role="img" aria-label={`各章张力柱状图，共${entries.length}章`}>
              {entries.map((entry) => {
                const heightPct = (entry.tensionScore / 10) * 100;
                const isLow = entry.tensionScore < TENSION_THRESHOLD;
                return (
                  <div key={entry.chapterNumber} className="flex-1 min-w-[6px] flex flex-col items-center group relative" title={`第${entry.chapterNumber}章：${entry.tensionScore}/10`}>
                    <div
                      className={`w-full rounded-t-sm transition-all ${isLow ? "bg-red-400/70" : "bg-emerald-500/70"} group-hover:bg-primary`}
                      style={{ height: `${Math.max(heightPct, 4)}%` }}
                    />
                    <span className="text-[8px] text-muted-foreground mt-0.5 truncate w-full text-center">{entry.chapterNumber}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-muted-foreground/60 border-t border-dashed border-red-300/40 pt-0.5">
              <span>0</span>
              <Badge variant="outline" className="text-[8px] px-1 py-0 text-red-400 border-red-300/40">阈值 {TENSION_THRESHOLD}</Badge>
              <span>10</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
