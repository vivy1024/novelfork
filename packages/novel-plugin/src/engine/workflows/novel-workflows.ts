/**
 * Novel Workflow Recipes — 小说专属工作流预设（权威源在 novel-plugin 内部）
 *
 * 遵循插件化边界铁律：所有网文流派的创作工作流属于 novel-plugin 领域资产。
 * 工作流是一张图（见 workflow-graph.ts）；内置方案仍按线性工序书写，加载时转成等价的链。
 */

import {
  END_NODE_ID,
  linearRecipeToGraph,
  START_NODE_ID,
  WORKFLOW_GRAPH_SCHEMA_VERSION,
  type LegacyWorkflowRecipe,
  type WorkflowGraphEdge,
  type WorkflowGraphRecipe,
} from "./workflow-graph.js";

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
  | "outline-plan"
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
  /** 审校工序：不通过时沿打回线自动打回的最大轮数（0–5），缺省 MAX_AUDIT_AUTO_RETURNS。 */
  readonly maxAutoReturns?: number;
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
      label: "生成场景蓝图",
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

/** 图方案的连线简写：[source, target] 为「下一步」。 */
function nextEdgesOf(pairs: ReadonlyArray<readonly [string, string]>): WorkflowGraphEdge[] {
  return pairs.map(([source, target]) => ({ id: `e-${source}-${target}`, source, target, kind: "next" }));
}

/**
 * 精修一章：已写好的一章，读者视角 / 文风 / 去 AI 味三路并行审校 → 汇合 → 按意见返修
 * → 作者确认新正文 → 覆盖原章并重新结算。
 * 审校排在返修之前，不通过不打回（没有更上游的正文可打回），意见直接交给返修。
 */
export const REFINE_CHAPTER_RECIPE: NovelWorkflowRecipe = {
  schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
  id: "refine-chapter",
  name: "精修一章",
  commandId: "/novel:refine-chapter",
  description: "已写好的一章：读者视角、文风、去AI味三路并行审校 → 按意见返修 → 你确认新正文 → 覆盖原章并重新结算",
  status: "published",
  revision: 1,
  nodes: [
    { id: START_NODE_ID, type: "start", label: "开始" },
    {
      id: "step-context",
      type: "step",
      kind: "context-load",
      label: "读取本章与前情",
      enabled: true,
      tools: ["cockpit.snapshot", "chapter.read", "memory.read", "lore.read"],
      customPrompt: "读取本章已保存的正文、近章前情与本书文风基准，确认本章存在且可以精修；本章还没写就报告阻塞。",
      onFailure: "stop",
    },
    {
      id: "step-reader",
      type: "step",
      kind: "audit",
      label: "读者视角审读",
      enabled: true,
      agentId: "nf-reader-critic",
      executionMode: "subagent",
      customPrompt: "以本书目标平台读者的身份读本章已保存的正文，给出追读欲、弃书点、爽点兑现与看不懂之处。",
      onFailure: "stop",
    },
    {
      id: "step-style",
      type: "step",
      kind: "audit",
      label: "文风与声线核对",
      enabled: true,
      agentId: "nf-style-keeper",
      executionMode: "subagent",
      customPrompt: "按本书已确认的文风指南与角色声线检查本章已保存的正文，列出声口与节奏的偏离。",
      onFailure: "stop",
    },
    {
      id: "step-deai",
      type: "step",
      kind: "audit",
      label: "去AI味审校",
      enabled: true,
      agentId: "nf-deai-auditor",
      executionMode: "subagent",
      customPrompt: "检查本章已保存正文的 AI 写作痕迹，给出典型原句定位。",
      onFailure: "stop",
    },
    { id: "join-review", type: "join", label: "汇总审校意见" },
    {
      id: "step-revise",
      type: "step",
      kind: "writer-generate",
      label: "按意见精修",
      enabled: true,
      agentId: "nf-reviser",
      executionMode: "subagent",
      skills: ["去AI味重写"],
      customPrompt: "以本章已保存的正文为底稿，逐条落实上游三份审校意见，提交改好的完整正文；只改被指出的问题，不动情节与设定。",
      requiresApproval: true,
      onFailure: "stop",
    },
    {
      id: "step-settlement",
      type: "step",
      kind: "post-settlement",
      label: "覆盖原章并重新结算",
      enabled: true,
      tools: ["chapter.write", "memory.settle_chapter"],
      customPrompt: "用作者确认的新正文覆盖本章，再重新结算本章叙事记忆。",
      // 落盘失败不能跳过：跳过会让运行显示完成，但作者确认的新正文没进书。
      onFailure: "stop",
    },
    { id: END_NODE_ID, type: "end", label: "完成" },
  ],
  edges: nextEdgesOf([
    [START_NODE_ID, "step-context"],
    ["step-context", "step-reader"],
    ["step-context", "step-style"],
    ["step-context", "step-deai"],
    ["step-reader", "join-review"],
    ["step-style", "join-review"],
    ["step-deai", "join-review"],
    ["join-review", "step-revise"],
    ["step-revise", "step-settlement"],
    ["step-settlement", END_NODE_ID],
  ]),
  resultStrategy: "formal-chapter",
  maxRetries: 1,
};

/**
 * 大纲推演：市场视角分析 → 推演后续若干章的大纲候选（作者确认）→ 按确认的大纲调整卷纲。
 * 全程不写正文；卷纲由叙述者在作者确认后调整。
 */
export const OUTLINE_FORECAST_RECIPE: NovelWorkflowRecipe = {
  schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
  id: "outline-forecast",
  name: "大纲推演",
  commandId: "/novel:outline-forecast",
  description: "不写正文：市场视角分析卖点与同类差异 → 推演后续几章的大纲（伏笔回收、节奏、冲突升级）→ 你确认后调整卷纲",
  status: "published",
  revision: 1,
  nodes: [
    { id: START_NODE_ID, type: "start", label: "开始" },
    {
      id: "step-context",
      type: "step",
      kind: "context-load",
      label: "读取卷纲、伏笔与进度",
      enabled: true,
      tools: ["cockpit.snapshot", "lore.read", "memory.read", "memory.graph"],
      customPrompt: "读取卷纲、近章摘要、伏笔台账与故事时间线，确认从哪一章开始推演。",
      onFailure: "stop",
    },
    {
      id: "step-market",
      type: "step",
      kind: "custom-tool",
      label: "市场视角分析",
      enabled: true,
      agentId: "nf-market-analyst",
      executionMode: "subagent",
      customPrompt: "对照已抓取的平台榜单，分析本书题材卖点、开篇钩子、标题简介与同类上榜作品的差异，给出后续剧情可以放大的卖点。",
      // 没抓过榜单时市场分析做不出来，不该挡住大纲推演。
      onFailure: "skip",
    },
    {
      id: "step-outline",
      type: "step",
      kind: "outline-plan",
      label: "推演后续大纲",
      enabled: true,
      agentId: "nf-outline-planner",
      executionMode: "subagent",
      skills: ["设计分卷大纲", "伏笔"],
      customPrompt: "从本次运行的章开始推演接下来 5–10 章的大纲：伏笔回收排期、节奏与冲突升级，参考上游市场分析；不改卷纲、不写正文。",
      requiresApproval: true,
      onFailure: "stop",
    },
    {
      id: "step-apply",
      type: "step",
      kind: "custom-tool",
      label: "按确认的大纲调整卷纲",
      enabled: true,
      tools: ["outline.volume"],
      customPrompt: "按作者确认的大纲候选调整卷纲（outline_volume，action=set），只改候选涉及的章；不写正文。改完用一两句话小结改了什么。",
      onFailure: "stop",
    },
    { id: END_NODE_ID, type: "end", label: "完成" },
  ],
  edges: nextEdgesOf([
    [START_NODE_ID, "step-context"],
    ["step-context", "step-market"],
    ["step-market", "step-outline"],
    ["step-outline", "step-apply"],
    ["step-apply", END_NODE_ID],
  ]),
  resultStrategy: "version-result",
  maxRetries: 1,
};

export const NOVEL_BUILTIN_WORKFLOWS: readonly NovelWorkflowRecipe[] = [
  FANQIE_XUANHUAN_SERIAL_RECIPE,
  ZHIHU_SHORT_STORY_RECIPE,
  TRADITIONAL_XIANXIA_RECIPE,
  REFINE_CHAPTER_RECIPE,
  OUTLINE_FORECAST_RECIPE,
];

export function getNovelWorkflow(commandId: string): NovelWorkflowRecipe | undefined {
  return NOVEL_BUILTIN_WORKFLOWS.find((w) => w.commandId === commandId || w.id === commandId);
}
