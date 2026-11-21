import { AlertCircle, Feather, FileText, Layers, Scale } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ArtifactOpenButton } from "./ArtifactOpenButton";
import { ToolResultSurface } from "./ToolResultSurface";
import {
  asRecord,
  getNumber,
  getString,
  getStringArray,
  getToolResultData,
  unwrapTruncatedToolPayload,
  type ToolResultRendererContext,
} from "./types";

const FRIENDLY_TOOL_TITLES: Readonly<Record<string, { readonly title: string; readonly kind: "style" | "mechanism" | "default" }>> = {
  style_manage: { title: "文风管理", kind: "style" },
  "style.manage": { title: "文风管理", kind: "style" },
  mechanism_distill: { title: "中观剧情机制卡拆解", kind: "mechanism" },
  "mechanism.distill": { title: "中观剧情机制卡拆解", kind: "mechanism" },
  skills_manage: { title: "写作技能管理", kind: "default" },
  "skills.manage": { title: "写作技能管理", kind: "default" },
};

function renderIcon(kind: "style" | "mechanism" | "default", isError: boolean) {
  if (isError) return <AlertCircle className="size-4 text-destructive" />;
  if (kind === "style") return <Scale className="size-4 text-primary" />;
  if (kind === "mechanism") return <Layers className="size-4 text-primary" />;
  return <FileText className="size-4 text-muted-foreground" />;
}

export function GenericToolResultRenderer({ toolName, result, onOpenArtifact }: ToolResultRendererContext) {
  const { unwrapped, isTruncated, fullLength, rawPreview } = unwrapTruncatedToolPayload(result);
  const root = unwrapped ?? asRecord(result);
  const data = asRecord(getToolResultData(result));
  const isError = root?.ok === false;

  const summary = (root ? getString(root.summary) : "")
    || (data ? getString(data.summary) || getString(data.message) : "")
    || (isError && root ? getString(root.error) : "");

  const explanation = asRecord(data?.explanation) ?? asRecord(root?.explanation);
  const nextHint = explanation ? getString(explanation.next) : "";

  const metaInfo = FRIENDLY_TOOL_TITLES[toolName];
  const displayTitle = metaInfo?.title ?? toolName;

  // 提取结构化亮点（机制卡名称、铁律条数、机械索引章节数、文风蒸馏批次进度等）
  const appliedRule = data ? getString(data.appliedRule) : "";
  const consolidatedRules = Array.isArray(data?.consolidatedRules) ? data.consolidatedRules : [];
  const extractedCards = Array.isArray(data?.extracted)
    ? data.extracted
    : Array.isArray(data?.cards)
      ? data.cards
      : [];
  const chapterCount = data ? getNumber(data.chapterCount) : null;
  const totalChars = data ? (getNumber(data.totalChars) ?? getNumber(data.totalCharCount)) : null;
  const recommendedObj = asRecord(data?.recommendedChapters);
  const recNums = Array.isArray(recommendedObj?.chapterNumbers) ? recommendedObj.chapterNumbers : [];
  const warnings = data ? getStringArray(data.warnings) : [];
  const jobObj = asRecord(data?.job);
  const batchesObj = asRecord(data?.batches);
  const batchTotal = batchesObj ? getNumber(batchesObj.total) : null;
  const batchDone = batchesObj ? getNumber(batchesObj.done) : null;
  const batchFailed = batchesObj ? getNumber(batchesObj.failed) : null;
  const batchPending = batchesObj ? getNumber(batchesObj.pending) : null;
  const batchFailures = Array.isArray(batchesObj?.failures) ? batchesObj.failures : [];
  const jobId = jobObj ? getString(jobObj.jobId) : "";
  const rawPayloadText = isTruncated && rawPreview
    ? rawPreview
    : JSON.stringify(unwrapped ?? result, null, 2);

  const hasRichSummary = Boolean(
    summary
    || appliedRule
    || consolidatedRules.length > 0
    || extractedCards.length > 0
    || chapterCount !== null
    || batchTotal !== null,
  );

  const badgeMeta = isTruncated && fullLength
    ? `长载荷 ${(fullLength / 1000).toFixed(1)} KB`
    : metaInfo
      ? toolName
      : undefined;

  return (
    <ToolResultSurface
      testId="tool-result-generic"
      title={displayTitle}
      icon={renderIcon(metaInfo?.kind ?? "default", isError)}
      meta={badgeMeta}
      footer={onOpenArtifact ? <ArtifactOpenButton result={result} onOpenArtifact={onOpenArtifact} /> : undefined}
    >
      {summary ? (
        <p className={`text-xs leading-relaxed ${isError ? "text-destructive" : "text-foreground"}`}>
          {summary}
          {isTruncated && !summary.endsWith("。") && !summary.endsWith("！") && !summary.endsWith(".") ? "…" : ""}
        </p>
      ) : null}

      {appliedRule && appliedRule !== summary ? (
        <div className="rounded-md border border-primary/25 bg-primary/5 px-2.5 py-1.5 text-xs text-foreground">
          <Feather className="mr-1 inline size-3 text-primary" />
          {appliedRule}
        </div>
      ) : null}

      {batchTotal !== null ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-2xs">
            {jobId && <Badge variant="outline" className="font-mono">{jobId}</Badge>}
            <Badge variant="secondary">
              批次 {(batchDone ?? 0) + (batchFailed ?? 0)}/{batchTotal}
            </Badge>
            {batchDone !== null && batchDone > 0 && <Badge variant="secondary">完成 {batchDone}</Badge>}
            {batchFailed !== null && batchFailed > 0 && <Badge variant="destructive">失败 {batchFailed}</Badge>}
            {batchPending !== null && batchPending > 0 && <Badge variant="outline">待处理 {batchPending}</Badge>}
          </div>
          {batchFailures.length > 0 ? (
            <ul className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-2xs text-destructive">
              {batchFailures.slice(0, 3).map((item, idx) => {
                const row = asRecord(item);
                const id = row ? getString(row.batchId) : "";
                const exp = row ? asRecord(row.explanation) : null;
                const what = exp ? getString(exp.what) : "";
                return what ? (
                  <li key={idx} className="break-words">
                    {id ? `${id}：` : ""}{what}
                  </li>
                ) : null;
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      {chapterCount !== null ? (
        <div className="flex flex-wrap items-center gap-1.5 text-2xs">
          <Badge variant="secondary">共 {chapterCount.toLocaleString("zh-CN")} 章</Badge>
          {totalChars !== null && <Badge variant="outline">{totalChars.toLocaleString("zh-CN")} 字</Badge>}
          {recNums.length > 0 && <Badge variant="outline">推荐高能章 {recNums.length} 章</Badge>}
        </div>
      ) : null}

      {consolidatedRules.length > 0 ? (
        <ul className="space-y-1 rounded-md border border-border/60 bg-muted/25 p-2 text-2xs text-foreground">
          {consolidatedRules.slice(0, 4).map((item, idx) => {
            const r = asRecord(item);
            const text = r ? getString(r.rule) : "";
            return text ? (
              <li key={idx} className="truncate">
                · {text}
              </li>
            ) : null;
          })}
          {consolidatedRules.length > 4 && (
            <li className="text-muted-foreground">…共 {consolidatedRules.length} 条执行铁律</li>
          )}
        </ul>
      ) : null}

      {extractedCards.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {extractedCards.slice(0, 6).map((item, idx) => {
            const c = asRecord(item);
            const name = c ? getString(c.name) : "";
            return name ? (
              <Badge key={idx} variant="secondary" className="max-w-full truncate text-2xs font-normal">
                {name}
              </Badge>
            ) : null;
          })}
          {extractedCards.length > 6 && (
            <Badge variant="outline" className="text-2xs">+{extractedCards.length - 6} 张</Badge>
          )}
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <p className="text-2xs text-muted-foreground">提示：{warnings[0]}</p>
      ) : null}

      {nextHint ? (
        <p className="text-2xs text-muted-foreground">建议：{nextHint}</p>
      ) : null}

      <details className="text-xs" open={!hasRichSummary}>
        <summary className="cursor-pointer select-none text-2xs text-muted-foreground hover:text-foreground">
          {isTruncated ? "查看原始返回字段（长载荷截断预览）" : "查看原始返回字段"}
        </summary>
        <pre className="mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/40 p-2 text-2xs text-foreground">
          {rawPayloadText}
        </pre>
      </details>
    </ToolResultSurface>
  );
}
