/**
 * 方案编辑器（纵向步骤列表）：每道工序一张卡，自上而下就是执行顺序。
 *
 * 内置方案只读，可复制成自己的草稿再改；自己的方案可编辑、保存草稿、发布。
 * 修改走 workflow-step-list-model（与叙述者、画布同一套编辑指令校验），
 * 结构问题用 checkWorkflowGraph 实时列出，有问题时不能发布。
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CopyPlus, Plus, Save, ShieldCheck, Trash2, Undo2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { checkWorkflowGraph, type WorkflowGraphRecipe, type WorkflowRecipeStatus, type WorkflowStepNode } from "../../engine/workflows/workflow-graph.js";
import type { NovelWorkflowStepKind, NovelWorkflowStepOnFailure } from "../../engine/workflows/novel-workflows.js";
import {
  appendStep,
  DEFAULT_MAX_AUTO_RETURNS,
  executorOf,
  executorOptions,
  failureOptionsFor,
  isAuditKind,
  isBuiltinRecipe,
  moveStep,
  rejectTargetOf,
  removeStep,
  setExecutor,
  setRecipeMeta,
  setRejectTarget,
  STEP_KIND_LABELS,
  STEP_KIND_OPTIONS,
  stepListOf,
  updateStep,
  writesChapter,
  type StepListResult,
} from "./workflow-step-list-model";
import { errorExplanation, jsonInit, workflowRequest, type Explanation } from "./workflow-api";

export interface WorkflowStepListEditorProps {
  /** 磁盘上的版本；revision 为 0 表示还没保存的新方案。 */
  readonly recipe: WorkflowGraphRecipe;
  /** `/api/books/:bookId` */
  readonly apiBase: string;
  readonly onSaved: (saved: WorkflowGraphRecipe) => void;
  readonly onDeleted: (recipeId: string) => void;
  readonly onCopy: (source: WorkflowGraphRecipe) => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
}

const selectClass = "h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60";
const fieldLabel = "flex flex-col gap-1 text-xs text-muted-foreground";

function ExplanationBox({ note, tone = "warn", testId }: { note: Explanation; tone?: "warn" | "error"; testId?: string }) {
  const color = tone === "error" ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-warning/60 bg-warning/10 text-warning";
  return (
    <div role="alert" className={`space-y-0.5 rounded-md border p-2 text-xs ${color}`} data-testid={testId}>
      <div className="font-medium">{note.what}</div>
      <div>原因：{note.why}</div>
      <div>建议：{note.action}</div>
    </div>
  );
}

export function WorkflowStepListEditor({ recipe, apiBase, onSaved, onDeleted, onCopy, onDirtyChange }: WorkflowStepListEditorProps) {
  const builtin = isBuiltinRecipe(recipe);
  const [working, setWorking] = useState(recipe);
  const [dirty, setDirty] = useState(recipe.revision === 0);
  const [problem, setProblem] = useState<Explanation | null>(null);
  const [saveError, setSaveError] = useState<{ message: string; explanation?: Explanation } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setWorking(recipe);
    setDirty(recipe.revision === 0);
    setProblem(null);
    setSaveError(null);
    setConfirmDelete(false);
  }, [recipe]);

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const issues = useMemo(() => checkWorkflowGraph(working), [working]);
  const { steps, linear } = useMemo(() => stepListOf(working), [working]);
  const editable = !builtin;
  const executors = useMemo(() => executorOptions(), []);

  const commit = (result: StepListResult) => {
    if (!result.ok) {
      setProblem({ what: result.what, why: result.why, action: result.action });
      return;
    }
    setProblem(null);
    setWorking(result.recipe);
    setDirty(true);
  };

  const save = async (status: WorkflowRecipeStatus) => {
    setBusy(true);
    setSaveError(null);
    try {
      const body = await workflowRequest<{ recipe: WorkflowGraphRecipe }>(
        `${apiBase}/workflow-recipes/${encodeURIComponent(working.id)}`,
        jsonInit("PUT", { recipe: { ...working, status }, expectedRevision: recipe.revision }),
      );
      setDirty(false);
      onSaved(body.recipe);
    } catch (error) {
      setSaveError(errorExplanation(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    if (recipe.revision === 0) {
      onDeleted(recipe.id);
      return;
    }
    setBusy(true);
    try {
      await workflowRequest(`${apiBase}/workflow-recipes/${encodeURIComponent(recipe.id)}?expectedRevision=${recipe.revision}`, { method: "DELETE" });
      onDeleted(recipe.id);
    } catch (error) {
      setSaveError(errorExplanation(error));
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    if (recipe.revision === 0) {
      onDeleted(recipe.id);
      return;
    }
    setWorking(recipe);
    setDirty(false);
    setProblem(null);
    setSaveError(null);
  };

  const isDraft = working.status === "draft";

  return (
    <section className="space-y-3" aria-label={`编辑方案：${working.name}`} data-testid="workflow-step-editor">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          {editable ? (
            <>
              <label className={fieldLabel}>
                方案名称
                <Input
                  value={working.name}
                  onChange={(event) => commit(setRecipeMeta(working, { name: event.target.value || " " }))}
                  aria-label="方案名称"
                />
              </label>
              <label className={fieldLabel}>
                说明
                <Textarea
                  value={working.description}
                  onChange={(event) => commit(setRecipeMeta(working, { description: event.target.value }))}
                  aria-label="方案说明"
                  className="min-h-14 text-xs"
                />
              </label>
            </>
          ) : (
            <>
              <h3 className="text-sm font-semibold">{working.name}</h3>
              <p className="text-xs text-muted-foreground">{working.description}</p>
            </>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {builtin ? <Badge variant="secondary">内置 · 只读</Badge> : null}
            <Badge variant={isDraft ? "outline" : "default"} data-testid="workflow-step-editor-status">{isDraft ? "草稿" : "已发布"}</Badge>
            {recipe.revision > 0 ? <span className="text-muted-foreground">第 {recipe.revision} 版</span> : <span className="text-muted-foreground">还没保存</span>}
            {dirty ? <span className="text-warning" data-testid="workflow-step-editor-dirty">有未保存的修改</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={() => onCopy(working)} disabled={busy || dirty}>
            <CopyPlus />
            复制为我的方案
          </Button>
          {editable ? (
            <>
              {dirty ? (
                <Button type="button" variant="ghost" size="sm" onClick={discard} disabled={busy}>
                  <Undo2 />
                  放弃修改
                </Button>
              ) : null}
              {confirmDelete ? (
                <>
                  <Button type="button" variant="destructive" size="sm" onClick={() => void remove()} disabled={busy}>确认删除</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>取消</Button>
                </>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} disabled={busy}>
                  <Trash2 />
                  删除
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => void save("draft")} disabled={busy || (!dirty && isDraft)}>
                <Save />
                {isDraft ? "保存草稿" : "转为草稿"}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void save("published")}
                disabled={busy || issues.length > 0 || (!dirty && !isDraft)}
                title={issues.length > 0 ? "下面还有问题，改好后才能发布" : "发布后才能用它写章"}
              >
                <Upload />
                {isDraft ? "检查并发布" : "保存"}
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {problem ? <ExplanationBox note={problem} testId="workflow-step-editor-problem" /> : null}
      {saveError ? (
        saveError.explanation
          ? <ExplanationBox note={saveError.explanation} tone="error" testId="workflow-step-editor-save-error" />
          : <div role="alert" className="text-xs text-destructive" data-testid="workflow-step-editor-save-error">{saveError.message}</div>
      ) : null}

      {issues.length > 0 ? (
        <div className="space-y-1.5" data-testid="workflow-step-editor-issues">
          <div className="flex items-center gap-1 text-xs font-medium text-destructive">
            <AlertTriangle className="size-3.5" />
            还有 {issues.length} 个问题，改好后才能发布
          </div>
          <ul className="space-y-1.5">
            {issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                <ExplanationBox note={issue.explanation} tone="error" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!linear ? (
        <p className="rounded-md border border-info/50 bg-info/10 p-2 text-xs text-info">
          这个方案有并行或分支，这里只能改各道工序的设置；要调整顺序或增删工序，请到写作台的「工作流」画布里改。
        </p>
      ) : null}

      <ol className="space-y-0" aria-label="工序顺序" data-testid="workflow-step-list">
        <li className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
          <span className="flex size-6 items-center justify-center rounded-full border bg-muted text-2xs">始</span>
          开始
        </li>
        {steps.map((step, index) => (
          <StepCard
            key={step.id}
            step={step}
            index={index}
            total={steps.length}
            upstream={steps.slice(0, index)}
            recipe={working}
            editable={editable}
            linear={linear}
            executors={executors}
            onChange={commit}
          />
        ))}
        <li className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
          <span className="flex size-6 items-center justify-center rounded-full border bg-muted text-2xs">终</span>
          完成
        </li>
      </ol>

      {editable && linear ? (
        <Button type="button" variant="outline" size="sm" onClick={() => commit(appendStep(working))}>
          <Plus />
          加一道工序
        </Button>
      ) : null}
    </section>
  );
}

function StepCard({
  step,
  index,
  total,
  upstream,
  recipe,
  editable,
  linear,
  executors,
  onChange,
}: {
  step: WorkflowStepNode;
  index: number;
  total: number;
  upstream: readonly WorkflowStepNode[];
  recipe: WorkflowGraphRecipe;
  editable: boolean;
  linear: boolean;
  executors: ReadonlyArray<{ value: string; label: string }>;
  onChange: (result: StepListResult) => void;
}) {
  const id = step.id;
  const rejectTarget = rejectTargetOf(recipe, id);
  const executor = executorOf(step);
  const approval = step.kind === "approval-gate" || step.requiresApproval === true;
  const audit = isAuditKind(step.kind);
  const titleId = `wf-step-${id}-title`;
  return (
    <li className="relative pb-2 pl-8" aria-labelledby={titleId} data-testid={`workflow-step-${id}`}>
      {/* 竖线：把卡片串成一条流程 */}
      <span aria-hidden className="absolute bottom-0 left-3 top-0 w-px bg-border" />
      <span aria-hidden className="absolute left-0.5 top-3 flex size-5 items-center justify-center rounded-full border bg-background text-2xs font-medium">{index + 1}</span>
      <div className={`space-y-2 rounded-lg border bg-card p-3 ${step.enabled ? "" : "opacity-60"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span id={titleId} className="truncate text-sm font-medium">{step.label}</span>
            <Badge variant="outline">{STEP_KIND_LABELS[step.kind]}</Badge>
            {approval ? (
              <span className="flex items-center gap-0.5 text-2xs text-warning"><ShieldCheck className="size-3" />要我确认</span>
            ) : null}
            {!step.enabled ? <span className="text-2xs text-muted-foreground">已停用</span> : null}
          </div>
          {editable && linear ? (
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`上移「${step.label}」`} disabled={index === 0} onClick={() => onChange(moveStep(recipe, id, -1))}>
                <ArrowUp />
              </Button>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`下移「${step.label}」`} disabled={index === total - 1} onClick={() => onChange(moveStep(recipe, id, 1))}>
                <ArrowDown />
              </Button>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`删除「${step.label}」`} onClick={() => onChange(removeStep(recipe, id))}>
                <Trash2 />
              </Button>
            </div>
          ) : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {editable ? (
            <label className={fieldLabel}>
              工序名称
              <Input value={step.label} onChange={(event) => onChange(updateStep(recipe, id, { label: event.target.value || " " }))} className="h-8 text-xs" />
            </label>
          ) : null}
          <label className={fieldLabel}>
            做什么
            <select
              className={selectClass}
              value={step.kind}
              disabled={!editable}
              onChange={(event) => onChange(updateStep(recipe, id, { kind: event.target.value as NovelWorkflowStepKind }))}
            >
              {STEP_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}（{option.hint}）</option>)}
            </select>
          </label>
          <label className={fieldLabel}>
            谁来做
            <select
              className={selectClass}
              value={executor}
              disabled={!editable || step.kind === "approval-gate"}
              onChange={(event) => onChange(setExecutor(recipe, id, event.target.value))}
            >
              {executors.map((option) => <option key={option.value || "leader"} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className={fieldLabel}>
            失败时
            <select
              className={selectClass}
              value={writesChapter(step) && step.onFailure === "skip" ? "stop" : step.onFailure ?? "stop"}
              disabled={!editable}
              aria-describedby={writesChapter(step) ? `wf-step-${id}-no-skip` : undefined}
              onChange={(event) => onChange(updateStep(recipe, id, { onFailure: event.target.value as NovelWorkflowStepOnFailure }))}
            >
              {failureOptionsFor(step).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {writesChapter(step) ? (
              <span id={`wf-step-${id}-no-skip`} className="text-2xs">这道工序把正文写进书里，失败不能跳过</span>
            ) : null}
          </label>
          <label className={fieldLabel}>
            不满意时打回到
            <select
              className={selectClass}
              value={rejectTarget ?? ""}
              disabled={!editable || upstream.length === 0}
              onChange={(event) => onChange(setRejectTarget(recipe, id, event.target.value || null))}
            >
              <option value="">不打回</option>
              {upstream.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
            </select>
          </label>
          {audit && rejectTarget ? (
            <label className={fieldLabel}>
              审校不过最多自动打回几轮
              <Input
                type="number"
                min={0}
                max={5}
                value={step.maxAutoReturns ?? DEFAULT_MAX_AUTO_RETURNS}
                disabled={!editable}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  onChange(updateStep(recipe, id, { maxAutoReturns: Number.isFinite(value) ? Math.trunc(value) : DEFAULT_MAX_AUTO_RETURNS }));
                }}
                className="h-8 text-xs"
              />
            </label>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={approval}
              disabled={!editable || step.kind === "approval-gate"}
              onChange={(event) => onChange(updateStep(recipe, id, { requiresApproval: event.target.checked }))}
            />
            做完要我确认
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={step.enabled}
              disabled={!editable}
              onChange={(event) => onChange(updateStep(recipe, id, { enabled: event.target.checked }))}
            />
            启用
          </label>
        </div>
      </div>
    </li>
  );
}
