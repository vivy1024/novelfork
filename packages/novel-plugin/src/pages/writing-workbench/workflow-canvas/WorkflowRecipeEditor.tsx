/**
 * 工作流方案编辑器：画布 + 属性面板 + 保存 / 发布。
 *
 * 编辑在本地工作副本上进行（每一步都经 applyWorkflowOps 校验），保存时整份提交，
 * 带上看到的版本号；叙述者或另一个窗口先改过会得到 409，提示重新载入。
 * 叙述者只能建草稿，作者在这里确认结构后发布；有结构问题时不能发布。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Bot, CopyPlus, FilePlus2, Flag, GitMerge, LayoutGrid, Plus, Save, Trash2, Undo2, Upload } from "lucide-react";

import {
  applyWorkflowOps,
  checkWorkflowGraph,
  END_NODE_ID,
  layoutWorkflowGraph,
  type WorkflowGraphOp,
  type WorkflowGraphRecipe,
  type WorkflowNodePosition,
  type WorkflowNodeType,
  type WorkflowRecipeStatus,
} from "../../../engine/workflows/workflow-graph.js";
import {
  addedId,
  addNodeOps,
  nextNodeId,
  placeNewNode,
  positionsOf,
  type CanvasSelection,
} from "./workflow-canvas-model";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { WorkflowInspector } from "./WorkflowInspector";

interface Explanation {
  readonly what: string;
  readonly why: string;
  readonly action: string;
}

export interface WorkflowRecipeEditorProps {
  /** 当前磁盘上的版本；revision 为 0 表示还没保存过的新方案。 */
  readonly recipe: WorkflowGraphRecipe;
  /** `/api/books/:bookId` */
  readonly apiBase: string;
  readonly onSaved: (saved: WorkflowGraphRecipe) => void;
  readonly onDeleted: (recipeId: string) => void;
  readonly onCreate: (mode: "blank" | "copy") => void;
  /** 保存冲突后重新从服务端读取。 */
  readonly onReload: () => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
}

class RecipeRequestError extends Error {
  constructor(message: string, readonly code?: string, readonly explanation?: Explanation) {
    super(message);
  }
}

async function sendRecipeRequest<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as ({ error?: string; code?: string; explanation?: Explanation } & T) | null;
  if (!res.ok) throw new RecipeRequestError(body?.error ?? `请求失败：HTTP ${res.status}`, body?.code, body?.explanation);
  return body as T;
}

/** 选中节点时加在它后面；没选时加在流向终点的那道工序后面。 */
function defaultAnchor(recipe: WorkflowGraphRecipe): string | null {
  const intoEnd = recipe.edges.filter((edge) => edge.kind === "next" && edge.target === END_NODE_ID);
  return intoEnd.length === 1 ? intoEnd[0]!.source : null;
}

export function WorkflowRecipeEditor({ recipe, apiBase, onSaved, onDeleted, onCreate, onReload, onDirtyChange }: WorkflowRecipeEditorProps) {
  const [working, setWorking] = useState(recipe);
  const [dirty, setDirty] = useState(recipe.revision === 0);
  const [selection, setSelection] = useState<CanvasSelection>(null);
  const [problem, setProblem] = useState<Explanation | null>(null);
  const [saveError, setSaveError] = useState<{ message: string; explanation?: Explanation; conflict: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 自动排版、加节点后让画布重新适配视口。
  const [fitViewKey, setFitViewKey] = useState(0);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // 服务端版本变了（保存成功、重新载入）且本地没有未保存的修改时，换成新版本。
  useEffect(() => {
    if (dirtyRef.current && recipe.revision !== 0) return;
    setWorking(recipe);
    setDirty(recipe.revision === 0);
  }, [recipe]);

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const issues = useMemo(() => checkWorkflowGraph(working), [working]);

  const workingRef = useRef(working);
  workingRef.current = working;

  const commit = useCallback((next: WorkflowGraphRecipe) => {
    workingRef.current = next;
    setWorking(next);
    setDirty(true);
  }, []);

  const applyOps = useCallback((ops: WorkflowGraphOp[]) => {
    const current = workingRef.current;
    const result = applyWorkflowOps(current, ops);
    if (!result.ok) {
      setProblem(result.explanation);
      return;
    }
    setProblem(null);
    commit(result.recipe);
    // 改连线类型 / 条件是断开重连，选中状态跟到新连线上。
    setSelection((selected) => {
      if (selected?.kind !== "edge" || result.recipe.edges.some((edge) => edge.id === selected.id)) return selected;
      const id = addedId(current, result.recipe, "edge");
      return id ? { kind: "edge", id } : null;
    });
  }, [commit]);

  const moveNode = useCallback((id: string, position: WorkflowNodePosition) => {
    const current = workingRef.current;
    const positions = positionsOf(current);
    const previous = positions[id];
    if (previous && previous.x === position.x && previous.y === position.y) return;
    commit({ ...current, layout: { positions: { ...positions, [id]: position } } });
  }, [commit]);

  const addNode = (type: Exclude<WorkflowNodeType, "start">) => {
    const anchor = selection?.kind === "node" ? selection.id : type === "end" ? null : defaultAnchor(working);
    const id = nextNodeId(working, type);
    const result = applyWorkflowOps(working, addNodeOps(working, type, id, anchor));
    if (!result.ok) {
      setProblem(result.explanation);
      return;
    }
    commit({ ...result.recipe, layout: { positions: placeNewNode(working, result.recipe, id, anchor) } });
    setProblem(null);
    setSelection({ kind: "node", id });
    setFitViewKey((key) => key + 1);
  };

  const autoLayout = () => {
    commit({ ...working, layout: { positions: layoutWorkflowGraph({ ...working, layout: undefined }) } });
    setFitViewKey((key) => key + 1);
  };

  const save = async (status: WorkflowRecipeStatus) => {
    setBusy(true);
    setSaveError(null);
    try {
      const body = await sendRecipeRequest<{ recipe: WorkflowGraphRecipe }>(`${apiBase}/workflow-recipes/${encodeURIComponent(working.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipe: { ...working, status }, expectedRevision: recipe.revision }),
      });
      setDirty(false);
      dirtyRef.current = false;
      onSaved(body.recipe);
    } catch (error) {
      const explanation = error instanceof RecipeRequestError ? error.explanation : undefined;
      setSaveError({
        message: error instanceof Error ? error.message : "保存失败",
        ...(explanation ? { explanation } : {}),
        conflict: error instanceof RecipeRequestError && error.code === "revision-conflict",
      });
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
    setSaveError(null);
    try {
      await sendRecipeRequest(`${apiBase}/workflow-recipes/${encodeURIComponent(recipe.id)}?expectedRevision=${recipe.revision}`, { method: "DELETE" });
      onDeleted(recipe.id);
    } catch (error) {
      const explanation = error instanceof RecipeRequestError ? error.explanation : undefined;
      setSaveError({
        message: error instanceof Error ? error.message : "删除失败",
        ...(explanation ? { explanation } : {}),
        conflict: error instanceof RecipeRequestError && error.code === "revision-conflict",
      });
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
    setSelection(null);
    setProblem(null);
    setSaveError(null);
  };

  const isDraft = working.status === "draft";
  const publishable = issues.length === 0;
  const toolButton = "flex items-center gap-1 rounded border px-2 py-1 text-2xs hover:bg-muted disabled:opacity-50";

  return (
    <section className="space-y-2 rounded-xl border bg-card p-3" data-testid="workflow-recipe-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold">{working.name}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-2xs font-medium ${isDraft ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"}`}
            data-testid="workflow-recipe-status"
          >
            {isDraft ? "草稿" : "已发布"}
          </span>
          {recipe.revision > 0 ? <span className="text-2xs text-muted-foreground">第 {recipe.revision} 版</span> : <span className="text-2xs text-muted-foreground">未保存的新方案</span>}
          {working.createdBy === "narrator" ? (
            <span className="flex items-center gap-0.5 text-2xs text-muted-foreground" title="这份草稿由叙述者起草，确认结构后发布才能运行">
              <Bot className="size-3" />
              叙述者起草
            </span>
          ) : null}
          {dirty ? <span className="text-2xs text-amber-600" data-testid="workflow-recipe-dirty">有未保存的修改</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={toolButton} onClick={() => onCreate("blank")} disabled={busy || dirty} title={dirty ? "先保存或放弃当前修改" : undefined}>
            <FilePlus2 className="size-3" />
            新建空白
          </button>
          <button type="button" className={toolButton} onClick={() => onCreate("copy")} disabled={busy || dirty} title={dirty ? "先保存或放弃当前修改" : undefined}>
            <CopyPlus className="size-3" />
            复制为草稿
          </button>
          {dirty ? (
            <button type="button" className={toolButton} onClick={discard} disabled={busy}>
              <Undo2 className="size-3" />
              放弃修改
            </button>
          ) : null}
          {confirmDelete ? (
            <>
              <button type="button" className={`${toolButton} border-destructive/50 text-destructive`} onClick={() => void remove()} disabled={busy}>
                确认删除
              </button>
              <button type="button" className={toolButton} onClick={() => setConfirmDelete(false)}>
                取消
              </button>
            </>
          ) : (
            <button type="button" className={`${toolButton} text-destructive`} onClick={() => setConfirmDelete(true)} disabled={busy}>
              <Trash2 className="size-3" />
              删除方案
            </button>
          )}
          {isDraft ? (
            <>
              <button type="button" className={toolButton} onClick={() => void save("draft")} disabled={busy || !dirty}>
                <Save className="size-3" />
                保存草稿
              </button>
              <button
                type="button"
                className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-2xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                onClick={() => void save("published")}
                disabled={busy || !publishable}
                title={publishable ? "发布后可以在上方启动运行" : "还有结构问题，修好后才能发布"}
              >
                <Upload className="size-3" />
                发布
              </button>
            </>
          ) : (
            <>
              <button type="button" className={toolButton} onClick={() => void save("draft")} disabled={busy}>
                转为草稿
              </button>
              <button
                type="button"
                className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-2xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                onClick={() => void save("published")}
                disabled={busy || !dirty || !publishable}
                title={publishable ? undefined : "已发布的方案必须结构完整；有问题可以先转为草稿再改"}
              >
                <Save className="size-3" />
                保存
              </button>
            </>
          )}
        </div>
      </div>

      {problem ? (
        <div role="alert" className="space-y-0.5 rounded-md border border-amber-400/60 bg-amber-50 p-2 text-2xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300" data-testid="workflow-op-problem">
          <div className="font-medium">{problem.what}</div>
          <div>原因：{problem.why}</div>
          <div>建议：{problem.action}</div>
        </div>
      ) : null}

      {saveError ? (
        <div role="alert" className="space-y-0.5 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-2xs text-destructive" data-testid="workflow-save-error">
          <div className="flex items-center gap-1 font-medium">
            <AlertCircle className="size-3" />
            {saveError.explanation?.what ?? saveError.message}
          </div>
          {saveError.explanation ? (
            <>
              <div>原因：{saveError.explanation.why}</div>
              <div>建议：{saveError.explanation.action}</div>
            </>
          ) : null}
          {saveError.conflict ? (
            <button
              type="button"
              className="mt-1 rounded border border-destructive/40 px-2 py-0.5 hover:bg-destructive/10"
              onClick={() => {
                setDirty(false);
                dirtyRef.current = false;
                setSaveError(null);
                onReload();
              }}
            >
              放弃我的修改并重新载入
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={toolButton} onClick={() => addNode("step")}>
          <Plus className="size-3" />
          工序
        </button>
        <button type="button" className={toolButton} onClick={() => addNode("join")}>
          <GitMerge className="size-3" />
          汇合
        </button>
        <button type="button" className={toolButton} onClick={() => addNode("end")}>
          <Flag className="size-3" />
          终点
        </button>
        <button type="button" className={toolButton} onClick={autoLayout}>
          <LayoutGrid className="size-3" />
          自动排版
        </button>
        <span className="text-2xs text-muted-foreground">
          选中节点再加工序会接在它后面；一道工序连出多条线即并行，声明结果后可按结果分支；Delete 键删除选中项。
        </span>
      </div>

      {/* 容器够宽时属性面板在画布右侧，不够宽（工作台中间栏）时换到画布下方。 */}
      <div className="flex flex-wrap gap-3">
        <div className="min-w-0 flex-[3_1_420px] overflow-hidden rounded-lg border">
          <WorkflowCanvas
            fitViewKey={fitViewKey}
            recipe={working}
            issues={issues}
            editable
            selection={selection}
            onSelect={setSelection}
            onOps={applyOps}
            onMoveNode={moveNode}
          />
        </div>
        <aside className="max-h-[600px] min-w-[260px] flex-[1_1_260px] overflow-y-auto rounded-lg border p-3">
          <WorkflowInspector recipe={working} issues={issues} selection={selection} editable onOps={applyOps} onSelect={setSelection} />
        </aside>
      </div>
    </section>
  );
}
