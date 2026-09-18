import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect } from "@/components/ui/simple-select";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Plus,
  Save,
  Trash2,
  Workflow,
  Wrench,
  Sparkles,
  Sliders,
  Check,
} from "lucide-react";
import {
  DEFAULT_WRITE_NEXT_RECIPE,
  DEFAULT_AUDIT_RECIPE,
  type WorkflowRecipeConfig,
  type WorkflowStepConfig,
  type WorkflowStepKind,
} from "../../shared/workflow-recipe";
import { createCustomSubagentsClient, type CustomSubagent } from "../runtime-admin/custom-subagents";
import { createWorkflowClient } from "../runtime/workflow-client";

export interface WorkflowRecipesSectionProps {
  readonly bookId?: string;
  readonly bookTitle?: string;
}

const workflowClient = createWorkflowClient();

/** 常用候选工具集（通用工具 + 小说领域只读/写入工具） */
const ALL_CANDIDATE_TOOLS: readonly string[] = [
  "cockpit.snapshot",
  "scene.spec",
  "pipeline.write",
  "chapter.read",
  "chapter.list",
  "chapter.audit",
  "lore.read",
  "lore.write",
  "memory.read",
  "memory.graph",
  "memory.events",
  "resource.manage",
  "character.check_consistency",
  "writing-skills.read",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "WebSearch",
  "Bash",
];

const STEP_KIND_LABELS: Record<WorkflowStepKind, string> = {
  "context-load": "上下文装配",
  "guided-plan": "镜头大纲规划",
  "approval-gate": "用户批准门禁",
  "writer-generate": "正文起草生成",
  "canvas-open": "结果挂载画布",
  "audit": "质量审查",
  "adversarial-audit": "多视角对抗审查",
  "post-settlement": "章后账本结算",
  "custom-tool": "自定义工具调用",
};

export function WorkflowRecipesSection({ bookId, bookTitle }: WorkflowRecipesSectionProps = {}) {
  const [recipes, setRecipes] = useState<readonly WorkflowRecipeConfig[]>([
    DEFAULT_WRITE_NEXT_RECIPE,
    DEFAULT_AUDIT_RECIPE,
  ]);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>(DEFAULT_WRITE_NEXT_RECIPE.id);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const [registeredSubagents, setRegisteredSubagents] = useState<readonly CustomSubagent[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 从后端加载当前作品的工作流配置；带有 AbortController 与取消防串书标志
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setIsLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSaveSuccess(false);

    workflowClient
      .list(bookId, controller.signal)
      .then((data) => {
        if (cancelled) return;
        setRecipes(data);
        if (data.length > 0) {
          setSelectedRecipeId((prev) => (data.some((r) => r.id === prev) ? prev : data[0].id));
        }
        setIsDirty(false);
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        setLoadError(err instanceof Error ? err.message : "加载作品工作流配置失败");
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [bookId]);

  // 动态读取系统中已创建的所有自定义子代理
  useEffect(() => {
    let cancelled = false;
    const client = createCustomSubagentsClient();
    client
      .list()
      .then((subs) => {
        if (!cancelled) setRegisteredSubagents(subs);
      })
      .catch(() => {
        if (!cancelled) setRegisteredSubagents([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedRecipe = recipes.find((r) => r.id === selectedRecipeId) ?? recipes[0];

  const handleUpdateStep = useCallback((stepId: string, patch: Partial<WorkflowStepConfig>) => {
    if (!selectedRecipe) return;
    const updatedSteps = selectedRecipe.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s));
    const updatedRecipe = { ...selectedRecipe, steps: updatedSteps };
    setRecipes((prev) => prev.map((r) => (r.id === selectedRecipe.id ? updatedRecipe : r)));
    setIsDirty(true);
  }, [selectedRecipe]);

  const handleToggleStep = (stepId: string, enabled: boolean) => {
    handleUpdateStep(stepId, { enabled });
  };

  const handleAddRecipe = () => {
    const newRecipe: WorkflowRecipeConfig = {
      id: `recipe-${Date.now()}`,
      name: "新流水线",
      commandId: `/custom:${Date.now()}`,
      description: "自定义创作流水线，组合子代理、规则与执行门禁",
      steps: [
        {
          id: `step-${Date.now()}-1`,
          kind: "context-load",
          label: "装配上下文与预检",
          enabled: true,
          executionMode: "tool-only",
          tools: ["cockpit.snapshot", "lore.read", "memory.read"],
        },
        {
          id: `step-${Date.now()}-2`,
          kind: "writer-generate",
          label: "正文起草",
          enabled: true,
          executionMode: "subagent",
          agentId: "writer",
          tools: ["pipeline.write"],
        },
        {
          id: `step-${Date.now()}-3`,
          kind: "adversarial-audit",
          label: "多视角质量审查",
          enabled: true,
          executionMode: "autonomous",
          requiresApproval: true,
          customPrompt: "由主代理根据本章剧情冲突，自主派发适宜的子代理进行前文一致性与毒点核验。",
        },
      ],
      resultStrategy: "formal-chapter",
      requireFinalApproval: true,
      maxRetries: 1,
    };
    setRecipes([...recipes, newRecipe]);
    setSelectedRecipeId(newRecipe.id);
    setIsDirty(true);
  };

  const handleDeleteRecipe = (id: string) => {
    if (recipes.length <= 1) return;
    const next = recipes.filter((r) => r.id !== id);
    setRecipes(next);
    setSelectedRecipeId(next[0]?.id ?? "");
    setIsDirty(true);
  };

  const handleAddStep = () => {
    if (!selectedRecipe) return;
    const newStep: WorkflowStepConfig = {
      id: `step-${Date.now()}`,
      kind: "custom-tool",
      label: "新建阶段",
      enabled: true,
      executionMode: "subagent",
      tools: ["Read"],
    };
    const updatedRecipe = { ...selectedRecipe, steps: [...selectedRecipe.steps, newStep] };
    setRecipes((prev) => prev.map((r) => (r.id === selectedRecipe.id ? updatedRecipe : r)));
    setExpandedStepId(newStep.id);
    setIsDirty(true);
  };

  const handleDeleteStep = (stepId: string) => {
    if (!selectedRecipe || selectedRecipe.steps.length <= 1) return;
    const updatedSteps = selectedRecipe.steps.filter((s) => s.id !== stepId);
    const updatedRecipe = { ...selectedRecipe, steps: updatedSteps };
    setRecipes((prev) => prev.map((r) => (r.id === selectedRecipe.id ? updatedRecipe : r)));
    if (expandedStepId === stepId) setExpandedStepId(null);
    setIsDirty(true);
  };

  const handleToggleTool = (step: WorkflowStepConfig, toolName: string) => {
    const current = new Set(step.tools ?? []);
    if (current.has(toolName)) current.delete(toolName);
    else current.add(toolName);
    handleUpdateStep(step.id, { tools: Array.from(current) });
  };

  const handleSaveToBackend = async () => {
    if (!bookId) {
      setSaveError("请先选择作品，以将流水线持久化保存到该作品目录。");
      return;
    }
    const targetBookId = bookId;
    setIsSaving(true);
    setSaveError(null);
    try {
      await workflowClient.save(targetBookId, recipes);
      if (targetBookId === bookId) {
        setIsDirty(false);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存工作流失败");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 text-foreground" data-testid="workflow-recipes-section">
      <div className="flex items-center justify-between border-b pb-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Workflow className="size-5 text-primary" />
            创作工作流装配平台
            {bookTitle && (
              <span className="text-xs font-normal text-muted-foreground">
                · 当前作品：《{bookTitle}》
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            配置持久化存储在作品目录（story/workflow_recipes.json），供工作台与主叙述者统一调度。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              有未保存改动
            </span>
          )}
          <Button
            size="sm"
            onClick={() => void handleSaveToBackend()}
            disabled={isSaving || !bookId || isLoading}
            className="gap-1.5"
          >
            {saveSuccess ? <Check className="size-3.5 text-emerald-300" /> : <Save className="size-3.5" />}
            {isSaving ? "正在落盘…" : saveSuccess ? "已持久化" : "保存工作流"}
          </Button>
          <Button size="sm" variant="outline" onClick={handleAddRecipe} className="gap-1.5">
            <Plus className="size-3.5" />
            新建流水线
          </Button>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {loadError}
        </div>
      )}

      {saveError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {saveError}
        </div>
      )}

      {selectedRecipe && (
        <div className="grid flex-1 grid-cols-12 gap-6 overflow-hidden">
          {/* 左侧流水线列表 */}
          <div className="col-span-4 flex flex-col gap-2 border-r pr-4 overflow-y-auto">
            <span className="text-xs font-semibold text-muted-foreground pb-1">已配置流水线</span>
            {recipes.map((recipe) => (
              <Card
                key={recipe.id}
                className={`cursor-pointer transition-colors hover:border-primary/50 ${
                  recipe.id === selectedRecipe.id ? "border-primary bg-primary/5" : ""
                }`}
                onClick={() => {
                  setSelectedRecipeId(recipe.id);
                  setExpandedStepId(null);
                }}
              >
                <CardHeader className="p-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium">{recipe.name}</CardTitle>
                    <Badge variant="outline" className="text-2xs font-mono">
                      {recipe.commandId}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs line-clamp-2 mt-1">
                    {recipe.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>

          {/* 右侧阶段流水线装配详情 */}
          <div className="col-span-8 flex flex-col gap-4 overflow-y-auto pr-2">
            <div className="flex items-center justify-between border-b pb-2">
              <div>
                <h3 className="text-sm font-semibold">{selectedRecipe.name}</h3>
                <p className="text-xs text-muted-foreground font-mono">
                  触发命令: {selectedRecipe.commandId} · 策略: {selectedRecipe.resultStrategy}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="xs" variant="outline" onClick={handleAddStep} className="gap-1">
                  <Plus className="size-3" />
                  添加阶段
                </Button>
                {recipes.length > 1 && (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-destructive gap-1"
                    onClick={() => handleDeleteRecipe(selectedRecipe.id)}
                  >
                    <Trash2 className="size-3" />
                    删除流水线
                  </Button>
                )}
              </div>
            </div>

            {/* 阶段链条列表 */}
            <div className="space-y-3 pb-8">
              <span className="text-xs font-semibold text-muted-foreground">流水线阶段工序 (Stages Chain)</span>
              {selectedRecipe.steps.map((step, idx) => {
                const isExpanded = expandedStepId === step.id;
                const execMode = step.executionMode ?? (step.agentId ? "subagent" : "tool-only");

                return (
                  <div
                    key={step.id}
                    className={`rounded-lg border bg-card transition-all ${
                      isExpanded ? "border-primary/60 shadow-sm" : "border-border/70"
                    }`}
                  >
                    {/* 阶段摘要栏 */}
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                          {idx + 1}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <span className="text-xs font-semibold">{step.label}</span>
                          <Badge variant="outline" className="text-2xs">
                            {STEP_KIND_LABELS[step.kind] ?? step.kind}
                          </Badge>
                          {execMode === "subagent" && (
                            <Badge variant="secondary" className="text-2xs gap-1">
                              <Bot className="size-2.5" />
                              {step.agentId || "未指定角色"}
                            </Badge>
                          )}
                          {execMode === "autonomous" && (
                            <Badge variant="secondary" className="text-2xs gap-1 text-purple-700 dark:text-purple-300">
                              <Sparkles className="size-2.5" />
                              主代理自主派发
                            </Badge>
                          )}
                          {execMode === "tool-only" && (
                            <Badge variant="outline" className="text-2xs gap-1 text-muted-foreground">
                              <Wrench className="size-2.5" />
                              纯工具流水线
                            </Badge>
                          )}
                          {step.requiresApproval && (
                            <Badge variant="outline" className="text-2xs text-amber-600 border-amber-300">
                              人工确认门禁
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Switch
                          aria-label={`启用阶段：${step.label}`}
                          checked={step.enabled}
                          onCheckedChange={(checked) => handleToggleStep(step.id, checked)}
                        />
                        <Button
                          size="xs"
                          variant="ghost"
                          className="h-7 text-xs gap-1"
                          onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                        >
                          <Sliders className="size-3" />
                          {isExpanded ? "收起装配" : "展开装配"}
                          {isExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                        </Button>
                      </div>
                    </div>

                    {/* 阶段深度装配抽屉 */}
                    {isExpanded && (
                      <div className="border-t bg-muted/20 p-4 space-y-4 text-xs">
                        <div className="grid grid-cols-2 gap-4">
                          {/* 阶段标题编辑 */}
                          <div className="space-y-1.5">
                            <Label htmlFor={`step-label-${step.id}`}>阶段名称</Label>
                            <Input
                              id={`step-label-${step.id}`}
                              value={step.label}
                              onChange={(e) => handleUpdateStep(step.id, { label: e.target.value })}
                              placeholder="阶段显示名称"
                              className="h-8"
                            />
                          </div>

                          {/* 阶段工序类型 */}
                          <div className="space-y-1.5">
                            <Label>工序类型</Label>
                            <SimpleSelect
                              aria-label="工序类型"
                              value={step.kind}
                              onValueChange={(val) => handleUpdateStep(step.id, { kind: val as WorkflowStepKind })}
                              options={Object.entries(STEP_KIND_LABELS).map(([val, label]) => ({
                                value: val,
                                label,
                              }))}
                              className="w-full h-8"
                            />
                          </div>
                        </div>

                        {/* 执行模式选择 */}
                        <div className="space-y-2 rounded-md border bg-card p-3">
                          <Label className="font-semibold text-foreground">执行模式与角色挂载</Label>
                          <div className="grid grid-cols-3 gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleUpdateStep(step.id, { executionMode: "subagent" })}
                              className={`flex flex-col items-start p-2 rounded border text-left transition-colors ${
                                execMode === "subagent" ? "border-primary bg-primary/10 text-primary font-medium" : "border-border hover:bg-muted/40"
                              }`}
                            >
                              <div className="flex items-center gap-1.5 text-xs">
                                <Bot className="size-3.5" />
                                派发自定义子代理
                              </div>
                              <span className="text-2xs text-muted-foreground mt-1">
                                挂载专职子代理（如审稿人、写手）
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleUpdateStep(step.id, { executionMode: "autonomous" })}
                              className={`flex flex-col items-start p-2 rounded border text-left transition-colors ${
                                execMode === "autonomous" ? "border-primary bg-primary/10 text-primary font-medium" : "border-border hover:bg-muted/40"
                              }`}
                            >
                              <div className="flex items-center gap-1.5 text-xs">
                                <Sparkles className="size-3.5" />
                                主代理自主派发
                              </div>
                              <span className="text-2xs text-muted-foreground mt-1">
                                由总指挥根据剧情动态决定调哪些角色
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleUpdateStep(step.id, { executionMode: "tool-only" })}
                              className={`flex flex-col items-start p-2 rounded border text-left transition-colors ${
                                execMode === "tool-only" ? "border-primary bg-primary/10 text-primary font-medium" : "border-border hover:bg-muted/40"
                              }`}
                            >
                              <div className="flex items-center gap-1.5 text-xs">
                                <Wrench className="size-3.5" />
                                纯工具流水线
                              </div>
                              <span className="text-2xs text-muted-foreground mt-1">
                                直接按白名单执行工具，不派发子代理
                              </span>
                            </button>
                          </div>

                          {/* 若为派发子代理，提供子代理选择与手动输入 */}
                          {execMode === "subagent" && (
                            <div className="grid grid-cols-2 gap-3 pt-2">
                              <div className="space-y-1.5">
                                <Label htmlFor={`step-agent-${step.id}`}>选择挂载子代理</Label>
                                <div className="flex gap-2">
                                  <Input
                                    id={`step-agent-${step.id}`}
                                    value={step.agentId ?? ""}
                                    onChange={(e) => handleUpdateStep(step.id, { agentId: e.target.value })}
                                    placeholder="输入子代理名或从右侧点选"
                                    className="h-8 font-mono text-xs"
                                  />
                                  {registeredSubagents.length > 0 && (
                                    <SimpleSelect
                                      aria-label="快速点选子代理"
                                      value={step.agentId ?? ""}
                                      onValueChange={(val) => handleUpdateStep(step.id, { agentId: val })}
                                      options={[
                                        { value: "writer", label: "内置写手 (writer)" },
                                        ...registeredSubagents.map((s) => ({
                                          value: s.name,
                                          label: `${s.name} (${s.description || "自定义"})`,
                                        })),
                                      ]}
                                      className="h-8"
                                    />
                                  )}
                                </div>
                              </div>

                              <div className="space-y-1.5">
                                <Label htmlFor={`step-model-${step.id}`}>模型覆盖 (可选)</Label>
                                <Input
                                  id={`step-model-${step.id}`}
                                  value={step.modelOverride ?? ""}
                                  onChange={(e) => handleUpdateStep(step.id, { modelOverride: e.target.value })}
                                  placeholder="留空则继承主模型 (例如 deepseek-v4-pro)"
                                  className="h-8 font-mono text-xs"
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        {/* 阶段定制 Prompt */}
                        <div className="space-y-1.5">
                          <Label htmlFor={`step-prompt-${step.id}`}>
                            阶段执行指令 / Prompt 注入 (可选)
                          </Label>
                          <Textarea
                            id={`step-prompt-${step.id}`}
                            value={step.customPrompt ?? ""}
                            onChange={(e) => handleUpdateStep(step.id, { customPrompt: e.target.value })}
                            placeholder="指导该阶段的 Agent 重点关注什么，例如：'严格核查本章战力数值是否与 Narrative Memory 记载冲突'..."
                            className="min-h-16 text-xs"
                          />
                        </div>

                        {/* 工具白名单点选器 */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label>该阶段允许调用的工具白名单 (Tool Whitelist)</Label>
                            <span className="text-2xs text-muted-foreground">
                              已选 {step.tools?.length ?? 0} 个工具
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 p-2 rounded-md border bg-card max-h-32 overflow-y-auto">
                            {ALL_CANDIDATE_TOOLS.map((toolName) => {
                              const isSelected = step.tools?.includes(toolName);
                              return (
                                <button
                                  key={toolName}
                                  type="button"
                                  onClick={() => handleToggleTool(step, toolName)}
                                  className={`px-2 py-0.5 rounded text-2xs font-mono transition-colors border ${
                                    isSelected
                                      ? "bg-primary text-primary-foreground border-primary"
                                      : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
                                  }`}
                                >
                                  {toolName}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* 门禁开关与操作 */}
                        <div className="flex items-center justify-between pt-2 border-t">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              <Switch
                                aria-label={`阶段门禁：${step.label}`}
                                checked={step.requiresApproval ?? false}
                                onCheckedChange={(checked) => handleUpdateStep(step.id, { requiresApproval: checked })}
                              />
                              <span className="text-xs">
                                开启人工审核门禁 (HITL) — 暂停等待作者批准
                              </span>
                            </div>
                          </div>

                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-destructive gap-1"
                            onClick={() => handleDeleteStep(step.id)}
                            disabled={selectedRecipe.steps.length <= 1}
                          >
                            <Trash2 className="size-3" />
                            删除本阶段
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
