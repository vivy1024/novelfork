import { AlertTriangle, CheckCircle2, FileText, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import { ArtifactOpenButton } from "./ArtifactOpenButton";
import { SecondaryModelCalls } from "./SecondaryModelCalls";
import {
  asRecord,
  getNumber,
  getString,
  getStringArray,
  getToolResultArtifact,
  getToolResultData,
  type ToolResultRenderer,
  type ToolResultRendererContext,
} from "./types";

interface AuditCounts {
  readonly critical: number;
  readonly warning: number;
  readonly info: number;
  readonly byType: readonly { readonly type: string; readonly count: number }[];
}

function readAuditCounts(value: unknown): AuditCounts {
  const record = asRecord(value);
  const byTypeRecord = asRecord(record?.byType);
  const byType = byTypeRecord
    ? Object.entries(byTypeRecord).flatMap(([type, count]) => {
        const numericCount = getNumber(count);
        return numericCount === null ? [] : [{ type, count: numericCount }];
      })
    : [];
  return {
    critical: getNumber(record?.critical) ?? 0,
    warning: getNumber(record?.warning) ?? 0,
    info: getNumber(record?.info) ?? 0,
    byType,
  };
}

/** pipeline.write 结果卡：展示真实管线阶段、审计分类、内部模型调用与章后结算，不伪造后端未返回的问题明细。 */
export const PipelineChapterResultCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const data = asRecord(getToolResultData(context.result));
  if (!data) return null;

  const title = getString(data.title);
  const chapterNumber = getNumber(data.chapterNumber);
  const wordCount = getNumber(data.wordCount);
  const auditResult = asRecord(data.auditResult);
  const auditPassed = data.auditPassed === true || auditResult?.passed === true;
  const auditCounts = readAuditCounts(data.auditIssueCategories);
  const revised = data.revised === true;
  const reviseRounds = getNumber(data.reviseRounds) ?? (revised ? 1 : 0);
  const factCheckRevised = data.factCheckRevised === true;
  const factCheckRound = getNumber(data.factCheckRound) ?? 0;
  const needsHumanReview = data.needsHumanReview === true;
  const settlement = asRecord(data.narrativeSettlement);
  const publishHint = asRecord(data.publishHint);
  const publishWarnings = getStringArray(publishHint?.warnings);
  const publishStatus = getString(publishHint?.status);
  const settlementError = getString(data.settlementError);
  const highRiskPendingReminder = getString(data.highRiskPendingReminder);
  const lengthWarning = getString(data.lengthWarning);
  const artifact = getToolResultArtifact(context.result);

  return (
    <Card data-testid="tool-result-pipeline" size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-4 text-primary" />
          <span>{chapterNumber ? `第${chapterNumber}章` : "章节结果"}{title ? ` ${title}` : ""}</span>
        </CardTitle>
        {wordCount !== null && <CardAction className="text-xs text-muted-foreground">{wordCount} 字</CardAction>}
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={auditPassed ? "secondary" : "destructive"}>
            {auditPassed ? <CheckCircle2 data-icon="inline-start" /> : <XCircle data-icon="inline-start" />}
            审计{auditPassed ? "通过" : "未通过"}
          </Badge>
          {revised && (
            <Badge variant="outline">
              <RefreshCw data-icon="inline-start" />
              自动修订 {reviseRounds} 轮
            </Badge>
          )}
          {factCheckRevised && <Badge variant="outline">事实专项修订 {factCheckRound} 轮</Badge>}
          {needsHumanReview && <Badge variant="destructive">需要人工复核</Badge>}
          {publishStatus && <Badge variant="outline">发布检查：{publishStatus}</Badge>}
        </div>

        <div className="flex flex-col gap-2 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            <span className="font-medium text-foreground">审计分类</span>
            <span>{auditCounts.critical} critical</span>
            <span>{auditCounts.warning} warning</span>
            <span>{auditCounts.info} info</span>
          </div>
          {auditCounts.byType.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {auditCounts.byType.map((item) => (
                <Badge key={item.type} variant="outline">{item.type} {item.count}</Badge>
              ))}
            </div>
          )}
        </div>

        {settlement && (
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Narrative Memory</span>
            <span>抽取 {getNumber(settlement.extracted) ?? 0}</span>
            <span>自动沉淀 {getNumber(settlement.autoApplied) ?? 0}</span>
            <span>待审 {getNumber(settlement.pending) ?? 0}</span>
          </div>
        )}

        <SecondaryModelCalls value={data.modelCalls} />

        {(publishWarnings.length > 0 || lengthWarning) && (
          <Alert>
            <AlertTriangle className="size-4 text-muted-foreground" />
            <AlertTitle>发布前提醒</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
                {lengthWarning && <li>{lengthWarning}</li>}
                {publishWarnings.map((warning, index) => <li key={`publish-warning-${index}`}>{warning}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {highRiskPendingReminder && (
          <Alert>
            <AlertTitle>高风险待审事件</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">{highRiskPendingReminder}</AlertDescription>
          </Alert>
        )}

        {settlementError && (
          <Alert className="border-destructive/40 bg-destructive/5">
            <XCircle className="size-4 text-destructive" />
            <AlertTitle className="text-destructive">章后结算未完成</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">{settlementError}</AlertDescription>
          </Alert>
        )}

        {!auditPassed && !needsHumanReview && (
          <p className="text-xs text-muted-foreground">审计未通过；请查看分类并在画布中复核正文后再继续发布。</p>
        )}
      </CardContent>

      {artifact && context.onOpenArtifact && (
        <>
          <Separator />
          <CardFooter>
            <ArtifactOpenButton result={context.result} onOpenArtifact={context.onOpenArtifact} />
          </CardFooter>
        </>
      )}
    </Card>
  );
};
