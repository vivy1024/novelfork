/**
 * 创作工作流的图结构（纯函数）。
 *
 * 一个工作流 = 节点 + 连线：
 * - 节点：起点（恰好一个）、终点（至少一个）、工序、汇合。
 * - 「下一步」连线：定义正向流程，必须无环。工序若声明了 outcomes（如审查的通过 / 不通过），
 *   出线可带 outcome 条件，提交时按结果选线；工序连出多条无条件连线即并行分叉。
 * - 「打回」连线：从需要作者确认的工序指回正向上游的工序；作者打回时从那里重做。
 *
 * 汇合与终点等所有入线都有结果才继续。没被选中的分支以「未走到」向下传递（死路径消除），
 * 所以分支 + 汇合既能表达并行合流，也能表达二选一后的合流，不会因某条分支没走而卡住。
 *
 * 结构问题（没连上、有环……）不阻止保存草稿，但阻止发布；只有已发布的工作流能运行。
 */

import type {
  NovelParallelSubagentConfig,
  NovelWorkflowExecutionMode,
  NovelWorkflowResultStrategy,
  NovelWorkflowStep,
  NovelWorkflowStepKind,
  NovelWorkflowStepOnFailure,
} from "./novel-workflows.js";

export const WORKFLOW_GRAPH_SCHEMA_VERSION = 2;

export interface WorkflowExplanationText {
  readonly what: string;
  readonly why: string;
  readonly action: string;
}

// ─── 类型 ────────────────────────────────────────────────────────────────────

export type WorkflowNodeType = "start" | "end" | "step" | "join";
export type WorkflowEdgeKind = "next" | "reject";
export type WorkflowRecipeStatus = "draft" | "published";

export interface WorkflowStartNode {
  readonly id: string;
  readonly type: "start";
  readonly label: string;
}

export interface WorkflowEndNode {
  readonly id: string;
  readonly type: "end";
  readonly label: string;
}

/** 汇合：等所有入线都有结果（完成或未走到）才继续。 */
export interface WorkflowJoinNode {
  readonly id: string;
  readonly type: "join";
  readonly label: string;
}

/** 工序节点：沿用线性方案的工序字段，另可声明提交结果（用于分支）。 */
export interface WorkflowStepNode extends NovelWorkflowStep {
  readonly type: "step";
  /** 这道工序提交时必须给出的结果之一，出线按结果分支；不声明则所有出线同时走（并行）。 */
  readonly outcomes?: readonly string[];
}

export type WorkflowGraphNode = WorkflowStartNode | WorkflowEndNode | WorkflowJoinNode | WorkflowStepNode;

export interface WorkflowGraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: WorkflowEdgeKind;
  /** 仅「下一步」连线：源工序提交该结果时才走这条线。 */
  readonly outcome?: string;
}

export interface WorkflowNodePosition {
  readonly x: number;
  readonly y: number;
}

export interface WorkflowGraphRecipe {
  readonly schemaVersion: typeof WORKFLOW_GRAPH_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly commandId: string;
  readonly description: string;
  readonly genre?: string;
  readonly status: WorkflowRecipeStatus;
  /** 每次保存 + 1，用于乐观并发：画布与叙述者同时改同一个工作流时后到者收到冲突。 */
  readonly revision: number;
  /** 谁建的草稿：叙述者建的草稿要作者在画布上确认发布。 */
  readonly createdBy?: "author" | "narrator";
  readonly nodes: readonly WorkflowGraphNode[];
  readonly edges: readonly WorkflowGraphEdge[];
  readonly resultStrategy: NovelWorkflowResultStrategy;
  readonly maxRetries: number;
  /** 画布上节点的位置；缺位置的节点由 layoutWorkflowGraph 自动排版。运行时不使用。 */
  readonly layout?: { readonly positions: Readonly<Record<string, WorkflowNodePosition>> };
}

/** 线性方案（schemaVersion 1）：工序数组 + 终审开关。只在读取旧文件与定义内置方案时出现。 */
export interface LegacyWorkflowRecipe {
  readonly id: string;
  readonly name: string;
  readonly commandId: string;
  readonly description: string;
  readonly genre?: string;
  readonly steps: readonly NovelWorkflowStep[];
  readonly resultStrategy: NovelWorkflowResultStrategy;
  readonly requireFinalApproval: boolean;
  readonly maxRetries: number;
}

export interface WorkflowGraphIssue {
  readonly code: string;
  readonly nodeId?: string;
  readonly edgeId?: string;
  readonly explanation: WorkflowExplanationText;
}

export const START_NODE_ID = "start";
export const END_NODE_ID = "end";

// ─── 线性方案 → 图 ───────────────────────────────────────────────────────────

/**
 * 把线性方案转成等价的图：起点 → 工序 1 → … → 工序 n → 终点。
 * requireFinalApproval 并入「最后一道启用的工序需要确认」（与线性运行时的语义一致）。
 */
export function linearRecipeToGraph(legacy: LegacyWorkflowRecipe): WorkflowGraphRecipe {
  const lastEnabledIndex = legacy.steps.reduce((last, step, index) => (step.enabled ? index : last), -1);
  const stepNodes: WorkflowStepNode[] = legacy.steps.map((step, index) => ({
    ...step,
    type: "step",
    ...(legacy.requireFinalApproval && index === lastEnabledIndex ? { requiresApproval: true } : {}),
  }));
  const chain = [START_NODE_ID, ...stepNodes.map((node) => node.id), END_NODE_ID];
  const usedIds = new Set(chain);
  const edges: WorkflowGraphEdge[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    edges.push({ id: uniqueId(`e-${chain[i]}-${chain[i + 1]}`, usedIds), source: chain[i]!, target: chain[i + 1]!, kind: "next" });
  }
  return {
    schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
    id: legacy.id,
    name: legacy.name,
    commandId: legacy.commandId,
    description: legacy.description,
    ...(legacy.genre !== undefined ? { genre: legacy.genre } : {}),
    status: "published",
    revision: 1,
    nodes: [
      { id: START_NODE_ID, type: "start", label: "开始" },
      ...stepNodes,
      { id: END_NODE_ID, type: "end", label: "完成" },
    ],
    edges,
    resultStrategy: legacy.resultStrategy,
    maxRetries: legacy.maxRetries,
  };
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

// ─── 查询 ────────────────────────────────────────────────────────────────────

export function stepNodes(recipe: Pick<WorkflowGraphRecipe, "nodes">): WorkflowStepNode[] {
  return recipe.nodes.filter((node): node is WorkflowStepNode => node.type === "step");
}

export function nextEdges(recipe: Pick<WorkflowGraphRecipe, "edges">): WorkflowGraphEdge[] {
  return recipe.edges.filter((edge) => edge.kind === "next");
}

/**
 * 正向（「下一步」连线）拓扑序。有环时返回 null。
 * 同层按节点在数组中的顺序排列，保证结果稳定（工序序号、简报顺序依赖它）。
 */
export function topologicalOrder(recipe: Pick<WorkflowGraphRecipe, "nodes" | "edges">): string[] | null {
  const ids = recipe.nodes.map((node) => node.id);
  const indexOf = new Map(ids.map((id, index) => [id, index]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of nextEdges(recipe)) {
    if (!indegree.has(edge.source) || !indegree.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)!.push(edge.target);
  }
  const ready = ids.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => indexOf.get(a)! - indexOf.get(b)!);
    const id = ready.shift()!;
    order.push(id);
    for (const target of outgoing.get(id) ?? []) {
      const left = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, left);
      if (left === 0) ready.push(target);
    }
  }
  return order.length === ids.length ? order : null;
}

/** 沿「下一步」连线可达的全部后继（不含自身）。 */
export function forwardDescendants(recipe: Pick<WorkflowGraphRecipe, "edges">, fromId: string): Set<string> {
  const edges = nextEdges(recipe);
  const seen = new Set<string>();
  const stack = [fromId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const edge of edges) {
      if (edge.source === id && !seen.has(edge.target)) {
        seen.add(edge.target);
        stack.push(edge.target);
      }
    }
  }
  return seen;
}

// ─── 结构检查 ────────────────────────────────────────────────────────────────

function issue(code: string, what: string, why: string, action: string, at: { nodeId?: string; edgeId?: string } = {}): WorkflowGraphIssue {
  return { code, ...at, explanation: { what, why, action } };
}

/**
 * 检查图能否运行。返回全部问题（画布据此逐个标红），空数组表示可以发布。
 * 只查结构；字段类型与枚举由存储层校验。
 */
export function checkWorkflowGraph(recipe: Pick<WorkflowGraphRecipe, "nodes" | "edges">): WorkflowGraphIssue[] {
  const issues: WorkflowGraphIssue[] = [];
  const nodes = new Map<string, WorkflowGraphNode>();
  for (const node of recipe.nodes) {
    if (nodes.has(node.id)) {
      issues.push(issue("duplicate-node", `节点 id「${node.id}」重复`, "连线和运行记录都按 id 找节点，重复会指错", "给其中一个换个 id", { nodeId: node.id }));
    }
    nodes.set(node.id, node);
  }
  const label = (id: string) => nodes.get(id)?.label ?? id;

  const starts = recipe.nodes.filter((node) => node.type === "start");
  const ends = recipe.nodes.filter((node) => node.type === "end");
  if (starts.length !== 1) {
    issues.push(issue("start-count", `工作流有 ${starts.length} 个起点`, "运行从唯一的起点出发", starts.length === 0 ? "添加一个起点" : "只保留一个起点"));
  }
  if (ends.length === 0) issues.push(issue("no-end", "工作流没有终点", "流程走到终点才算完成", "添加一个终点并连上"));
  if (!recipe.nodes.some((node) => node.type === "step")) {
    issues.push(issue("no-step", "工作流没有任何工序", "没有工序就无事可做", "至少添加一道工序"));
  }

  const edgeIds = new Set<string>();
  const incoming = new Map<string, WorkflowGraphEdge[]>();
  const outgoing = new Map<string, WorkflowGraphEdge[]>();
  for (const edge of recipe.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push(issue("duplicate-edge", `连线 id「${edge.id}」重复`, "删改连线按 id 定位", "给其中一条换个 id", { edgeId: edge.id }));
    }
    edgeIds.add(edge.id);
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      issues.push(issue("dangling-edge", `连线「${edge.id}」连到了不存在的节点`, "节点删掉后连线没跟着删", "删掉这条连线", { edgeId: edge.id }));
      continue;
    }
    if (edge.source === edge.target) {
      issues.push(issue("self-loop", `「${label(edge.source)}」连向了自己`, "工序不能以自己为下一步；重做请用作者打回", "删掉这条连线", { edgeId: edge.id }));
      continue;
    }
    if (edge.kind !== "next") continue;
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }

  for (const node of recipe.nodes) {
    const ins = incoming.get(node.id) ?? [];
    const outs = outgoing.get(node.id) ?? [];
    const at = { nodeId: node.id };
    switch (node.type) {
      case "start":
        if (ins.length > 0) issues.push(issue("start-incoming", "有连线指向起点", "起点是流程的第一步", "删掉指向起点的连线", at));
        if (outs.length === 0) issues.push(issue("start-dangling", "起点没有连出去", "运行启动后无处可走", "从起点连到第一道工序", at));
        break;
      case "end":
        if (outs.length > 0) issues.push(issue("end-outgoing", `终点「${node.label}」还连向别处`, "到终点流程就结束了", "删掉终点的出线", at));
        if (ins.length === 0) issues.push(issue("end-unreached", `终点「${node.label}」没有入线`, "走不到的终点永远不会完成", "把最后一道工序连到它，或删掉它", at));
        break;
      case "join":
        if (ins.length < 2) issues.push(issue("join-inputs", `汇合「${node.label}」只有 ${ins.length} 条入线`, "汇合用来等多条分支会合", "至少连入两条分支，或删掉这个汇合", at));
        if (outs.length === 0) issues.push(issue("join-dangling", `汇合「${node.label}」没有连出去`, "分支会合后要继续往下走", "把汇合连到下一道工序或终点", at));
        break;
      case "step": {
        if (ins.length === 0) issues.push(issue("step-unreached", `工序「${node.label}」没有入线`, "没有上一步的工序永远不会开始", "把它接到流程里，或删掉它", at));
        if (ins.length > 1) {
          issues.push(issue("step-multi-input", `工序「${node.label}」有 ${ins.length} 条入线`, "多条分支直接汇到一道工序时，不清楚该等全部还是等任意一条", "在它前面加一个汇合节点", at));
        }
        if (outs.length === 0) issues.push(issue("step-dangling", `工序「${node.label}」没有下一步`, "流程会停在这里，走不到终点", "把它连到下一道工序或终点", at));
        issues.push(...checkStepOutcomes(node, outs));
        break;
      }
    }
  }

  const order = topologicalOrder(recipe);
  if (order === null) {
    issues.push(issue("cycle", "「下一步」连线形成了环", "正向流程必须有始有终；需要重做请用「打回」连线，由作者决定", "找出环上的一条连线删掉，或改成打回连线"));
  }

  const start = starts[0];
  if (start) {
    const reachable = forwardDescendants(recipe, start.id);
    for (const node of recipe.nodes) {
      if (node.id !== start.id && !reachable.has(node.id) && (incoming.get(node.id) ?? []).length > 0) {
        issues.push(issue("unreachable", `「${node.label}」从起点走不到`, "它所在的这段流程和起点断开了", "把这段流程接回主干", { nodeId: node.id }));
      }
    }
  }
  const endIds = new Set(ends.map((node) => node.id));
  for (const node of recipe.nodes) {
    if (node.type === "end" || endIds.size === 0) continue;
    const descendants = forwardDescendants(recipe, node.id);
    if (![...descendants].some((id) => endIds.has(id)) && (outgoing.get(node.id) ?? []).length > 0) {
      issues.push(issue("no-path-to-end", `「${node.label}」之后走不到终点`, "流程会在这段里打转或停下", "把这段流程连到某个终点", { nodeId: node.id }));
    }
  }

  const rejectSources = new Set<string>();
  for (const edge of recipe.edges) {
    if (edge.kind !== "reject" || !nodes.has(edge.source) || !nodes.has(edge.target) || edge.source === edge.target) continue;
    const source = nodes.get(edge.source)!;
    const target = nodes.get(edge.target)!;
    const at = { edgeId: edge.id };
    if (source.type !== "step" || !requiresAuthorDecision(source)) {
      issues.push(issue("reject-source", `「${source.label}」不需要作者确认，不能连出打回线`, "打回是作者在确认环节做的决定", "给这道工序开启「需要确认」，或删掉打回线", at));
      continue;
    }
    if (target.type !== "step") {
      issues.push(issue("reject-target", `打回线指向了「${target.label}」`, "只能打回到某道工序重做", "把打回线改指向上游的一道工序", at));
      continue;
    }
    if (!forwardDescendants(recipe, target.id).has(source.id)) {
      issues.push(issue("reject-not-upstream", `「${target.label}」不在「${source.label}」的上游`, "打回只能往回走，指向下游或旁支会让流程乱序", "改指向这道工序之前的某道工序", at));
    }
    if (rejectSources.has(source.id)) {
      issues.push(issue("reject-duplicate", `「${source.label}」连出了多条打回线`, "作者打回时只能回到一个地方", "只保留一条打回线", at));
    }
    rejectSources.add(source.id);
  }
  return issues;
}

/** 这道工序是否会停下来等作者：需要确认的工序与人工门禁。 */
export function requiresAuthorDecision(step: Pick<WorkflowStepNode, "kind" | "requiresApproval">): boolean {
  return step.kind === "approval-gate" || step.requiresApproval === true;
}

function checkStepOutcomes(step: WorkflowStepNode, outs: readonly WorkflowGraphEdge[]): WorkflowGraphIssue[] {
  const issues: WorkflowGraphIssue[] = [];
  const at = { nodeId: step.id };
  const outcomes = step.outcomes ?? [];
  const conditioned = outs.filter((edge) => edge.outcome !== undefined);
  if (outcomes.length === 0) {
    for (const edge of conditioned) {
      issues.push(issue("outcome-undeclared", `「${step.label}」没有声明结果，连线却带了条件「${edge.outcome}」`, "工序不声明结果时所有出线都会同时走", "给工序声明结果，或去掉连线上的条件", { edgeId: edge.id }));
    }
    return issues;
  }
  if (new Set(outcomes).size !== outcomes.length) {
    issues.push(issue("outcome-duplicate", `「${step.label}」声明的结果有重复`, "提交时按结果名选线，重名会分不清", "去掉重复的结果", at));
  }
  for (const edge of conditioned) {
    if (!outcomes.includes(edge.outcome!)) {
      issues.push(issue("outcome-unknown", `连线条件「${edge.outcome}」不是「${step.label}」声明的结果`, "提交永远不会给出这个结果，这条线走不到", `改成 ${outcomes.join(" / ")} 之一`, { edgeId: edge.id }));
    }
  }
  const hasDefault = outs.some((edge) => edge.outcome === undefined);
  const uncovered = outcomes.filter((outcome) => !conditioned.some((edge) => edge.outcome === outcome));
  if (!hasDefault && uncovered.length > 0) {
    issues.push(issue("outcome-uncovered", `「${step.label}」提交「${uncovered.join(" / ")}」时无路可走`, "每种结果都要有去处，否则流程会停在这里", "为这些结果各连一条线，或加一条不带条件的默认线", at));
  }
  if (step.enabled === false) {
    issues.push(issue("branch-disabled", `分支工序「${step.label}」被停用了`, "停用的工序会被直接跳过，没有结果就不知道该走哪条分支", "重新启用它，或删掉它并改好连线", at));
  }
  if (step.onFailure === "skip") {
    issues.push(issue("branch-skip", `分支工序「${step.label}」失败时设为跳过`, "跳过就没有结果，不知道该走哪条分支", "失败处理改为停止或重试", at));
  }
  return issues;
}

// ─── 编辑指令（叙述者与画布共用） ─────────────────────────────────────────────

export type WorkflowGraphOp =
  | { readonly op: "add_node"; readonly node: Partial<WorkflowGraphNode> & { readonly type: WorkflowNodeType } }
  | { readonly op: "update_node"; readonly id: string; readonly patch: Record<string, unknown> }
  | { readonly op: "remove_node"; readonly id: string }
  | { readonly op: "connect"; readonly source: string; readonly target: string; readonly kind?: WorkflowEdgeKind; readonly outcome?: string; readonly id?: string }
  | { readonly op: "disconnect"; readonly id?: string; readonly source?: string; readonly target?: string }
  | { readonly op: "set_meta"; readonly patch: Partial<Pick<WorkflowGraphRecipe, "name" | "description" | "genre" | "resultStrategy" | "maxRetries" | "commandId">> };

export type WorkflowOpsResult =
  | { readonly ok: true; readonly recipe: WorkflowGraphRecipe; readonly issues: WorkflowGraphIssue[] }
  | { readonly ok: false; readonly failedIndex: number; readonly explanation: WorkflowExplanationText };

const STEP_KINDS: readonly NovelWorkflowStepKind[] = [
  "context-load", "guided-plan", "approval-gate", "writer-generate", "adversarial-audit", "audit", "post-settlement", "canvas-open", "custom-tool",
];
const NODE_TYPES: readonly WorkflowNodeType[] = ["start", "end", "step", "join"];
/** update_node 不允许改的字段：id 与类型决定了节点身份，改它们应删掉重建。 */
const IMMUTABLE_NODE_FIELDS = new Set(["id", "type"]);

function opFailure(failedIndex: number, what: string, why: string, action: string): WorkflowOpsResult {
  return { ok: false, failedIndex, explanation: { what, why, action } };
}

function slug(text: string): string {
  const ascii = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return ascii || "node";
}

/**
 * 按顺序应用一批编辑指令。任意一条不合法（引用不存在的节点、改不可改的字段……）整批不生效，
 * 返回出错的序号与说明；全部合法时返回新工作流与结构问题（草稿允许有问题，发布时才要求清零）。
 * 不修改入参，也不改 revision / status（由存储层决定）。
 */
export function applyWorkflowOps(recipe: WorkflowGraphRecipe, ops: readonly WorkflowGraphOp[]): WorkflowOpsResult {
  let nodes = [...recipe.nodes];
  let edges = [...recipe.edges];
  let meta: Partial<WorkflowGraphRecipe> = {};
  const usedIds = new Set([...nodes.map((node) => node.id), ...edges.map((edge) => edge.id)]);
  const nodeLabel = (id: string) => nodes.find((node) => node.id === id)?.label ?? id;

  for (let index = 0; index < ops.length; index++) {
    const op = ops[index]!;
    switch (op.op) {
      case "add_node": {
        const type = op.node.type;
        if (!NODE_TYPES.includes(type)) return opFailure(index, `第 ${index + 1} 条指令：节点类型「${String(type)}」不存在`, "节点只有起点、终点、工序、汇合四种", "type 用 start / end / step / join 之一");
        const labelText = typeof op.node.label === "string" && op.node.label.trim() ? op.node.label.trim() : "";
        if (!labelText) return opFailure(index, `第 ${index + 1} 条指令：新节点缺少名称`, "画布与简报都靠名称认节点", "给 node.label 一个名字");
        const requestedId = typeof op.node.id === "string" ? op.node.id.trim() : "";
        if (requestedId && usedIds.has(requestedId)) return opFailure(index, `第 ${index + 1} 条指令：id「${requestedId}」已被占用`, "节点与连线的 id 必须唯一", "换一个 id，或省略 id 由系统生成");
        const id = requestedId || uniqueId(`${type}-${slug(labelText)}`, usedIds);
        usedIds.add(id);
        if (type === "step") {
          const kind = (op.node as Partial<WorkflowStepNode>).kind;
          if (!kind || !STEP_KINDS.includes(kind)) {
            return opFailure(index, `第 ${index + 1} 条指令：工序「${labelText}」的 kind「${String(kind)}」不合法`, "工序类别决定它要交什么产物", `kind 用 ${STEP_KINDS.join(" / ")} 之一`);
          }
          const stepFields = pickStepFields(op.node as Record<string, unknown>);
          if (!stepFields.ok) return opFailure(index, `第 ${index + 1} 条指令：${stepFields.what}`, stepFields.why, stepFields.action);
          nodes.push({ ...stepFields.value, id, type: "step", label: labelText, kind, enabled: stepFields.value.enabled ?? true } as WorkflowStepNode);
        } else {
          nodes.push({ id, type, label: labelText } as WorkflowGraphNode);
        }
        break;
      }
      case "update_node": {
        const at = nodes.findIndex((node) => node.id === op.id);
        if (at < 0) return opFailure(index, `第 ${index + 1} 条指令：找不到节点「${op.id}」`, "只能修改已存在的节点", "先用 add_node 创建，或核对 id");
        const blocked = Object.keys(op.patch ?? {}).filter((key) => IMMUTABLE_NODE_FIELDS.has(key));
        if (blocked.length > 0) return opFailure(index, `第 ${index + 1} 条指令：不能修改节点的 ${blocked.join("、")}`, "id 与类型决定节点身份，连线和运行记录都依赖它们", "删掉这个节点再用 add_node 建一个新的");
        const current = nodes[at]!;
        if (current.type === "step") {
          const picked = pickStepFields(op.patch);
          if (!picked.ok) return opFailure(index, `第 ${index + 1} 条指令：${picked.what}`, picked.why, picked.action);
          const kind = "kind" in op.patch ? (op.patch.kind as NovelWorkflowStepKind) : current.kind;
          if (!STEP_KINDS.includes(kind)) return opFailure(index, `第 ${index + 1} 条指令：kind「${String(kind)}」不合法`, "工序类别决定它要交什么产物", `kind 用 ${STEP_KINDS.join(" / ")} 之一`);
          const labelText = "label" in op.patch ? String(op.patch.label ?? "").trim() : current.label;
          if (!labelText) return opFailure(index, `第 ${index + 1} 条指令：节点名称不能为空`, "画布与简报都靠名称认节点", "给 label 一个名字");
          const merged: Record<string, unknown> = { ...current, ...picked.value, kind, label: labelText };
          // 补丁里显式给 null 的字段表示删除（如去掉 agentId、取消分支结果）。
          for (const [key, field] of Object.entries(op.patch)) if (field === null && key !== "label" && key !== "kind" && key !== "enabled") delete merged[key];
          nodes[at] = merged as unknown as WorkflowStepNode;
        } else {
          const labelText = "label" in op.patch ? String(op.patch.label ?? "").trim() : current.label;
          const extra = Object.keys(op.patch).filter((key) => key !== "label");
          if (extra.length > 0) return opFailure(index, `第 ${index + 1} 条指令：${current.label} 没有字段 ${extra.join("、")}`, "起点、终点、汇合只有名称可改", "只修改 label");
          if (!labelText) return opFailure(index, `第 ${index + 1} 条指令：节点名称不能为空`, "画布与简报都靠名称认节点", "给 label 一个名字");
          nodes[at] = { ...current, label: labelText };
        }
        break;
      }
      case "remove_node": {
        if (!nodes.some((node) => node.id === op.id)) return opFailure(index, `第 ${index + 1} 条指令：找不到节点「${op.id}」`, "只能删除已存在的节点", "核对 id");
        nodes = nodes.filter((node) => node.id !== op.id);
        edges = edges.filter((edge) => edge.source !== op.id && edge.target !== op.id);
        break;
      }
      case "connect": {
        for (const end of [op.source, op.target]) {
          if (!nodes.some((node) => node.id === end)) return opFailure(index, `第 ${index + 1} 条指令：找不到节点「${end}」`, "连线两端都必须是已存在的节点", "先创建节点，或核对 id");
        }
        const kind = op.kind ?? "next";
        if (kind !== "next" && kind !== "reject") return opFailure(index, `第 ${index + 1} 条指令：连线类型「${String(kind)}」不存在`, "连线只有下一步与打回两种", "kind 用 next 或 reject");
        if (kind === "reject" && op.outcome !== undefined) return opFailure(index, `第 ${index + 1} 条指令：打回线不能带结果条件`, "打回由作者在确认时决定，不看提交结果", "去掉 outcome");
        if (edges.some((edge) => edge.source === op.source && edge.target === op.target && edge.kind === kind && edge.outcome === op.outcome)) {
          return opFailure(index, `第 ${index + 1} 条指令：「${nodeLabel(op.source)}」到「${nodeLabel(op.target)}」已有同样的连线`, "重复连线没有意义", "去掉这条指令");
        }
        const requestedId = op.id?.trim();
        if (requestedId && usedIds.has(requestedId)) return opFailure(index, `第 ${index + 1} 条指令：id「${requestedId}」已被占用`, "节点与连线的 id 必须唯一", "换一个 id，或省略 id 由系统生成");
        const id = requestedId || uniqueId(`e-${op.source}-${op.target}`, usedIds);
        usedIds.add(id);
        const outcome = typeof op.outcome === "string" && op.outcome.trim() ? op.outcome.trim() : undefined;
        edges.push({ id, source: op.source, target: op.target, kind, ...(outcome !== undefined ? { outcome } : {}) });
        break;
      }
      case "disconnect": {
        const before = edges.length;
        edges = op.id
          ? edges.filter((edge) => edge.id !== op.id)
          : edges.filter((edge) => !(edge.source === op.source && edge.target === op.target));
        if (edges.length === before) return opFailure(index, `第 ${index + 1} 条指令：没有找到要删除的连线`, "只能删除已存在的连线", "按 id，或按 source + target 指定");
        break;
      }
      case "set_meta": {
        const patch = op.patch ?? {};
        if ("name" in patch && !String(patch.name ?? "").trim()) return opFailure(index, `第 ${index + 1} 条指令：工作流名称不能为空`, "列表与启动都靠名称认工作流", "给 name 一个名字");
        if ("maxRetries" in patch && (!Number.isInteger(patch.maxRetries) || patch.maxRetries! < 0 || patch.maxRetries! > 10)) {
          return opFailure(index, `第 ${index + 1} 条指令：maxRetries 必须是 0–10 的整数`, "重试次数限制模型的自动重试", "给一个 0–10 的整数");
        }
        if ("resultStrategy" in patch && !["formal-chapter", "version-result", "direct-write"].includes(String(patch.resultStrategy))) {
          return opFailure(index, `第 ${index + 1} 条指令：resultStrategy「${String(patch.resultStrategy)}」不合法`, "结果策略决定正文落到哪里", "用 formal-chapter / version-result / direct-write 之一");
        }
        meta = { ...meta, ...patch };
        break;
      }
      default:
        return opFailure(index, `第 ${index + 1} 条指令：不认识的指令「${String((op as { op?: unknown }).op)}」`, "只支持 add_node / update_node / remove_node / connect / disconnect / set_meta", "改用支持的指令");
    }
  }

  const positions = recipe.layout?.positions;
  const keptPositions = positions
    ? Object.fromEntries(Object.entries(positions).filter(([id]) => nodes.some((node) => node.id === id)))
    : undefined;
  const next: WorkflowGraphRecipe = {
    ...recipe,
    ...meta,
    nodes,
    edges,
    ...(keptPositions ? { layout: { positions: keptPositions } } : {}),
  };
  return { ok: true, recipe: next, issues: checkWorkflowGraph(next) };
}

type PickResult =
  | { readonly ok: true; readonly value: Partial<WorkflowStepNode> }
  | { readonly ok: false; readonly what: string; readonly why: string; readonly action: string };

const EXECUTION_MODES: readonly NovelWorkflowExecutionMode[] = ["subagent", "autonomous", "tool-only"];
const FAILURE_ACTIONS: readonly NovelWorkflowStepOnFailure[] = ["stop", "skip", "retry"];

/** 从补丁里取出工序可改字段并校验类型；未知字段报错，避免模型以为改了其实没改。 */
function pickStepFields(raw: Record<string, unknown>): PickResult {
  const value: Record<string, unknown> = {};
  const fail = (what: string, action: string): PickResult => ({ ok: false, what, why: "工序字段类型不对会让运行时读错配置", action });
  const known = new Set([
    "id", "type", "label", "kind", "enabled", "executionMode", "agentId", "modelOverride", "tools", "skills",
    "customPrompt", "parallelSubagents", "requiresApproval", "onFailure", "outcomes",
  ]);
  for (const [key, field] of Object.entries(raw)) {
    if (!known.has(key)) return fail(`工序没有字段「${key}」`, `可改字段：${[...known].filter((k) => k !== "id" && k !== "type").join("、")}`);
    if (key === "id" || key === "type" || key === "label" || key === "kind") continue;
    if (field === null || field === undefined) {
      value[key] = undefined;
      continue;
    }
    switch (key) {
      case "enabled":
      case "requiresApproval":
        if (typeof field !== "boolean") return fail(`${key} 必须是布尔值`, `给 ${key} true 或 false`);
        value[key] = field;
        break;
      case "agentId":
      case "modelOverride":
      case "customPrompt":
        if (typeof field !== "string") return fail(`${key} 必须是字符串`, `给 ${key} 一段文字`);
        value[key] = key === "customPrompt" ? field : field.trim();
        break;
      case "executionMode":
        if (!EXECUTION_MODES.includes(field as NovelWorkflowExecutionMode)) return fail(`executionMode「${String(field)}」不合法`, `用 ${EXECUTION_MODES.join(" / ")} 之一`);
        value[key] = field;
        break;
      case "onFailure":
        if (!FAILURE_ACTIONS.includes(field as NovelWorkflowStepOnFailure)) return fail(`onFailure「${String(field)}」不合法`, `用 ${FAILURE_ACTIONS.join(" / ")} 之一`);
        value[key] = field;
        break;
      case "tools":
      case "skills":
      case "outcomes": {
        if (!Array.isArray(field) || field.some((item) => typeof item !== "string" || !item.trim())) return fail(`${key} 必须是非空字符串数组`, `给 ${key} 一个字符串列表`);
        value[key] = field.map((item: string) => item.trim());
        break;
      }
      case "parallelSubagents": {
        if (!Array.isArray(field)) return fail("parallelSubagents 必须是数组", "给一个子代理配置列表");
        const configs: NovelParallelSubagentConfig[] = [];
        for (const item of field) {
          if (!item || typeof item !== "object" || typeof (item as { name?: unknown }).name !== "string" || !(item as { name: string }).name.trim()) {
            return fail("parallelSubagents 的每一项都要有 name", "给每个子代理一个名字");
          }
          configs.push(item as NovelParallelSubagentConfig);
        }
        value[key] = configs;
        break;
      }
    }
  }
  // undefined 表示删除该字段
  for (const [key, field] of Object.entries(value)) if (field === undefined) delete value[key];
  return { ok: true, value: value as Partial<WorkflowStepNode> };
}

// ─── 自动排版 ────────────────────────────────────────────────────────────────

export const LAYOUT_COLUMN_GAP = 280;
export const LAYOUT_ROW_GAP = 150;

/**
 * 分层排版：按「下一步」连线的最长路径分列，列内按拓扑序排行并垂直居中。
 * 已有位置的节点保持不动，只给缺位置的节点补位——作者手动摆放优先于自动排版。
 * 有环时退化为按数组顺序排成一行。
 */
export function layoutWorkflowGraph(recipe: Pick<WorkflowGraphRecipe, "nodes" | "edges" | "layout">): Record<string, WorkflowNodePosition> {
  const existing = recipe.layout?.positions ?? {};
  const order = topologicalOrder(recipe) ?? recipe.nodes.map((node) => node.id);
  const column = new Map<string, number>();
  const edges = nextEdges(recipe);
  for (const id of order) {
    const preds = edges.filter((edge) => edge.target === id).map((edge) => column.get(edge.source) ?? 0);
    column.set(id, preds.length > 0 ? Math.max(...preds) + 1 : 0);
  }
  const byColumn = new Map<number, string[]>();
  for (const id of order) byColumn.set(column.get(id)!, [...(byColumn.get(column.get(id)!) ?? []), id]);
  const tallest = Math.max(1, ...[...byColumn.values()].map((ids) => ids.length));
  const positions: Record<string, WorkflowNodePosition> = {};
  for (const [col, ids] of byColumn) {
    const offset = ((tallest - ids.length) * LAYOUT_ROW_GAP) / 2;
    ids.forEach((id, row) => {
      positions[id] = existing[id] ?? { x: col * LAYOUT_COLUMN_GAP, y: offset + row * LAYOUT_ROW_GAP };
    });
  }
  return positions;
}
