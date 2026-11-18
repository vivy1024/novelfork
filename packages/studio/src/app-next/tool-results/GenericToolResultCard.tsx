import { AlertCircle, Compass, Feather, FileText, Layers, Scale } from "lucide-react";

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

const FRIENDLY_TOOL_TITLES: Readonly<Record<string, { readonly title: string; readonly kind: "style" | "mechanism" | "index" | "default" }>> = {
  style_consolidate: { title: "文风铁律提纯与负反馈", kind: "style" },
  "style.consolidate": { title: "文风铁律提纯与负反馈", kind: "style" },
  mechanism_distill: { title: "中观剧情机制卡拆解", kind: "mechanism" },
  "mechanism.distill": { title: "中观剧情机制卡拆解", kind: "mechanism" },
  style_distill_index: { title: "参考书零消耗机械索引", kind: "index" },
  "style.distill_index": { title: "参考书零消耗机械索引", kind: "index" },
  style_distill_preview: { title: "文风抽样范围预览", kind: "index" },
  "style.distill_preview": { title: "文风抽样范围预览", kind: "index" },
  style_distill_start: { title: "文风蒸馏抽取", kind: "style" },
  "style.distill_start": { title: "文风蒸馏抽取", kind: "style" },
  style_distill_status: { title: "文风蒸馏进度", kind: "style" },
  "style.distill_status": { title: "文风蒸馏进度", kind: "style" },
  style_distill_adopt: { title: "采纳文风规则与范文", kind: "style" },
  "style.distill_adopt": { title: "采纳文风规则与范文", kind: "style" },
  skills_check_compliance: { title: "写作技能合规检查", kind: "default" },
  "skills.check_compliance": { title: "写作技能合规检查", kind: "default" },
  skills_recommend: { title: "写作技能推荐", kind: "default" },
  "skills.recommend": { title: "写作技能推荐", kind: "default" },
};

function renderIcon(kind: "style" | "mechanism" | "index" | "default", isError: boolean) {
  if (isError) return <AlertCircle className="size-4 text-destructive" />;
  if (kind === "style") return <Scale className="size-4 text-primary" />;
  if (kind === "mechanism") return <Layers className="size-4 text-primary" />;
  if (kind === "index") return <Compass className="size-4 text-primary" />;
  return <FileText className="size-4 text-muted-foreground" />;
}

export function GenericToolResultRenderer({ toolName, result, onOpenArtifact }: ToolResultRendererContext) {
  const { unwrapped, isTruncated, fullLength } = unwrapTruncatedToolPayload(result);
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

  // 提取结构化亮点（机制卡名称、铁律条数、机械索引章节数、负反馈置顶规则等）
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

  const hasRichSummary = Boolean(
    summary
    || appliedRule
    || consolidatedRules.length > 0
    || extractedCards.length > 0
    || chapterCount !== null,
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
          查看原始返回字段
        </summary>
        <pre className="mt-1.5 max-h-60 overflow-auto rounded-md border border-border/60 bg-muted/40 p-2 text-2xs text-foreground">
          {JSON.stringify(unwrapped ?? result, null, 2)}
        </pre>
      </details>
    </ToolResultSurface>
  );
}
