/**
 * Novel Workflow Recipes — 小说专属工作流预设（权威源在 novel-plugin 内部）
 *
 * 遵循插件化边界铁律：所有网文流派的创作工作流属于 novel-plugin 领域资产。
 * 工作流是一张图（见 workflow-graph.ts）；内置方案仍按线性工序书写，加载时转成等价的链。
 */

import { linearRecipeToGraph, type LegacyWorkflowRecipe, type WorkflowGraphRecipe } from "./workflow-graph.js";

/**
 * 写-审-改回路：审校工序连一条打回线回到写正文的工序。
 * 审校不通过时状态机沿它自动打回（至多 MAX_AUDIT_AUTO_RETURNS 轮），作者打回也走这条线。
 */
export const BUILTIN_REVIEW_REJECT_EDGES: Readonly<Record<string, { readonly source: string; readonly target: string }>> = {
  "fanqie-xuanhuan-serial": { source: "step-adversarial-audit", target: "step-draft" },
  "zhihu-short-story": { source: "step-audit", target: "step-draft" },
  "traditional-xianxia": { source: "step-audit", target: "step-draft" },
};

/** 给图补上写-审-改打回线（已有同源打回线、或两端工序不存在时原样返回）。 */
export function withReviewRejectEdge(recipe: WorkflowGraphRecipe, link = BUILTIN_REVIEW_REJECT_EDGES[recipe.id]): WorkflowGraphRecipe {
  if (!link) return recipe;
  const has = (id: string) => recipe.nodes.some((node) => node.type === "step" && node.id === id);
  if (!has(link.source) || !has(link.target)) return recipe;
  if (recipe.edges.some((edge) => edge.kind === "reject" && edge.source === link.source)) return recipe;
  return {
    ...recipe,
    edges: [...recipe.edges, { id: `r-${link.source}-${link.target}`, source: link.source, target: link.target, kind: "reject" }],
  };
}

function builtinRecipe(legacy: LegacyWorkflowRecipe): WorkflowGraphRecipe {
  return withReviewRejectEdge(linearRecipeToGraph(legacy));
}

export type NovelWorkflowStepKind =
  | "context-load"
  | "guided-plan"
  | "approval-gate"
  | "writer-generate"
  | "adversarial-audit"
  | "audit"
  | "post-settlement"
  | "canvas-open"
  | "custom-tool";

export type NovelWorkflowExecutionMode = "subagent" | "autonomous" | "tool-only";

export type NovelWorkflowStepOnFailure = "stop" | "skip" | "retry";

export type NovelWorkflowResultStrategy = "formal-chapter" | "version-result" | "direct-write";

export interface NovelParallelSubagentConfig {
  readonly name: string;
  readonly roleLabel?: string;
  readonly model?: string;
  readonly tools?: readonly string[];
  readonly prompt?: string;
}

export interface NovelWorkflowStep {
  readonly id: string;
  readonly kind: NovelWorkflowStepKind;
  readonly label: string;
  readonly enabled: boolean;
  readonly executionMode?: NovelWorkflowExecutionMode;
  readonly agentId?: string;
  readonly modelOverride?: string;
  readonly tools?: readonly string[];
  /** Runtime Skill 工具按 SKILL.md 的 name 精确查找，不接受 catalog id / slug。 */
  readonly skills?: readonly string[];
  readonly customPrompt?: string;
  readonly parallelSubagents?: readonly NovelParallelSubagentConfig[];
  readonly requiresApproval?: boolean;
  readonly onFailure?: NovelWorkflowStepOnFailure;
}

/** 工作流方案：图结构（节点 + 连线 + 草稿 / 发布状态）。 */
export type NovelWorkflowRecipe = WorkflowGraphRecipe;

/**
 * 番茄/起点爆款单章连载流
 */
export const FANQIE_XUANHUAN_SERIAL_RECIPE: NovelWorkflowRecipe = builtinRecipe({
  id: "fanqie-xuanhuan-serial",
  name: "番茄/起点爆款单章连载流",
  commandId: "/novel:write-xuanhuan",
  genre: "xuanhuan",
  description: "快节奏黄金三章结构：镜头蓝图 → 写作草稿 → 三视角对抗审查（连续性/叙事/文本） → 资源账本自动结算",
  steps: [
    {
      id: "step-context",
      kind: "context-load",
      label: "装配上下文与前置预检",
      enabled: true,
      tools: ["cockpit.snapshot", "write.preflight", "memory.read", "lore.read"],
      onFailure: "stop",
    },
    {
      id: "step-blueprint",
      kind: "guided-plan",
      label: "生成镜头蓝图 (SceneSpec)",
      enabled: true,
      tools: ["scene.spec"],
      skills: ["爽点密度与分级", "强化章末钩子"],
      requiresApproval: false,
      onFailure: "stop",
    },
    {
      id: "step-draft",
      kind: "writer-generate",
      label: "起草正文草稿",
      enabled: true,
      agentId: "writer",
      executionMode: "subagent",
      tools: ["skills.check_compliance"],
      onFailure: "stop",
    },
    {
      id: "step-adversarial-audit",
      kind: "adversarial-audit",
      label: "三视角对抗审查 (连续性+叙事+去AI味)",
      enabled: true,
      agentId: "novel-continuity-auditor",
      executionMode: "subagent",
      tools: ["chapter.read", "memory.graph"],
      requiresApproval: true,
      onFailure: "stop",
    },
    {
      id: "step-settlement",
      kind: "post-settlement",
      label: "章后状态与账本结算",
      enabled: true,
      tools: ["pipeline.write", "resource.manage", "memory.settle_chapter"],
      // 落盘失败不能跳过：跳过会让运行显示完成，但作者批准的正文没进书。
      onFailure: "stop",
    },
  ],
  resultStrategy: "formal-chapter",
  requireFinalApproval: true,
  maxRetries: 1,
} satisfies LegacyWorkflowRecipe);

/**
 * 知乎盐选 8000 字短篇虐渣反转流
 */
export const ZHIHU_SHORT_STORY_RECIPE: NovelWorkflowRecipe = builtinRecipe({
  id: "zhihu-short-story",
  name: "知乎盐选 8000 字短篇虐渣流",
  commandId: "/novel:write-short",
  genre: "short-story",
  description: "情绪极限拉扯：情绪曲线规划 → 高压反转起草 → 叙事与去AI味严查 → 定稿落盘",
  steps: [
    {
      id: "step-context",
      kind: "context-load",
      label: "加载短篇核心核与情绪档案",
      enabled: true,
      // write.preflight 记下本章写前召回；没有它，收尾的 pipeline.write 会被 recall-required 拒写。
      tools: ["cockpit.snapshot", "write.preflight", "memory.read"],
      onFailure: "stop",
    },
    {
      id: "step-blueprint",
      kind: "guided-plan",
      label: "构建情绪高压镜头蓝图",
      enabled: true,
      tools: ["scene.spec"],
      skills: ["冲突与悬念分工"],
      onFailure: "stop",
    },
    {
      id: "step-draft",
      kind: "writer-generate",
      label: "起草高密度正文",
      enabled: true,
      agentId: "writer",
      executionMode: "subagent",
      onFailure: "stop",
    },
    {
      id: "step-audit",
      kind: "adversarial-audit",
      label: "反转节奏与文本去AI味严审",
      enabled: true,
      agentId: "novel-text-auditor",
      executionMode: "subagent",
      tools: ["chapter.read"],
      requiresApproval: true,
      onFailure: "stop",
    },
    {
      id: "step-settlement",
      kind: "post-settlement",
      label: "成品收录落盘",
      enabled: true,
      tools: ["pipeline.write"],
      onFailure: "stop",
    },
  ],
  resultStrategy: "formal-chapter",
  requireFinalApproval: true,
  maxRetries: 1,
} satisfies LegacyWorkflowRecipe);

/**
 * 传统仙侠大长篇严谨推演流
 */
export const TRADITIONAL_XIANXIA_RECIPE: NovelWorkflowRecipe = builtinRecipe({
  id: "traditional-xianxia",
  name: "传统仙侠大长篇严谨推演流",
  commandId: "/novel:write-xianxia",
  genre: "xianxia",
  description: "重设定与境界严谨推演：时序门禁 → 战力推演 → 带工具查证连续性深审 → 伏笔网络落盘",
  steps: [
    {
      id: "step-context",
      kind: "context-load",
      label: "时序与宗门设定门禁巡检",
      enabled: true,
      tools: ["cockpit.snapshot", "write.preflight", "lore.read", "memory.graph"],
      onFailure: "stop",
    },
    {
      id: "step-blueprint",
      kind: "guided-plan",
      label: "生成严谨因果镜头蓝图",
      enabled: true,
      tools: ["scene.spec"],
      onFailure: "stop",
    },
    {
      id: "step-draft",
      kind: "writer-generate",
      label: "沉浸式仙侠正文起草",
      enabled: true,
      agentId: "writer",
      executionMode: "subagent",
      onFailure: "stop",
    },
    {
      id: "step-audit",
      kind: "adversarial-audit",
      label: "连续性与正典事件深度查证会审",
      enabled: true,
      agentId: "novel-continuity-auditor",
      executionMode: "subagent",
      tools: ["chapter.read", "memory.read", "memory.graph"],
      requiresApproval: true,
      onFailure: "stop",
    },
    {
      id: "step-settlement",
      kind: "post-settlement",
      label: "境界账本结算与伏笔落盘",
      enabled: true,
      tools: ["pipeline.write", "resource.manage", "memory.settle_chapter"],
      onFailure: "stop",
    },
  ],
  resultStrategy: "formal-chapter",
  requireFinalApproval: true,
  maxRetries: 1,
} satisfies LegacyWorkflowRecipe);

export const NOVEL_BUILTIN_WORKFLOWS: readonly NovelWorkflowRecipe[] = [
  FANQIE_XUANHUAN_SERIAL_RECIPE,
  ZHIHU_SHORT_STORY_RECIPE,
  TRADITIONAL_XIANXIA_RECIPE,
];

export function getNovelWorkflow(commandId: string): NovelWorkflowRecipe | undefined {
  return NOVEL_BUILTIN_WORKFLOWS.find((w) => w.commandId === commandId || w.id === commandId);
}
