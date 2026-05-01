import { useState } from "react";
import { fetchJson } from "../../hooks/use-api";
import type { PublishReportResource } from "../../shared/contracts";
import { InlineError } from "../components/feedback";

interface PublishReport {
  readonly status: "ready" | "has-warnings" | "blocked";
  readonly totalBlockCount: number;
  readonly totalWarnCount: number;
  readonly totalSuggestCount: number;
  readonly sensitiveScan?: {
    readonly totalBlockCount?: number;
    readonly totalWarnCount?: number;
    readonly totalSuggestCount?: number;
  };
  readonly aiRatio?: {
    readonly overallAiRatio?: number;
  };
  readonly formatCheck?: {
    readonly issues?: readonly unknown[];
  };
  readonly continuity?: {
    readonly status: "unknown";
    readonly reason: string;
  };
}

const STATUS_LABELS: Record<string, string> = { ready: "就绪", "has-warnings": "存在警告", blocked: "阻塞" };
const STATUS_COLORS: Record<string, string> = { ready: "text-emerald-600 bg-emerald-500/10", "has-warnings": "text-amber-600 bg-amber-500/10", blocked: "text-destructive bg-destructive/10" };
const CONTINUITY_STATUS_LABELS: Record<string, string> = { unknown: "未完成审计", ready: "连续性正常", "has-warnings": "存在警告", blocked: "需处理" };

const PLATFORMS = [
  { value: "qidian", label: "起点中文网" },
  { value: "jjwxc", label: "晋江文学城" },
  { value: "fanqie", label: "番茄小说" },
  { value: "generic", label: "通用参考" },
] as const;

function indicatorColor(value: number, warnAt: number, blockAt: number): string {
  if (value >= blockAt) return "text-destructive";
  if (value >= warnAt) return "text-amber-600";
  return "text-emerald-600";
}

function sensitiveIssueCount(report: PublishReport): number {
  const scan = report.sensitiveScan;
  if (!scan) return report.totalBlockCount;
  return (scan.totalBlockCount ?? 0) + (scan.totalWarnCount ?? 0) + (scan.totalSuggestCount ?? 0);
}

function formatIssueCount(report: PublishReport): number {
  return report.formatCheck?.issues?.length ?? report.totalSuggestCount;
}

function platformLabel(value: string): string {
  return PLATFORMS.find((platform) => platform.value === value)?.label ?? "通用参考";
}

function publishStatusLabel(value: string | undefined): string {
  return value ? STATUS_LABELS[value] ?? "状态待确认" : "状态待确认";
}

function continuityStatusLabel(value: string | undefined): string {
  return value ? CONTINUITY_STATUS_LABELS[value] ?? "未完成审计" : "未完成审计";
}

function formatAiRatio(value: number | undefined): string {
  return value == null ? "未检测" : `${(value * 100).toFixed(0)}%`;
}

function reportMarkdown(platform: string, report: PublishReport): string {
  return [
    `# 发布就绪报告`,
    "",
    `- 平台：${platformLabel(platform)}`,
    `- 状态：${publishStatusLabel(report.status)}`,
    `- 敏感词指标：${sensitiveIssueCount(report)}`,
    `- AI 痕迹：${formatAiRatio(report.aiRatio?.overallAiRatio)}`,
    `- 格式问题：${formatIssueCount(report)}`,
    `- 连续性：${continuityStatusLabel(report.continuity?.status)}`,
    `- 连续性说明：${report.continuity?.reason ?? "连续性指标未知"}`,
  ].join("\n");
}

export function PublishPanel({
  bookId,
  onReport,
}: {
  readonly bookId: string;
  readonly onReport?: (report: PublishReportResource) => void;
}) {
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
      onReport?.({
        id: `publish-readiness:${platform}`,
        title: `${platform} 发布就绪报告`,
        channel: platform,
        status: res.report.status,
        updatedAt: new Date().toISOString(),
        content: reportMarkdown(platform, res.report),
      });
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
            {publishStatusLabel(report.status)}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="敏感词" value={sensitiveIssueCount(report)} color={indicatorColor(sensitiveIssueCount(report), 1, 5)} />
            <Metric label="AI 比例" value={formatAiRatio(report.aiRatio?.overallAiRatio)} color={indicatorColor(report.aiRatio?.overallAiRatio ?? 0, 0.3, 0.7)} />
            <Metric label="格式问题" value={formatIssueCount(report)} color={indicatorColor(formatIssueCount(report), 3, 10)} />
            <Metric label="警告数" value={report.totalWarnCount} color={indicatorColor(report.totalWarnCount, 1, 5)} />
          </div>
          <div className="rounded-lg border border-border p-3 text-sm">
            <div className="text-xs text-muted-foreground">连续性指标</div>
            <div className="font-medium">{continuityStatusLabel(report.continuity?.status)}</div>
            <div className="text-muted-foreground">{report.continuity?.reason ?? "连续性指标未知"}</div>
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
