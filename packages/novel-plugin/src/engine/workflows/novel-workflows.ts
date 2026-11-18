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
      label: "生成镜头蓝图",
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

/**
 * 黄金开书与首卷立项流：市场扫榜定位 → 读者契约与首卷 10 章推演（作者确认）→ 落盘首卷卷纲。
 */
export const GOLDEN_OPENING_LAUNCH_RECIPE: NovelWorkflowRecipe = {
  schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
  id: "golden-opening-launch",
  name: "黄金开书与首卷立项流",
  commandId: "/novel:golden-opening",
  genre: "general",
  description: "开书立项专用：市场视角扫榜定位 → 读者契约与首卷 10 章黄金开篇推演（你确认）→ 落盘首卷卷纲",
  status: "published",
  revision: 1,
  nodes: [
    { id: START_NODE_ID, type: "start", label: "开始" },
    {
      id: "step-context",
      type: "step",
      kind: "context-load",
      label: "读取新书设定与立项资料",
      enabled: true,
      tools: ["cockpit.snapshot", "lore.read", "memory.read"],
      customPrompt: "读取本书核心设定、主角动机、世界规则与已有卷纲草稿，梳理开书卖点与目标读者画像。",
      onFailure: "stop",
    },
    {
      id: "step-market",
      type: "step",
      kind: "custom-tool",
      label: "市场视角扫榜定位",
      enabled: true,
      agentId: "nf-market-analyst",
      executionMode: "subagent",
      customPrompt: "对照已抓取的平台榜单快照，评估本书题材赛道热度、标题简介吸引力、黄金三章切入点与同类作品差异化空间。",
      onFailure: "skip",
    },
    {
      id: "step-outline",
      type: "step",
      kind: "outline-plan",
      label: "读者契约与首卷 10 章推演",
      enabled: true,
      agentId: "nf-outline-planner",
      executionMode: "subagent",
      skills: ["黄金三章", "设计分卷大纲", "伏笔"],
      customPrompt: "结合上游市场定位，确立本书读者契约，推演第 1–10 章首卷开局大纲（第 1–3 章困境/代价转机/更大危机，第 4–10 章首轮小高潮与核心伏笔埋设）；不直接改卷纲、不写正文。",
      requiresApproval: true,
      onFailure: "stop",
    },
    {
      id: "step-apply",
      type: "step",
      kind: "custom-tool",
      label: "落盘首卷卷纲",
      enabled: true,
      tools: ["outline.volume"],
      customPrompt: "按作者确认的首卷大纲候选写入首卷卷纲（outline_volume，action=set），明确卷目标与章号区间；不写正文。",
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

/**
 * 日更稳健连载流（高密度控制卡）：预检召回 → 高密度因果蓝图 → 执笔起草 →
 * 连续性 + 节奏 + 去AI味三路并行审校 → Join 汇合 → 按意见返修（作者确认）→ 落盘与账本结算。
 */
export const DAILY_SERIAL_PACK_RECIPE: NovelWorkflowRecipe = {
  schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
  id: "daily-serial-pack",
  name: "日更稳健连载流（高密度控制卡）",
  commandId: "/novel:daily-serial",
  genre: "serial",
  description: "长篇稳健日更：上下文预检 → 高密度因果施工蓝图 → 执笔起草 → 连续性/节奏/去AI味三路并行会审 → 定稿返修 → 落盘结算",
  status: "published",
  revision: 1,
  nodes: [
    { id: START_NODE_ID, type: "start", label: "开始" },
    {
      id: "step-context",
      type: "step",
      kind: "context-load",
      label: "装配上下文与预检",
      enabled: true,
      tools: ["cockpit.snapshot", "write.preflight", "memory.read", "lore.read"],
      customPrompt: "调用写前预检装载本章召回包、出场人物设定、近章时间线与到期伏笔，确认具备开写条件。",
      onFailure: "stop",
    },
    {
      id: "step-blueprint",
      type: "step",
      kind: "guided-plan",
      label: "高密度因果施工蓝图",
      enabled: true,
      agentId: "nf-scene-architect",
      executionMode: "subagent",
      tools: ["scene.spec"],
      skills: ["冲突与悬念分工", "爽点密度与分级", "强化章末钩子"],
      customPrompt: "按高密度因果控制卡规格拟定本章镜头蓝图：锁定视角人物筹码与代价、本场争夺焦点、信息增量、中段回报与章末钩子。",
      onFailure: "stop",
    },
    {
      id: "step-draft",
      type: "step",
      kind: "writer-generate",
      label: "执笔起草正文",
      enabled: true,
      agentId: "nf-writer",
      executionMode: "subagent",
      tools: ["skills.check_compliance"],
      skills: ["创建小说正文", "对白权力与潜台词"],
      customPrompt: "严格按上游镜头蓝图起草本章完整正文，守住限知视角与对白权力关系，把心理活动转化为具体可拍动作。",
      onFailure: "stop",
    },
    {
      id: "step-continuity",
      type: "step",
      kind: "audit",
      label: "连续性与设定审校",
      enabled: true,
      agentId: "nf-continuity-auditor",
      executionMode: "subagent",
      customPrompt: "对照经纬设定与近章记忆核查人物言行、知识边界、伤势道具延续与时间线自洽。",
      onFailure: "stop",
    },
    {
      id: "step-pacing",
      type: "step",
      kind: "audit",
      label: "节奏与爽点钩子审校",
      enabled: true,
      agentId: "nf-pacing-auditor",
      executionMode: "subagent",
      customPrompt: "检查章首 300 字抓力、中段实质回报、信息增量与章末钩子强度，标出注水拖沓段落。",
      onFailure: "stop",
    },
    {
      id: "step-deai",
      type: "step",
      kind: "audit",
      label: "去AI味与套话审校",
      enabled: true,
      agentId: "nf-deai-auditor",
      executionMode: "subagent",
      customPrompt: "按四维病灶排查高频套话、均匀排比句、总结升华腔与元信息工程词泄漏。",
      onFailure: "stop",
    },
    { id: "join-audit", type: "join", label: "汇合三路审校" },
    {
      id: "step-revise",
      type: "step",
      kind: "writer-generate",
      label: "按审校意见返修定稿",
      enabled: true,
      agentId: "nf-reviser",
      executionMode: "subagent",
      skills: ["去AI味重写", "元信息泄漏扫描"],
      customPrompt: "以初稿为底本，逐条落实连续性、节奏与去 AI 味三路审校意见，保留角色声口与剧情张力，提交定稿完整正文。",
      requiresApproval: true,
      onFailure: "stop",
    },
    {
      id: "step-settlement",
      type: "step",
      kind: "post-settlement",
      label: "落盘与账本结算",
      enabled: true,
      tools: ["pipeline.write", "resource.manage", "memory.settle_chapter"],
      customPrompt: "将作者批准的正文正式落盘，并完成本章资源状态与叙事记忆结算。",
      onFailure: "stop",
    },
    { id: END_NODE_ID, type: "end", label: "完成" },
  ],
  edges: [
    ...nextEdgesOf([
      [START_NODE_ID, "step-context"],
      ["step-context", "step-blueprint"],
      ["step-blueprint", "step-draft"],
      ["step-draft", "step-continuity"],
      ["step-draft", "step-pacing"],
      ["step-draft", "step-deai"],
      ["step-continuity", "join-audit"],
      ["step-pacing", "join-audit"],
      ["step-deai", "join-audit"],
      ["join-audit", "step-revise"],
      ["step-revise", "step-settlement"],
      ["step-settlement", END_NODE_ID],
    ]),
    { id: "r-step-revise-step-draft", source: "step-revise", target: "step-draft", kind: "reject" },
  ],
  resultStrategy: "formal-chapter",
  maxRetries: 1,
};

/**
 * 小说转短剧 / AI 漫剧分镜流：读取本章与视觉设定 → 短剧分镜导演改编 → 连续性审校核对外貌设定（作者确认）→ 整理归档。
 */
export const DRAMA_STORYBOARD_ADAPT_RECIPE: NovelWorkflowRecipe = {
  schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
  id: "drama-storyboard-adapt",
  name: "小说转短剧 / AI 漫剧分镜流",
  commandId: "/novel:drama-storyboard",
  genre: "adaptation",
  description: "多模态视听改编：读取章节与角色外貌锚点 → 短剧导演拆解场次、锁脸提示词与运镜台词 → 设定一致性核对 → 分镜归档",
  status: "published",
  revision: 1,
  nodes: [
    { id: START_NODE_ID, type: "start", label: "开始" },
    {
      id: "step-context",
      type: "step",
      kind: "context-load",
      label: "读取本章正文与角色视觉设定",
      enabled: true,
      tools: ["chapter.read", "lore.read", "memory.read"],
      customPrompt: "读取本章已保存正文、出场角色外貌服饰设定与当前场景状态；若本章尚未成稿则报告阻塞。",
      onFailure: "stop",
    },
    {
      id: "step-storyboard",
      type: "step",
      kind: "custom-tool",
      label: "改编分集剧本与锁脸分镜表",
      enabled: true,
      agentId: "nf-script-director",
      executionMode: "subagent",
      customPrompt: "将本章改编为竖屏短剧/漫剧结构化分镜表：提取固定人物锁脸锚点，逐镜给出场次、景别、运镜、动作画面、精炼台词、音效及 AI 生图/生视频 Prompt。",
      onFailure: "stop",
    },
    {
      id: "step-visual-audit",
      type: "step",
      kind: "audit",
      label: "核对人物外貌与设定一致性",
      enabled: true,
      agentId: "nf-continuity-auditor",
      executionMode: "subagent",
      customPrompt: "对照经纬设定与原章事实核查分镜剧本：人物外貌服饰锁脸锚点、持有道具、空间方位与台词立场是否与原著严丝合缝。",
      requiresApproval: true,
      onFailure: "stop",
    },
    {
      id: "step-archive",
      type: "step",
      kind: "canvas-open",
      label: "分镜剧本整理归档",
      enabled: true,
      customPrompt: "汇总已通过确认的角色视觉锚点表与分镜剧本要点，生成清晰可导出的版本结果小结，不改动原章节正文。",
      onFailure: "stop",
    },
    { id: END_NODE_ID, type: "end", label: "完成" },
  ],
  edges: [
    ...nextEdgesOf([
      [START_NODE_ID, "step-context"],
      ["step-context", "step-storyboard"],
      ["step-storyboard", "step-visual-audit"],
      ["step-visual-audit", "step-archive"],
      ["step-archive", END_NODE_ID],
    ]),
    { id: "r-step-visual-audit-step-storyboard", source: "step-visual-audit", target: "step-storyboard", kind: "reject" },
  ],
  resultStrategy: "version-result",
  maxRetries: 1,
};

/**
 * 多角色 AI 有声书台本流：读取本章与角色声线档案 → 有声书配音导演切分多角色情绪台本（作者确认）→ 整理归档。
 */
export const AUDIOBOOK_SCRIPT_ADAPT_RECIPE: NovelWorkflowRecipe = {
  schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
  id: "audiobook-script-adapt",
  name: "多角色 AI 有声书台本流",
  commandId: "/novel:audiobook-script",
  genre: "adaptation",
  description: "有声演播改编：读取章节正文与角色声线档案 → 配音导演切分旁白与多角色情绪停顿台本（你确认）→ 台本归档",
  status: "published",
  revision: 1,
  nodes: [
    { id: START_NODE_ID, type: "start", label: "开始" },
    {
      id: "step-context",
      type: "step",
      kind: "context-load",
      label: "读取本章正文与角色声线",
      enabled: true,
      tools: ["chapter.read", "character.voice.read", "lore.read"],
      customPrompt: "读取本章已保存正文、出场角色已确认的声线档案（character_voice_read）与人物关系背景；若本章尚未成稿则报告阻塞。",
      onFailure: "stop",
    },
    {
      id: "step-voice-script",
      type: "step",
      kind: "custom-tool",
      label: "切分多角色情绪配音台本",
      enabled: true,
      agentId: "nf-audiobook-director",
      executionMode: "subagent",
      customPrompt: "保持原文词句顺序不漏段，将本章切分为旁白与各角色对白台本，绑定说话人声线锚点、情绪语气、停顿重音与环境音效提示。",
      requiresApproval: true,
      onFailure: "stop",
    },
    {
      id: "step-archive",
      type: "step",
      kind: "canvas-open",
      label: "有声台本整理归档",
      enabled: true,
      customPrompt: "汇总已确认的配音角色表与多角色演播台本摘要，作为本章有声化版本结果归档，不修改原章节正文。",
      onFailure: "stop",
    },
    { id: END_NODE_ID, type: "end", label: "完成" },
  ],
  edges: nextEdgesOf([
    [START_NODE_ID, "step-context"],
    ["step-context", "step-voice-script"],
    ["step-voice-script", "step-archive"],
    ["step-archive", END_NODE_ID],
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
  GOLDEN_OPENING_LAUNCH_RECIPE,
  DAILY_SERIAL_PACK_RECIPE,
  DRAMA_STORYBOARD_ADAPT_RECIPE,
  AUDIOBOOK_SCRIPT_ADAPT_RECIPE,
];

export function getNovelWorkflow(commandId: string): NovelWorkflowRecipe | undefined {
  return NOVEL_BUILTIN_WORKFLOWS.find((w) => w.commandId === commandId || w.id === commandId);
}
