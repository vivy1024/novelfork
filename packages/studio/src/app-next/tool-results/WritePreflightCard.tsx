import { AlertTriangle, CheckCircle2, ChevronRight, XCircle } from "lucide-react";

import { asRecord, getNumber, getString, getToolResultData, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

interface DiagnosticRow {
  readonly code: string;
  readonly message: string;
  readonly whatHappened?: string;
  readonly whyItMatters?: string;
  readonly suggestedAction?: string;
}

/** 只读 preflight 返回的 explanation 三段式，不按 code 自造文案。 */
function readDiagnostics(value: unknown): DiagnosticRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const explanation = asRecord(record.explanation);
    return [{
      code: getString(record.code, "other"),
      message: getString(record.message),
      whatHappened: explanation ? getString(explanation.whatHappened) : "",
      whyItMatters: explanation ? getString(explanation.whyItMatters) : "",
      suggestedAction: explanation ? getString(explanation.suggestedAction) : "",
    }];
  });
}

function DiagnosticList({ rows, tone }: { rows: readonly DiagnosticRow[]; tone: "block" | "warn" }) {
  if (rows.length === 0) return null;
  const Icon = tone === "block" ? XCircle : AlertTriangle;
  const color = tone === "block" ? "text-destructive" : "text-amber-500";
  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li key={`${tone}-${row.code}`} className="text-xs">
          <div className="flex items-start gap-1.5">
            <Icon className={`mt-0.5 size-3.5 shrink-0 ${color}`} />
            <div className="min-w-0">
              <p className="text-foreground">{row.whatHappened || row.message}</p>
              {row.whyItMatters && <p className="text-muted-foreground">{row.whyItMatters}</p>}
              {row.suggestedAction && (
                <p className="flex items-start gap-1 text-muted-foreground">
                  <ChevronRight className="mt-0.5 size-3 shrink-0" />
                  <span>{row.suggestedAction}</span>
                </p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** write.preflight 预检卡：能不能写、缺什么、建议怎么做。 */
export const WritePreflightCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const data = asRecord(getToolResultData(context.result));
  if (!data) return null;

  const ok = data.ok === true;
  const chapterNumber = getNumber(data.chapterNumber);
  const blockers = readDiagnostics(data.blockers);
  const warnings = readDiagnostics(data.warningItems);
  const directive = getString(data.resolvedDirective);
  const needsUserConfirm = data.needsUserConfirm === true;
  const volume = asRecord(data.currentVolume);
  const platform = asRecord(data.platform);
  const recent = Array.isArray(data.recentChapters) ? data.recentChapters.length : 0;

  return (
    <div data-testid="tool-result-write-preflight" className="space-y-3 rounded-lg border border-border bg-card p-3 text-sm">
      <div className="flex items-center gap-2">
        {ok ? <CheckCircle2 className="size-4 text-emerald-500" /> : <XCircle className="size-4 text-destructive" />}
        <span className="font-medium">
          {ok ? "写前检查通过" : "写前检查未通过"}
          {chapterNumber ? ` · 第${chapterNumber}章` : ""}
        </span>
        {warnings.length > 0 && (
          <span className="text-xs text-amber-500">{warnings.length} 条提醒</span>
        )}
      </div>

      {directive && (
        <p className="text-xs text-muted-foreground">
          本章目标：<span className="text-foreground">{directive}</span>
          {needsUserConfirm && <span className="ml-1 text-amber-500">（来自焦点默认，需你确认）</span>}
        </p>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {volume && <span>卷纲：{getString(volume.title) || "未命名"}</span>}
        {platform && <span>平台：{getString(platform.label) || getString(platform.platform)}</span>}
        <span>近章记忆：{recent} 条</span>
      </div>

      <DiagnosticList rows={blockers} tone="block" />
      <DiagnosticList rows={warnings} tone="warn" />

      {!ok && (
        <p className="border-t border-border pt-2 text-xs text-muted-foreground">
          阻断项未解决前不要直接写正文，先按上面的建议处理。
        </p>
      )}
    </div>
  );
};
