import { AlertTriangle, CheckCircle2, Send, XCircle } from "lucide-react";

import { asRecord, getNumber, getString, getStringArray, getToolResultData, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

const STATUS_META: Record<string, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  ready: { label: "可以发布", tone: "text-emerald-600 dark:text-emerald-400", icon: CheckCircle2 },
  "has-warnings": { label: "可发布，有提醒", tone: "text-amber-600 dark:text-amber-400", icon: AlertTriangle },
  blocked: { label: "不建议发布", tone: "text-destructive", icon: XCircle },
  skipped: { label: "未执行检查", tone: "text-muted-foreground", icon: AlertTriangle },
};

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`text-xs ${tone ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}

/** publish.check / compliance.publish-readiness 卡：平台自检的四个维度。 */
export const PublishReadinessCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const data = asRecord(getToolResultData(context.result));
  if (!data) return null;

  const report = asRecord(data.report);
  const status = getString(data.status) || getString(report?.status, "skipped");
  const meta = STATUS_META[status] ?? STATUS_META.skipped;
  const StatusIcon = meta.icon;

  const platformLabel = getString(data.platformLabel) || getString(data.platform) || getString(report?.platform);
  const blockCount = getNumber(data.blockCount) ?? getNumber(report?.totalBlockCount) ?? 0;
  const warnCount = getNumber(data.warnCount) ?? getNumber(report?.totalWarnCount) ?? 0;
  const suggestCount = getNumber(data.suggestCount) ?? getNumber(report?.totalSuggestCount) ?? 0;
  const checkedChapters = getNumber(data.checkedChapters);

  const aiRatio = asRecord(report?.aiRatio);
  const aiRatioValue = getNumber(aiRatio?.estimatedAiRatio) ?? getNumber(aiRatio?.ratio);
  const formatCheck = asRecord(report?.formatCheck);
  const continuity = asRecord(report?.continuity);
  const chapterTarget = asRecord(data.chapterTarget);
  const notes = getStringArray(data.notes);
  const summary = getString(data.summary);

  return (
    <div data-testid="tool-result-publish-readiness" className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
      <div className="flex items-center gap-2">
        <Send className="size-4 text-primary" />
        <span className="font-medium">发布自检</span>
        {platformLabel && <span className="text-xs text-muted-foreground">{platformLabel}</span>}
      </div>

      <div className="flex items-center gap-1.5">
        <StatusIcon className={`size-4 ${meta.tone}`} />
        <span className={`text-xs ${meta.tone}`}>{meta.label}</span>
        {checkedChapters ? <span className="text-xs text-muted-foreground">已检 {checkedChapters} 章</span> : null}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border pt-2 sm:grid-cols-4">
        <Metric label="阻断" value={String(blockCount)} tone={blockCount > 0 ? "text-destructive" : undefined} />
        <Metric label="警告" value={String(warnCount)} tone={warnCount > 0 ? "text-amber-500" : undefined} />
        <Metric label="建议" value={String(suggestCount)} />
        {aiRatioValue !== null && (
          <Metric label="AI 率" value={`${Math.round(aiRatioValue * 100)}%`} />
        )}
      </div>

      {(formatCheck || continuity || chapterTarget) && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-border pt-2 text-[11px] text-muted-foreground">
          {formatCheck && <span>格式：{formatCheck.passed === true ? "通过" : "有问题"}</span>}
          {continuity && <span>连续性：{continuity.passed === true ? "通过" : "有问题"}</span>}
          {chapterTarget && <span>章字数：{getString(chapterTarget.status, "unknown")}</span>}
        </div>
      )}

      {notes.length > 0 && (
        <ul className="space-y-0.5 border-t border-border pt-2 text-[11px] text-muted-foreground">
          {notes.slice(0, 5).map((note, index) => <li key={index}>{note}</li>)}
        </ul>
      )}

      {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
    </div>
  );
};
