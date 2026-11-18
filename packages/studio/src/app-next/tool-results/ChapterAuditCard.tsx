import { AlertTriangle, CheckCircle2, ChevronRight, Info, LocateFixed, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { ToolResultSurface } from "./ToolResultSurface";
import {
  asRecord,
  getNumber,
  getString,
  getToolResultArtifact,
  getToolResultData,
  type ToolResultArtifact,
  type ToolResultRenderer,
  type ToolResultRendererContext,
} from "./types";

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

function extractLocateQuote(row: ViolationRow): string {
  const loc = row.location.trim();
  if (loc.length >= 2) return loc;
  const quoted = row.description.match(/[「『“"]([^」』”"]{2,60})[」』”"]/u)?.[1]?.trim();
  return quoted ?? "";
}

function ViolationList({
  rows,
  tone,
  onLocateInChapter,
}: {
  rows: readonly ViolationRow[];
  tone: "hard" | "soft";
  onLocateInChapter?: (quote: string) => void;
}) {
  if (rows.length === 0) return null;
  const Icon = tone === "hard" ? XCircle : Info;
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => {
        const quote = extractLocateQuote(row);
        return (
          <li key={row.key} className="rounded-md border border-border/50 bg-background/50 px-2.5 py-2 text-xs">
            <div className="flex items-start gap-1.5">
              <Icon className={tone === "hard" ? "mt-0.5 size-3.5 shrink-0 text-destructive" : "mt-0.5 size-3.5 shrink-0 text-muted-foreground"} />
              <div className="min-w-0 flex-1">
                <p className="leading-5 text-foreground">
                  {row.ruleId && <span className="mr-1 text-muted-foreground">[{row.ruleId}]</span>}
                  {row.description}
                </p>
                {row.location && <p className="mt-0.5 text-2xs text-muted-foreground">位置：{row.location}</p>}
                {row.suggestion && (
                  <p className="mt-0.5 flex items-start gap-1 text-muted-foreground">
                    <ChevronRight className="mt-0.5 size-3 shrink-0" />
                    <span>{row.suggestion}</span>
                  </p>
                )}
              </div>
              {onLocateInChapter && quote ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="h-6 shrink-0 gap-1 px-1.5 text-2xs text-primary"
                  onClick={() => onLocateInChapter(quote)}
                  title="跳转到正文并定位此句，配合正文波浪线原地修订"
                  data-testid="audit-card-jump-fix"
                >
                  <LocateFixed className="size-3" />
                  跳转正文修
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** chapter.audit 审计卡：书房质感折叠摘要 + 硬/软约束分组 + 跳转正文原地修。 */
export const ChapterAuditCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const data = asRecord(getToolResultData(context.result));
  if (!data) return null;

  const passed = data.passed === true;
  const wordCount = getNumber(data.wordCount);
  const chapterNumber = getNumber(data.chapterNumber);
  const artifact = getToolResultArtifact(context.result);
  const hard = readViolations(data.hardViolations, "hard");
  const soft = readViolations(data.softViolations, "soft");

  const jumpArtifactBase: ToolResultArtifact | null = artifact
    ?? (chapterNumber && chapterNumber > 0
      ? { kind: "chapter", id: `chapter:${chapterNumber}`, title: `第${chapterNumber}章`, chapterNumber }
      : null);

  const handleLocateInChapter = context.onOpenArtifact && jumpArtifactBase
    ? (quote: string) => {
        context.onOpenArtifact?.({
          ...jumpArtifactBase,
          locateQuote: quote,
        });
      }
    : undefined;

  return (
    <ToolResultSurface
      testId="tool-result-chapter-audit"
      title={passed ? "章节审计通过" : "章节审计未通过"}
      icon={passed ? <CheckCircle2 className="size-4 text-primary" /> : <XCircle className="size-4 text-destructive" />}
      meta={wordCount !== null ? `${wordCount} 字` : undefined}
      footer={context.onOpenArtifact && jumpArtifactBase ? (
        <div className="flex w-full items-center justify-between gap-2 text-2xs text-muted-foreground">
          <span>可在正文波浪线原地 PopConfirm 修订</span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="h-6 text-2xs"
            onClick={() => context.onOpenArtifact?.(jumpArtifactBase)}
            data-testid="audit-card-open-chapter"
          >
            打开第{chapterNumber ?? "?"}章正文
          </Button>
        </div>
      ) : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={hard.length > 0 ? "destructive" : "outline"}>硬约束违反 {hard.length}</Badge>
        <Badge variant="outline">软约束建议 {soft.length}</Badge>
      </div>

      {hard.length > 0 && (
        <>
          <Separator />
          <details className="text-xs" open>
            <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-destructive">
              <XCircle className="size-3.5 shrink-0" />
              硬约束违反（必须处理 · {hard.length}）
            </summary>
            <div className="mt-1.5">
              <ViolationList rows={hard} tone="hard" onLocateInChapter={handleLocateInChapter} />
            </div>
          </details>
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
            <div className="mt-1.5">
              <ViolationList rows={soft} tone="soft" onLocateInChapter={handleLocateInChapter} />
            </div>
          </details>
        </>
      )}

      {hard.length === 0 && soft.length === 0 && (
        <p className="text-xs text-muted-foreground">未发现硬/软约束问题。</p>
      )}
    </ToolResultSurface>
  );
};
