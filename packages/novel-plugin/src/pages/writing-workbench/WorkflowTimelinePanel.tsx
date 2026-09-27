import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SkipForward,
  Workflow,
  XCircle,
} from "lucide-react";
import type { NovelWorkflowRecipe } from "../../engine/workflows/novel-workflows.js";
import { stepNodes, topologicalOrder } from "../../engine/workflows/workflow-graph.js";

export interface WorkflowTimelinePanelProps {
  bookId: string;
  currentChapter?: number;
  /** 当前打开的本书叙述者会话；工作流约束作用在它身上。没有时不能启动。 */
  narratorId?: string;
  /** 启动后给叙述者发一句开工提示（工序简报本身由系统注入，不走这里）。 */
  onSendToNarrator?: (message: string) => Promise<void> | void;
}

// ─── 接口数据形状（与 routes/workflow-runs.ts 的序列化一致） ─────────────────

type RunStatus = "running" | "awaiting_approval" | "blocked" | "done" | "cancelled";
type StepStatus = "pending" | "running" | "awaiting_approval" | "done" | "skipped" | "failed";

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
  readonly expectedOutput: "scene-spec" | "prose" | "audit" | "other" | null;
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
  readonly kind: "scene-spec" | "prose" | "audit" | "other";
  readonly payload: unknown;
  readonly validation: unknown;
  readonly decision: "pending" | "approved" | "rejected";
  readonly reviewerNote?: string;
  readonly committedRef?: string;
}

interface RunDetailView {
  readonly run: RunSummaryView & { readonly steps: readonly RunStepView[] };
  readonly brief: string | null;
  readonly candidates: readonly CandidateView[];
}

const POLL_INTERVAL_MS = 2500;
const ACTIVE_STATUSES: readonly RunStatus[] = ["running", "awaiting_approval", "blocked"];

const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: "执行中",
  awaiting_approval: "等待你确认",
  blocked: "受阻",
  done: "已完成",
  cancelled: "已取消",
};

/** 开工提示：只是一句触发，不复述工序——工序简报由产品在系统层注入，并随工序推进更新。 */
/** 方案里的工序，按正向流程的先后排列。 */
function orderedSteps(recipe: NovelWorkflowRecipe) {
  const order = topologicalOrder(recipe) ?? recipe.nodes.map((node) => node.id);
  const steps = stepNodes(recipe);
  return order.map((id) => steps.find((step) => step.id === id)).filter((step): step is (typeof steps)[number] => step !== undefined);
}

export function buildWorkflowKickoffMessage(recipeName: string, chapterNumber: number): string {
  return `开始执行第 ${chapterNumber} 章的创作工作流「${recipeName}」。当前工序与要求在系统简报里；请先调用 workflow_get_current_step 确认，再按简报逐道推进，每道工序的产物用 workflow_submit_step_output 提交。`;
}

class WorkflowRequestError extends Error {}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null) as { summary?: string } | null;
  if (!res.ok) {
    throw new WorkflowRequestError(body?.summary ?? `请求失败：HTTP ${res.status}`);
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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

// ─── 子视图 ──────────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="size-4 text-emerald-500" />;
    case "running":
      return <Loader2 className="size-4 animate-spin text-primary" />;
    case "awaiting_approval":
      return <Pause className="size-4 text-amber-500" />;
    case "failed":
      return <XCircle className="size-4 text-destructive" />;
    case "skipped":
      return <Circle className="size-4 text-muted-foreground/50" />;
    default:
      return <Clock className="size-4 text-muted-foreground/50" />;
  }
}

function ExplanationBlock({ note, tone }: { note: Explanation; tone: "warn" | "error" }) {
  const color = tone === "error"
    ? "border-destructive/40 bg-destructive/5 text-destructive"
    : "border-amber-400/60 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300";
  return (
    <div className={`space-y-0.5 rounded-md border p-2 text-xs ${color}`}>
      <div className="font-medium">{note.what}</div>
      <div>原因：{note.why}</div>
      <div>建议：{note.action}</div>
    </div>
  );
}

/** 待确认产物的预览：按类别展示作者需要判断的内容。 */
function CandidatePreview({ candidate }: { candidate: CandidateView }) {
  const payload = record(candidate.payload) ?? {};
  const validation = record(candidate.validation) ?? {};
  if (candidate.kind === "prose") {
    const title = typeof payload.title === "string" ? payload.title : "";
    const content = typeof payload.content === "string" ? payload.content : "";
    return (
      <div className="space-y-1" data-testid="workflow-candidate-prose">
        <div className="text-xs text-muted-foreground">
          正文{title ? `「${title}」` : ""} · {typeof validation.wordCount === "number" ? `${validation.wordCount} 字` : ""}
          {typeof validation.wordTarget === "number" ? ` / 目标 ${validation.wordTarget} 字` : ""}
        </div>
        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded border bg-background p-2 text-xs leading-relaxed">{content}</div>
      </div>
    );
  }
  if (candidate.kind === "scene-spec") {
    const spec = record(payload.sceneSpec) ?? {};
    const scenes = Array.isArray(spec.scenes) ? spec.scenes.map(record).filter(Boolean) as Record<string, unknown>[] : [];
    return (
      <ol className="space-y-1 text-xs" data-testid="workflow-candidate-scenes">
        {scenes.map((scene, index) => (
          <li key={index} className="rounded border bg-background p-2">
            <span className="font-medium">场景 {index + 1}</span>
            {typeof scene.location === "string" ? ` · ${scene.location}` : ""}
            {typeof scene.conflict === "string" ? ` · 冲突：${scene.conflict}` : ""}
            {typeof scene.outcome === "string" ? ` · 结果：${scene.outcome}` : ""}
          </li>
        ))}
      </ol>
    );
  }
  if (candidate.kind === "audit") {
    const issues = Array.isArray(payload.issues) ? payload.issues.map(record).filter(Boolean) as Record<string, unknown>[] : [];
    return (
      <div className="space-y-1 text-xs" data-testid="workflow-candidate-audit">
        <div className={payload.passed === true ? "text-emerald-600" : "text-destructive"}>
          {payload.passed === true ? "审查通过" : "审查未通过"}：{typeof payload.summary === "string" ? payload.summary : ""}
        </div>
        {issues.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-4">
            {issues.map((issue, index) => (
              <li key={index}>[{String(issue.severity ?? "info")}] {String(issue.description ?? "")}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  return <div className="whitespace-pre-wrap text-xs">{typeof payload.summary === "string" ? payload.summary : ""}</div>;
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

export function WorkflowTimelinePanel({
  bookId,
  currentChapter = 1,
  narratorId,
  onSendToNarrator,
}: WorkflowTimelinePanelProps) {
  const [recipes, setRecipes] = useState<readonly NovelWorkflowRecipe[]>([]);
  const [activeRecipeId, setActiveRecipeId] = useState("");
  const [chapterInput, setChapterInput] = useState(String(currentChapter));
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<RunDetailView | null>(null);
  const [recent, setRecent] = useState<readonly RunSummaryView[]>([]);
  const [rejectNote, setRejectNote] = useState("");
  const [showRecipe, setShowRecipe] = useState(false);
  const bookRef = useRef(bookId);
  bookRef.current = bookId;
  const base = `/api/books/${encodeURIComponent(bookId)}`;

  useEffect(() => {
    setChapterInput(String(currentChapter));
  }, [currentChapter]);

  // 方案与运行一起载入；切书时用 AbortController 取消旧请求，避免串书。
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!bookId) {
      setRecipes([]);
      setActiveRecipeId("");
      setDetail(null);
      setRecent([]);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`${base}/workflow-recipes`, { signal });
      if (!res.ok) throw new Error(`加载工作流配置失败: HTTP ${res.status}`);
      const data = (await res.json()) as { recipes?: readonly NovelWorkflowRecipe[] };
      if (signal?.aborted) return;
      const fetched = Array.isArray(data.recipes) ? data.recipes : [];
      setRecipes(fetched);
      setActiveRecipeId((prev) => (fetched.some((r) => r.id === prev) ? prev : fetched[0]?.id ?? ""));

      const runsUrl = narratorId ? `${base}/workflow-runs?narratorId=${encodeURIComponent(narratorId)}` : `${base}/workflow-runs`;
      const runs = await fetch(runsUrl, { signal }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as
        | { active?: RunDetailView | null; recent?: RunSummaryView[] }
        | null;
      if (signal?.aborted) return;
      setDetail(runs?.active ?? null);
      setRecent(Array.isArray(runs?.recent) ? runs.recent : []);
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
      setRecipes([]);
      setActiveRecipeId("");
      setLoadError(err instanceof Error ? err.message : "获取工作流配置失败");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [base, bookId, narratorId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // 进行中的运行轮询刷新：叙述者的提交会在几秒内出现在这里（P0 用轮询）。
  const activeRunId = detail && ACTIVE_STATUSES.includes(detail.run.status) ? detail.run.id : null;
  useEffect(() => {
    if (!activeRunId) return;
    const bookAtStart = bookRef.current;
    const timer = setInterval(() => {
      void requestJson<RunDetailView>(`${base}/workflow-runs/${encodeURIComponent(activeRunId)}`)
        .then((next) => {
          if (bookRef.current === bookAtStart && next?.run) setDetail(next);
        })
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [activeRunId, base]);

  const selectedRecipe = recipes.find((r) => r.id === activeRecipeId) ?? recipes[0];
  const runIsActive = Boolean(activeRunId);
  const chapterNumber = Number(chapterInput);
  const chapterValid = Number.isInteger(chapterNumber) && chapterNumber >= 1;

  const act = async (fn: () => Promise<RunDetailView>) => {
    setBusy(true);
    setActionError(null);
    try {
      const next = await fn();
      setDetail(next);
      setRejectNote("");
      return next;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "操作失败");
      // 版本冲突等情况下拉一次最新状态，让作者看到对方刚做的变化。
      void load();
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleStart = async () => {
    if (!selectedRecipe || !narratorId || !chapterValid) return;
    const started = await act(() => postJson<RunDetailView>(`${base}/workflow-runs`, {
      recipeId: selectedRecipe.id,
      chapterNumber,
      narratorId,
    }));
    if (started && onSendToNarrator) {
      try {
        await onSendToNarrator(buildWorkflowKickoffMessage(selectedRecipe.name, chapterNumber));
      } catch (err) {
        setActionError(`运行已启动，但给叙述者发开工提示失败：${err instanceof Error ? err.message : String(err)}。可在对话里手动提醒它。`);
      }
    }
  };

  const runPath = detail ? `${base}/workflow-runs/${encodeURIComponent(detail.run.id)}` : "";
  const revision = detail?.run.revision ?? 0;
  const currentStep = detail?.run.steps.find((step) => step.stepId === detail.run.currentStepId);
  const pendingCandidate = detail && currentStep
    ? [...detail.candidates].reverse().find((c) => c.stepId === currentStep.stepId && c.decision === "pending")
    : undefined;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-background p-6 text-foreground" data-testid="workflow-run-monitor">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Workflow className="size-5 text-primary" />
            <h2 className="text-base font-semibold">创作工作流 · 执行</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            按方案逐道工序推进本章。每道工序能用什么工具、必须交什么由产品决定，需要确认的工序会停下来等你。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            aria-label="生产方案"
            value={activeRecipeId}
            onChange={(e) => setActiveRecipeId(e.target.value)}
            disabled={isLoading || recipes.length === 0 || runIsActive}
            className="rounded-lg border bg-background px-3 py-1.5 text-xs font-medium outline-none focus:border-primary disabled:opacity-50"
          >
            {recipes.length === 0 ? (
              <option value="">{isLoading ? "正在读取配置…" : "无可用工作流"}</option>
            ) : (
              recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({stepNodes(r).filter((s) => s.enabled).length} 道工序){r.status === "draft" ? " · 草稿" : ""}
                </option>
              ))
            )}
          </select>
          <label className="flex items-center gap-1 text-muted-foreground">
            第
            <input
              aria-label="目标章号"
              type="number"
              min={1}
              value={chapterInput}
              onChange={(e) => setChapterInput(e.target.value)}
              disabled={runIsActive}
              className="w-16 rounded border bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50"
            />
            章
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={isLoading || !bookId}
            title="刷新"
            className="rounded-lg border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => void handleStart()}
            disabled={busy || isLoading || !selectedRecipe || !narratorId || !chapterValid || runIsActive}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Play className="size-3.5 fill-current" />
            启动工作流
          </button>
        </div>
      </div>

      {!narratorId ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300" data-testid="workflow-no-narrator">
          <AlertCircle className="size-4 shrink-0" />
          <span>还没有打开本书的叙述者会话。工作流由叙述者执行，请先在写作页打开或新建叙述者会话再启动。</span>
        </div>
      ) : null}

      {loadError ? (
        <div role="alert" className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button type="button" onClick={() => void load()} className="rounded border border-destructive/30 px-2 py-1 text-2xs font-medium hover:bg-destructive/10">
            重试
          </button>
        </div>
      ) : null}

      {actionError ? (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive" data-testid="workflow-action-error">
          <AlertCircle className="size-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      ) : null}

      {detail && runIsActive ? (
        <section className="space-y-3 rounded-xl border bg-card p-4" data-testid="workflow-active-run">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">
              {detail.run.recipeName} · 第 {detail.run.chapterNumber} 章
              <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-2xs font-medium text-primary" data-testid="workflow-run-status">
                {RUN_STATUS_LABEL[detail.run.status]}
              </span>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => postJson<RunDetailView>(`${runPath}/cancel`, { expectedRevision: revision }))}
              className="flex items-center gap-1 rounded border px-2 py-1 text-2xs text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <Ban className="size-3" />
              取消运行
            </button>
          </div>

          <ol className="space-y-1.5" data-testid="workflow-run-steps">
            {detail.run.steps.map((step) => (
              <li
                key={step.stepId}
                className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs ${step.stepId === detail.run.currentStepId ? "bg-primary/5 font-medium" : ""}`}
              >
                <StepIcon status={step.status} />
                <span className="flex-1">{step.ordinal}. {step.label}</span>
                {step.requiresApproval ? <ShieldCheck className="size-3.5 text-amber-500" aria-label="需要确认" /> : null}
                {step.attempt > 1 ? <span className="text-2xs text-muted-foreground">第 {step.attempt} 次</span> : null}
              </li>
            ))}
          </ol>

          {detail.run.status === "running" && currentStep ? (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs" data-testid="workflow-running-card">
              <div>叙述者正在执行「{currentStep.label}」{currentStep.executorKind === "subagent" && currentStep.agentId ? `（委派子代理 ${currentStep.agentId}）` : ""}。</div>
              {currentStep.note ? <ExplanationBlock note={currentStep.note} tone="warn" /> : null}
              {onSendToNarrator ? (
                <button
                  type="button"
                  onClick={() => void onSendToNarrator(buildWorkflowKickoffMessage(detail.run.recipeName, detail.run.chapterNumber))}
                  className="rounded border px-2 py-1 text-2xs text-muted-foreground hover:bg-muted"
                >
                  叙述者没动静？提醒它继续
                </button>
              ) : null}
            </div>
          ) : null}

          {detail.run.status === "awaiting_approval" && currentStep ? (
            <div className="space-y-2 rounded-md border border-amber-400/60 p-3" data-testid="workflow-approval-card">
              <div className="text-xs font-medium">
                {currentStep.executorKind === "manual-gate" ? `人工门禁「${currentStep.label}」：确认后放行下一道工序` : `「${currentStep.label}」的产物等你确认`}
              </div>
              {pendingCandidate ? <CandidatePreview candidate={pendingCandidate} /> : null}
              {currentStep.executorKind !== "manual-gate" ? (
                <textarea
                  aria-label="打回意见"
                  placeholder="打回时写明哪里不行、希望怎么改；意见会原样交给叙述者"
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  className="min-h-16 w-full rounded border bg-background p-2 text-xs"
                />
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => postJson<RunDetailView>(`${runPath}/steps/${encodeURIComponent(currentStep.stepId)}/approve`, { expectedRevision: revision }))}
                  className="flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <CheckCircle2 className="size-3.5" />
                  {currentStep.executorKind === "manual-gate" ? "放行" : "批准"}
                </button>
                {currentStep.executorKind !== "manual-gate" ? (
                  <button
                    type="button"
                    disabled={busy || !rejectNote.trim()}
                    onClick={() => void act(() => postJson<RunDetailView>(`${runPath}/steps/${encodeURIComponent(currentStep.stepId)}/reject`, { expectedRevision: revision, note: rejectNote }))}
                    className="flex items-center gap-1 rounded border px-3 py-1 text-xs hover:bg-muted disabled:opacity-50"
                  >
                    <RotateCcw className="size-3.5" />
                    打回
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {detail.run.status === "blocked" && currentStep ? (
            <div className="space-y-2 rounded-md border border-destructive/40 p-3" data-testid="workflow-blocked-card">
              <div className="text-xs font-medium">「{currentStep.label}」受阻</div>
              {currentStep.note ? <ExplanationBlock note={currentStep.note} tone="error" /> : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => postJson<RunDetailView>(`${runPath}/retry`, { expectedRevision: revision }))}
                  className="flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50"
                >
                  <RotateCcw className="size-3.5" />
                  重试本工序
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => postJson<RunDetailView>(`${runPath}/skip`, { expectedRevision: revision }))}
                  className="flex items-center gap-1 rounded border px-3 py-1 text-xs hover:bg-muted disabled:opacity-50"
                >
                  <SkipForward className="size-3.5" />
                  跳过
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {selectedRecipe && !runIsActive ? (
        <section className="rounded-xl border bg-card">
          <button
            type="button"
            onClick={() => setShowRecipe((value) => !value)}
            className="flex w-full items-center justify-between p-3 text-xs font-semibold text-muted-foreground"
          >
            方案工序一览（{selectedRecipe.name}）
            {showRecipe ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
          {showRecipe ? (
            <ol className="space-y-1 border-t p-3 text-xs" data-testid="workflow-recipe-steps">
              {orderedSteps(selectedRecipe).map((step, index) => (
                <li key={step.id} className={step.enabled ? "" : "text-muted-foreground line-through"}>
                  {index + 1}. {step.label}
                  {step.requiresApproval ? " · 需要确认" : ""}
                  {step.outcomes?.length ? ` · 按结果分支：${step.outcomes.join(" / ")}` : ""}
                  {step.tools?.length ? ` · 可用写入工具：${step.tools.join("、")}` : ""}
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section className="space-y-1" data-testid="workflow-recent-runs">
          <div className="text-xs font-semibold text-muted-foreground">最近的运行</div>
          {recent.map((run) => (
            <div key={run.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
              <span>第 {run.chapterNumber} 章 · {run.recipeName}</span>
              <span className="text-muted-foreground">{RUN_STATUS_LABEL[run.status]}</span>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
