import { useState } from "react";
import { fetchJson } from "../../hooks/use-api";
import { InlineError } from "../components/feedback";

interface PublishReport {
  readonly status: "ready" | "has-warnings" | "blocked";
  readonly totalBlockCount: number;
  readonly totalWarnCount: number;
  readonly totalSuggestCount: number;
  readonly sensitiveWordCount?: number;
  readonly aiRatio?: number;
  readonly formatIssues?: number;
}

const STATUS_LABELS: Record<string, string> = { ready: "就绪", "has-warnings": "存在警告", blocked: "阻塞" };
const STATUS_COLORS: Record<string, string> = { ready: "text-green-600 bg-green-500/10", "has-warnings": "text-amber-600 bg-amber-500/10", blocked: "text-red-600 bg-red-500/10" };

const PLATFORMS = [
  { value: "qidian", label: "起点中文网" },
  { value: "jjwxc", label: "晋江文学城" },
  { value: "fanqie", label: "番茄小说" },
  { value: "generic", label: "通用参考" },
] as const;

function indicatorColor(value: number, warnAt: number, blockAt: number): string {
  if (value >= blockAt) return "text-red-600";
  if (value >= warnAt) return "text-amber-600";
  return "text-green-600";
}

export function PublishPanel({ bookId }: { readonly bookId: string }) {
  const [platform, setPlatform] = useState("qidian");
  const [report, setReport] = useState<PublishReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetchJson<{ report: PublishReport }>(`/books/${bookId}/compliance/publish-readiness`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      setReport(res.report);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <h2 className="text-xl font-semibold">发布就绪检查</h2>
        <div className="flex items-center gap-2">
          <select className="rounded border border-border bg-background px-2 py-1 text-sm" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50" disabled={checking} onClick={() => void runCheck()} type="button">
            {checking ? "检查中…" : "运行检查"}
          </button>
        </div>
      </div>

      {error && <InlineError message={error} onRetry={() => void runCheck()} />}

      {report && (
        <div className="space-y-3">
          <div className={`inline-block rounded-lg px-3 py-1.5 text-sm font-medium ${STATUS_COLORS[report.status] ?? ""}`}>
            {STATUS_LABELS[report.status] ?? report.status}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="敏感词" value={report.sensitiveWordCount ?? report.totalBlockCount} color={indicatorColor(report.sensitiveWordCount ?? report.totalBlockCount, 1, 5)} />
            <Metric label="AI 比例" value={report.aiRatio != null ? `${(report.aiRatio * 100).toFixed(0)}%` : "N/A"} color={indicatorColor(report.aiRatio ?? 0, 0.3, 0.7)} />
            <Metric label="格式问题" value={report.formatIssues ?? report.totalSuggestCount} color={indicatorColor(report.formatIssues ?? report.totalSuggestCount, 3, 10)} />
            <Metric label="警告数" value={report.totalWarnCount} color={indicatorColor(report.totalWarnCount, 1, 5)} />
          </div>
        </div>
      )}

      {!report && !checking && !error && (
        <p className="text-sm text-muted-foreground">选择平台后点击"运行检查"开始发布就绪评估。</p>
      )}
    </div>
  );
}

function Metric({ label, value, color }: { readonly label: string; readonly value: string | number; readonly color: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
