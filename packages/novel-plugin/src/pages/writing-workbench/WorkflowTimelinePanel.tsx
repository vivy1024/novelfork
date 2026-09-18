import React, { useState, useEffect } from "react";
import {
  Workflow,
  Play,
  RotateCcw,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Bot,
  Sparkles,
  Wrench,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import type {
  NovelWorkflowRecipe,
  NovelWorkflowStep,
} from "../../engine/workflows/novel-workflows.js";

export interface WorkflowTimelinePanelProps {
  bookId: string;
  currentChapter?: number;
  onSendToNarrator?: (message: string) => Promise<void> | void;
}

/**
 * 构建发送给主叙述者的工作流执行结构化指令。
 * 完整传递选定 recipe 的各阶段配置、代理、模型覆盖、工具指引、自定义 prompt 与门禁要求。
 * 明确注明：工具白名单为工序推荐提示，非底层强制隔离权限。
 */
export function buildWorkflowExecutionMessage(
  recipe: NovelWorkflowRecipe,
  chapterNumber: number
): string {
  const lines: string[] = [
    `【创作工作流执行请求】请主叙述者按照以下创作工序指导推进第 ${chapterNumber} 章：`,
    `流水线方案：${recipe.name}（${recipe.commandId}）`,
    `方案说明：${recipe.description || "无"}`,
    `目标章节：第 ${chapterNumber} 章 | 成果策略：${recipe.resultStrategy}`,
    "",
    "【阶段工序与角色装配一览】（注意：所列工具为工序推荐要求，权限受宿主环境策略约束；若标注人工门禁，请在生成对应阶段产物后等待作者确认）：",
  ];

  recipe.steps.forEach((step, idx) => {
    const execMode = step.executionMode ?? (step.agentId ? "subagent" : "tool-only");
    const stepLines: string[] = [
      `${idx + 1}. [${step.enabled ? "启用" : "停用"}] ${step.label} (类型: ${step.kind})`,
      `   - 执行模式: ${execMode}${step.agentId ? ` (挂载角色/子代理: ${step.agentId})` : ""}`,
    ];
    if (step.modelOverride) {
      stepLines.push(`   - 建议模型: ${step.modelOverride}`);
    }
    if (step.tools && step.tools.length > 0) {
      stepLines.push(`   - 推荐工具(提示要求非强制隔离): ${step.tools.join(", ")}`);
    }
    if (step.skills && step.skills.length > 0) {
      stepLines.push(`   - 挂载技巧: ${step.skills.join(", ")}`);
    }
    if (step.customPrompt) {
      stepLines.push(`   - 阶段定向指令: ${step.customPrompt}`);
    }
    if (step.requiresApproval) {
      stepLines.push(`   - 阶段门禁: 开启人工审核门禁（HITL），此阶段产出后须停下供作者核验`);
    }
    lines.push(stepLines.join("\n"));
  });

  lines.push("");
  lines.push(`请按顺序推进各工序，结合本作品背景与叙事记忆起草第 ${chapterNumber} 章。`);
  return lines.join("\n");
}

export function WorkflowTimelinePanel({
  bookId,
  currentChapter = 1,
  onSendToNarrator,
}: WorkflowTimelinePanelProps) {
  // 不使用预置死数据作为初始状态，防止请求未完成或失败时向用户展示假配置
  const [recipes, setRecipes] = useState<readonly NovelWorkflowRecipe[]>([]);
  const [activeRecipeId, setActiveRecipeId] = useState<string>("");
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  // 从后端路由拉取该作品的真实工作流配置；采用 AbortController 与 cancelled 标志杜绝跨作品竞态
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const fetchRecipes = async () => {
      if (!bookId) {
        setRecipes([]);
        setActiveRecipeId("");
        setIsLoading(false);
        setLoadError(null);
        return;
      }

      setIsLoading(true);
      setLoadError(null);
      setActionError(null);
      setSendSuccess(false);

      try {
        const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/workflow-recipes`, {
          signal: controller.signal,
        });
        if (cancelled) return;

        if (!res.ok) {
          throw new Error(`加载工作流配置失败: HTTP ${res.status}`);
        }

        const data = (await res.json()) as { recipes?: readonly NovelWorkflowRecipe[] };
        if (cancelled) return;

        const fetchedRecipes = Array.isArray(data.recipes) ? data.recipes : [];
        setRecipes(fetchedRecipes);
        if (fetchedRecipes.length > 0) {
          setActiveRecipeId((prev) =>
            fetchedRecipes.some((r) => r.id === prev) ? prev : fetchedRecipes[0].id
          );
        } else {
          setActiveRecipeId("");
        }
      } catch (err: unknown) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        setRecipes([]);
        setActiveRecipeId("");
        setLoadError(err instanceof Error ? err.message : "获取工作流配置失败");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchRecipes();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [bookId]);

  const selectedRecipe = recipes.find((r) => r.id === activeRecipeId) ?? recipes[0];

  const handleManualRefresh = () => {
    if (!bookId || isLoading) return;
    setIsLoading(true);
    setLoadError(null);
    setActionError(null);

    fetch(`/api/books/${encodeURIComponent(bookId)}/workflow-recipes`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`加载工作流配置失败: HTTP ${res.status}`);
        const data = (await res.json()) as { recipes?: readonly NovelWorkflowRecipe[] };
        const fetchedRecipes = Array.isArray(data.recipes) ? data.recipes : [];
        setRecipes(fetchedRecipes);
        if (fetchedRecipes.length > 0) {
          setActiveRecipeId((prev) =>
            fetchedRecipes.some((r) => r.id === prev) ? prev : fetchedRecipes[0].id
          );
        } else {
          setActiveRecipeId("");
        }
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : "刷新工作流配置失败");
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  const handleStartWorkflow = async () => {
    if (!onSendToNarrator || !selectedRecipe || isRunning || isLoading) return;
    setIsRunning(true);
    setActionError(null);
    setSendSuccess(false);

    try {
      const message = buildWorkflowExecutionMessage(selectedRecipe, currentChapter);
      await onSendToNarrator(message);
      setSendSuccess(true);
      setTimeout(() => setSendSuccess(false), 3000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "向叙述者发送执行请求失败");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground overflow-y-auto p-6 gap-6">
      {/* 顶部总控台：明确为工作流推演与叙述者调度请求 */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Workflow className="size-5 text-primary" />
            <h2 className="text-base font-semibold">创作工作流推演与调度</h2>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              第 {currentChapter} 章
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            从作品底层（story/workflow_recipes.json）读取装配工序，向主叙述者发起结构化的章节创作指令。
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">生产方案：</span>
            <select
              aria-label="生产方案"
              value={activeRecipeId}
              onChange={(e) => setActiveRecipeId(e.target.value)}
              disabled={isLoading || recipes.length === 0}
              className="rounded-lg border bg-background px-3 py-1.5 text-xs font-medium outline-none focus:border-primary disabled:opacity-50"
            >
              {recipes.length === 0 ? (
                <option value="">{isLoading ? "正在读取配置…" : "无可用工作流"}</option>
              ) : (
                recipes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.steps.length} 阶段)
                  </option>
                ))
              )}
            </select>
          </div>

          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isLoading || !bookId}
            title="刷新工作流配置"
            className="rounded-lg border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>

          <button
            type="button"
            onClick={() => void handleStartWorkflow()}
            disabled={isRunning || isLoading || !selectedRecipe || !onSendToNarrator}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Play className="size-3.5 fill-current" />
            {isRunning ? "正在发送执行请求…" : "调度叙述者推进本章"}
          </button>
        </div>
      </div>

      {/* 状态反馈通知 */}
      {loadError && (
        <div role="alert" className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={handleManualRefresh}
            className="rounded border border-destructive/30 px-2 py-1 text-2xs font-medium hover:bg-destructive/10"
          >
            重试
          </button>
        </div>
      )}

      {actionError && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {sendSuccess && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>已将工作流执行工序完整传递给主叙述者，请在对话窗口查看推进过程。</span>
        </div>
      )}

      {/* 竖向时间线阶段列表 */}
      <div className="flex flex-col gap-4 max-w-4xl">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground">阶段执行时序 (Timeline)</span>
          <span className="text-xs text-muted-foreground">
            共 {selectedRecipe?.steps.length ?? 0} 个工序阶段
          </span>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            正在从作品配置载入工作流阶段…
          </div>
        ) : !selectedRecipe ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-xs text-muted-foreground">
            未找到有效的工作流配置。请在作品装配平台保存工作流方案后再试。
          </div>
        ) : (
          <div className="relative pl-6 flex flex-col gap-6 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-[2px] before:bg-border">
            {selectedRecipe.steps.map((step, index) => {
              const isExpanded = expandedStepId === step.id;
              const execMode = step.executionMode ?? (step.agentId ? "subagent" : "tool-only");

              return (
                <div key={step.id} className="relative">
                  {/* 时间线圆点 */}
                  <div
                    className={`absolute -left-[30px] top-3.5 flex size-5 items-center justify-center rounded-full border-2 bg-background text-2xs font-bold ${
                      step.enabled
                        ? "border-primary text-primary"
                        : "border-muted text-muted-foreground"
                    }`}
                  >
                    {index + 1}
                  </div>

                  {/* 阶段卡片 */}
                  <div
                    className={`rounded-xl border bg-card transition-all ${
                      isExpanded ? "border-primary/50 shadow-md" : "border-border shadow-sm hover:border-border/80"
                    }`}
                  >
                    <div className="flex items-center justify-between p-4">
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{step.label}</span>
                          <span className="rounded bg-muted px-2 py-0.5 text-2xs font-mono text-muted-foreground">
                            {step.kind}
                          </span>

                          {execMode === "subagent" && (
                            <span className="flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-2xs font-medium text-secondary-foreground">
                              <Bot className="size-3" />
                              {step.agentId ?? "挂载子代理"}
                            </span>
                          )}

                          {execMode === "autonomous" && (
                            <span className="flex items-center gap-1 rounded bg-purple-100 px-2 py-0.5 text-2xs font-medium text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
                              <Sparkles className="size-3" />
                              主代理自主派发
                            </span>
                          )}

                          {execMode === "tool-only" && (
                            <span className="flex items-center gap-1 rounded border px-2 py-0.5 text-2xs text-muted-foreground">
                              <Wrench className="size-3" />
                              纯工具流水线
                            </span>
                          )}

                          {step.requiresApproval && (
                            <span className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-2xs font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                              <ShieldCheck className="size-3" />
                              人工审核门禁 (HITL)
                            </span>
                          )}
                        </div>

                        {step.tools && step.tools.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            建议调用工具（提示要求，非强制权限）:{" "}
                            <span className="font-mono text-foreground">{step.tools.join(" · ")}</span>
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0 ml-4">
                        <button
                          type="button"
                          onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          {isExpanded ? "收起推演" : "查看推演"}
                          {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* 展开的推演与提示词详情 */}
                    {isExpanded && (
                      <div className="border-t bg-muted/20 p-4 space-y-3 text-xs">
                        {step.customPrompt && (
                          <div className="space-y-1">
                            <div className="font-medium text-muted-foreground">阶段定制 Prompt 指令：</div>
                            <div className="rounded border bg-card p-2.5 font-mono text-xs whitespace-pre-wrap">
                              {step.customPrompt}
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-between rounded border bg-card p-3">
                          <div className="space-y-0.5">
                            <span className="font-medium">阶段装配状态</span>
                            <p className="text-2xs text-muted-foreground">
                              {step.enabled
                                ? "此阶段已在流水线中启用，将作为提示要求传达给叙述者"
                                : "阶段已被作者停用，执行时将跳过"}
                            </p>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded text-2xs font-medium ${
                              step.enabled
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {step.enabled ? "已启用" : "已停用"}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

