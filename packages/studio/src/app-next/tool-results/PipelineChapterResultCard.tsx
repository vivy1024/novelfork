import type { ToolResultRenderer, ToolResultRendererContext } from "./types";
import { asRecord, getToolResultData, getString, getNumber } from "./types";
import { ArtifactOpenButton } from "./ArtifactOpenButton";
import { CheckCircle2, XCircle, AlertTriangle, Info, FileText, RefreshCw } from "lucide-react";

interface AuditIssue {
  severity: "critical" | "warning" | "info";
  category: string;
  description: string;
  suggestion: string;
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical") return <XCircle className="size-3.5 text-destructive shrink-0" />;
  if (severity === "warning") return <AlertTriangle className="size-3.5 text-amber-500 shrink-0" />;
  return <Info className="size-3.5 text-muted-foreground shrink-0" />;
}

export const PipelineChapterResultCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const data = asRecord(getToolResultData(context.result));
  if (!data) return null;

  const title = getString(data.title);
  const chapterNumber = getNumber(data.chapterNumber);
  const wordCount = getNumber(data.wordCount);
  const auditPassed = data.auditPassed === true;
  const auditIssues = Array.isArray(data.auditIssues) ? (data.auditIssues as AuditIssue[]) : [];
  const auditSummary = getString(data.auditSummary);
  const revised = data.revised === true;
  const jingweiDelta = asRecord(data.jingweiDelta);
  const candidateId = getString(data.candidateId);

  const criticalCount = auditIssues.filter((i) => i.severity === "critical").length;
  const warningCount = auditIssues.filter((i) => i.severity === "warning").length;
  const infoCount = auditIssues.filter((i) => i.severity === "info").length;

  const createdEntries = Array.isArray(jingweiDelta?.created) ? jingweiDelta.created.length : 0;
  const updatedEntries = Array.isArray(jingweiDelta?.updated) ? jingweiDelta.updated.length : 0;

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3 text-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-primary" />
          <span className="font-medium">
            {chapterNumber ? `第${chapterNumber}章` : ""} {title}
          </span>
        </div>
        {wordCount && (
          <span className="text-xs text-muted-foreground">{wordCount} 字</span>
        )}
      </div>

      {/* Audit result */}
      <div className="flex items-center gap-2">
        {auditPassed ? (
          <CheckCircle2 className="size-4 text-emerald-500" />
        ) : (
          <XCircle className="size-4 text-destructive" />
        )}
        <span className={auditPassed ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
          审计{auditPassed ? "通过" : "未通过"}
        </span>
        {revised && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <RefreshCw className="size-3" /> 已自动修订
          </span>
        )}
      </div>

      {/* Issue summary */}
      {auditIssues.length > 0 && (
        <div className="text-xs text-muted-foreground flex gap-3">
          {criticalCount > 0 && <span className="text-destructive">{criticalCount} critical</span>}
          {warningCount > 0 && <span className="text-amber-500">{warningCount} warning</span>}
          {infoCount > 0 && <span>{infoCount} info</span>}
        </div>
      )}

      {/* Issue details (show first 5) */}
      {auditIssues.length > 0 && (
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {auditIssues.slice(0, 5).map((issue, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs">
              <SeverityIcon severity={issue.severity} />
              <span className="text-muted-foreground">[{issue.category}]</span>
              <span>{issue.description}</span>
            </div>
          ))}
          {auditIssues.length > 5 && (
            <p className="text-xs text-muted-foreground">...还有 {auditIssues.length - 5} 个问题</p>
          )}
        </div>
      )}

      {/* Jingwei delta */}
      {(createdEntries > 0 || updatedEntries > 0) && (
        <div className="text-xs text-muted-foreground">
          经纬变更：
          {createdEntries > 0 && <span className="text-emerald-600 dark:text-emerald-400"> +{createdEntries} 新增</span>}
          {updatedEntries > 0 && <span className="text-blue-600 dark:text-blue-400"> ~{updatedEntries} 更新</span>}
          <span className="ml-1">（接受候选稿后自动应用）</span>
        </div>
      )}

      {/* Audit summary */}
      {auditSummary && (
        <p className="text-xs text-muted-foreground border-t border-border pt-2">{auditSummary}</p>
      )}

      {/* Action hints when audit failed */}
      {!auditPassed && (
        <div className="text-xs text-muted-foreground border-t border-border pt-2 space-y-1">
          <p className="font-medium">可选操作：</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>回复"修订"— 自动修复 critical 问题后重新审计</li>
            <li>回复"忽略并接受"— 跳过审计直接接受候选稿</li>
            <li>回复"重新生成"— 重新走完整管线生成</li>
          </ul>
        </div>
      )}

      {/* Open in canvas button */}
      {candidateId && context.onOpenArtifact && (
        <ArtifactOpenButton
          result={context.result}
          onOpenArtifact={context.onOpenArtifact}
        />
      )}
    </div>
  );
};
