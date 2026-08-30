import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  FileText,
  Pause,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";

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

interface ContextSourceRow {
  readonly key: string;
  readonly source: string;
  readonly reason: string;
  readonly chars: number;
}

interface StageRow {
  readonly key: string;
  readonly stage: string;
  readonly status: "ok" | "skipped" | "warning" | "failed";
  readonly detail: string;
}

function readContextSources(value: unknown): ContextSourceRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const source = getString(record.source);
    if (!source) return [];
    return [{
      key: `context-${index}-${source}`,
      source,
      reason: getString(record.reason),
      chars: getNumber(record.chars) ?? 0,
    }];
  });
}

const STAGE_STATUS: Record<StageRow["status"], { readonly label: string; readonly className: string }> = {
  ok: { label: "通过", className: "text-emerald-600 dark:text-emerald-400" },
  skipped: { label: "跳过", className: "text-muted-foreground/70" },
  warning: { label: "有提醒", className: "text-amber-600 dark:text-amber-400" },
  failed: { label: "失败", className: "text-destructive" },
};

function StageIcon({ status }: { readonly status: StageRow["status"] }) {
  switch (status) {
    case "ok":
      return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />;
    case "warning":
      return <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />;
    case "failed":
      return <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />;
    case "skipped":
      return <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40" />;
  }
}

function readStages(value: unknown): StageRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const stage = getString(record.stage);
    if (!stage) return [];
    const rawStatus = getString(record.status);
    const status: StageRow["status"] = rawStatus === "skipped" || rawStatus === "warning" || rawStatus === "failed"
      ? rawStatus
      : "ok";
    return [{ key: `stage-${index}-${stage}`, stage, status, detail: getString(record.detail) }];
  });
}

/** 失败码对应的恢复建议。只覆盖 pipeline.write 已经会返回的 code，不编造未实现的按钮。 */
const PIPELINE_RECOVERY: Record<string, { readonly title: string; readonly action: string }> = {
  "invalid-input": { title: "输入不完整", action: "补全 scene.spec 后重新提交 pipeline.write。" },
  "content-required": { title: "缺少正文", action: "pipeline.write 不生成正文。由当前 Runtime Agent 提交已完成的 content。" },
  "book-not-found": { title: "找不到这本书", action: "确认当前书籍绑定后再重试。" },
  "spec-invalid": { title: "Scene Spec 不完整", action: "每个场景都要有人物、地点、冲突和结果，补全后重提。" },
  "beat-budget-invalid": { title: "情节点预算不合规", action: "回到 scene.spec 重排 beatBudget，不要硬写。" },
  "context-not-ready": { title: "近章记忆未就绪", action: "先用 memory.settle_range 回填近章，或用 chapter.discard_range 清掉空进度后再写。" },
  "preflight-execution-failed": { title: "写前预检未能执行", action: "预检失败即拒绝保存。修好写前检查后再重试。" },
  "high-risk-pending": { title: "高风险待审事件阻断", action: "先在叙事记忆里处理 pending，或明确 continueWithHighRiskPending 后再写。" },
  "length-out-of-range": { title: "字数超出硬范围", action: "按本书硬范围改字数后重新提交。正文未保存。" },
  "writing-skill-compliance-failed": { title: "Writing Skills 硬性违规", action: "按错误里的技能条目改稿后重新提交 pipeline.write。" },
  "fact-check-failed": { title: "事实/连续性未通过", action: "修订关键事实后重新提交；requireFactCheckPass 开启时不会保存。" },
  "volume-range-violation": { title: "章号不在当前卷区间", action: "用 outline.volume 修正当前卷或章号后再写。" },
  "generation-failed": { title: "落盘或执行失败", action: "查看错误详情，修复存储或正文后重试 pipeline.write。" },
  timeout: { title: "管线超时", action: "稍后重试 pipeline.write；若反复超时，先缩小本章正文再提交。" },
};

function readSkillWarnings(warnings: readonly string[]): string[] {
  return warnings.filter((warning) => warning.includes("Writing Skill"));
}

function NextStep({ children }: { readonly children: string }) {
  return (
    <p className="flex items-start gap-1 text-xs text-muted-foreground">
      <ChevronRight className="mt-0.5 size-3 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function PipelineStages({ stages }: { readonly stages: readonly StageRow[] }) {
  if (stages.length === 0) return null;
  const failed = stages.filter((item) => item.status === "failed").length;
  const warning = stages.filter((item) => item.status === "warning").length;
  const passed = stages.filter((item) => item.status === "ok").length;
  const skipped = stages.filter((item) => item.status === "skipped").length;
  const done = passed + skipped + warning + failed;
  const progress = Math.round((done / stages.length) * 100);
  const barClass = failed > 0 ? "bg-destructive" : warning > 0 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="pipeline-stages">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-foreground">管线阶段</span>
        <span className="text-muted-foreground">
          {passed} 通过
          {warning > 0 ? ` · ${warning} 提醒` : ""}
          {failed > 0 ? ` · ${failed} 失败` : ""}
          {skipped > 0 ? ` · ${skipped} 跳过` : ""}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all ${barClass}`} style={{ width: `${progress}%` }} />
      </div>
      <ul className="flex flex-col gap-1.5">
        {stages.map((item) => (
          <li key={item.key} className="flex items-start gap-2">
            <StageIcon status={item.status} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-foreground">{item.stage}</span>
                <span className={STAGE_STATUS[item.status].className}>{STAGE_STATUS[item.status].label}</span>
              </div>
              {item.detail && <p className="text-muted-foreground">{item.detail}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** pipeline.write 结果卡：展示真实管线阶段、错误恢复、技能结果、结算重试与人工干预，不伪造未返回的明细。 */
export const PipelineChapterResultCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const wrapper = asRecord(context.result);
  const payload = asRecord(getToolResultData(context.result)) ?? wrapper;
  if (!payload) return null;

  const failed = wrapper?.ok === false || payload.ok === false;
  const failureCode = getString(payload.code) || (failed ? getString(wrapper?.error) || getString(payload.error) : "");
  const failureMessage = failed
    ? getString(payload.error) || getString(payload.summary) || getString(wrapper?.summary) || getString(wrapper?.error)
    : "";
  const failureExplanation = getString(payload.explanation) || getString(payload.summary);
  const recovery = PIPELINE_RECOVERY[failureCode];

  const title = getString(payload.title);
  const chapterNumber = getNumber(payload.chapterNumber);
  const wordCount = getNumber(payload.wordCount);
  const auditResult = asRecord(payload.auditResult);
  const auditPassed = payload.auditPassed === true || auditResult?.passed === true;
  const auditCounts = readAuditCounts(payload.auditIssueCategories);
  const revised = payload.revised === true;
  const reviseRounds = getNumber(payload.reviseRounds) ?? (revised ? 1 : 0);
  const factCheckRevised = payload.factCheckRevised === true;
  const factCheckRound = getNumber(payload.factCheckRound) ?? 0;
  const needsHumanReview = payload.needsHumanReview === true;
  const settlement = asRecord(payload.narrativeSettlement);
  const settlementDispatch = asRecord(payload.settlementDispatch);
  const publishHint = asRecord(payload.publishHint);
  const publishWarnings = getStringArray(publishHint?.warnings);
  const skillWarnings = readSkillWarnings(publishWarnings);
  const otherPublishWarnings = publishWarnings.filter((warning) => !skillWarnings.includes(warning));
  const publishStatus = getString(publishHint?.status);
  const settlementError = getString(payload.settlementError);
  const highRiskPendingReminder = getString(payload.highRiskPendingReminder);
  const lengthWarning = getString(payload.lengthWarning);
  const contextSources = readContextSources(payload.contextSources);
  const stages = readStages(payload.pipelineStages);
  const artifact = getToolResultArtifact(context.result);
  const heading = chapterNumber
    ? `第${chapterNumber}章${title ? ` ${title}` : ""}`
    : failed
      ? "章节管线未完成"
      : title || "章节结果";

  return (
    <Card data-testid="tool-result-pipeline" size="sm">
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2">
          {failed ? <XCircle className="size-4 text-destructive" /> : <FileText className="size-4 text-primary" />}
          <span className="min-w-0">{heading}</span>
        </CardTitle>
        {wordCount !== null && <CardAction className="text-xs text-muted-foreground">{wordCount} 字</CardAction>}
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {failed && (
          <Alert className="border-destructive/40 bg-destructive/5" data-testid="pipeline-failure">
            <XCircle className="size-4 text-destructive" />
            <AlertTitle className="text-destructive">{recovery?.title ?? "管线未能保存本章"}</AlertTitle>
            <AlertDescription className="flex flex-col gap-1">
              {failureMessage && <p className="whitespace-pre-wrap text-foreground">{failureMessage}</p>}
              {failureExplanation && failureExplanation !== failureMessage && (
                <p className="whitespace-pre-wrap">{failureExplanation}</p>
              )}
              <NextStep>{recovery?.action ?? "按错误信息处理后，让叙述者重新调用 pipeline.write。"}</NextStep>
            </AlertDescription>
          </Alert>
        )}

        {!failed && (
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
            {needsHumanReview && (
              <Badge variant="destructive">
                <Pause data-icon="inline-start" />
                需要人工复核
              </Badge>
            )}
            {publishStatus && <Badge variant="outline">发布检查：{publishStatus}</Badge>}
          </div>
        )}

        {!failed && (auditCounts.critical + auditCounts.warning + auditCounts.info > 0 || auditCounts.byType.length > 0) && (
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
        )}

        {settlement && (
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Narrative Memory</span>
            <span>抽取 {getNumber(settlement.extracted) ?? 0}</span>
            <span>自动沉淀 {getNumber(settlement.autoApplied) ?? 0}</span>
            <span>待审 {getNumber(settlement.pending) ?? 0}</span>
          </div>
        )}

        {settlementDispatch && (
          <div className="flex flex-wrap items-baseline gap-x-2 text-xs" data-testid="pipeline-settlement-dispatch">
            <span className="font-medium text-foreground">结算派发</span>
            <span className={settlementDispatch.ok === false ? "text-destructive" : "text-muted-foreground"}>
              {settlementDispatch.ok === false ? "结算失败" : "已完成"}
            </span>
            {getString(settlementDispatch.toolName) && (
              <span className="text-muted-foreground">{getString(settlementDispatch.toolName)}</span>
            )}
            {getString(settlementDispatch.dispatched) && (
              <span className="text-muted-foreground">
                {getString(settlementDispatch.dispatched) === "tool-call" ? "面板可见工具调用" : "进程内回退"}
              </span>
            )}
          </div>
        )}

        <PipelineStages stages={stages} />

        {skillWarnings.length > 0 && (
          <div className="flex flex-col gap-1 text-xs" data-testid="pipeline-skill-results">
            <span className="font-medium text-foreground">技能结果</span>
            <ul className="flex flex-col gap-1">
              {skillWarnings.map((warning, index) => (
                <li key={`skill-warning-${index}`} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                  <span className="text-muted-foreground">{warning}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {contextSources.length > 0 && (
          <details className="text-xs" data-testid="pipeline-context-sources">
            <summary className="cursor-pointer text-muted-foreground">
              本章实际注入的上下文（{contextSources.length} 项）
            </summary>
            <ul className="mt-1 flex flex-col gap-1">
              {contextSources.map((item) => (
                <li key={item.key} className="flex flex-col">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-foreground">{item.source}</span>
                    <span className="text-muted-foreground">{item.chars} 字</span>
                  </span>
                  {item.reason && <span className="text-muted-foreground">{item.reason}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}

        <SecondaryModelCalls value={payload.modelCalls} />

        {(otherPublishWarnings.length > 0 || lengthWarning) && (
          <Alert>
            <AlertTriangle className="size-4 text-muted-foreground" />
            <AlertTitle>发布前提醒</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
                {lengthWarning && <li>{lengthWarning}</li>}
                {otherPublishWarnings.map((warning, index) => <li key={`publish-warning-${index}`}>{warning}</li>)}
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

        {needsHumanReview && !failed && (
          <Alert className="border-amber-500/40 bg-amber-500/5" data-testid="pipeline-human-review">
            <Pause className="size-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle>需要人工干预</AlertTitle>
            <AlertDescription className="flex flex-col gap-1">
              <p>审计仍有可修订问题。正文已保存，但不要直接发布。</p>
              <NextStep>打开画布复核正文，按审计分类修订后重新提交 pipeline.write。</NextStep>
            </AlertDescription>
          </Alert>
        )}

        {settlementError && (
          <Alert className="border-destructive/40 bg-destructive/5" data-testid="pipeline-settlement-retry">
            <XCircle className="size-4 text-destructive" />
            <AlertTitle className="text-destructive">章后结算未完成</AlertTitle>
            <AlertDescription className="flex flex-col gap-1">
              <p className="whitespace-pre-wrap">{settlementError}</p>
              <NextStep>重试 memory.settle_chapter（正文已在库，不会丢稿）。若要连同前后章回填，用 memory.settle_range。</NextStep>
            </AlertDescription>
          </Alert>
        )}

        {!failed && !auditPassed && !needsHumanReview && (
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
