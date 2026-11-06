/**
 * 「套路 › 工作流」页：按书管理写章流程。
 *
 * - 方案：内置方案只读、可复制；自己的方案可编辑（纵向步骤列表）、发布；可设为本书默认。
 * - 运行：本书的运行记录与详情，在这里确认 / 打回。
 * - 子代理：内置帮手的职责与可用工具（只读）。
 *
 * 方案按书存（每本书一份），所以页面顶部先选书。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, BookOpen, Star, Workflow } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WorkflowGraphRecipe } from "../../engine/workflows/workflow-graph.js";
import { copyRecipe, uniqueRecipeId } from "../writing-workbench/workflow-canvas/workflow-canvas-model";
import { bookApiBase, errorExplanation, jsonInit, workflowRequest, type BookDefaultWorkflowView, type Explanation } from "./workflow-api";
import { isBuiltinRecipe, stepListOf } from "./workflow-step-list-model";
import { WorkflowRunsPanel } from "./WorkflowRunsPanel";
import { WorkflowStepListEditor } from "./WorkflowStepListEditor";
import { WorkflowSubagentRoster } from "./WorkflowSubagentRoster";

export interface WorkflowsPageBook {
  readonly id: string;
  readonly title: string;
}

export interface WorkflowsPageProps {
  readonly books: readonly WorkflowsPageBook[];
  readonly selectedBookId: string | null;
  readonly onSelectBook: (bookId: string) => void;
  readonly initialTab?: WorkflowsPageTab;
}

export type WorkflowsPageTab = "recipes" | "runs" | "subagents";

const selectClass = "h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export function WorkflowsPage({ books, selectedBookId, onSelectBook, initialTab = "recipes" }: WorkflowsPageProps) {
  const bookId = selectedBookId && books.some((book) => book.id === selectedBookId) ? selectedBookId : books[0]?.id ?? null;
  const [tab, setTab] = useState<WorkflowsPageTab>(initialTab);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6" data-testid="workflows-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Workflow className="size-5 text-primary" aria-hidden />工作流</h2>
          <p className="text-xs text-muted-foreground">写一章分几道工序、谁来做、哪里停下等你确认。每本书可以有自己的默认工作流。</p>
        </div>
        {books.length > 0 ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <BookOpen className="size-4" aria-hidden />
            作品
            <select aria-label="选择作品" className={selectClass} value={bookId ?? ""} onChange={(event) => onSelectBook(event.target.value)}>
              {books.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
            </select>
          </label>
        ) : null}
      </header>

      <Tabs value={tab} onValueChange={(value) => setTab(value as WorkflowsPageTab)}>
        <TabsList aria-label="工作流页签">
          <TabsTrigger value="recipes">方案</TabsTrigger>
          <TabsTrigger value="runs">运行</TabsTrigger>
          <TabsTrigger value="subagents">子代理</TabsTrigger>
        </TabsList>
        <TabsContent value="recipes">
          {bookId ? <RecipesTab key={bookId} bookId={bookId} /> : <NoBook />}
        </TabsContent>
        <TabsContent value="runs">
          {bookId ? <WorkflowRunsPanel key={bookId} apiBase={bookApiBase(bookId)} /> : <NoBook />}
        </TabsContent>
        <TabsContent value="subagents">
          <WorkflowSubagentRoster />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NoBook() {
  return <p className="text-sm text-muted-foreground">还没有作品。先在「我的作品」里新建一本书，工作流按书保存。</p>;
}

function RecipesTab({ bookId }: { bookId: string }) {
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
      setSelectedId((prev) => (prev && fetched.some((recipe) => recipe.id === prev) ? prev : current.recipeId ?? fetched[0]?.id ?? null));
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
  const mine = useMemo(() => recipes.filter((recipe) => !isBuiltinRecipe(recipe)), [recipes]);
  const selected = recipes.find((recipe) => recipe.id === selectedId) ?? null;

  const setDefault = async (recipeId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const next = await workflowRequest<BookDefaultWorkflowView>(`${apiBase}/workflow-default`, jsonInit("PUT", { recipeId }));
      setDefaultView(next);
    } catch (cause) {
      setError(errorExplanation(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = (source: WorkflowGraphRecipe) => {
    const taken = new Set(recipes.map((recipe) => recipe.id));
    const created = copyRecipe(source, uniqueRecipeId(`${source.id}-mine`, taken), `${source.name}（我的）`);
    setRecipes((current) => [...current, created]);
    setSelectedId(created.id);
  };

  const recipeButton = (recipe: WorkflowGraphRecipe) => {
    const isDefault = defaultView?.recipeId === recipe.id;
    return (
      <li key={recipe.id}>
        <button
          type="button"
          aria-pressed={recipe.id === selectedId}
          disabled={dirty && recipe.id !== selectedId}
          title={dirty && recipe.id !== selectedId ? "先保存或放弃当前修改" : undefined}
          onClick={() => setSelectedId(recipe.id)}
          className={`w-full space-y-0.5 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50 ${recipe.id === selectedId ? "border-primary bg-primary/5" : ""}`}
        >
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate font-medium">{recipe.name}</span>
            {isDefault ? <Star className="size-3.5 fill-current text-warning" aria-label="本书默认" /> : null}
          </div>
          <div className="text-muted-foreground">
            {stepListOf(recipe).steps.length} 道工序 · {recipe.status === "draft" ? "草稿" : "已发布"}{recipe.revision === 0 ? " · 未保存" : ""}
          </div>
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-3" data-testid="workflow-recipes-tab">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-xs" data-testid="workflow-book-default">
        <Star className="size-4 text-warning" aria-hidden />
        <span>本书默认工作流：</span>
        <span className="font-medium">{defaultView?.recipeName && defaultView.recipeId ? defaultView.recipeName : "未设置（写章时自己选）"}</span>
        {selected && selected.status === "published" && selected.revision > 0 && defaultView?.recipeId !== selected.id ? (
          <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => void setDefault(selected.id)}>
            把「{selected.name}」设为本书默认
          </Button>
        ) : null}
        {defaultView?.storedRecipeId ? (
          <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => void setDefault(null)}>清除默认</Button>
        ) : null}
        {defaultView?.notice ? <span className="w-full text-warning">{defaultView.notice.what}。{defaultView.notice.action}。</span> : null}
      </div>

      {error ? (
        <div role="alert" className="space-y-0.5 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive" data-testid="workflow-recipes-error">
          <div className="flex items-center gap-1 font-medium"><AlertCircle className="size-3.5" aria-hidden />{error.explanation?.what ?? error.message}</div>
          {error.explanation ? <><div>原因：{error.explanation.why}</div><div>建议：{error.explanation.action}</div></> : null}
          <Button type="button" size="xs" variant="outline" onClick={() => void load()}>重试</Button>
        </div>
      ) : null}

      {loading && recipes.length === 0 ? <p className="text-xs text-muted-foreground">正在读取…</p> : null}

      <div className="flex flex-wrap gap-4">
        <nav className="w-full max-w-60 space-y-3" aria-label="方案列表">
          <div className="space-y-1">
            <h3 className="text-xs font-semibold text-muted-foreground">内置方案 <Badge variant="secondary">只读</Badge></h3>
            <ul className="space-y-1" data-testid="workflow-builtin-list">{builtin.map(recipeButton)}</ul>
          </div>
          <div className="space-y-1">
            <h3 className="text-xs font-semibold text-muted-foreground">我的方案</h3>
            {mine.length === 0 ? <p className="text-xs text-muted-foreground">还没有。选一个内置方案点「复制为我的方案」开始改。</p> : null}
            <ul className="space-y-1" data-testid="workflow-mine-list">{mine.map(recipeButton)}</ul>
          </div>
        </nav>
        <div className="min-w-0 flex-1">
          {selected ? (
            <WorkflowStepListEditor
              recipe={selected}
              apiBase={apiBase}
              onSaved={(saved) => {
                setRecipes((current) => current.map((recipe) => (recipe.id === saved.id ? saved : recipe)));
                // 默认方案转回草稿后，有效默认会失效：重读一次说明。
                if (defaultView?.storedRecipeId === saved.id) void load();
              }}
              onDeleted={(recipeId) => {
                setRecipes((current) => current.filter((recipe) => recipe.id !== recipeId));
                setSelectedId(null);
                setDirty(false);
                if (defaultView?.storedRecipeId === recipeId) void load();
              }}
              onCopy={handleCopy}
              onDirtyChange={setDirty}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
