import { PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";

import { ToolResultSurface } from "./ToolResultSurface";
import { getNumber, getString, getToolResultArtifact, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

const ACTION_LABELS: Record<string, string> = {
  continue: "续写",
  polish: "润色",
  rewrite: "改写",
  expand: "扩写",
  compress: "精简",
};

function clip(text: string, limit = 400): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

/** chapter.propose_selection 的候选卡：候选不覆盖正文，作者从「在正文里审阅」进入编辑器对照。 */
export const SelectionCandidateCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const artifact = getToolResultArtifact(context.result);
  if (!artifact || artifact.kind !== "selection-candidate") return null;

  const chapterNumber = getNumber(artifact.chapterNumber);
  const action = getString(artifact.action);
  const actionLabel = ACTION_LABELS[action] ?? (action || "改写");
  const sourceText = getString(artifact.sourceText);
  const candidateText = getString(artifact.candidateText);

  return (
    <ToolResultSurface
      testId="tool-result-selection-candidate"
      title={<>选区{actionLabel}候选{chapterNumber ? ` · 第${chapterNumber}章` : ""}</>}
      icon={<PenLine className="size-4 text-primary" />}
      meta="确认前不会覆盖正文"
    >
      {sourceText && (
        <div>
          <p className="text-2xs text-muted-foreground">原文</p>
          <p className="mt-0.5 max-h-24 overflow-y-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs" data-testid="selection-candidate-card-source">
            {clip(sourceText)}
          </p>
        </div>
      )}
      {candidateText && (
        <div>
          <p className="text-2xs text-muted-foreground">候选（{action === "continue" ? "接在原文之后" : "替换原文"}）</p>
          <p className="mt-0.5 max-h-24 overflow-y-auto whitespace-pre-wrap rounded bg-primary/10 p-2 text-xs" data-testid="selection-candidate-card-text">
            {clip(candidateText, 600)}
          </p>
        </div>
      )}
      {context.onOpenArtifact ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-2xs text-muted-foreground">在正文中查看对照后，决定应用或放弃。</p>
          <Button size="sm" onClick={() => context.onOpenArtifact!(artifact)} data-testid="selection-candidate-open">
            在正文里审阅
          </Button>
        </div>
      ) : null}
    </ToolResultSurface>
  );
};
