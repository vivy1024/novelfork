/**
 * 工序简报：告诉叙述者「现在哪些工序要做、各自能用什么、必须交什么」。
 * 工作流是图，可能有多道工序同时进行（并行分支）；每道都单独列出，提交时用 stepId 区分。
 *
 * 同一份文本有两个出口：每趟对话开始时作为 system 级 promptExtension 注入，
 * 以及 workflow.get_current_step / submit_step_output 的返回结果（同一趟内切换工序靠它）。
 * 工具名一律写成模型看到的线上名（点换下划线），与 Runtime 的归一化一致。
 */

import type { WorkflowRunRecord } from "./run-store.js";
import { hasDownstreamProseStep, runningSteps, type WorkflowCandidateKind, type WorkflowStepState } from "./run-state-machine.js";
import { workflowTeamIdForBook } from "./workflow-team.js";
import { rosterTemplatesForStep } from "../agents/roster.js";
import type { WorkflowStepNode } from "./workflow-graph.js";

export function toWireToolName(name: string): string {
  return name.replace(/\./g, "_");
}

const KIND_LABEL: Record<WorkflowCandidateKind, string> = {
  "scene-spec": "镜头蓝图",
  prose: "正文",
  audit: "审查结论",
  outline: "大纲候选",
  other: "工序小结",
};

const PAYLOAD_SHAPE: Record<WorkflowCandidateKind, string> = {
  "scene-spec":
    '{ "sceneSpec": { "chapter": 章号, "title": "标题", "wordTarget": 字数, "scenes": [{ "characters": [], "location": "", "conflict": "", "mood": "", "outcome": "", "hooks_used": [], "hooks_planted": [] }], "constraints": [] } }',
  prose: '{ "title": "章节标题", "content": "完整正文" }',
  audit: '{ "passed": true 或 false, "summary": "结论", "issues": [{ "severity": "error | warning | info", "description": "问题与定位" }] }',
  outline:
    '{ "summary": "调整思路", "fromChapter": 起始章号, "chapters": [{ "chapter": 章号, "title": "暂定标题", "goal": "本章目标", "conflict": "冲突", "hooks": ["埋设或回收的伏笔"] }], "risks": ["与卷纲或设定的冲突"] }',
  other: '{ "summary": "本工序做了什么、结果如何" }',
};

const DEFAULT_GOAL: Partial<Record<WorkflowStepState["kind"], string>> = {
  "context-load": "读取本章所需上下文（驾驶舱、预检、记忆、设定），确认可以开写；缺关键输入就报告阻塞。",
  "guided-plan": "由你本人拟出本章镜头蓝图（场景、冲突、情绪、结果、伏笔），作为正文的骨架。",
  "writer-generate": "按已确认的蓝图写出本章完整正文。",
  audit: "审查本章正文的连续性、叙事与文本问题，给出结论与可定位的问题清单。",
  "adversarial-audit": "从连续性、叙事、去 AI 味等多个视角对抗审查本章正文，给出结论与问题清单。",
  "outline-plan": "读卷纲、章摘要、伏笔与故事时间线，推演后续若干章的大纲调整（伏笔回收排期、节奏、冲突升级），交大纲候选给作者确认；不改卷纲与设定，不写正文。",
  "post-settlement": "把已确认的正文落盘并完成章后结算。",
  "canvas-open": "整理本章结果，供作者在画布中查看。",
  "custom-tool": "按本工序配置的工具完成指定操作。",
};

/** 审校排在改稿之前、没有打回线：意见交给下游改稿，不打回。 */
function auditsBeforeRevision(run: WorkflowRunRecord, stepId: string): boolean {
  return !run.recipe.edges.some((edge) => edge.kind === "reject" && edge.source === stepId) && hasDownstreamProseStep(run.recipe, stepId);
}

function recipeStepOf(run: WorkflowRunRecord, stepId: string): WorkflowStepNode | undefined {
  return run.recipe.nodes.find((node): node is WorkflowStepNode => node.type === "step" && node.id === stepId);
}

function header(run: WorkflowRunRecord): string[] {
  return [
    "【创作工作流 · 由产品状态机驱动】",
    `运行 ${run.id}（版本 ${run.state.revision}）｜第 ${run.chapterNumber} 章｜方案「${run.recipe.name}」`,
  ];
}

function executionLine(
  run: WorkflowRunRecord,
  step: WorkflowStepState,
  recipeStep: { modelOverride?: string; parallelSubagents?: readonly { name: string }[] } | undefined,
): string {
  if (step.executorKind === "subagent") {
    const templates = rosterTemplatesForStep(step);
    const builtin = templates.length > 0
      ? `执行方式（首选）：委派内置子代理——Agent(subagent_type="${templates[0]}"${recipeStep?.modelOverride ? `, model="${recipeStep.modelOverride}"` : ""})` +
        `${templates.length > 1 ? `（按打回意见返修时可改派 subagent_type="${templates[1]}"）` : ""}。` +
        `prompt 里只写本工序目标、stepId="${step.stepId}" 与需要它参考的候选 id，不要粘贴正文或蓝图原文（子代理用 workflow_get_current_step 自己取）。` +
        "子代理会直接用 workflow_submit_step_output 提交本工序产物，交还你的是摘要与 candidateId；你不要再提交一遍，也不要把正文转贴给作者。" +
        "内置子代理不可用（没有 Agent 工具或模板未加载）时按下面的次选办法。\n"
      : "";
    const model = recipeStep?.modelOverride ? `，model=${recipeStep.modelOverride}` : "";
    const parallel = recipeStep?.parallelSubagents?.length
      ? `；并行子代理：${recipeStep.parallelSubagents.map((agent) => agent.name).join("、")}（团队里各自 team_dispatch，或各自 task(run_in_background=true)，汇总后一次提交）`
      : "";
    // 一本书一个团队：插件按 teamId 存团队配置，不指定就会都落到默认团队里串成一锅。
    const teamId = run.bookId ? workflowTeamIdForBook(run.bookId) : "";
    const teamLine = teamId
      ? `团队 id 用 "${teamId}"（本书专用；team_setup / team_status 等工具的 teamId 参数都填它，不要用默认团队）；`
      : "";
    return (
      builtin +
      `${builtin ? "次选" : "执行方式"}：委派工人执行（产物必须由你本人提交，工人不得直写权威源）——` +
      `优先用团队编排工具（plugin__com_whisent_narrator-team__ 前缀）：① team_status 读现有编排，合并后 team_setup 写回（勿盲覆盖既有配置）；` +
      `${teamLine}` +
      `② team_dispatch 把本工序目标派给标题前缀「工作流工人·」的对应工人（角色 ${step.agentId ?? "writer"}${model}）；` +
      `③ team_report / team_status 收集结果。` +
      `没有团队工具时回退：用 task(subagent_type="general") 派 Runtime 通用子代理并把工序目标写进 prompt；` +
      `注意这是能力降级——通用子代理没有该角色的专门技能与工人绑定（团队里的「工作流工人·」叙述者才带书级工具），请优先在画布一键启用 narrator-team 后重试。` +
      `若既无团队工具也无可用子代理，调用 workflow_report_blocker。${parallel}`
    );
  }
  if (step.executorKind === "domain-tool") return "执行方式：只调用本工序列出的工具完成，不要自行发挥。";
  return `执行方式：由你本人完成${step.agentId ? `（建议角色：${step.agentId}）` : ""}。`;
}

/** 一道进行中工序的完整说明。 */
function runningStepLines(run: WorkflowRunRecord, step: WorkflowStepState, multiple: boolean): string[] {
  const recipeStep = recipeStepOf(run, step.stepId);
  const lines = [`▶ 工序 ${step.ordinal}：${step.label}（stepId="${step.stepId}"）`];
  lines.push(`目标：${recipeStep?.customPrompt?.trim() || DEFAULT_GOAL[step.kind] || "完成本工序。"}`);
  lines.push(executionLine(run, step, recipeStep));
  const writeTools = step.executorKind === "subagent" ? [] : step.tools.map(toWireToolName);
  lines.push(
    writeTools.length > 0
      ? `允许的写入工具：${writeTools.join("、")}（读类工具不受限）。`
      : "不允许调用任何写入工具（读类工具不受限）。",
  );
  if (step.tools.includes("pipeline.write")) {
    lines.push("落盘正文：调用 pipeline_write 时传 fromWorkflowRun=true，正文与蓝图由工具从本运行里作者已确认的候选取，不要再把正文贴进 content。");
  } else if (step.tools.includes("chapter.write")) {
    lines.push("覆盖已有章节：调用 chapter_write 时 content 原样使用 workflow_get_current_step 返回的 approvedProse.content（作者已确认的那一版），不要改动。");
  }
  if (recipeStep?.skills?.length) {
    lines.push(`需要遵循的写作技能：${recipeStep.skills.join("、")}（用 Skill 工具读取）。`);
  }
  if (step.expectedOutput) {
    const stepArg = multiple ? `stepId="${step.stepId}"，` : "";
    const outcomeArg = step.outcomes.length > 0 ? `，outcome 取 ${step.outcomes.map((item) => `"${item}"`).join(" / ")} 之一（决定后续走哪条分支）` : "";
    lines.push(
      `必交产物：调用 workflow_submit_step_output，${stepArg}runRevision=${run.state.revision}，kind="${step.expectedOutput}"${outcomeArg}，payload=${PAYLOAD_SHAPE[step.expectedOutput]}`,
      step.requiresApproval
        ? "提交后需要作者确认才继续。"
        : step.expectedOutput === "prose"
          ? "提交后进入审校；正文要等审校与作者确认后才会落盘。"
          : step.expectedOutput === "audit"
            ? auditsBeforeRevision(run, step.stepId)
              ? "审校意见会交给下游的改稿工序落实；不通过（passed=false）也照常往下走，不打回。"
              : "审校不通过（passed=false）时会自动打回写正文的工序返修，返修轮数用完后交作者决定。"
            : "提交通过校验后自动继续，返回结果里会给出新的简报。",
    );
  }
  if (step.note) {
    lines.push(`上一次的意见：${step.note.what}；${step.note.why}；建议：${step.note.action}`);
  }
  return lines;
}

/**
 * 委派子代理的简报：只讲分给它的工序（目标、必交产物、上一次的意见），不讲团队编排与其它工序。
 * allowedStepIds 为空时说明现在没有它能做的事。
 */
export function buildDelegatedStepBrief(run: WorkflowRunRecord, template: string, allowedStepIds: readonly string[]): string {
  const lines = [
    `【创作工作流 · 你是内置子代理 ${template}】`,
    `运行 ${run.id}（版本 ${run.state.revision}）｜第 ${run.chapterNumber} 章｜方案「${run.recipe.name}」`,
  ];
  const steps = runningSteps(run.state).filter((step) => allowedStepIds.includes(step.stepId));
  if (steps.length === 0) {
    lines.push("现在没有分给你的进行中工序：不要提交任何产物，把情况写成一两句摘要交还领导者。");
    return lines.join("\n");
  }
  for (const step of steps) {
    const recipeStep = recipeStepOf(run, step.stepId);
    lines.push(`▶ 工序：${step.label}（stepId="${step.stepId}"）`);
    lines.push(`目标：${recipeStep?.customPrompt?.trim() || DEFAULT_GOAL[step.kind] || "完成本工序。"}`);
    if (recipeStep?.skills?.length) lines.push(`需要遵循的写作技能：${recipeStep.skills.join("、")}（用 Skill 工具读取）。`);
    if (step.expectedOutput) {
      const outcomeArg = step.outcomes.length > 0 ? `，outcome 取 ${step.outcomes.map((item) => `"${item}"`).join(" / ")} 之一` : "";
      lines.push(`必交产物：workflow_submit_step_output，stepId="${step.stepId}"，runRevision=${run.state.revision}，kind="${step.expectedOutput}"${outcomeArg}，payload=${PAYLOAD_SHAPE[step.expectedOutput]}`);
    }
    if (step.note) lines.push(`上一次的意见：${step.note.what}；${step.note.why}；建议：${step.note.action}`);
  }
  lines.push("上游材料（蓝图、上一版正文、各道审校的意见、大纲与市场分析）在本工具结果的 upstream 字段里，按需取用；上游没有正文时用 chapter_read 读已保存的本章。");
  lines.push("交还领导者时只写摘要与 candidateId，不贴正文。");
  return lines.join("\n");
}

/** 生成工序简报。运行已结束时返回 null（不再注入任何约束）。 */
export function buildWorkflowRunBrief(run: WorkflowRunRecord): string | null {
  const { status } = run.state;
  if (status === "done" || status === "cancelled") return null;
  const lines = header(run);

  if (status === "blocked") {
    const failed = run.state.steps.find((step) => step.status === "failed");
    lines.push(`状态：受阻——${failed ? `工序「${failed.label}」` : ""}${failed?.note?.what ?? "工序失败"}。`);
    if (failed?.note) lines.push(`原因：${failed.note.why}`);
    lines.push("等待作者在「工作流」页选择重试、跳过或取消；期间不要调用写入工具，也不要提交其他工序。");
    return lines.join("\n");
  }

  const running = runningSteps(run.state);
  const awaiting = run.state.steps.filter((step) => step.status === "awaiting_approval");
  if (running.length === 0) {
    if (awaiting.length === 0) {
      lines.push("运行没有进行中的工序，状态异常。请调用 workflow_report_blocker 说明情况，等待作者处理。");
      return lines.join("\n");
    }
    for (const step of awaiting) {
      lines.push(
        step.executorKind === "manual-gate"
          ? `「${step.label}」：人工门禁，等待作者在「写作 › 工作流」放行。`
          : `「${step.label}」：${step.expectedOutput ? KIND_LABEL[step.expectedOutput] : "产物"}已提交，等待作者在「写作 › 工作流」确认。`,
      );
    }
    lines.push("现在停止产出，不要调用任何写入工具；作者确认或打回后会在下一轮告诉你结果。");
    return lines.join("\n");
  }

  const multiple = running.length > 1;
  lines.push(multiple
    ? `现在有 ${running.length} 道工序同时进行（并行分支），可以依次完成，提交时用 stepId 指明是哪一道：`
    : `当前工序（共 ${run.state.steps.length} 道）：`);
  for (const step of running) lines.push(...runningStepLines(run, step, multiple));
  if (awaiting.length > 0) {
    lines.push(`另有等待作者确认的工序：${awaiting.map((step) => step.label).join("、")}（不要再提交它们）。`);
  }
  lines.push("其他写入工具在工作流运行期间会被拒绝。做不到时调用 workflow_report_blocker（带上 stepId）并写清 what / why / action，不要编造产物。");
  return lines.join("\n");
}
