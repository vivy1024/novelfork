import { useState } from "react";
import { ClipboardCheck, FileSearch, Globe, Link2, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { SecondaryModelCalls } from "./SecondaryModelCalls";
import { ToolResultSurface } from "./ToolResultSurface";
import {
  asRecord,
  getNumber,
  getString,
  getStringArray,
  getToolResultData,
  type ToolResultAction,
  type ToolResultRenderer,
  type ToolResultRendererContext,
} from "./types";

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function names(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      const record = asRecord(item);
      if (record) {
        const name = getString(record.name) || getString(record.title) || getString(record.summary);
        return name ? [name] : [];
      }
      return typeof item === "string" && item.trim() ? [item.trim()] : [];
    })
    .slice(0, limit);
}

function StatRow({ icon: Icon, label, count, samples }: {
  icon: typeof Users;
  label: string;
  count: number;
  samples: readonly string[];
}) {
  if (count === 0) return null;
  return (
    <li className="flex items-start gap-1.5 text-xs">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <span className="text-foreground">{label} {count}</span>
        {samples.length > 0 && (
          <span className="ml-1 text-muted-foreground">{samples.join("、")}{count > samples.length ? " …" : ""}</span>
        )}
      </div>
    </li>
  );
}

interface StagingCandidate {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly status: string;
  readonly duplicateCount: number;
}

function readStagingCandidates(value: unknown): StagingCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const id = getString(record.id).trim();
    const title = getString(record.proposedTitle).trim() || getString(record.title).trim();
    if (!id || !title) return [];
    return [{
      id,
      title,
      kind: getString(record.kind) || getString(record.category) || "setting",
      status: getString(record.status, "needs-review"),
      duplicateCount: Array.isArray(record.duplicateCandidates) ? record.duplicateCandidates.length : 0,
    }];
  });
}

type CandidateDecisionState =
  | { readonly status: "idle" }
  | { readonly status: "pending"; readonly decision: "promote" | "reject" }
  | { readonly status: "done"; readonly decision: "promote" | "reject"; readonly summary: string }
  | { readonly status: "error"; readonly message: string };

function errorMessageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "操作失败，请重试。";
}

function summaryOf(value: unknown, fallback: string): string {
  const record = asRecord(value);
  const summary = getString(record?.summary).trim();
  return summary || fallback;
}

function StagingCandidateList({
  candidates,
  onAction,
}: {
  readonly candidates: readonly StagingCandidate[];
  readonly onAction?: (action: ToolResultAction) => Promise<unknown> | unknown;
}) {
  const [states, setStates] = useState<Record<string, CandidateDecisionState>>({});

  const run = async (candidate: StagingCandidate, decision: "promote" | "reject") => {
    if (!onAction) return;
    setStates((current) => ({ ...current, [candidate.id]: { status: "pending", decision } }));
    try {
      const result = await onAction({
        type: "lore.write.staging",
        toolName: "lore.write",
        input: {
          stagingId: candidate.id,
          stagingDecision: decision,
          title: candidate.title,
        },
      });
      setStates((current) => ({
        ...current,
        [candidate.id]: {
          status: "done",
          decision,
          summary: summaryOf(result, decision === "promote" ? `已提升「${candidate.title}」。` : `已拒绝「${candidate.title}」。`),
        },
      }));
    } catch (error) {
      setStates((current) => ({
        ...current,
        [candidate.id]: { status: "error", message: errorMessageOf(error) },
      }));
    }
  };

  return (
    <ul className="flex flex-col gap-2" data-testid="book-dissect-staging-list">
      {candidates.map((candidate) => {
        const state = states[candidate.id] ?? { status: "idle" as const };
        const pending = state.status === "pending";
        const done = state.status === "done";
        return (
          <li key={candidate.id} className="flex flex-col gap-1 rounded-md border border-border/60 p-2" data-testid={`book-dissect-staging-${candidate.id}`}>
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs text-foreground">{candidate.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {candidate.kind}
                  {candidate.duplicateCount > 0 ? ` · ${candidate.duplicateCount} 条疑似重复` : ""}
                </p>
              </div>
              {done ? (
                <Badge variant="outline">{state.decision === "promote" ? "已提升" : "已拒绝"}</Badge>
              ) : (
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    size="xs"
                    disabled={!onAction || pending}
                    data-testid={`book-dissect-promote-${candidate.id}`}
                    onClick={() => void run(candidate, "promote")}
                  >
                    {pending && state.decision === "promote" ? "提升中…" : "提升"}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="destructive"
                    disabled={!onAction || pending}
                    data-testid={`book-dissect-reject-${candidate.id}`}
                    onClick={() => void run(candidate, "reject")}
                  >
                    {pending && state.decision === "reject" ? "拒绝中…" : "拒绝"}
                  </Button>
                </div>
              )}
            </div>
            {done && <p className="text-[11px] text-muted-foreground">{state.summary}</p>}
            {state.status === "error" && <p className="text-[11px] text-destructive">{state.message}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function BookDissectCardView({
  data,
  onAction,
}: {
  readonly data: Record<string, unknown>;
  readonly onAction?: ToolResultRendererContext["onAction"];
}) {
  const knowledge = asRecord(data.knowledge) ?? asRecord(data.draft);
  const fromChapter = getNumber(data.fromChapter);
  const toChapter = getNumber(data.toChapter);
  const applied = data.applied === true;
  const settled = data.settled === true;
  const summary = getString(data.summary);
  const characterCount = countOf(knowledge?.characterCards) || getStringArray(knowledge?.characters).length;
  const worldCount = countOf(knowledge?.worldElements);
  const hookCount = countOf(knowledge?.openHooks) || getStringArray(knowledge?.hooks).length;
  const summaryCount = countOf(knowledge?.detailedSummaries) || countOf(knowledge?.chapterSummaries);
  const suggestedFocus = getString(knowledge?.suggestedFocus);
  const range = fromChapter && toChapter ? `第 ${fromChapter}–${toChapter} 章` : undefined;
  const staging = readStagingCandidates(data.staging);
  const pendingStaging = staging.filter((item) => item.status === "needs-review" || !item.status);

  return (
    <ToolResultSurface
      testId="tool-result-book-dissect"
      title="拆书结果"
      icon={<FileSearch className="size-4 text-primary" />}
      meta={range}
    >
      <ul className="flex flex-col gap-1">
        <StatRow icon={Users} label="人物" count={characterCount} samples={names(knowledge?.characterCards, 4).length > 0 ? names(knowledge?.characterCards, 4) : getStringArray(knowledge?.characters).slice(0, 4)} />
        <StatRow icon={Globe} label="世界设定" count={worldCount} samples={names(knowledge?.worldElements, 3)} />
        <StatRow icon={Link2} label="未收伏笔" count={hookCount} samples={names(knowledge?.openHooks, 2).length > 0 ? names(knowledge?.openHooks, 2) : getStringArray(knowledge?.hooks).slice(0, 2)} />
        <StatRow icon={ClipboardCheck} label="章摘要" count={summaryCount} samples={[]} />
      </ul>

      {suggestedFocus && (
        <p className="text-xs text-muted-foreground">建议下一步焦点：<span className="text-foreground">{suggestedFocus}</span></p>
      )}

      <Separator />
      <div className="flex flex-col gap-2 text-xs text-muted-foreground">
        {applied ? (
          pendingStaging.length > 0 ? (
            <>
              <p>
                已写入拆书暂存 <Badge variant="outline">needs-review（待确认）</Badge>
                {pendingStaging.length} 条。点提升才进正式经纬，点拒绝则丢弃；脏候选不会进入写作召回。
              </p>
              <StagingCandidateList candidates={pendingStaging} onAction={onAction} />
              {!onAction && <p>当前面板未绑定书籍，无法直接确认，请在作品叙述者里操作。</p>}
            </>
          ) : (
            <p>
              已写入拆书暂存，状态为 <Badge variant="outline">needs-review（待确认）</Badge>。
              用 lore.write 确认提升后才进正式经纬；脏候选不会进入写作召回。
            </p>
          )
        ) : (
          <p>仅预览，未写入暂存。确认后用 book.dissect(apply=true) 落入 dissection_staging。</p>
        )}
        {settled && <p>已同时结算叙事记忆。</p>}
        {summary && <p>{summary}</p>}
      </div>

      <SecondaryModelCalls value={data.modelCalls} />
    </ToolResultSurface>
  );
}

/** book.dissect 采纳卡：抽取结果落在 dissection_staging，确认后才经 lore.write 提升。 */
export const BookDissectCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const data = asRecord(getToolResultData(context.result));
  if (!data) return null;
  return <BookDissectCardView data={data} onAction={context.onAction} />;
};
