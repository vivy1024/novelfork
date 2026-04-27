import { useState } from "react";
import { postApi, useApi } from "../../hooks/use-api";
import { InlineError } from "../components/feedback";

interface DetectStats {
  readonly totalChapters: number;
  readonly averageScore: number;
  readonly highRiskCount: number;
}

interface ChapterResult {
  readonly chapter: number;
  readonly score: number;
  readonly riskLevel: "low" | "medium" | "high";
  readonly issues: ReadonlyArray<{ type: string; description: string; severity: string }>;
}

const RISK_COLORS: Record<string, string> = {
  high: "text-destructive bg-destructive/10",
  medium: "text-amber-600 bg-amber-500/10",
  low: "text-emerald-600 bg-emerald-500/10",
};
const RISK_LABELS: Record<string, string> = { high: "高风险", medium: "中风险", low: "低风险" };

export function DetectPanel({ bookId }: { readonly bookId: string }) {
  const { data: stats, error: statsError } = useApi<DetectStats>(`/books/${bookId}/detect/stats`);
  const [results, setResults] = useState<ReadonlyArray<ChapterResult>>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const runDetect = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await postApi<{ results: ReadonlyArray<ChapterResult> }>(`/books/${bookId}/detect`);
      setResults(res.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <h2 className="text-xl font-semibold">AI 检测</h2>
        <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50" disabled={running} onClick={() => void runDetect()} type="button">
          {running ? "检测中…" : "运行检测"}
        </button>
      </div>

      {statsError && <InlineError message={statsError} />}

      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground">总章节</div>
            <div className="text-lg font-semibold">{stats.totalChapters}</div>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground">平均分</div>
            <div className="text-lg font-semibold tabular-nums">{stats.averageScore.toFixed(1)}</div>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground">高风险章节</div>
            <div className={`text-lg font-semibold ${stats.highRiskCount > 0 ? "text-destructive" : "text-emerald-600"}`}>{stats.highRiskCount}</div>
          </div>
        </div>
      )}

      {error && <InlineError message={error} onRetry={() => void runDetect()} />}

      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((r) => (
            <div key={r.chapter} className="rounded-lg border border-border">
              <button className="flex w-full items-center justify-between px-3 py-2 text-sm" onClick={() => setExpanded(expanded === r.chapter ? null : r.chapter)} type="button">
                <span>第 {r.chapter} 章 · 分数 {r.score.toFixed(1)} · 问题 {r.issues.length}</span>
                <span className={`rounded px-2 py-0.5 text-xs ${RISK_COLORS[r.riskLevel] ?? ""}`}>{RISK_LABELS[r.riskLevel] ?? r.riskLevel}</span>
              </button>
              {expanded === r.chapter && r.issues.length > 0 && (
                <div className="border-t border-border px-3 py-2 space-y-1">
                  {r.issues.map((issue, i) => (
                    <div key={i} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">[{issue.type}]</span> {issue.description}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!stats && !error && !running && results.length === 0 && (
        <p className="text-sm text-muted-foreground">暂无检测数据</p>
      )}
    </div>
  );
}
