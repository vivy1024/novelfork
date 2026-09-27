import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  NOVEL_BUILTIN_WORKFLOWS,
  type NovelParallelSubagentConfig,
  type NovelWorkflowExecutionMode,
  type NovelWorkflowRecipe,
  type NovelWorkflowResultStrategy,
  type NovelWorkflowStep,
  type NovelWorkflowStepKind,
  type NovelWorkflowStepOnFailure,
} from "./novel-workflows.js";
import {
  checkWorkflowGraph,
  linearRecipeToGraph,
  WORKFLOW_GRAPH_SCHEMA_VERSION,
  type WorkflowExplanationText,
  type WorkflowGraphEdge,
  type WorkflowGraphNode,
  type WorkflowGraphRecipe,
  type WorkflowNodePosition,
  type WorkflowStepNode,
} from "./workflow-graph.js";

export const WORKFLOW_RECIPES_RELATIVE_PATH = join("story", "workflow_recipes.json");

const ALLOWED_STEP_KINDS = new Set<NovelWorkflowStepKind>([
  "context-load",
  "guided-plan",
  "approval-gate",
  "writer-generate",
  "adversarial-audit",
  "audit",
  "post-settlement",
  "canvas-open",
  "custom-tool",
]);

const ALLOWED_EXECUTION_MODES = new Set<NovelWorkflowExecutionMode>([
  "subagent",
  "autonomous",
  "tool-only",
]);

const ALLOWED_FAILURE_ACTIONS = new Set<NovelWorkflowStepOnFailure>([
  "stop",
  "skip",
  "retry",
]);

const ALLOWED_RESULT_STRATEGIES = new Set<NovelWorkflowResultStrategy>([
  "formal-chapter",
  "version-result",
  "direct-write",
]);

export class WorkflowStoreError extends Error {
  readonly code: string;
  readonly status: number;
  /** 需要作者处理的错误（结构问题、版本冲突）带三段式说明，前端直接展示。 */
  readonly explanation?: WorkflowExplanationText;

  constructor(message: string, code = "INVALID_WORKFLOW_RECIPES", status = 400, explanation?: WorkflowExplanationText) {
    super(message);
    this.name = "WorkflowStoreError";
    this.code = code;
    this.status = status;
    if (explanation) this.explanation = explanation;
  }
}

function explained(code: string, status: number, explanation: WorkflowExplanationText): WorkflowStoreError {
  return new WorkflowStoreError(explanation.what, code, status, explanation);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateParallelSubagent(
  raw: unknown,
  recipeIndex: number,
  stepIndex: number,
  subagentIndex: number,
): NovelParallelSubagentConfig {
  if (!isPlainObject(raw)) {
    throw new WorkflowStoreError(
      `Recipe #${recipeIndex + 1} Step #${stepIndex + 1} parallelSubagents[${subagentIndex}] must be an object`,
    );
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) {
    throw new WorkflowStoreError(
      `Recipe #${recipeIndex + 1} Step #${stepIndex + 1} parallelSubagents[${subagentIndex}] requires a non-empty name`,
    );
  }

  const roleLabel = typeof raw.roleLabel === "string" ? raw.roleLabel.trim() : undefined;
  const model = typeof raw.model === "string" ? raw.model.trim() : undefined;
  const prompt = typeof raw.prompt === "string" ? raw.prompt : undefined;

  let tools: string[] | undefined;
  if (raw.tools !== undefined) {
    if (!Array.isArray(raw.tools)) {
      throw new WorkflowStoreError(
        `Recipe #${recipeIndex + 1} Step #${stepIndex + 1} parallelSubagents[${subagentIndex}] tools must be an array`,
      );
    }
    tools = raw.tools
      .map((t, i) => {
        if (typeof t !== "string" || !t.trim()) {
          throw new WorkflowStoreError(
            `Recipe #${recipeIndex + 1} Step #${stepIndex + 1} parallelSubagents[${subagentIndex}] tools[${i}] must be a non-empty string`,
          );
        }
        return t.trim();
      });
  }

  return {
    name,
    ...(roleLabel !== undefined ? { roleLabel } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(tools !== undefined ? { tools } : {}),
  };
}

function validateStep(
  raw: unknown,
  recipeIndex: number,
  stepIndex: number,
  seenStepIds: Set<string>,
): NovelWorkflowStep {
  if (!isPlainObject(raw)) {
    throw new WorkflowStoreError(
      `Recipe #${recipeIndex + 1} step #${stepIndex + 1} must be an object`,
    );
  }

  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) {
    throw new WorkflowStoreError(
      `Recipe #${recipeIndex + 1} step #${stepIndex + 1} requires a non-empty id`,
    );
  }
  if (seenStepIds.has(id)) {
    throw new WorkflowStoreError(
      `Recipe #${recipeIndex + 1} has duplicate step id: "${id}"`,
    );
  }
  seenStepIds.add(id);

  if (typeof raw.kind !== "string" || !ALLOWED_STEP_KINDS.has(raw.kind as NovelWorkflowStepKind)) {
    throw new WorkflowStoreError(
      `Recipe #${recipeIndex + 1} step "${id}" has invalid kind: "${String(raw.kind)}"`,
    );
  }
  const kind = raw.kind as NovelWorkflowStepKind;

  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (!label) {
    throw new WorkflowStoreError(
      `Recipe #${recipeIndex + 1} step "${id}" requires a non-empty label`,
    );
  }

  if (typeof raw.enabled !== "boolean") {
    throw new WorkflowStoreError(
      `Recipe #${recipeIndex + 1} step "${id}" enabled must be a boolean`,
    );
  }
  const enabled = raw.enabled;

  let executionMode: NovelWorkflowExecutionMode | undefined;
  if (raw.executionMode !== undefined) {
    if (
      typeof raw.executionMode !== "string" ||
      !ALLOWED_EXECUTION_MODES.has(raw.executionMode as NovelWorkflowExecutionMode)
    ) {
      throw new WorkflowStoreError(
        `Recipe #${recipeIndex + 1} step "${id}" has invalid executionMode: "${String(raw.executionMode)}"`,
      );
    }
    executionMode = raw.executionMode as NovelWorkflowExecutionMode;
  }

  const agentId = typeof raw.agentId === "string" ? raw.agentId.trim() : undefined;
  const modelOverride = typeof raw.modelOverride === "string" ? raw.modelOverride.trim() : undefined;
  const customPrompt = typeof raw.customPrompt === "string" ? raw.customPrompt : undefined;
  const requiresApproval = typeof raw.requiresApproval === "boolean" ? raw.requiresApproval : undefined;

  let onFailure: NovelWorkflowStepOnFailure | undefined;
  if (raw.onFailure !== undefined) {
    if (
      typeof raw.onFailure !== "string" ||
      !ALLOWED_FAILURE_ACTIONS.has(raw.onFailure as NovelWorkflowStepOnFailure)
    ) {
      throw new WorkflowStoreError(
        `Recipe #${recipeIndex + 1} step "${id}" has invalid onFailure: "${String(raw.onFailure)}"`,
      );
    }
    onFailure = raw.onFailure as NovelWorkflowStepOnFailure;
  }

  let tools: string[] | undefined;
  if (raw.tools !== undefined) {
    if (!Array.isArray(raw.tools)) {
      throw new WorkflowStoreError(
        `Recipe #${recipeIndex + 1} step "${id}" tools must be an array`,
      );
    }
    tools = raw.tools.map((tool, idx) => {
      if (typeof tool !== "string" || !tool.trim()) {
        throw new WorkflowStoreError(
          `Recipe #${recipeIndex + 1} step "${id}" tools[${idx}] must be a non-empty string`,
        );
      }
      return tool.trim();
    });
  }

  let skills: string[] | undefined;
  if (raw.skills !== undefined) {
    if (!Array.isArray(raw.skills)) {
      throw new WorkflowStoreError(
        `Recipe #${recipeIndex + 1} step "${id}" skills must be an array`,
      );
    }
    skills = raw.skills.map((skill, idx) => {
      if (typeof skill !== "string" || !skill.trim()) {
        throw new WorkflowStoreError(
          `Recipe #${recipeIndex + 1} step "${id}" skills[${idx}] must be a non-empty string`,
        );
      }
      return skill.trim();
    });
  }

  let parallelSubagents: NovelParallelSubagentConfig[] | undefined;
  if (raw.parallelSubagents !== undefined) {
    if (!Array.isArray(raw.parallelSubagents)) {
      throw new WorkflowStoreError(
        `Recipe #${recipeIndex + 1} step "${id}" parallelSubagents must be an array`,
      );
    }
    parallelSubagents = raw.parallelSubagents.map((subagent, subIdx) =>
      validateParallelSubagent(subagent, recipeIndex, stepIndex, subIdx),
    );
  }

  let outcomes: string[] | undefined;
  if (raw.outcomes !== undefined) {
    if (!Array.isArray(raw.outcomes) || raw.outcomes.some((item) => typeof item !== "string" || !item.trim())) {
      throw new WorkflowStoreError(`Recipe #${recipeIndex + 1} step "${id}" outcomes must be an array of non-empty strings`);
    }
    outcomes = raw.outcomes.map((item: string) => item.trim());
  }

  return {
    id,
    kind,
    label,
    enabled,
    ...(outcomes !== undefined ? { outcomes } : {}),
    ...(executionMode !== undefined ? { executionMode } : {}),
    ...(agentId !== undefined ? { agentId } : {}),
    ...(modelOverride !== undefined ? { modelOverride } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(customPrompt !== undefined ? { customPrompt } : {}),
    ...(parallelSubagents !== undefined ? { parallelSubagents } : {}),
    ...(requiresApproval !== undefined ? { requiresApproval } : {}),
    ...(onFailure !== undefined ? { onFailure } : {}),
  };
}

const NODE_TYPES = new Set(["start", "end", "step", "join"]);
const EDGE_KINDS = new Set(["next", "reject"]);
const RECIPE_STATUSES = new Set(["draft", "published"]);

function requireText(value: unknown, message: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new WorkflowStoreError(message);
  return text;
}

function validateResultAndRetries(item: Record<string, unknown>, id: string) {
  if (
    typeof item.resultStrategy !== "string" ||
    !ALLOWED_RESULT_STRATEGIES.has(item.resultStrategy as NovelWorkflowResultStrategy)
  ) {
    throw new WorkflowStoreError(`Recipe "${id}" has invalid resultStrategy: "${String(item.resultStrategy)}"`);
  }
  if (
    typeof item.maxRetries !== "number" ||
    !Number.isInteger(item.maxRetries) ||
    item.maxRetries < 0 ||
    item.maxRetries > 10
  ) {
    throw new WorkflowStoreError(`Recipe "${id}" maxRetries must be an integer between 0 and 10`);
  }
  return { resultStrategy: item.resultStrategy as NovelWorkflowResultStrategy, maxRetries: item.maxRetries };
}

/** 线性方案（旧文件）：按原规则校验后转成等价的图。 */
function normalizeLegacyRecipe(item: Record<string, unknown>, index: number, id: string): WorkflowGraphRecipe {
  const name = requireText(item.name, `Recipe "${id}" requires a non-empty name`);
  const commandId = requireText(item.commandId, `Recipe "${id}" requires a non-empty commandId`);
  if (!Array.isArray(item.steps) || item.steps.length === 0) {
    throw new WorkflowStoreError(`Recipe "${id}" must contain at least one step`);
  }
  const seenStepIds = new Set<string>();
  const steps: NovelWorkflowStep[] = item.steps.map((step, stepIndex) => validateStep(step, index, stepIndex, seenStepIds));
  if (typeof item.requireFinalApproval !== "boolean") {
    throw new WorkflowStoreError(`Recipe "${id}" requireFinalApproval must be a boolean`);
  }
  const genre = typeof item.genre === "string" ? item.genre.trim() : undefined;
  return linearRecipeToGraph({
    id,
    name,
    commandId,
    description: typeof item.description === "string" ? item.description : "",
    ...(genre !== undefined ? { genre } : {}),
    steps,
    requireFinalApproval: item.requireFinalApproval,
    ...validateResultAndRetries(item, id),
  });
}

function validateNode(raw: unknown, index: number, nodeIndex: number, seen: Set<string>): WorkflowGraphNode {
  if (!isPlainObject(raw)) throw new WorkflowStoreError(`Recipe #${index + 1} node #${nodeIndex + 1} must be an object`);
  if (typeof raw.type !== "string" || !NODE_TYPES.has(raw.type)) {
    throw new WorkflowStoreError(`Recipe #${index + 1} node #${nodeIndex + 1} has invalid type: "${String(raw.type)}"`);
  }
  if (raw.type === "step") {
    const step = validateStep(raw, index, nodeIndex, seen);
    return { ...step, type: "step" } as WorkflowStepNode;
  }
  const id = requireText(raw.id, `Recipe #${index + 1} node #${nodeIndex + 1} requires a non-empty id`);
  if (seen.has(id)) throw new WorkflowStoreError(`Recipe #${index + 1} has duplicate node id: "${id}"`);
  seen.add(id);
  const label = requireText(raw.label, `Recipe #${index + 1} node "${id}" requires a non-empty label`);
  return { id, type: raw.type, label } as WorkflowGraphNode;
}

function validateEdge(raw: unknown, index: number, edgeIndex: number, seen: Set<string>): WorkflowGraphEdge {
  if (!isPlainObject(raw)) throw new WorkflowStoreError(`Recipe #${index + 1} edge #${edgeIndex + 1} must be an object`);
  const id = requireText(raw.id, `Recipe #${index + 1} edge #${edgeIndex + 1} requires a non-empty id`);
  if (seen.has(id)) throw new WorkflowStoreError(`Recipe #${index + 1} has duplicate edge id: "${id}"`);
  seen.add(id);
  const source = requireText(raw.source, `Recipe #${index + 1} edge "${id}" requires a source`);
  const target = requireText(raw.target, `Recipe #${index + 1} edge "${id}" requires a target`);
  const kind = raw.kind ?? "next";
  if (typeof kind !== "string" || !EDGE_KINDS.has(kind)) {
    throw new WorkflowStoreError(`Recipe #${index + 1} edge "${id}" has invalid kind: "${String(kind)}"`);
  }
  const outcome = typeof raw.outcome === "string" && raw.outcome.trim() ? raw.outcome.trim() : undefined;
  return { id, source, target, kind: kind as WorkflowGraphEdge["kind"], ...(outcome !== undefined ? { outcome } : {}) };
}

function validateLayout(raw: unknown): WorkflowGraphRecipe["layout"] | undefined {
  if (!isPlainObject(raw) || !isPlainObject(raw.positions)) return undefined;
  const positions: Record<string, WorkflowNodePosition> = {};
  for (const [id, position] of Object.entries(raw.positions)) {
    if (isPlainObject(position) && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      positions[id] = { x: Number(position.x), y: Number(position.y) };
    }
  }
  return { positions };
}

/** 图结构方案：校验字段与枚举；已发布的方案还必须通过结构检查。 */
function normalizeGraphRecipe(item: Record<string, unknown>, index: number, id: string): WorkflowGraphRecipe {
  const name = requireText(item.name, `Recipe "${id}" requires a non-empty name`);
  const commandId = requireText(item.commandId, `Recipe "${id}" requires a non-empty commandId`);
  const status = item.status ?? "draft";
  if (typeof status !== "string" || !RECIPE_STATUSES.has(status)) {
    throw new WorkflowStoreError(`Recipe "${id}" has invalid status: "${String(status)}"`);
  }
  const revision = item.revision ?? 0;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
    throw new WorkflowStoreError(`Recipe "${id}" revision must be a non-negative integer`);
  }
  if (!Array.isArray(item.nodes)) throw new WorkflowStoreError(`Recipe "${id}" nodes must be an array`);
  if (!Array.isArray(item.edges)) throw new WorkflowStoreError(`Recipe "${id}" edges must be an array`);
  const seenNodes = new Set<string>();
  const nodes = item.nodes.map((node, nodeIndex) => validateNode(node, index, nodeIndex, seenNodes));
  const seenEdges = new Set<string>();
  const edges = item.edges.map((edge, edgeIndex) => validateEdge(edge, index, edgeIndex, seenEdges));
  const genre = typeof item.genre === "string" ? item.genre.trim() : undefined;
  const createdBy = item.createdBy === "author" || item.createdBy === "narrator" ? item.createdBy : undefined;
  const layout = validateLayout(item.layout);
  const recipe: WorkflowGraphRecipe = {
    schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
    id,
    name,
    commandId,
    description: typeof item.description === "string" ? item.description : "",
    ...(genre !== undefined ? { genre } : {}),
    status: status as WorkflowGraphRecipe["status"],
    revision,
    ...(createdBy !== undefined ? { createdBy } : {}),
    nodes,
    edges,
    ...validateResultAndRetries(item, id),
    ...(layout !== undefined ? { layout } : {}),
  };
  if (recipe.status === "published") assertPublishable(recipe);
  return recipe;
}

/** 已发布的方案必须能运行：结构问题清零。 */
export function assertPublishable(recipe: WorkflowGraphRecipe): void {
  const issues = checkWorkflowGraph(recipe);
  if (issues.length === 0) return;
  const first = issues[0]!.explanation;
  throw explained("graph-invalid", 400, {
    what: `「${recipe.name}」还有 ${issues.length} 处结构问题，不能发布：${first.what}`,
    why: first.why,
    action: `${first.action}；也可以先存为草稿`,
  });
}

/**
 * 校验并规范化工作流方案列表。新旧两种格式都接受：
 * - 线性方案（含 steps）：按原规则校验后转成等价的图；
 * - 图结构方案（schemaVersion 2）：校验节点、连线与发布条件。
 * 返回值一律是图结构。限制枚举与唯一 ID，同时保留用户合法的自定义值（自定义代理/模型/提示词/工具）。
 */
export function validateWorkflowRecipes(raw: unknown): NovelWorkflowRecipe[] {
  if (!Array.isArray(raw)) {
    throw new WorkflowStoreError("Workflow recipes payload must be an array");
  }
  if (raw.length === 0) {
    throw new WorkflowStoreError("Workflow recipes must not be empty");
  }
  const seenRecipeIds = new Set<string>();
  return raw.map((item, index) => {
    if (!isPlainObject(item)) throw new WorkflowStoreError(`Recipe #${index + 1} must be an object`);
    const id = requireText(item.id, `Recipe #${index + 1} requires a non-empty id`);
    if (seenRecipeIds.has(id)) throw new WorkflowStoreError(`Duplicate recipe id found: "${id}"`);
    seenRecipeIds.add(id);
    const legacy = Array.isArray(item.steps) && item.nodes === undefined;
    return legacy ? normalizeLegacyRecipe(item, index, id) : normalizeGraphRecipe(item, index, id);
  });
}

async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * 读取指定作品的工作流方案列表。
 * - 缺文件（ENOENT）：正常回退到内置权威预设，绝不返回空；
 * - 空文件或坏文件（非合法 JSON 或结构损坏）：必须报错抛出 WorkflowStoreError，绝不静默覆盖真实数据。
 */
export async function readWorkflowRecipes(
  bookRoot: string,
): Promise<readonly NovelWorkflowRecipe[]> {
  const filePath = join(bookRoot, WORKFLOW_RECIPES_RELATIVE_PATH);
  const raw = await tryReadFile(filePath);
  if (raw === null) {
    // 缺文件：新作品未单独配置，回退到内置权威预设
    return NOVEL_BUILTIN_WORKFLOWS;
  }

  if (!raw.trim()) {
    throw new WorkflowStoreError(
      `Workflow recipes file at "${filePath}" is empty or corrupted`,
      "CORRUPTED_WORKFLOW_FILE",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new WorkflowStoreError(
      `Workflow recipes file at "${filePath}" contains invalid JSON: ${(err as Error).message}`,
      "CORRUPTED_WORKFLOW_FILE",
    );
  }

  return validateWorkflowRecipes(parsed);
}

async function writeRecipesFile(bookRoot: string, recipes: readonly NovelWorkflowRecipe[]): Promise<void> {
  const filePath = join(bookRoot, WORKFLOW_RECIPES_RELATIVE_PATH);
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tempPath = join(dir, `.${randomUUID()}.tmp`);
  const content = JSON.stringify(recipes, null, 2);

  await writeFile(tempPath, `${content}\n`, "utf8");
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

/**
 * 保存工作流方案列表到作品目录（story/workflow_recipes.json）。
 * 必须使用原子写入模式（写临时文件 + rename），写坏时不覆盖原文件。
 * 旧格式的输入会被转成图结构写回。
 */
export async function saveWorkflowRecipes(
  bookRoot: string,
  recipes: readonly unknown[],
): Promise<readonly NovelWorkflowRecipe[]> {
  const validated = validateWorkflowRecipes(recipes);
  await writeRecipesFile(bookRoot, validated);
  return validated;
}

export interface SaveWorkflowRecipeOptions {
  /** 调用方看到的版本；与磁盘上的不一致时拒绝（新建传 0）。 */
  readonly expectedRevision: number;
}

/**
 * 保存单个方案：新建或覆盖同 id 的方案，revision 在磁盘版本上 + 1。
 * expectedRevision 与磁盘不一致说明别人（作者或叙述者）刚改过，返回 409，调用方应重读后再改。
 * 作品目录还没有方案文件时，以内置方案为底写出完整列表。
 */
export async function saveWorkflowRecipe(
  bookRoot: string,
  raw: unknown,
  options: SaveWorkflowRecipeOptions,
): Promise<NovelWorkflowRecipe> {
  const [incoming] = validateWorkflowRecipes([raw]);
  const current = await readWorkflowRecipes(bookRoot);
  const existing = current.find((recipe) => recipe.id === incoming!.id);
  const onDisk = existing?.revision ?? 0;
  if (options.expectedRevision !== onDisk) {
    throw explained("revision-conflict", 409, {
      what: existing
        ? `「${existing.name}」已被更新（你看到的是第 ${options.expectedRevision} 版，现在是第 ${onDisk} 版）`
        : `方案「${incoming!.id}」不存在，无法按第 ${options.expectedRevision} 版保存`,
      why: "作者在画布上的修改和叙述者的修改可能同时发生，按旧版本保存会覆盖对方刚做的改动",
      action: "重新读取方案后再修改",
    });
  }
  const saved: NovelWorkflowRecipe = { ...incoming!, revision: onDisk + 1 };
  const next = existing ? current.map((recipe) => (recipe.id === saved.id ? saved : recipe)) : [...current, saved];
  await writeRecipesFile(bookRoot, next);
  return saved;
}

/** 删除单个方案；expectedRevision 规则同保存。至少要留一个方案。 */
export async function deleteWorkflowRecipe(
  bookRoot: string,
  recipeId: string,
  options: SaveWorkflowRecipeOptions,
): Promise<void> {
  const current = await readWorkflowRecipes(bookRoot);
  const existing = current.find((recipe) => recipe.id === recipeId);
  if (!existing) {
    throw explained("recipe-not-found", 404, {
      what: `找不到工作流方案「${recipeId}」`,
      why: "方案可能已被删除",
      action: "刷新后重试",
    });
  }
  if (options.expectedRevision !== existing.revision) {
    throw explained("revision-conflict", 409, {
      what: `「${existing.name}」已被更新（你看到的是第 ${options.expectedRevision} 版，现在是第 ${existing.revision} 版）`,
      why: "删除前需要确认你看到的是最新内容",
      action: "重新读取方案后再决定是否删除",
    });
  }
  if (current.length === 1) {
    throw explained("last-recipe", 400, {
      what: "这是最后一个工作流方案",
      why: "作品至少要保留一个方案，「执行」页才能启动运行",
      action: "先新建一个方案，再删除这个",
    });
  }
  await writeRecipesFile(bookRoot, current.filter((recipe) => recipe.id !== recipeId));
}
