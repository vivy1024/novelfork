/**
 * Workflow Recipe — configurable multi-step agent execution plan.
 *
 * 对标 Claude Code CLI 的 tool chain / workflow 概念。
 * 套路页可配置参与 agents、模型、工具、确认门和章节结果策略。
 * Runtime 执行 /novel:write-next 时读取当前 recipe 配置。
 */

export type WorkflowStepKind =
  | "context-load"
  | "guided-plan"
  | "approval-gate"
  | "writer-generate"
  | "canvas-open"
  | "audit"
  | "adversarial-audit"
  | "post-settlement"
  | "custom-tool";

export interface WorkflowParallelSubagentConfig {
  readonly name: string;
  readonly roleLabel?: string;
  readonly model?: string;
  readonly tools?: readonly string[];
  readonly prompt?: string;
}

export interface WorkflowStepConfig {
  readonly id: string;
  readonly kind: WorkflowStepKind;
  readonly label: string;
  readonly enabled: boolean;
  /** 执行模式：单个子代理、主代理自主派发、或纯工具流水线 */
  readonly executionMode?: "subagent" | "autonomous" | "tool-only";
  /** 该步骤使用的单个主 agent / 子代理（如 writer 或自定义子代理名称） */
  readonly agentId?: string;
  /** 该步骤使用的模型覆盖（空则继承 session 默认） */
  readonly modelOverride?: string;
  /** 该步骤依赖的工具白名单 */
  readonly tools?: readonly string[];
  /** 挂载的写作技巧/规范（如 writing-skills/hooks） */
  readonly skills?: readonly string[];
  /** 阶段定制提示词（指导该阶段子代理或主代理怎么跑） */
  readonly customPrompt?: string;
  /** 并行子代理群组（用于对抗审查、多角色推演等 Fan-out 阶段） */
  readonly parallelSubagents?: readonly WorkflowParallelSubagentConfig[];
  /** 是否需要用户确认才能继续 */
  readonly requiresApproval?: boolean;
  /** 步骤失败时的行为 */
  readonly onFailure?: "stop" | "skip" | "retry";
}

export interface WorkflowRecipeConfig {
  readonly id: string;
  readonly name: string;
  readonly commandId: string;
  readonly description: string;
  /** 适用题材（如 general, xuanhuan, short-story, suspense 等） */
  readonly genre?: string;
  readonly steps: readonly WorkflowStepConfig[];
  /** 写作结果策略 */
  readonly resultStrategy: "formal-chapter" | "version-result" | "direct-write";
  /** 是否在最终写入前要求确认 */
  readonly requireFinalApproval: boolean;
  /** 最大重试次数 */
  readonly maxRetries: number;
}

/**
 * 默认 /novel:write-next workflow recipe
 * context → Guided Plan → approve → Writer chapter result → canvas open
 */
export const DEFAULT_WRITE_NEXT_RECIPE: WorkflowRecipeConfig = {
  id: "write-next",
  name: "写下一章",
  commandId: "/novel:write-next",
  description: "读取上下文 → 引导计划 → 用户批准 → 生成章节结果 → 画布打开；方向不明时用 AskUserQuestion",
  steps: [
    {
      id: "step-context",
      kind: "context-load",
      label: "加载上下文",
      enabled: true,
      agentId: "explorer",
      tools: ["cockpit.snapshot", "narrative.read_line", "storyline.read"],
      onFailure: "stop",
    },
    {
      id: "step-guided-plan",
      kind: "guided-plan",
      label: "引导式计划",
      enabled: false,
      agentId: "planner",
      tools: ["scene.spec"],
      requiresApproval: true,
      onFailure: "stop",
    },
    {
      id: "step-approval",
      kind: "approval-gate",
      label: "用户批准计划",
      enabled: true,
      requiresApproval: true,
      onFailure: "stop",
    },
    {
      id: "step-writer",
      kind: "writer-generate",
      label: "生成章节结果",
      enabled: true,
      agentId: "writer",
      tools: ["pipeline.write"],
      onFailure: "stop",
    },
    {
      id: "step-canvas",
      kind: "canvas-open",
      label: "画布打开章节结果",
      enabled: true,
      onFailure: "skip",
    },
  ],
  resultStrategy: "formal-chapter",
  requireFinalApproval: true,
  maxRetries: 1,
};

/**
 * 默认 /novel:audit workflow recipe
 */
export const DEFAULT_AUDIT_RECIPE: WorkflowRecipeConfig = {
  id: "audit",
  name: "小说审计",
  commandId: "/novel:audit",
  description: "连续性审计 → AI 味检测 → 生成审计报告",
  steps: [
    {
      id: "step-context",
      kind: "context-load",
      label: "加载审计上下文",
      enabled: true,
      agentId: "explorer",
      tools: ["cockpit.snapshot", "narrative.read_line"],
      onFailure: "stop",
    },
    {
      id: "step-audit",
      kind: "audit",
      label: "执行审计",
      enabled: true,
      agentId: "auditor",
      tools: ["audit.continuity", "audit.ai_taste"],
      onFailure: "stop",
    },
    {
      id: "step-canvas",
      kind: "canvas-open",
      label: "打开审计报告",
      enabled: true,
      onFailure: "skip",
    },
  ],
  resultStrategy: "version-result",
  requireFinalApproval: false,
  maxRetries: 0,
};

export const DEFAULT_WORKFLOW_RECIPES: readonly WorkflowRecipeConfig[] = [
  DEFAULT_WRITE_NEXT_RECIPE,
  DEFAULT_AUDIT_RECIPE,
];

/**
 * 根据 commandId 查找 workflow recipe
 */
export function getWorkflowRecipe(commandId: string, recipes: readonly WorkflowRecipeConfig[] = DEFAULT_WORKFLOW_RECIPES): WorkflowRecipeConfig | undefined {
  return recipes.find((recipe) => recipe.commandId === commandId);
}

/**
 * 获取 recipe 中启用的步骤
 */
export function getEnabledSteps(recipe: WorkflowRecipeConfig): readonly WorkflowStepConfig[] {
  return recipe.steps.filter((step) => step.enabled);
}
