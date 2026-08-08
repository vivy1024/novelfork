import { AlertTriangle, CheckCircle2, ChevronRight, Info, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import { ToolResultSurface } from "./ToolResultSurface";
import { asRecord, getNumber, getString, getToolResultData, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

interface ViolationRow {
  readonly key: string;
  readonly ruleId: string;
  readonly location: string;
  readonly description: string;
  readonly suggestion: string;
}

function readViolations(value: unknown, prefix: string): ViolationRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const description = getString(record.description);
    if (!description) return [];
    return [{
      key: `${prefix}-${index}`,
      ruleId: getString(record.ruleId),
      location: getString(record.location),
      description,
      suggestion: getString(record.suggestion),
    }];
  });
}

function ViolationList({ rows, tone }: { rows: readonly ViolationRow[]; tone: "hard" | "soft" }) {
  if (rows.length === 0) return null;
  const Icon = tone === "hard" ? XCircle : Info;
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li key={row.key} className="text-xs">
          <div className="flex items-start gap-1.5">
            <Icon className={tone === "hard" ? "mt-0.5 size-3.5 shrink-0 text-destructive" : "mt-0.5 size-3.5 shrink-0 text-muted-foreground"} />
            <div className="min-w-0">
              <p className="text-foreground">
                {row.ruleId && <span className="mr-1 text-muted-foreground">[{row.ruleId}]</span>}
                {row.description}
              </p>
              {row.location && <p className="text-muted-foreground">位置：{row.location}</p>}
              {row.suggestion && (
                <p className="flex items-start gap-1 text-muted-foreground">
                  <ChevronRight className="mt-0.5 size-3 shrink-0" />
                  <span>{row.suggestion}</span>
                </p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** chapter.audit 审计卡：先看是否过硬门，再按硬/软约束分组列问题，文案直接用后端 description/suggestion。 */
export const ChapterAuditCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const data = asRecord(getToolResultData(context.result));
  if (!data) return null;

  const passed = data.passed === true;
  const wordCount = getNumber(data.wordCount);
  const hard = readViolations(data.hardViolations, "hard");
  const soft = readViolations(data.softViolations, "soft");

  return (
    <ToolResultSurface
      testId="tool-result-chapter-audit"
      title={passed ? "章节审计通过" : "章节审计未通过"}
      icon={passed ? <CheckCircle2 className="size-4 text-primary" /> : <XCircle className="size-4 text-destructive" />}
      meta={wordCount !== null ? `${wordCount} 字` : undefined}
    >
      <div className="flex flex-wrap gap-2">
        <Badge variant={hard.length > 0 ? "destructive" : "outline"}>硬约束违反 {hard.length}</Badge>
        <Badge variant="outline">软约束建议 {soft.length}</Badge>
      </div>

      {hard.length > 0 && (
        <>
          <Separator />
          <div className="flex flex-col gap-1">
            <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <XCircle className="size-3.5 shrink-0" />
              硬约束违反（必须处理）
            </p>
            <ViolationList rows={hard} tone="hard" />
          </div>
        </>
      )}

      {soft.length > 0 && (
        <>
          <Separator />
          <details className="text-xs" open={hard.length === 0}>
            <summary className="flex cursor-pointer items-center gap-1.5 text-foreground">
              <AlertTriangle className="size-3.5 shrink-0" />
              软约束建议（{soft.length}）
            </summary>
            <div className="mt-1"><ViolationList rows={soft} tone="soft" /></div>
          </details>
        </>
      )}

      {hard.length === 0 && soft.length === 0 && (
        <p className="text-xs text-muted-foreground">未发现硬/软约束问题。</p>
      )}
    </ToolResultSurface>
  );
};
