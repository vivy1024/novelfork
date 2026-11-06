/**
 * 纵向步骤编辑器的模型：把工作流图看成「起点 → 工序 1 → … → 工序 n → 终点」的一条链来编辑。
 *
 * - 只有单链（无并行、无分支、无汇合）的方案能在这里调顺序、增删工序；
 *   带并行或分支的方案只能改工序属性，结构请到写作台的工作流画布上改。
 * - 每次修改都经 applyWorkflowOps（与叙述者、画布同一套校验），保存前用 checkWorkflowGraph 列出结构问题。
 */

import {
  applyWorkflowOps,
  END_NODE_ID,
  START_NODE_ID,
  stepNodes,
  topologicalOrder,
  type WorkflowGraphOp,
  type WorkflowGraphRecipe,
  type WorkflowStepNode,
} from "../../engine/workflows/workflow-graph.js";
import type { NovelWorkflowStepKind, NovelWorkflowStepOnFailure } from "../../engine/workflows/novel-workflows.js";
import { NOVEL_BUILTIN_WORKFLOWS } from "../../engine/workflows/novel-workflows.js";
import { CHAPTER_WRITE_TOOLS, expectedOutputFor, MAX_AUDIT_AUTO_RETURNS } from "../../engine/workflows/run-state-machine.js";
import { isNovelSubagentTemplateId, NOVEL_SUBAGENT_ROSTER, rosterTemplatesForStep } from "../../engine/agents/roster.js";
import { getNovelToolRoutine } from "../../handlers/tool-routines.js";

export const BUILTIN_RECIPE_IDS: ReadonlySet<string> = new Set(NOVEL_BUILTIN_WORKFLOWS.map((recipe) => recipe.id));

export function isBuiltinRecipe(recipe: Pick<WorkflowGraphRecipe, "id">): boolean {
  return BUILTIN_RECIPE_IDS.has(recipe.id);
}

export const STEP_KIND_OPTIONS: ReadonlyArray<{ value: NovelWorkflowStepKind; label: string; hint: string }> = [
  { value: "context-load", label: "读取上下文", hint: "开工前读全书状态、设定与前情" },
  { value: "guided-plan", label: "镜头蓝图", hint: "拟本章的场景、冲突与结果" },
  { value: "writer-generate", label: "写正文", hint: "按蓝图写出本章完整正文" },
  { value: "audit", label: "审校", hint: "检查正文，给出通过与否和问题清单" },
  { value: "adversarial-audit", label: "多视角审校", hint: "连续性、节奏、文字几路一起审" },
  { value: "outline-plan", label: "大纲推演", hint: "推演后续几章的大纲，交你确认" },
  { value: "approval-gate", label: "作者确认", hint: "停下来等你放行" },
  { value: "post-settlement", label: "章后结算", hint: "落盘后整理伏笔、人物状态与时间线" },
  { value: "canvas-open", label: "结果整理", hint: "汇总这一章的产物" },
  { value: "custom-tool", label: "自定义", hint: "按你写的要求做" },
];

export const STEP_KIND_LABELS: Readonly<Record<NovelWorkflowStepKind, string>> = Object.fromEntries(
  STEP_KIND_OPTIONS.map((option) => [option.value, option.label]),
) as Record<NovelWorkflowStepKind, string>;

export const FAILURE_OPTIONS: ReadonlyArray<{ value: NovelWorkflowStepOnFailure; label: string }> = [
  { value: "stop", label: "停下等我处理" },
  { value: "retry", label: "自动重试" },
  { value: "skip", label: "跳过继续" },
];

/** 执行者选项：领导者（本书叙述者）自己做，或委派给某个内置子代理。 */
export const LEADER_EXECUTOR = "";

export function executorOptions(): ReadonlyArray<{ value: string; label: string }> {
  return [
    { value: LEADER_EXECUTOR, label: "叙述者自己做" },
    ...NOVEL_SUBAGENT_ROSTER.map((template) => ({ value: template.id, label: `委派：${template.nameZh}` })),
  ];
}

/** 工序当前的执行者：委派时取对应子代理（旧角色名按名册映射），否则是叙述者自己。 */
export function executorOf(step: WorkflowStepNode): string {
  if (step.executionMode !== "subagent") return LEADER_EXECUTOR;
  const [template] = rosterTemplatesForStep({ kind: step.kind, agentId: step.agentId, expectedOutput: expectedOutputFor(step.kind) });
  return template && isNovelSubagentTemplateId(template) ? template : LEADER_EXECUTOR;
}

export function subagentNameZh(id: string): string {
  return NOVEL_SUBAGENT_ROSTER.find((template) => template.id === id)?.nameZh ?? "子代理";
}

/** 工具的中文名：小说工具取套路名，Runtime 自带的技能工具单独命名。 */
export function toolDisplayName(tool: string): string {
  if (tool === "Skill") return "调用技能";
  return getNovelToolRoutine(tool)?.nameZh ?? tool;
}

/**
 * 这道工序负责把正文写进书里（能调用落盘工具）。落盘工具清单直接取自引擎 run-state-machine，
 * 判定与引擎 writesChapter 一致（这里接受未声明 tools 的草稿工序）：这类工序失败不能跳过，受阻时可带意见打回写正文。
 */
export { CHAPTER_WRITE_TOOLS };

export function writesChapter(step: { readonly tools?: readonly string[] }): boolean {
  return (step.tools ?? []).some((tool) => CHAPTER_WRITE_TOOLS.has(tool));
}

/** 某道工序可选的失败策略：落盘工序不能选「跳过」。 */
export function failureOptionsFor(step: { readonly tools?: readonly string[] }): ReadonlyArray<{ value: NovelWorkflowStepOnFailure; label: string }> {
  return writesChapter(step) ? FAILURE_OPTIONS.filter((option) => option.value !== "skip") : FAILURE_OPTIONS;
}

/** 审校类工序：不通过时可沿打回线自动返修。 */
export function isAuditKind(kind: NovelWorkflowStepKind): boolean {
  return kind === "audit" || kind === "adversarial-audit";
}

export const DEFAULT_MAX_AUTO_RETURNS = MAX_AUDIT_AUTO_RETURNS;

export interface StepListView {
  /** 工序按执行顺序排列。 */
  readonly steps: readonly WorkflowStepNode[];
  /** 单链：可以调顺序、增删工序。 */
  readonly linear: boolean;
}

export function stepListOf(recipe: WorkflowGraphRecipe): StepListView {
  const steps = stepNodes(recipe);
  const order = topologicalOrder(recipe);
  const ordered = order
    ? order.map((id) => steps.find((step) => step.id === id)).filter((step): step is WorkflowStepNode => Boolean(step))
    : steps;
  // 不在拓扑序里的（理论上没有）补在末尾，避免丢失。
  for (const step of steps) if (!ordered.includes(step)) ordered.push(step);
  return { steps: ordered, linear: isLinearChain(recipe, ordered) };
}

function isLinearChain(recipe: WorkflowGraphRecipe, ordered: readonly WorkflowStepNode[]): boolean {
  if (recipe.nodes.some((node) => node.type === "join")) return false;
  if (recipe.nodes.filter((node) => node.type === "end").length !== 1) return false;
  if (!recipe.nodes.some((node) => node.id === START_NODE_ID) || !recipe.nodes.some((node) => node.id === END_NODE_ID)) return false;
  if (ordered.some((step) => (step.outcomes?.length ?? 0) > 0)) return false;
  const next = recipe.edges.filter((edge) => edge.kind === "next");
  const chain = [START_NODE_ID, ...ordered.map((step) => step.id), END_NODE_ID];
  if (next.length !== chain.length - 1) return false;
  return chain.slice(0, -1).every((id, index) => next.some((edge) => edge.source === id && edge.target === chain[index + 1] && edge.outcome === undefined));
}

/** 打回线：这道工序被打回（作者打回或审校不过）时回到哪道工序。 */
export function rejectTargetOf(recipe: WorkflowGraphRecipe, stepId: string): string | null {
  return recipe.edges.find((edge) => edge.kind === "reject" && edge.source === stepId)?.target ?? null;
}

export type StepListResult =
  | { readonly ok: true; readonly recipe: WorkflowGraphRecipe }
  | { readonly ok: false; readonly what: string; readonly why: string; readonly action: string };

function apply(recipe: WorkflowGraphRecipe, ops: WorkflowGraphOp[]): StepListResult {
  const result = applyWorkflowOps(recipe, ops);
  return result.ok ? { ok: true, recipe: result.recipe } : { ok: false, ...result.explanation };
}

/** 单链重排：删掉所有「下一步」连线，按新顺序重新连起点 → 各工序 → 终点。打回线保留（指错方向时由校验报出）。 */
function rechain(recipe: WorkflowGraphRecipe, orderedIds: readonly string[]): StepListResult {
  const ops: WorkflowGraphOp[] = recipe.edges
    .filter((edge) => edge.kind === "next")
    .map((edge) => ({ op: "disconnect", id: edge.id }));
  const chain = [START_NODE_ID, ...orderedIds, END_NODE_ID];
  for (let i = 0; i < chain.length - 1; i++) ops.push({ op: "connect", source: chain[i]!, target: chain[i + 1]! });
  return apply(recipe, ops);
}

export function moveStep(recipe: WorkflowGraphRecipe, stepId: string, delta: -1 | 1): StepListResult {
  const ids = stepListOf(recipe).steps.map((step) => step.id);
  const from = ids.indexOf(stepId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return { ok: true, recipe };
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  return rechain(recipe, ids);
}

export function removeStep(recipe: WorkflowGraphRecipe, stepId: string): StepListResult {
  const ids = stepListOf(recipe).steps.map((step) => step.id).filter((id) => id !== stepId);
  const removed = apply(recipe, [{ op: "remove_node", id: stepId }]);
  return removed.ok ? rechain(removed.recipe, ids) : removed;
}

export function appendStep(recipe: WorkflowGraphRecipe, kind: NovelWorkflowStepKind = "custom-tool"): StepListResult {
  const taken = new Set(recipe.nodes.map((node) => node.id));
  let n = stepNodes(recipe).length + 1;
  while (taken.has(`step-${n}`)) n++;
  const id = `step-${n}`;
  const added = apply(recipe, [{ op: "add_node", node: { type: "step", id, label: `新工序 ${n}`, kind, enabled: true } }]);
  if (!added.ok) return added;
  return rechain(added.recipe, [...stepListOf(recipe).steps.map((step) => step.id), id]);
}

/** 改工序字段；值为 null 表示去掉该字段。 */
export function updateStep(recipe: WorkflowGraphRecipe, stepId: string, patch: Record<string, unknown>): StepListResult {
  return apply(recipe, [{ op: "update_node", id: stepId, patch }]);
}

export function setExecutor(recipe: WorkflowGraphRecipe, stepId: string, executor: string): StepListResult {
  return updateStep(recipe, stepId, executor === LEADER_EXECUTOR
    ? { executionMode: null, agentId: null }
    : { executionMode: "subagent", agentId: executor });
}

/** 设置打回到哪道工序（null 表示不打回）。 */
export function setRejectTarget(recipe: WorkflowGraphRecipe, stepId: string, target: string | null): StepListResult {
  const ops: WorkflowGraphOp[] = recipe.edges
    .filter((edge) => edge.kind === "reject" && edge.source === stepId)
    .map((edge) => ({ op: "disconnect", id: edge.id }));
  if (target) ops.push({ op: "connect", source: stepId, target, kind: "reject" });
  return apply(recipe, ops);
}

export function setRecipeMeta(recipe: WorkflowGraphRecipe, patch: { name?: string; description?: string }): StepListResult {
  return apply(recipe, [{ op: "set_meta", patch }]);
}
