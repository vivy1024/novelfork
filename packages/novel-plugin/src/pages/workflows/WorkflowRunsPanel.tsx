/**
 * 运行面板：本书的运行列表 + 选中运行的详情（工序进度、候选、待确认、打回意见）。
 * 作者在这里确认 / 打回，都带上看到的运行版本号；版本冲突时提示并重新读取。
 * 进行中的运行定时刷新（叙述者的提交几秒内就会出现）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, BellRing, CheckCircle2, Circle, Clock, Loader2, Pause, RefreshCw, RotateCcw, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { OutlineCandidatePreview } from "./OutlineCandidatePreview";
import { subagentNameZh, writesChapter } from "./workflow-step-list-model";
import { errorExplanation, jsonInit, workflowRequest, type Explanation } from "./workflow-api";

export type RunStatus = "running" | "awaiting_approval" | "blocked" | "done" | "cancelled";
type StepStatus = "pending" | "running" | "awaiting_approval" | "done" | "skipped" | "bypassed" | "failed";

export interface RunSummary {
  readonly id: string;
  readonly chapterNumber: number;
  readonly recipeName: string;
  readonly status: RunStatus;
  readonly revision: number;
  readonly updatedAt: number;
}

interface RunStep {
  readonly stepId: string;
  readonly ordinal: number;
  readonly label: string;
  readonly status: StepStatus;
  readonly attempt: number;
  readonly executorKind: "narrator" | "subagent" | "domain-tool" | "manual-gate";
  readonly agentId?: string;
  readonly requiresApproval: boolean;
  readonly tools?: readonly string[];
  readonly note?: Explanation;
}

interface Candidate {
  readonly id: string;
  readonly stepId: string;
  readonly kind: "scene-spec" | "prose" | "audit" | "outline" | "other";
  readonly payload: unknown;
  readonly validation: unknown;
  readonly decision: "pending" | "approved" | "rejected";
  readonly reviewerNote?: string;
}

interface RunDetail {
  readonly run: RunSummary & { readonly steps: readonly RunStep[] };
  readonly graph?: { readonly nodes: ReadonlyArray<{ id: string; label: string }>; readonly edges: ReadonlyArray<{ kind: string; source: string; target: string }> };
  readonly candidates: readonly Candidate[];
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: "进行中",
  awaiting_approval: "等你确认",
  blocked: "卡住了",
  done: "已完成",
  cancelled: "已取消",
};

const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  pending: "未开始",
  running: "进行中",
  awaiting_approval: "等你确认",
  done: "完成",
  skipped: "已跳过",
  bypassed: "分支没走到",
  failed: "卡住了",
};

const ACTIVE: readonly RunStatus[] = ["running", "awaiting_approval", "blocked"];
const POLL_MS = 2500;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "done": return <CheckCircle2 className="size-4 text-success" aria-hidden />;
    case "running": return <Loader2 className="size-4 animate-spin text-primary" aria-hidden />;
    case "awaiting_approval": return <Pause className="size-4 text-warning" aria-hidden />;
    case "failed": return <XCircle className="size-4 text-destructive" aria-hidden />;
    case "skipped":
    case "bypassed": return <Circle className="size-4 text-muted-foreground/50" aria-hidden />;
    default: return <Clock className="size-4 text-muted-foreground/50" aria-hidden />;
  }
}

/** 运行结束后正文候选只留首尾摘录（全文以章节为准）。 */
export function compactedProsePreview(payload: Record<string, unknown>): string {
  const compacted = record(payload.compacted);
  if (typeof compacted.head !== "string") return "";
  const tail = typeof compacted.tail === "string" && compacted.tail ? `\n……\n${compacted.tail}` : "";
  return `${compacted.head}${tail}\n\n（运行已结束，这一版只保留了开头与结尾，完整正文请看章节）`;
}

function CandidatePreview({ candidate }: { candidate: Candidate }) {
  const payload = record(candidate.payload);
  const validation = record(candidate.validation);
  if (candidate.kind === "prose") {
    return (
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">
          正文{typeof payload.title === "string" && payload.title ? `「${payload.title}」` : ""}
          {typeof validation.wordCount === "number" ? ` · ${validation.wordCount} 字` : ""}
          {typeof validation.wordTarget === "number" ? ` / 目标 ${validation.wordTarget} 字` : ""}
        </div>
        <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border bg-background p-2 text-xs leading-relaxed" tabIndex={0} aria-label="正文预览">
          {typeof payload.content === "string" ? payload.content : compactedProsePreview(payload)}
        </div>
      </div>
    );
  }
  if (candidate.kind === "audit") {
    const issues = Array.isArray(payload.issues) ? payload.issues.map(record) : [];
    return (
      <div className="space-y-1 text-xs">
        <div className={payload.passed === true ? "text-success" : "text-destructive"}>
          {payload.passed === true ? "审校通过" : "审校没通过"}{typeof payload.summary === "string" ? `：${payload.summary}` : ""}
        </div>
        {issues.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-4">{issues.map((issue, index) => <li key={index}>{String(issue.description ?? "")}</li>)}</ul>
        ) : null}
      </div>
    );
  }
  if (candidate.kind === "outline") return <OutlineCandidatePreview payload={payload} />;
  if (candidate.kind === "scene-spec") {
    const scenes = Array.isArray(record(payload.sceneSpec).scenes) ? (record(payload.sceneSpec).scenes as unknown[]).map(record) : [];
    return (
      <ol className="space-y-1 text-xs">
        {scenes.map((scene, index) => (
          <li key={index} className="rounded border bg-background p-2">
            场景 {index + 1}{typeof scene.location === "string" ? ` · ${scene.location}` : ""}{typeof scene.conflict === "string" ? ` · 冲突：${scene.conflict}` : ""}
          </li>
        ))}
      </ol>
    );
  }
  return <div className="whitespace-pre-wrap text-xs">{typeof payload.summary === "string" ? payload.summary : ""}</div>;
}

export interface WorkflowRunsPanelProps {
  readonly apiBase: string;
}

export function WorkflowRunsPanel({ apiBase }: WorkflowRunsPanelProps) {
  const [runs, setRuns] = useState<readonly RunSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; explanation?: Explanation } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const baseRef = useRef(apiBase);
  baseRef.current = apiBase;

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const body = await workflowRequest<{ recent?: RunSummary[] }>(`${apiBase}/workflow-runs`);
      const list = Array.isArray(body.recent) ? body.recent : [];
      setRuns(list);
      setSelectedId((current) => (current && list.some((run) => run.id === current) ? current : (list.find((run) => ACTIVE.includes(run.status)) ?? list[0])?.id ?? null));
    } catch (cause) {
      setError(errorExplanation(cause));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    setRuns([]);
    setDetail(null);
    setSelectedId(null);
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(async (runId: string) => {
    const base = baseRef.current;
    try {
      const next = await workflowRequest<RunDetail>(`${base}/workflow-runs/${encodeURIComponent(runId)}`);
      if (baseRef.current === base) setDetail(next);
    } catch (cause) {
      setError(errorExplanation(cause));
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const activeId = detail && ACTIVE.includes(detail.run.status) ? detail.run.id : null;
  useEffect(() => {
    if (!activeId) return;
    const timer = setInterval(() => void loadDetail(activeId), POLL_MS);
    return () => clearInterval(timer);
  }, [activeId, loadDetail]);

  const act = async (path: string, body: Record<string, unknown>) => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const next = await workflowRequest<RunDetail>(
        `${apiBase}/workflow-runs/${encodeURIComponent(detail.run.id)}${path}`,
        jsonInit("POST", { ...body, expectedRevision: detail.run.revision }),
      );
      setDetail(next);
      setNotes({});
      setRuns((current) => current.map((run) => (run.id === next.run.id ? { ...run, status: next.run.status, revision: next.run.revision } : run)));
    } catch (cause) {
      setError(errorExplanation(cause));
      // 版本冲突等：拉一次最新状态，作者能看到叙述者刚做的变化。
      void loadDetail(detail.run.id);
    } finally {
      setBusy(false);
    }
  };

  const waiting = runs.filter((run) => run.status === "awaiting_approval");
  const pendingCandidate = (stepId: string) =>
    detail ? [...detail.candidates].reverse().find((candidate) => candidate.stepId === stepId && candidate.decision === "pending") : undefined;
  const rejectTargetLabel = (stepId: string) => {
    const edge = detail?.graph?.edges.find((item) => item.kind === "reject" && item.source === stepId);
    return edge ? detail?.graph?.nodes.find((node) => node.id === edge.target)?.label ?? null : null;
  };
  const latestRejectNote = (stepId: string) =>
    detail ? [...detail.candidates].reverse().find((candidate) => candidate.stepId === stepId && candidate.decision === "rejected" && candidate.reviewerNote)?.reviewerNote : undefined;

  return (
    <section className="space-y-3" aria-label="运行记录" data-testid="workflow-runs-panel">
      {waiting.length > 0 ? (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-warning/70 bg-warning/15 p-3 text-sm font-medium text-warning" data-testid="workflow-runs-waiting">
          <BellRing className="size-4 shrink-0" aria-hidden />
          有 {waiting.length} 次运行在等你确认：{waiting.map((run) => `第 ${run.chapterNumber} 章`).join("、")}
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="space-y-0.5 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive" data-testid="workflow-runs-error">
          <div className="flex items-center gap-1 font-medium"><AlertCircle className="size-3.5" aria-hidden />{error.explanation?.what ?? error.message}</div>
          {error.explanation ? <><div>原因：{error.explanation.why}</div><div>建议：{error.explanation.action}</div></> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-4">
        <div className="w-full max-w-64 space-y-1.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground">本书的运行</h3>
            <Button type="button" variant="ghost" size="icon-xs" aria-label="刷新运行列表" onClick={() => void loadList()} disabled={loading}>
              <RefreshCw className={loading ? "animate-spin" : ""} />
            </Button>
          </div>
          {runs.length === 0 && !loading ? <p className="text-xs text-muted-foreground">还没有运行过。在写作台写下一章时选择按工作流写。</p> : null}
          <ul className="space-y-1" aria-label="运行列表">
            {runs.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  aria-pressed={run.id === selectedId}
                  onClick={() => setSelectedId(run.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-muted ${run.id === selectedId ? "border-primary bg-primary/5" : ""}`}
                >
                  <span className="min-w-0 truncate">第 {run.chapterNumber} 章 · {run.recipeName}</span>
                  <Badge variant={run.status === "awaiting_approval" ? "default" : run.status === "blocked" ? "destructive" : "outline"}>{RUN_STATUS_LABEL[run.status]}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {detail ? (
          <div className="min-w-0 flex-1 space-y-3" data-testid="workflow-run-detail">
            <div className="text-sm font-semibold">
              第 {detail.run.chapterNumber} 章 · {detail.run.recipeName}
              <span className="ml-2 text-xs font-normal text-muted-foreground">{RUN_STATUS_LABEL[detail.run.status]}</span>
            </div>
            <ol className="space-y-1" aria-label="工序进度">
              {detail.run.steps.map((step) => (
                <li key={step.stepId} className="flex items-center gap-2 text-xs">
                  <StepIcon status={step.status} />
                  <span className="flex-1">{step.ordinal}. {step.label}
                    {step.executorKind === "subagent" && step.agentId ? <span className="text-muted-foreground">（{subagentNameZh(step.agentId)}）</span> : null}
                  </span>
                  <span className="text-muted-foreground">{STEP_STATUS_LABEL[step.status]}{step.attempt > 1 ? ` · 第 ${step.attempt} 次` : ""}</span>
                </li>
              ))}
            </ol>

            {detail.run.steps.filter((step) => step.status === "awaiting_approval" || step.status === "failed").map((step) => {
              const candidate = pendingCandidate(step.stepId);
              const target = rejectTargetLabel(step.stepId);
              const isGate = step.executorKind === "manual-gate";
              const canReject = !isGate || target !== null;
              const note = notes[step.stepId] ?? "";
              const lastReject = latestRejectNote(step.stepId);
              if (step.status === "failed") {
                const commits = writesChapter(step);
                return (
                  <div key={step.stepId} className="space-y-2 rounded-md border border-destructive/40 p-3" data-testid="workflow-run-blocked">
                    <div className="text-xs font-medium">「{step.label}」卡住了</div>
                    {step.note ? <div className="text-xs text-destructive">{step.note.what}。{step.note.why}。{step.note.action}。</div> : null}
                    {commits ? (
                      <>
                        <p className="text-xs text-muted-foreground" data-testid="workflow-run-no-skip">这道工序负责把正文写进书里，不能跳过：跳过的话运行会显示完成，正文却没进书。正文本身有问题（比如字数不够）就写明意见打回重写。</p>
                        <Textarea
                          aria-label={`打回重写正文的意见（「${step.label}」）`}
                          placeholder="写明正文哪里要改，比如还差多少字、哪段要补"
                          value={note}
                          onChange={(event) => setNotes((current) => ({ ...current, [step.stepId]: event.target.value }))}
                          className="min-h-16 text-xs"
                        />
                      </>
                    ) : null}
                    <div className="flex gap-2">
                      <Button type="button" size="sm" disabled={busy} onClick={() => void act("/retry", { stepId: step.stepId })}>
                        <RotateCcw />重试这道工序
                      </Button>
                      {commits ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy || !note.trim()}
                          onClick={() => void act(`/steps/${encodeURIComponent(step.stepId)}/reject`, { note })}
                        >
                          <RotateCcw />打回重写正文
                        </Button>
                      ) : (
                        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void act("/skip", { stepId: step.stepId })}>跳过</Button>
                      )}
                    </div>
                  </div>
                );
              }
              return (
                <div key={step.stepId} className="space-y-2 rounded-md border-2 border-warning/70 bg-warning/5 p-3" data-testid="workflow-run-approval">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-warning">
                    <BellRing className="size-4" aria-hidden />
                    {isGate ? `「${step.label}」等你放行` : `「${step.label}」做完了，等你确认`}
                  </div>
                  {step.note ? <div className="text-xs text-warning">{step.note.what}。{step.note.action}。</div> : null}
                  {lastReject ? <div className="text-xs text-muted-foreground">上次打回意见：{lastReject}</div> : null}
                  {candidate ? <CandidatePreview candidate={candidate} /> : null}
                  {canReject ? (
                    <Textarea
                      aria-label={`打回「${step.label}」的意见`}
                      placeholder={target ? `打回后从「${target}」重做。写明哪里不行、想怎么改` : "写明哪里不行、想怎么改"}
                      value={note}
                      onChange={(event) => setNotes((current) => ({ ...current, [step.stepId]: event.target.value }))}
                      className="min-h-16 text-xs"
                    />
                  ) : null}
                  <div className="flex gap-2">
                    <Button type="button" size="sm" disabled={busy} onClick={() => void act(`/steps/${encodeURIComponent(step.stepId)}/approve`, {})}>
                      <CheckCircle2 />{isGate ? "放行" : "确认"}
                    </Button>
                    {canReject ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy || !note.trim()}
                        onClick={() => void act(`/steps/${encodeURIComponent(step.stepId)}/reject`, { note })}
                      >
                        <RotateCcw />{target ? `打回到「${target}」` : "打回重做"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
