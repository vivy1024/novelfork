import { AlertTriangle, CheckCircle2, FileSearch } from "lucide-react";

import { asRecord, getNumber, getString, getStringArray, getToolResultData, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

const STATUS_META: Record<string, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  ready: { label: "未发现明显线索", tone: "text-emerald-600 dark:text-emerald-400", icon: CheckCircle2 },
  "has-warnings": { label: "有提醒", tone: "text-amber-600 dark:text-amber-400", icon: AlertTriangle },
  "needs-review": { label: "需人工复核", tone: "text-amber-600 dark:text-amber-400", icon: AlertTriangle },
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

/** publish.check / compliance.publish-readiness：只读投稿风险自检卡。 */
export const PublishReadinessCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const data = asRecord(getToolResultData(context.result));
  if (!data) return null;

  const report = asRecord(data.report);
  const status = getString(data.status) || getString(report?.status, "skipped");
  const meta = STATUS_META[status] ?? STATUS_META.skipped;
  const StatusIcon = meta.icon;
  const platformLabel = getString(data.platformLabel) || getString(data.platform) || getString(report?.platform);
  const highRiskCount = getNumber(data.blockCount) ?? getNumber(report?.totalBlockCount) ?? 0;
  const warnCount = getNumber(data.warnCount) ?? getNumber(report?.totalWarnCount) ?? 0;
  const suggestCount = getNumber(data.suggestCount) ?? getNumber(report?.totalSuggestCount) ?? 0;
  const checkedChapters = getNumber(data.checkedChapters);
  const aiTaste = asRecord(report?.aiTaste);
  const aiRiskLevel = getString(aiTaste?.overallRiskLevel);
  const aiTasteRulePack = asRecord(aiTaste?.rulePack);
  const aiTasteMethodology = getString(aiTaste?.methodology);
  const rulePack = asRecord(report?.rulePack);
  const evidence = Array.isArray(report?.evidence) ? report.evidence.map(asRecord).filter((item): item is Record<string, unknown> => item !== null) : [];
  const notes = getStringArray(data.notes);
  const summary = getString(data.summary);

  return (
    <div data-testid="tool-result-publish-readiness" className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
      <div className="flex items-center gap-2">
        <FileSearch className="size-4 text-primary" />
        <span className="font-medium">投稿风险自检</span>
        {platformLabel && <span className="text-xs text-muted-foreground">{platformLabel}</span>}
      </div>

      <div className="flex items-center gap-1.5">
        <StatusIcon className={`size-4 ${meta.tone}`} />
        <span className={`text-xs ${meta.tone}`}>{meta.label}</span>
        {checkedChapters ? <span className="text-xs text-muted-foreground">已检 {checkedChapters} 章</span> : null}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border pt-2 sm:grid-cols-4">
        <Metric label="高风险线索" value={String(highRiskCount)} tone={highRiskCount > 0 ? "text-amber-600 dark:text-amber-400" : undefined} />
        <Metric label="提醒" value={String(warnCount)} tone={warnCount > 0 ? "text-amber-500" : undefined} />
        <Metric label="建议" value={String(suggestCount)} />
        {aiRiskLevel && <Metric label="AI 味线索" value={aiRiskLevel} />}
      </div>

      {rulePack && (
        <div className="border-t border-border pt-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">规则来源：</span>{getString(rulePack.id)} · {getString(rulePack.name)} · v{getString(rulePack.version)} · {getString(rulePack.confidence)} 可信度
          {getString(rulePack.source) && <span> · {getString(rulePack.source)}</span>}
        </div>
      )}

      {aiTasteRulePack && (
        <div className="border-t border-border pt-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">AI 味线索来源：</span>{getString(aiTasteRulePack.id)} · {getString(aiTasteRulePack.name)}
          {aiTasteMethodology && <p className="mt-1">{aiTasteMethodology}</p>}
          {getString(aiTasteRulePack.note) && <p className="mt-1">{getString(aiTasteRulePack.note)}</p>}
        </div>
      )}

      {evidence.length > 0 && (
        <div className="space-y-1 border-t border-border pt-2 text-[11px]">
          <span className="font-medium">复核证据</span>
          {evidence.slice(0, 3).map((item, index) => {
            const chapterNumber = getNumber(item.chapterNumber);
            const paragraph = getNumber(item.paragraph);
            const offset = getNumber(item.offset);
            return (
              <div key={`${getString(item.ruleId, "evidence")}-${index}`} className="rounded-md bg-muted/50 p-2 text-muted-foreground">
                <p>{getString(item.message)}</p>
                <p className="mt-1">规则：{getString(item.rulePackId) ? `${getString(item.rulePackId)} · ` : ""}{getString(item.ruleId)} · 来源：{getString(item.source)}</p>
                {chapterNumber !== undefined && <p className="mt-1">位置：第 {chapterNumber} 章{getString(item.chapterTitle) ? `《${getString(item.chapterTitle)}》` : ""}{paragraph !== undefined ? ` · 第 ${paragraph} 段` : ""}{offset !== undefined ? ` · 偏移 ${offset}` : ""}</p>}
                {getString(item.context) && <p className="mt-1 break-words">正文摘录：{getString(item.context)}</p>}
                {getString(item.suggestion) && <p className="mt-1">人工复核建议：{getString(item.suggestion)}</p>}
              </div>
            );
          })}
          {evidence.length > 3 && <p className="text-muted-foreground">另有 {evidence.length - 3} 条证据，请在投稿风险面板查看。</p>}
        </div>
      )}

      {notes.length > 0 && (
        <ul className="space-y-0.5 border-t border-border pt-2 text-[11px] text-muted-foreground">
          {notes.slice(0, 5).map((note, index) => <li key={index}>{note}</li>)}
        </ul>
      )}
      {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
      <p className="text-[11px] text-muted-foreground">此结果是本地自检线索，不代表平台审核结论。</p>
    </div>
  );
};
