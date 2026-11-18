/**
 * 书内一级「工作流无限画布 & 实时运行日志 & 自定义子代理工坊」三合一工作台（对齐 GenUI v6 蓝图）。
 *
 * 1. 「无限画布编排」：左侧内置/我的方案列表 + 默认工作流一键切换；右侧基于 @xyflow/react 的点阵无限画布，
 *    内置方案可点阵预览并一键「复制为我的方案」后自由拖放节点、连线、在右侧属性面板直选内置与自定义子代理；
 * 2. 「运行工作日志 (实时)」：实时监控本书各章工作流运行拓扑、步骤状态流、事件时间轴日志与产物放行/打回；
 * 3. 「自定义子代理工坊」：按书复制内置子代理或从零新建专属子代理（受 ROSTER_FORBIDDEN_TOOLS 安全白名单保护）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Bot, CopyPlus, FilePlus2, ScrollText, Star, Workflow } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  checkWorkflowGraph,
  type WorkflowGraphRecipe,
} from "../../engine/workflows/workflow-graph.js";
import { blankRecipe, copyRecipe, uniqueRecipeId } from "./workflow-canvas/workflow-canvas-model";
import { WorkflowCanvas } from "./workflow-canvas/WorkflowCanvas";
import { WorkflowRecipeEditor } from "./workflow-canvas/WorkflowRecipeEditor";
import { WorkflowTimelinePanel } from "./WorkflowTimelinePanel";
import { WorkflowSubagentRoster } from "../workflows/WorkflowSubagentRoster";
import {
  bookApiBase,
  errorExplanation,
  jsonInit,
  workflowRequest,
  type BookDefaultWorkflowView,
  type Explanation,
} from "../workflows/workflow-api";
import { isBuiltinRecipe, stepListOf } from "../workflows/workflow-step-list-model";

export type BookWorkflowStudioMode = "canvas" | "logs" | "agents";

export interface BookWorkflowStudioProps {
  readonly bookId: string;
  readonly bookTitle?: string;
  readonly currentChapter?: number;
  readonly narratorId?: string;
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
  readonly onBackToWrite?: () => void;
  readonly initialMode?: BookWorkflowStudioMode;
}

export function BookWorkflowStudio({
  bookId,
  bookTitle,
  currentChapter,
  narratorId,
  onSendToNarrator,
  onBackToWrite,
  initialMode = "canvas",
}: BookWorkflowStudioProps) {
  const [mode, setMode] = useState<BookWorkflowStudioMode>(initialMode);
  const apiBase = bookApiBase(bookId);

  const [recipes, setRecipes] = useState<readonly WorkflowGraphRecipe[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [defaultView, setDefaultView] = useState<BookDefaultWorkflowView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; explanation?: Explanation } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, current] = await Promise.all([
        workflowRequest<{ recipes?: WorkflowGraphRecipe[] }>(`${apiBase}/workflow-recipes`),
        workflowRequest<BookDefaultWorkflowView>(`${apiBase}/workflow-default`),
      ]);
      const fetched = Array.isArray(list.recipes) ? list.recipes : [];
      setRecipes(fetched);
      setDefaultView(current);
      setSelectedId((prev) =>
        prev && fetched.some((r) => r.id === prev) ? prev : current.recipeId ?? fetched[0]?.id ?? null,
      );
    } catch (cause) {
      setError(errorExplanation(cause));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  const builtin = useMemo(() => recipes.filter(isBuiltinRecipe), [recipes]);
  const mine = useMemo(() => recipes.filter((r) => !isBuiltinRecipe(r)), [recipes]);
  const selected = recipes.find((r) => r.id === selectedId) ?? recipes[0] ?? null;

  const handleSetDefault = async (recipeId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const next = await workflowRequest<BookDefaultWorkflowView>(
        `${apiBase}/workflow-default`,
        jsonInit("PUT", { recipeId }),
      );
      setDefaultView(next);
    } catch (cause) {
      setError(errorExplanation(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateRecipe = (createMode: "blank" | "copy", sourceOverride?: WorkflowGraphRecipe) => {
    const taken = new Set(recipes.map((r) => r.id));
    const source = sourceOverride ?? selected;
    const created =
      createMode === "copy" && source
        ? copyRecipe(source, uniqueRecipeId(`${source.id}-custom`, taken), `${source.name}（定制）`)
        : blankRecipe(uniqueRecipeId("custom-workflow", taken), "新建自定义工作流");
    setRecipes((prev) => [...prev, created]);
    setSelectedId(created.id);
    setDirty(true);
  };

  const handleSavedRecipe = (saved: WorkflowGraphRecipe) => {
    setRecipes((prev) => {
      const exists = prev.some((r) => r.id === saved.id);
      return exists ? prev.map((r) => (r.id === saved.id ? saved : r)) : [...prev, saved];
    });
    setSelectedId(saved.id);
    setDirty(false);
  };

  const handleDeletedRecipe = (recipeId: string) => {
    setRecipes((prev) => {
      const next = prev.filter((r) => r.id !== recipeId);
      setSelectedId(next[0]?.id ?? null);
      return next;
    });
    setDirty(false);
  };

  const selectedIsBuiltin = selected ? isBuiltinRecipe(selected) : false;
  const selectedIssues = useMemo(() => (selected ? checkWorkflowGraph(selected) : []), [selected]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="book-workflow-studio">
      {/* 顶栏：与 GenUI v6 工作流画布顶栏对齐 */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card/80 px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Workflow className="size-4 text-primary" />
            <h2 className="text-sm font-bold text-foreground">
              工作流无限画布 & 子代理工坊{bookTitle ? ` · 《${bookTitle}》` : ""}
            </h2>
          </div>

          <div
            className="inline-flex rounded-md border border-border bg-muted/50 p-0.5 text-xs"
            role="tablist"
            aria-label="工作流工坊模式切换"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "canvas"}
              data-testid="wf-studio-tab-canvas"
              onClick={() => setMode("canvas")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors",
                mode === "canvas" ? "bg-card text-primary shadow-2xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Workflow className="size-3.5" />
              <span>无限画布编排</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "logs"}
              data-testid="wf-studio-tab-logs"
              onClick={() => setMode("logs")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors",
                mode === "logs" ? "bg-card text-primary shadow-2xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <ScrollText className="size-3.5" />
              <span>运行工作日志 (实时)</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "agents"}
              data-testid="wf-studio-tab-agents"
              onClick={() => setMode("agents")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors",
                mode === "agents" ? "bg-card text-primary shadow-2xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Bot className="size-3.5" />
              <span>自定义子代理工坊</span>
            </button>
          </div>
        </div>

        {onBackToWrite ? (
          <Button type="button" size="xs" variant="outline" onClick={onBackToWrite} data-testid="wf-back-to-write">
            回码字台
          </Button>
        ) : null}
      </header>

      {/* 主体区 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === "canvas" ? (
          <div className="flex h-full min-h-0">
            {/* 左列：方案列表 + 本书默认工作流设置 */}
            <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card/50">
              <div className="space-y-1.5 border-b border-border p-2.5 text-2xs">
                <div className="flex items-center gap-1 font-semibold text-foreground">
                  <Star className="size-3.5 text-warning" />
                  <span>本书默认工作流</span>
                </div>
                <div className="truncate text-muted-foreground">
                  {defaultView?.recipeName && defaultView.recipeId
                    ? defaultView.recipeName
                    : "未设置（写章时按需选）"}
                </div>
                {selected && selected.status === "published" && selected.revision > 0 && defaultView?.recipeId !== selected.id ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void handleSetDefault(selected.id)}
                    className="h-6 w-full text-2xs"
                  >
                    设为本书默认
                  </Button>
                ) : defaultView?.storedRecipeId ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void handleSetDefault(null)}
                    className="h-6 w-full text-2xs"
                  >
                    取消默认绑定
                  </Button>
                ) : null}
              </div>

              <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
                <span className="text-2xs font-bold text-muted-foreground">工作流方案</span>
                <button
                  type="button"
                  disabled={dirty}
                  onClick={() => handleCreateRecipe("blank")}
                  className="inline-flex items-center gap-0.5 text-2xs font-semibold text-primary hover:underline disabled:opacity-50"
                >
                  <FilePlus2 className="size-3" />
                  <span>新建</span>
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-3">
                {mine.length > 0 ? (
                  <div className="space-y-1">
                    <div className="px-1 text-2xs font-semibold text-primary">我的定制画布 ({mine.length})</div>
                    {mine.map((recipe) => {
                      const active = recipe.id === selected?.id;
                      const isDef = defaultView?.recipeId === recipe.id;
                      return (
                        <button
                          key={recipe.id}
                          type="button"
                          disabled={dirty && !active}
                          onClick={() => setSelectedId(recipe.id)}
                          className={cn(
                            "w-full rounded-md border p-2 text-left text-xs transition-colors disabled:opacity-50",
                            active ? "border-primary bg-card font-semibold text-primary shadow-2xs" : "border-border/60 hover:bg-card",
                          )}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate">{recipe.name}</span>
                            {isDef ? <Star className="size-3 shrink-0 fill-current text-warning" /> : null}
                          </div>
                          <div className="mt-0.5 text-2xs text-muted-foreground">
                            {stepListOf(recipe).steps.length} 道工序 · {recipe.status === "draft" ? "草稿" : "已发布"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                <div className="space-y-1">
                  <div className="flex items-center justify-between px-1 text-2xs font-semibold text-muted-foreground">
                    <span>内置方案模板</span>
                    <Badge variant="secondary" className="h-4 px-1 text-2xs">可复制改图</Badge>
                  </div>
                  {builtin.map((recipe) => {
                    const active = recipe.id === selected?.id;
                    const isDef = defaultView?.recipeId === recipe.id;
                    return (
                      <button
                        key={recipe.id}
                        type="button"
                        disabled={dirty && !active}
                        onClick={() => setSelectedId(recipe.id)}
                        className={cn(
                          "w-full rounded-md border p-2 text-left text-xs transition-colors disabled:opacity-50",
                          active ? "border-primary bg-card font-semibold text-primary shadow-2xs" : "border-border/60 hover:bg-card",
                        )}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate">{recipe.name}</span>
                          {isDef ? <Star className="size-3 shrink-0 fill-current text-warning" /> : null}
                        </div>
                        <div className="mt-0.5 text-2xs text-muted-foreground">
                          {stepListOf(recipe).steps.length} 道工序 · 已发布
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>

            {/* 右侧主画布区：我的方案直接可拖放编辑；内置方案点阵画布预览 + 一键复制为可编辑画布 */}
            <div className="flex min-w-0 flex-1 flex-col p-3">
              {error ? (
                <div role="alert" className="mb-2 flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <span className="inline-flex items-center gap-1.5">
                    <AlertCircle className="size-3.5" />
                    {error.explanation?.what ?? error.message}
                  </span>
                  <Button type="button" size="xs" variant="outline" onClick={() => void load()}>重试</Button>
                </div>
              ) : null}

              {loading && !selected ? (
                <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                  正在载入工作流无限画布…
                </div>
              ) : selected ? (
                selectedIsBuiltin ? (
                  <div className="flex h-full min-h-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-foreground">{selected.name}</span>
                          <Badge variant="outline" className="text-2xs">内置模板 · 点阵画布预览</Badge>
                        </div>
                        <p className="truncate text-2xs text-muted-foreground">{selected.description}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => setMode("agents")}
                        >
                          配置自定义子代理
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          onClick={() => handleCreateRecipe("copy", selected)}
                          data-testid="wf-copy-to-editable-canvas"
                          className="gap-1"
                        >
                          <CopyPlus className="size-3.5" />
                          <span>复制为可编辑无限画布</span>
                        </Button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-[var(--nf-paper,var(--card))]">
                      <WorkflowCanvas
                        recipe={selected}
                        issues={selectedIssues}
                        editable={false}
                        className="h-full min-h-[420px]"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <WorkflowRecipeEditor
                      key={`${selected.id}:${selected.revision}`}
                      recipe={selected}
                      apiBase={apiBase}
                      onSaved={handleSavedRecipe}
                      onDeleted={handleDeletedRecipe}
                      onCreate={(m) => handleCreateRecipe(m)}
                      onReload={() => void load()}
                      onDirtyChange={setDirty}
                    />
                  </div>
                )
              ) : null}
            </div>
          </div>
        ) : mode === "logs" ? (
          <div className="h-full overflow-y-auto p-4">
            <WorkflowTimelinePanel
              bookId={bookId}
              currentChapter={currentChapter}
              {...(narratorId ? { narratorId } : {})}
              {...(onSendToNarrator ? { onSendToNarrator } : {})}
            />
          </div>
        ) : (
          <div className="h-full overflow-y-auto p-4">
            <WorkflowSubagentRoster bookId={bookId} />
          </div>
        )}
      </div>
    </div>
  );
}
