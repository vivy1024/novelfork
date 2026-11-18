import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Workflow,
  XCircle,
} from "lucide-react";

import type { NovelWorkflowRecipe } from "../../engine/workflows/novel-workflows.js";
import type { WorkflowGraphEdge, WorkflowGraphNode } from "../../engine/workflows/workflow-graph.js";
import { OutlineCandidatePreview } from "../workflows/OutlineCandidatePreview";
import { compactedProsePreview } from "../workflows/WorkflowRunsPanel";
import { writesChapter } from "../workflows/workflow-step-list-model";
import { buildWorkflowKickoffMessage } from "./WorkflowTimelinePanel";

export interface InlineWorkflowRunBarProps {
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly narratorId?: string;
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
  readonly onOpenFullWorkflowStudio?: () => void;
  readonly onChapterCommitted?: () => void;
  /** 无活跃工作流运行时，是否渲染一行紧凑的「用本书默认工作流跑本章」快捷启动条（默认 false，无活跃运行时返回 null）。 */
  readonly showLauncherWhenIdle?: boolean;
}

type RunStatus = "running" | "awaiting_approval" | "blocked" | "done" | "cancelled";
type StepStatus = "pending" | "running" | "awaiting_approval" | "done" | "skipped" | "bypassed" | "failed";

interface Explanation {
  readonly what: string;
  readonly why: string;
  readonly action: string;
}

interface RunStepView {
  readonly stepId: string;
  readonly ordinal: number;
  readonly label: string;
  readonly status: StepStatus;
  readonly attempt: number;
  readonly executorKind: "narrator" | "subagent" | "domain-tool" | "manual-gate";
  readonly agentId?: string;
  readonly requiresApproval: boolean;
  readonly tools?: readonly string[];
  readonly expectedOutput: "scene-spec" | "prose" | "audit" | "outline" | "other" | null;
  readonly outcome?: string;
  readonly note?: Explanation;
}

interface RunSummaryView {
  readonly id: string;
  readonly chapterNumber: number;
  readonly recipeName: string;
  readonly status: RunStatus;
  readonly currentStepId: string | null;
  readonly revision: number;
  readonly updatedAt: number;
}

interface CandidateView {
  readonly id: string;
  readonly stepId: string;
  readonly kind: "scene-spec" | "prose" | "audit" | "outline" | "other";
  readonly payload: unknown;
  readonly validation: unknown;
  readonly decision: "pending" | "approved" | "rejected";
}

interface RunDetailView {
  readonly run: RunSummaryView & { readonly steps: readonly RunStepView[] };
  readonly graph?: {
    readonly nodes: readonly WorkflowGraphNode[];
    readonly edges: readonly WorkflowGraphEdge[];
  };
  readonly candidates: readonly CandidateView[];
}

const ACTIVE_STATUSES: readonly RunStatus[] = ["running", "awaiting_approval", "blocked"];
const POLL_INTERVAL_MS = 3000;

const RUN_STATUS_BADGE: Record<RunStatus, { label: string; cls: string }> = {
  running: { label: "执行中", cls: "border-primary/40 bg-primary/10 text-primary" },
  awaiting_approval: { label: "待你确认", cls: "border-warning/50 bg-warning/12 text-warning" },
  blocked: { label: "工序受阻", cls: "border-destructive/45 bg-destructive/10 text-destructive" },
  done: { label: "已完成", cls: "border-success/40 bg-success/10 text-success" },
  cancelled: { label: "已取消", cls: "border-border bg-muted text-muted-foreground" },
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as { summary?: string } | null;
  if (!res.ok) {
    throw new Error(body?.summary ?? `请求失败：HTTP ${res.status}`);
  }
  return body as T;
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function StepPillGlyph({ status }: { status: StepStatus }) {
  switch (status) {
    case "done":
      return <span className="text-success" aria-hidden="true">✓</span>;
    case "running":
      return <Loader2 className="size-3 animate-spin text-primary" />;
    case "awaiting_approval":
      return <Pause className="size-3 text-warning" />;
    case "failed":
      return <XCircle className="size-3 text-destructive" />;
    default:
      return <span className="text-muted-foreground/60" aria-hidden="true">○</span>;
  }
}

function CompactCandidateSummary({ candidate }: { candidate: CandidateView }) {
  const payload = record(candidate.payload) ?? {};
  const validation = record(candidate.validation) ?? {};

  if (candidate.kind === "prose") {
    const title = typeof payload.title === "string" ? payload.title : "";
    const content = typeof payload.content === "string" ? payload.content : compactedProsePreview(payload);
    return (
      <div className="space-y-1">
        <div className="text-2xs text-muted-foreground">
          正文候选{title ? `「${title}」` : ""}
          {typeof validation.wordCount === "number" ? ` · ${validation.wordCount} 字` : ""}
          {typeof validation.wordTarget === "number" ? ` / 目标 ${validation.wordTarget} 字` : ""}
        </div>
        <div className="max-h-44 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-background p-2 text-xs leading-relaxed">
          {content}
        </div>
      </div>
    );
  }
  if (candidate.kind === "outline") {
    return <OutlineCandidatePreview payload={payload} />;
  }
  if (candidate.kind === "scene-spec") {
    const spec = record(payload.sceneSpec) ?? payload;
    const scenes = Array.isArray(spec.scenes) ? (spec.scenes.map(record).filter(Boolean) as Record<string, unknown>[]) : [];
    return (
      <ol className="space-y-1 text-2xs">
        {scenes.map((scene, index) => (
          <li key={index} className="rounded border border-border bg-background px-2 py-1.5">
            <span className="font-semibold text-foreground">场 {index + 1}</span>
            {typeof scene.location === "string" ? ` · ${scene.location}` : ""}
            {typeof scene.conflict === "string" ? ` · 冲突：${scene.conflict}` : ""}
            {typeof scene.outcome === "string" ? ` · 结果：${scene.outcome}` : ""}
          </li>
        ))}
      </ol>
    );
  }
  if (candidate.kind === "audit") {
    const issues = Array.isArray(payload.issues) ? (payload.issues.map(record).filter(Boolean) as Record<string, unknown>[]) : [];
    return (
      <div className="space-y-1 text-2xs">
        <div className={payload.passed === true ? "font-medium text-success" : "font-medium text-destructive"}>
          {payload.passed === true ? "审查通过" : "审查发现问题"}
          {typeof payload.summary === "string" && payload.summary ? `：${payload.summary}` : ""}
        </div>
        {issues.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
            {issues.slice(0, 5).map((issue, idx) => (
              <li key={idx}>[{String(issue.severity ?? "info")}] {String(issue.description ?? "")}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  return (
    <div className="whitespace-pre-wrap rounded border border-border bg-background p-2 text-2xs">
      {typeof payload.summary === "string" ? payload.summary : JSON.stringify(payload)}
    </div>
  );
}

/**
 * 写正文画布与 AI 写章筹备台共用的内嵌工作流实时状态条。
 * - 有匹配本章（或当前活跃）的工作流运行时：实时展示工序胶囊链，支持原地展开候选并「批准继续 / 打回重做 / 重试 / 跳过」，免切去工作流全屏页；
 * - 无活跃运行且 `showLauncherWhenIdle` 为 true 时：提供紧凑的「用默认工作流跑本章」一键启动入口。
 */
export function InlineWorkflowRunBar({
  bookId,
  chapterNumber,
  narratorId,
  onSendToNarrator,
  onOpenFullWorkflowStudio,
  onChapterCommitted,
  showLauncherWhenIdle = false,
}: InlineWorkflowRunBarProps) {
  const [detail, setDetail] = useState<RunDetailView | null>(null);
  const [defaultRecipe, setDefaultRecipe] = useState<NovelWorkflowRecipe | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const prevStatusRef = useRef<RunStatus | null>(null);
  const base = `/api/books/${encodeURIComponent(bookId)}`;

  const matchesChapter = useCallback(
    (ch: number) => (typeof chapterNumber === "number" ? ch === chapterNumber : true),
    [chapterNumber],
  );

  const loadActiveRun = useCallback(
    async (signal?: AbortSignal) => {
      if (!bookId) {
        setDetail(null);
        return;
      }
      const runsUrl = narratorId
        ? `${base}/workflow-runs?narratorId=${encodeURIComponent(narratorId)}`
        : `${base}/workflow-runs`;
      const runsResp = (await fetch(runsUrl, { signal })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)) as { active?: RunDetailView | null; recent?: RunSummaryView[] } | null;
      if (signal?.aborted) return;

      if (
        runsResp?.active &&
        ACTIVE_STATUSES.includes(runsResp.active.run.status) &&
        matchesChapter(runsResp.active.run.chapterNumber)
      ) {
        setDetail(runsResp.active);
        return;
      }

      const matchedSummary = (runsResp?.recent ?? []).find(
        (r) => ACTIVE_STATUSES.includes(r.status) && matchesChapter(r.chapterNumber),
      );
      if (matchedSummary) {
        const fetchedDetail = await requestJson<RunDetailView>(
          `${base}/workflow-runs/${encodeURIComponent(matchedSummary.id)}`,
          { signal },
        ).catch(() => null);
        if (!signal?.aborted) {
          setDetail(fetchedDetail);
        }
        return;
      }

      setDetail(null);

      if (showLauncherWhenIdle) {
        const [recipesData, defData] = await Promise.all([
          fetch(`${base}/workflow-recipes`, { signal })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null) as Promise<{ recipes?: readonly NovelWorkflowRecipe[] } | null>,
          fetch(`${base}/workflow-default`, { signal })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null) as Promise<{ recipeId?: string | null } | null>,
        ]);
        if (signal?.aborted) return;
        const published = (recipesData?.recipes ?? []).filter((r) => r.status === "published" && r.revision > 0);
        const preferred =
          (defData?.recipeId ? published.find((r) => r.id === defData.recipeId) : undefined) ?? published[0] ?? null;
        setDefaultRecipe(preferred);
      }
    },
    [base, bookId, matchesChapter, narratorId, showLauncherWhenIdle],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadActiveRun(controller.signal);
    return () => controller.abort();
  }, [loadActiveRun]);

  // 当活跃运行存在时，每 3 秒轮询一次最新详情
  const activeRunId = detail && ACTIVE_STATUSES.includes(detail.run.status) ? detail.run.id : null;
  useEffect(() => {
    if (!activeRunId) return;
    const timer = setInterval(() => {
      void requestJson<RunDetailView>(`${base}/workflow-runs/${encodeURIComponent(activeRunId)}`)
        .then((next) => {
          if (!next?.run) return;
          if (next.run.status === "done" && prevStatusRef.current !== "done") {
            onChapterCommitted?.();
          }
          prevStatusRef.current = next.run.status;
          if (ACTIVE_STATUSES.includes(next.run.status)) {
            setDetail(next);
          } else {
            setDetail(null);
          }
        })
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [activeRunId, base, onChapterCommitted]);

  // 进入待确认或受阻态时默认自动展开，方便作者第一时间原地决策
  useEffect(() => {
    if (detail?.run.status === "awaiting_approval" || detail?.run.status === "blocked") {
      setExpanded(true);
    }
  }, [detail?.run.id, detail?.run.status]);

  const attentionSteps = useMemo(() => {
    if (!detail) return [];
    return detail.run.steps.filter(
      (step) => step.status === (detail.run.status === "blocked" ? "failed" : "awaiting_approval"),
    );
  }, [detail]);

  const candidateOf = useCallback(
    (stepId: string) =>
      detail
        ? [...detail.candidates].reverse().find((c) => c.stepId === stepId && c.decision === "pending")
        : undefined,
    [detail],
  );

  const rejectTargetOf = useCallback(
    (stepId: string) => {
      const edge = detail?.graph?.edges.find((e) => e.kind === "reject" && e.source === stepId);
      return edge ? detail?.graph?.nodes.find((n) => n.id === edge.target)?.label ?? edge.target : undefined;
    },
    [detail],
  );

  const runMutation = async (fn: () => Promise<RunDetailView>, wakeAfter = false) => {
    setBusy(true);
    setErrorText(null);
    try {
      const next = await fn();
      setRejectNotes({});
      if (next.run.status === "done") {
        onChapterCommitted?.();
        setDetail(null);
      } else {
        setDetail(next);
        if (wakeAfter && next.run.status === "running" && onSendToNarrator) {
          await onSendToNarrator(buildWorkflowKickoffMessage(next.run.recipeName, next.run.chapterNumber));
        }
      }
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "工作流操作失败");
      void loadActiveRun();
    } finally {
      setBusy(false);
    }
  };

  const handleQuickStartDefault = async () => {
    const targetCh = chapterNumber ?? 1;
    if (!defaultRecipe || !narratorId) {
      setErrorText(!narratorId ? "请先打开右侧本书叙述者对话后再启动工作流。" : "当前暂无已发布的可用工作流方案。");
      return;
    }
    await runMutation(
      () =>
        postJson<RunDetailView>(`${base}/workflow-runs`, {
          recipeId: defaultRecipe.id,
          chapterNumber: targetCh,
          narratorId,
        }),
      true,
    );
  };

  if (!detail || !ACTIVE_STATUSES.includes(detail.run.status)) {
    if (!showLauncherWhenIdle) return null;
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card/85 px-3 py-2 text-xs"
        data-testid="inline-workflow-run-bar"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="size-3.5 shrink-0 text-primary" />
          <span className="font-medium text-foreground">章节工作流流水线</span>
          <span className="truncate text-2xs text-muted-foreground">
            {defaultRecipe
              ? `默认方案「${defaultRecipe.name}」· 按工序闸门自动推进预检、蓝图、起草与审计`
              : "可在工作流画布配置多工序写作流水线"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {errorText ? <span className="text-2xs text-destructive">{errorText}</span> : null}
          {defaultRecipe ? (
            <button
              type="button"
              disabled={busy || !narratorId}
              title={!narratorId ? "请先开启右侧本书叙述者会话" : undefined}
              onClick={() => void handleQuickStartDefault()}
              data-testid="inline-workflow-quick-start"
              className="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-2xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Play className="size-3 fill-current" />
              用默认工作流跑本章
            </button>
          ) : null}
          {onOpenFullWorkflowStudio ? (
            <button
              type="button"
              onClick={onOpenFullWorkflowStudio}
              className="inline-flex items-center gap-0.5 rounded border border-border px-2 py-1 text-2xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              打开工作流画布
              <ArrowUpRight className="size-3" />
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const badge = RUN_STATUS_BADGE[detail.run.status];
  const runPath = `${base}/workflow-runs/${encodeURIComponent(detail.run.id)}`;
  const revision = detail.run.revision;

  return (
    <div
      className="shrink-0 border-b border-border bg-card/90 px-3 py-2 text-xs"
      data-testid="inline-workflow-run-bar"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Workflow className="size-3.5 shrink-0 text-primary" />
          <span className="font-semibold text-foreground">
            {detail.run.recipeName} · 第 {detail.run.chapterNumber} 章
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-2xs font-medium ${badge.cls}`}>
            {badge.label}
          </span>
          <div className="flex flex-wrap items-center gap-1" aria-label="工作流步骤进度">
            {detail.run.steps.map((step, idx) => (
              <span key={step.stepId} className="inline-flex items-center gap-1 text-2xs">
                {idx > 0 ? <span className="text-muted-foreground/50">→</span> : null}
                <span
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
                    step.status === "awaiting_approval"
                      ? "bg-warning/15 font-semibold text-warning"
                      : step.status === "failed"
                        ? "bg-destructive/12 font-semibold text-destructive"
                        : step.status === "running"
                          ? "bg-primary/10 font-medium text-primary"
                          : step.status === "done"
                            ? "text-foreground"
                            : "text-muted-foreground"
                  }`}
                >
                  <StepPillGlyph status={step.status} />
                  <span>{step.label}</span>
                </span>
              </span>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {(attentionSteps.length > 0 || detail.run.status === "running") ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              data-testid="inline-workflow-toggle-detail"
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-2xs text-foreground hover:bg-muted"
            >
              {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              <span>{expanded ? "收起详情" : attentionSteps.length > 0 ? "原地审批 / 处理" : "查看进度"}</span>
            </button>
          ) : null}
          {onOpenFullWorkflowStudio ? (
            <button
              type="button"
              onClick={onOpenFullWorkflowStudio}
              data-testid="inline-workflow-open-studio"
              className="inline-flex items-center gap-0.5 rounded px-2 py-0.5 text-2xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              打开完整工作流画布
              <ArrowUpRight className="size-3" />
            </button>
          ) : null}
        </div>
      </div>

      {errorText ? (
        <div role="alert" className="mt-1.5 flex items-center gap-1.5 text-2xs text-destructive">
          <AlertCircle className="size-3.5 shrink-0" />
          <span>{errorText}</span>
        </div>
      ) : null}

      {expanded ? (
        <div className="mt-2 space-y-2 border-t border-border/70 pt-2">
          {detail.run.status === "running" && attentionSteps.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/70 bg-muted/25 px-2.5 py-1.5 text-2xs text-muted-foreground">
              <span>
                右侧叙述者正在自动推进当前工序
                {detail.run.steps
                  .filter((s) => s.status === "running")
                  .map((s) => `「${s.label}」`)
                  .join("、")}
                ，无需离开当前写作页。
              </span>
              {onSendToNarrator ? (
                <button
                  type="button"
                  onClick={() =>
                    void onSendToNarrator(
                      buildWorkflowKickoffMessage(detail.run.recipeName, detail.run.chapterNumber),
                    )
                  }
                  className="rounded border border-border bg-background px-2 py-0.5 text-foreground hover:bg-muted"
                >
                  提醒叙述者继续
                </button>
              ) : null}
            </div>
          ) : null}

          {attentionSteps.map((step) => {
            const candidate = candidateOf(step.stepId);
            const rejectTarget = rejectTargetOf(step.stepId);
            const isGate = step.executorKind === "manual-gate";
            const canReject = !isGate || rejectTarget !== undefined;
            const noteVal = rejectNotes[step.stepId] ?? "";

            if (step.status === "failed") {
              const mustNotSkip = writesChapter(step);
              return (
                <div
                  key={step.stepId}
                  className="space-y-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2.5"
                  data-testid="inline-workflow-blocked-card"
                >
                  <div className="text-xs font-medium text-destructive">工序「{step.label}」受阻</div>
                  {step.note ? (
                    <div className="text-2xs text-muted-foreground">
                      {step.note.what}（原因：{step.note.why} · 建议：{step.note.action}）
                    </div>
                  ) : null}
                  {mustNotSkip ? (
                    <input
                      type="text"
                      aria-label="打回重写意见"
                      placeholder="写明正文需修改之处，打回给叙述者重写…"
                      value={noteVal}
                      onChange={(e) => setRejectNotes((prev) => ({ ...prev, [step.stepId]: e.target.value }))}
                      className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
                    />
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runMutation(
                          () => postJson<RunDetailView>(`${runPath}/retry`, { expectedRevision: revision, stepId: step.stepId }),
                          true,
                        )
                      }
                      data-testid="inline-workflow-retry-btn"
                      className="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-2xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      <RotateCcw className="size-3" />
                      重试
                    </button>
                    {mustNotSkip ? (
                      <button
                        type="button"
                        disabled={busy || !noteVal.trim()}
                        onClick={() =>
                          void runMutation(
                            () =>
                              postJson<RunDetailView>(
                                `${runPath}/steps/${encodeURIComponent(step.stepId)}/reject`,
                                { expectedRevision: revision, note: noteVal.trim() },
                              ),
                            true,
                          )
                        }
                        className="inline-flex items-center gap-1 rounded border border-border bg-background px-2.5 py-1 text-2xs hover:bg-muted disabled:opacity-50"
                      >
                        <RotateCcw className="size-3" />
                        打回重写
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void runMutation(
                            () => postJson<RunDetailView>(`${runPath}/skip`, { expectedRevision: revision, stepId: step.stepId }),
                            true,
                          )
                        }
                        data-testid="inline-workflow-skip-btn"
                        className="inline-flex items-center gap-1 rounded border border-border bg-background px-2.5 py-1 text-2xs hover:bg-muted disabled:opacity-50"
                      >
                        <SkipForward className="size-3" />
                        跳过
                      </button>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={step.stepId}
                className="space-y-2 rounded-md border border-warning/50 bg-warning/5 p-2.5"
                data-testid="inline-workflow-approval-card"
              >
                <div className="text-xs font-medium text-foreground">
                  {isGate ? `人工门禁「${step.label}」待放行` : `「${step.label}」已提交候选，待你原地确认`}
                </div>
                {candidate ? <CompactCandidateSummary candidate={candidate} /> : null}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void runMutation(
                        () =>
                          postJson<RunDetailView>(
                            `${runPath}/steps/${encodeURIComponent(step.stepId)}/approve`,
                            { expectedRevision: revision },
                          ),
                        true,
                      )
                    }
                    data-testid="inline-workflow-approve-btn"
                    className="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-2xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    <CheckCircle2 className="size-3" />
                    批准继续
                  </button>
                  {canReject ? (
                    <>
                      <input
                        type="text"
                        aria-label="打回修改意见"
                        placeholder={rejectTarget ? `填写修改意见后打回到「${rejectTarget}」…` : "填写修改意见后打回重做…"}
                        value={noteVal}
                        onChange={(e) => setRejectNotes((prev) => ({ ...prev, [step.stepId]: e.target.value }))}
                        className="min-w-48 flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
                      />
                      <button
                        type="button"
                        disabled={busy || !noteVal.trim()}
                        onClick={() =>
                          void runMutation(
                            () =>
                              postJson<RunDetailView>(
                                `${runPath}/steps/${encodeURIComponent(step.stepId)}/reject`,
                                { expectedRevision: revision, note: noteVal.trim() },
                              ),
                            true,
                          )
                        }
                        data-testid="inline-workflow-reject-btn"
                        className="inline-flex items-center gap-1 rounded border border-border bg-background px-2.5 py-1 text-2xs hover:bg-muted disabled:opacity-50"
                      >
                        <RotateCcw className="size-3" />
                        {rejectTarget ? `打回到「${rejectTarget}」` : "打回重做"}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
