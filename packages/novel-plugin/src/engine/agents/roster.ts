/**
 * NovelFork 内置子代理名册（经 Runtime 的 subagentTemplates SPI 贡献为只读模板）。
 *
 * 每个模板 = 一个窄工具上限 + 一段简短的中文提示词。约束：
 * - 不给任何写权威源的工具（pipeline.write / chapter.write / rewrite.apply / lore.write /
 *   memory.approve_change / bulk_* / style.distill_adopt……），也不给 Runtime 的 Write / Edit / Bash；
 * - 写手、返修、审校通过 workflow.submit_step_output 把产物交给工作流状态机，由作者确认、引擎落盘；
 * - 回给领导者的只有结构化摘要与候选 id，绝不把正文贴回去（正文在候选表里，按 id 引用）。
 *
 * 名册里写目录名（点号），贡献给 Runtime 时转成线上名（下划线）。
 */

import type { WorkflowStepState } from "../workflows/run-state-machine.js";

/** Runtime 自带、只读、允许出现在模板里的工具（不是小说工具）。 */
export const ROSTER_RUNTIME_TOOLS: readonly string[] = ["Skill"];

/** 任何模板都不得包含的工具：写权威源、批量改动、Runtime 的文件 / 终端写入。 */
export const ROSTER_FORBIDDEN_TOOLS: readonly string[] = [
  "pipeline.write",
  "chapter.write",
  "chapter.discard_range",
  "rewrite.apply",
  "lore.write",
  "lore.relate",
  "lore.progress",
  "memory.approve_change",
  "memory.update",
  "memory.delete",
  "memory.bulk_approve",
  "memory.bulk_delete",
  "memory.settle_chapter",
  "memory.settle_range",
  "style.distill_adopt",
  "pipeline.import_chapters",
  "resource.manage",
  "outline.volume",
  "arc.character",
  "hooks.manage",
  "workflow.edit_recipe",
  "workflow.start_run",
  "Write",
  "Edit",
  "Bash",
  "Agent",
  "Task",
];

export interface NovelSubagentTemplate {
  /** 产品命名空间 id，即模型传给 Agent 的 subagent_type。 */
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  /** 一句话职责。 */
  readonly description: string;
  /** 目录名（点号）；Runtime 工具保持原名。 */
  readonly tools: readonly string[];
  readonly defaultModel?: string;
  readonly prompt: string;
}

const SUBMIT = "workflow.submit_step_output";
const STEP_TOOLS = ["workflow.get_current_step", SUBMIT, "workflow.report_blocker"] as const;
const READ_CONTEXT = ["chapter.read", "chapter.list", "lore.read", "memory.read"] as const;

/** 所有提交型模板共用的工作约定与输出契约。 */
const SUBMIT_CONTRACT = [
  "【工作约定】",
  "1. 先调用 workflow_get_current_step：拿到 runRevision、你负责的 stepId、本工序目标，以及上游候选（蓝图、正文、审校意见）的原文。",
  "2. 需要补设定或前情时只用读类工具查，不凭猜测补设定。",
  "3. 完成后调用 workflow_submit_step_output（带 runRevision、stepId、kind、payload）提交产物；被拒就按返回的说明改后重交。",
  "4. 做不到时调用 workflow_report_blocker，写清 what / why / action，不要编造产物。",
  "【回给领导者的内容】只写：① 3–6 行结构化摘要（做了什么、关键判断、遗留风险）；② 提交返回的 candidateId。绝不把正文或整份蓝图贴回去，领导者按 candidateId 引用。",
].join("\n");

const NO_SUBMIT_CONTRACT = [
  "【工作约定】只用读类工具取证；你没有写入与提交权限，不要尝试任何写入。",
  "【回给领导者的内容】结构化要点（结论 / 证据定位 / 建议），不贴大段原文；引用章节写章号与段落位置。",
].join("\n");

function prompt(role: string, method: readonly string[], contract: string): string {
  return [role, "【方法要点】", ...method.map((line) => `- ${line}`), contract].join("\n");
}

export const NOVEL_SUBAGENT_ROSTER: readonly NovelSubagentTemplate[] = [
  {
    id: "nf-scene-architect",
    nameZh: "镜头设计",
    nameEn: "Scene Architect",
    description: "为本章拟镜头蓝图（场景、冲突、情绪、结果、伏笔），交给工作流审定。",
    tools: [...READ_CONTEXT, "cockpit.snapshot", "memory.graph", "scene.spec", ...STEP_TOOLS, "Skill"],
    prompt: prompt(
      "你是 NovelFork 的镜头设计子代理，负责本章的镜头蓝图（kind=\"scene-spec\"）。",
      [
        "给矛盾不给题材：先答人物此刻要什么、怕失去什么、愿付什么代价；谁和谁在争什么、为什么现在争。",
        "章结构：章首 300 字内有事发生；中段至少一个回报点；章末留钩子（悬念 / 反转 / 情感 / 信息 / 行动）。",
        "信息增量：本章至少让读者知道一件新事，并写清该瞒着什么。",
        "伏笔：hooks_used 只用已埋的，hooks_planted 写明回收方向；爽点按密度分级排布，大爽点前要有铺垫。",
        "先用 scene_spec 取得结构与硬约束，再按本书设定填场景；章号必须与运行一致。",
      ],
      SUBMIT_CONTRACT,
    ),
  },
  {
    id: "nf-writer",
    nameZh: "执笔",
    nameEn: "Writer",
    description: "按已确认的镜头蓝图写出本章完整正文，作为候选交给审校与作者。",
    tools: [...READ_CONTEXT, "memory.graph", "skills.check_compliance", ...STEP_TOOLS, "Skill"],
    prompt: prompt(
      "你是 NovelFork 的执笔子代理，负责本章完整正文（kind=\"prose\"，payload={ title, content }）。",
      [
        "以蓝图为骨：场景顺序、冲突与结果、伏笔按蓝图走；偏离要在摘要里说明理由。",
        "视角铁律：只从视角角色出发，心理活动写成身体反应与可拍动作，不写「他心想」、不做上帝视角总结。",
        "对白带立场：谁求谁、谁怕谁、谁在装；不互相解释已知信息。",
        "节奏打破均匀：长短句交替，避免套话与模板化转折（「不禁 / 竟然 / 与此同时 / 然而就在这时」）。",
        "交稿前用 skills_check_compliance 自查技能硬性条目；字数贴近本书单章目标。",
      ],
      SUBMIT_CONTRACT,
    ),
  },
  {
    id: "nf-reviser",
    nameZh: "返修",
    nameEn: "Reviser",
    description: "按审校意见或作者打回意见修改本章正文，交新的正文候选。",
    tools: [...READ_CONTEXT, "memory.graph", "chapter.audit", "skills.check_compliance", ...STEP_TOOLS, "Skill"],
    prompt: prompt(
      "你是 NovelFork 的返修子代理：在上一版正文候选上按意见修改，提交新的完整正文（kind=\"prose\"）。",
      [
        "先逐条读意见（工序简报里的「上一次的意见」与上游审校候选），只改被指出的问题，不推倒重写。",
        "信息不丢：改表达不删设定，不弱化钩子，不洗掉数据、编号与压迫来源。",
        "去 AI 味：抽象情绪改成可拍动作，均匀句式打碎，套话与模板转折替换。",
        "改完自查：意见是否逐条落实、有没有引入新的连续性问题。摘要里按意见编号写处理结果。",
      ],
      SUBMIT_CONTRACT,
    ),
  },
  {
    id: "nf-continuity-auditor",
    nameZh: "连续性审校",
    nameEn: "Continuity Auditor",
    description: "核对本章正文候选与设定、前情、人物状态是否冲突，提交审校结论。",
    tools: [
      ...READ_CONTEXT,
      "memory.graph",
      "memory.search",
      "character.check_consistency",
      "jingwei.audit",
      "chapter.audit",
      ...STEP_TOOLS,
    ],
    prompt: prompt(
      "你是 NovelFork 的连续性审校子代理，提交审校结论（kind=\"audit\"，payload={ passed, summary, issues }）。",
      [
        "先装裁判源：设定（lore_read）、近章记忆与人物状态（memory_read / memory_graph），再读正文候选。",
        "人物：言行是否符合动机与边界，有没有降智、工具人化、声口混同。",
        "设定与时间线：与经纬冲突、前章状态没有正确延续、角色知道了不该知道的事。",
        "每条问题写 severity（error / warning / info）与定位（段落或原句片段）；有 error 即 passed=false。",
      ],
      SUBMIT_CONTRACT,
    ),
  },
  {
    id: "nf-pacing-auditor",
    nameZh: "节奏审校",
    nameEn: "Pacing Auditor",
    description: "检查本章正文候选的章首抓力、中段回报、章末钩子与注水，提交审校结论。",
    tools: [...READ_CONTEXT, "cockpit.snapshot", "chapter.audit", ...STEP_TOOLS],
    prompt: prompt(
      "你是 NovelFork 的节奏审校子代理，提交审校结论（kind=\"audit\"）。",
      [
        "章首抓力：前 300 字有没有事发生，是否承接上章钩子。",
        "中段回报：有没有读者能爽到的点（信息揭示 / 反杀 / 关系推进），还是一路铺垫。",
        "章末钩子是否成立；信息增量是否为零；指出注水段与可删段落。",
        "爽点密度：小爽点间隔、大爽点有无铺垫与代价。每条问题带 severity 与定位。",
      ],
      SUBMIT_CONTRACT,
    ),
  },
  {
    id: "nf-deai-auditor",
    nameZh: "去AI味审校",
    nameEn: "De-AI Auditor",
    description: "按四维病灶检查本章正文候选的 AI 写作痕迹，提交审校结论。",
    tools: [...READ_CONTEXT, "chapter.audit", "skills.check_compliance", ...STEP_TOOLS],
    prompt: prompt(
      "你是 NovelFork 的去 AI 味审校子代理，提交审校结论（kind=\"audit\"）。",
      [
        "习惯用语：套话与模板词密度（「不禁 / 竟然 / 仿佛 / 深吸一口气 / 眸光流转」）。",
        "句式逻辑：句长段长是否过于均匀、排比滥用。",
        "写法口气：直接命名情绪、上帝视角总结、替读者解读。",
        "论证逻辑：对话像辩论稿、转折公式化。每类给出典型原句片段做定位，严重泛滥记 error。",
      ],
      SUBMIT_CONTRACT,
    ),
  },
  {
    id: "nf-settler",
    nameZh: "结算核对",
    nameEn: "Settlement Checker",
    description: "落盘后核对本章引起的伏笔、人物状态与时间线变化，整理成待结算清单交给领导者。",
    tools: [...READ_CONTEXT, "memory.graph", "memory.list", "memory.search", "chapter.audit", "workflow.get_current_step", "workflow.report_blocker"],
    prompt: prompt(
      "你是 NovelFork 的结算核对子代理。权威写入由领导者负责，你只核对并给出清单。",
      [
        "读已落盘的本章与近章记忆，列出本章新增 / 回收的伏笔、人物状态与关系变化、时间线推进。",
        "逐条标明证据（段落位置）与建议写回位置（设定 / 叙事记忆），区分确定事实与推测。",
        "发现与既有设定冲突时单列，并说明哪一方更可能是错的。",
      ],
      NO_SUBMIT_CONTRACT,
    ),
  },
  {
    id: "nf-assistant",
    nameZh: "资料助手",
    nameEn: "Research Assistant",
    description: "只读查资料：翻章节、设定与记忆，回答领导者的具体问题。",
    tools: [...READ_CONTEXT, "memory.graph", "memory.search", "memory.list", "cockpit.snapshot", "workflow.get_current_step"],
    prompt: prompt(
      "你是 NovelFork 的资料助手子代理，只读，回答领导者委派的具体问题。",
      [
        "先确定问题需要哪类裁判源（章节正文 / 设定 / 叙事记忆），再定向查，不全量翻。",
        "答案附证据定位（章号、条目名），查不到就明说查不到，不补设定。",
      ],
      NO_SUBMIT_CONTRACT,
    ),
  },
];

export const NOVEL_SUBAGENT_TEMPLATE_IDS: readonly string[] = NOVEL_SUBAGENT_ROSTER.map((template) => template.id);

export function isNovelSubagentTemplateId(id: string | null | undefined): boolean {
  return typeof id === "string" && NOVEL_SUBAGENT_TEMPLATE_IDS.includes(id);
}

/** 工序配方里的旧角色 id → 名册模板。 */
const LEGACY_AGENT_TEMPLATE: Readonly<Record<string, string>> = {
  writer: "nf-writer",
  reviser: "nf-reviser",
  "novel-continuity-auditor": "nf-continuity-auditor",
  "novel-text-auditor": "nf-deai-auditor",
  "novel-pacing-auditor": "nf-pacing-auditor",
  "scene-architect": "nf-scene-architect",
};

/** 工序类别的默认模板（配方没指定角色时）。 */
const KIND_DEFAULT_TEMPLATE: Partial<Record<WorkflowStepState["kind"], string>> = {
  "guided-plan": "nf-scene-architect",
  "writer-generate": "nf-writer",
  audit: "nf-continuity-auditor",
  "adversarial-audit": "nf-continuity-auditor",
};

/**
 * 一道工序期望由哪个模板完成（首选在前）。
 * 写正文的工序被打回后（带意见重做）也接受返修子代理。没有对应模板的工序返回空数组。
 */
export function rosterTemplatesForStep(
  step: Pick<WorkflowStepState, "kind" | "agentId" | "note" | "expectedOutput">,
): string[] {
  if (step.expectedOutput === null) return [];
  const fromAgent = step.agentId
    ? isNovelSubagentTemplateId(step.agentId)
      ? step.agentId
      : LEGACY_AGENT_TEMPLATE[step.agentId]
    : undefined;
  const primary = fromAgent ?? KIND_DEFAULT_TEMPLATE[step.kind];
  if (!primary) return [];
  const result = [primary];
  if (step.kind === "writer-generate" && step.note && !result.includes("nf-reviser")) result.push("nf-reviser");
  return result;
}

/** Runtime SPI 形状（与 RuntimeProductSubagentTemplate 一致），工具名为线上名。 */
export interface NovelSubagentTemplateContribution {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly description: string;
  readonly tools: readonly string[];
  readonly defaultModel?: string;
  readonly prompt: string;
}

export function toWireToolNameForRoster(name: string): string {
  return ROSTER_RUNTIME_TOOLS.includes(name) ? name : name.replace(/\./g, "_");
}

/** 名册贡献给 Runtime 的形状：工具名换成线上名。 */
export function listNovelSubagentTemplateContributions(): NovelSubagentTemplateContribution[] {
  return NOVEL_SUBAGENT_ROSTER.map((template) => ({
    id: template.id,
    nameZh: template.nameZh,
    nameEn: template.nameEn,
    description: template.description,
    tools: template.tools.map(toWireToolNameForRoster),
    ...(template.defaultModel ? { defaultModel: template.defaultModel } : {}),
    prompt: template.prompt,
  }));
}
