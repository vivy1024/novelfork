/**
 * 叙述者侧的工作流方案工具：列出、查看、编辑（只改草稿）、启动运行。
 *
 * 方案读写限定在可信书籍绑定的作品目录里；模型输入里不含书籍、路径或叙述者标识。
 * 叙述者建的或改的方案一律是草稿：作者在「故事推进 › 执行」的画布上确认发布后才能运行。
 * 已发布的方案叙述者不能直接改——要改就用 copyFrom 另建一份草稿。
 */

import { getStorageDatabase } from "@vivy1024/novelfork-core";
import type { RuntimeToolResult, ToolExecutionContext } from "@vivy1024/novelfork-core/plugins";

import { startWorkflowRun } from "../engine/workflows/run-service.js";
import {
  applyWorkflowOps,
  checkWorkflowGraph,
  END_NODE_ID,
  START_NODE_ID,
  stepNodes,
  WORKFLOW_GRAPH_SCHEMA_VERSION,
  type WorkflowGraphOp,
  type WorkflowGraphRecipe,
} from "../engine/workflows/workflow-graph.js";
import { readWorkflowRecipes, saveWorkflowRecipe, WorkflowStoreError } from "../engine/workflows/workflow-store.js";
import type { TrustedRuntimeBookBinding } from "./runtime-domain-tools.js";
import { toWorkflowToolView } from "./workflow-run-tools.js";

export const WORKFLOW_RECIPE_TOOL_NAMES = [
  "workflow.list_recipes",
  "workflow.get_recipe",
  "workflow.edit_recipe",
  "workflow.start_run",
] as const;

function fail(error: string, summary: string, data?: unknown): RuntimeToolResult {
  return { ok: false, error, summary, ...(data === undefined ? {} : { data }) };
}

function explainedFailure(code: string, explanation: { what: string; why: string; action: string }, extra: Record<string, unknown> = {}): RuntimeToolResult {
  return fail(code, `${explanation.what}。${explanation.why}。${explanation.action}。`, { explanation, ...extra });
}

/** 给模型看的方案：去掉画布位置（排版交给画布，模型只管结构）。 */
function recipeForModel(recipe: WorkflowGraphRecipe) {
  const { layout: _layout, ...rest } = recipe;
  return { ...rest, issues: checkWorkflowGraph(recipe) };
}

function summarize(recipe: WorkflowGraphRecipe) {
  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    status: recipe.status,
    revision: recipe.revision,
    ...(recipe.createdBy ? { createdBy: recipe.createdBy } : {}),
    stepCount: stepNodes(recipe).length,
    issueCount: checkWorkflowGraph(recipe).length,
  };
}

function emptyDraft(id: string, name: string): WorkflowGraphRecipe {
  return {
    schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
    id,
    name,
    commandId: `/novel:${id}`,
    description: "",
    status: "draft",
    revision: 0,
    createdBy: "narrator",
    nodes: [
      { id: START_NODE_ID, type: "start", label: "开始" },
      { id: END_NODE_ID, type: "end", label: "完成" },
    ],
    edges: [],
    resultStrategy: "formal-chapter",
    maxRetries: 1,
  };
}

function slugId(text: string, taken: ReadonlySet<string>): string {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workflow";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

function readOps(raw: unknown): WorkflowGraphOp[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  return raw.filter((op): op is WorkflowGraphOp => typeof op === "object" && op !== null && typeof (op as { op?: unknown }).op === "string");
}

export async function executeWorkflowRecipeTool(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult | null> {
  const wire = toolName.replace(/\./g, "_");
  const normalized = WORKFLOW_RECIPE_TOOL_NAMES.find((name) => name.replace(/\./g, "_") === wire);
  if (!normalized) return null;

  let recipes: readonly WorkflowGraphRecipe[];
  try {
    recipes = await readWorkflowRecipes(binding.root);
  } catch (error) {
    if (error instanceof WorkflowStoreError) return fail(error.code, error.message);
    throw error;
  }
  const findRecipe = (id: unknown) => (typeof id === "string" ? recipes.find((recipe) => recipe.id === id.trim()) : undefined);

  if (normalized === "workflow.list_recipes") {
    return {
      ok: true,
      summary: `本书有 ${recipes.length} 个工作流方案（${recipes.filter((recipe) => recipe.status === "published").length} 个已发布）。`,
      data: { recipes: recipes.map(summarize) },
    };
  }

  if (normalized === "workflow.get_recipe") {
    const recipe = findRecipe(input.recipeId);
    if (!recipe) return fail("recipe-not-found", `找不到方案「${String(input.recipeId ?? "")}」。先调用 workflow_list_recipes 查看可用方案。`);
    return { ok: true, summary: `方案「${recipe.name}」（${recipe.status === "published" ? "已发布" : "草稿"}，第 ${recipe.revision} 版）。`, data: { recipe: recipeForModel(recipe) } };
  }

  if (normalized === "workflow.start_run") {
    const narratorId = context.sessionId?.trim();
    if (!narratorId) return fail("missing-session", "缺少宿主注入的会话标识，无法启动工作流。");
    const chapterNumber = typeof input.chapterNumber === "number" ? input.chapterNumber : Number.NaN;
    const storage = getStorageDatabase();
    const started = await startWorkflowRun({
      storage,
      bookId: binding.bookId,
      bookRoot: binding.root,
      recipeId: typeof input.recipeId === "string" ? input.recipeId.trim() : "",
      chapterNumber,
      narratorId,
    });
    if (!started.ok) return explainedFailure(started.code, started.explanation);
    return {
      ok: true,
      summary: `已启动「${started.data.recipe.name}」第 ${started.data.chapterNumber} 章，按返回的 brief 开始第一道工序。`,
      data: toWorkflowToolView(storage, started.data),
    };
  }

  // workflow.edit_recipe
  const ops = readOps(input.ops);
  if (ops === null) return fail("invalid-ops", "ops 必须是编辑指令数组（add_node / update_node / remove_node / connect / disconnect / set_meta）。");
  const existing = findRecipe(input.recipeId);
  let base: WorkflowGraphRecipe;
  let expectedRevision: number;
  if (existing) {
    if (existing.status === "published") {
      return explainedFailure("recipe-published", {
        what: `「${existing.name}」已发布，叙述者不能直接修改`,
        why: "已发布的方案作者随时可能在用，改动要经作者确认",
        action: `用 copyFrom="${existing.id}" 另建一份草稿再改，作者会在画布上确认`,
      });
    }
    const requested = typeof input.expectedRevision === "number" ? input.expectedRevision : existing.revision;
    base = existing;
    expectedRevision = requested;
  } else {
    const source = input.copyFrom === undefined ? undefined : findRecipe(input.copyFrom);
    if (input.copyFrom !== undefined && !source) {
      return fail("recipe-not-found", `找不到要复制的方案「${String(input.copyFrom)}」。先调用 workflow_list_recipes 查看可用方案。`);
    }
    const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : source ? `${source.name}（草稿）` : "";
    if (!name) return fail("name-required", "新建方案需要 name（或用 copyFrom 基于已有方案复制）。");
    const taken = new Set(recipes.map((recipe) => recipe.id));
    const requestedId = typeof input.recipeId === "string" && input.recipeId.trim() ? input.recipeId.trim() : "";
    const id = requestedId && !taken.has(requestedId) ? requestedId : slugId(source ? `${source.id}-draft` : name, taken);
    base = source
      ? { ...source, id, name, commandId: `/novel:${id}`, status: "draft", revision: 0, createdBy: "narrator" }
      : emptyDraft(id, name);
    expectedRevision = 0;
  }

  const applied = applyWorkflowOps(base, ops);
  if (!applied.ok) {
    return explainedFailure("ops-rejected", applied.explanation, { failedIndex: applied.failedIndex, recipe: recipeForModel(base) });
  }
  try {
    const saved = await saveWorkflowRecipe(binding.root, { ...applied.recipe, status: "draft" }, { expectedRevision });
    const issues = checkWorkflowGraph(saved);
    return {
      ok: true,
      summary: issues.length === 0
        ? `草稿「${saved.name}」已保存（第 ${saved.revision} 版），结构完整，请作者在「故事推进 › 执行」的画布上确认发布。`
        : `草稿「${saved.name}」已保存（第 ${saved.revision} 版），还有 ${issues.length} 处结构问题，发布前需要修好：${issues[0]!.explanation.what}`,
      data: { recipe: recipeForModel(saved) },
    };
  } catch (error) {
    if (error instanceof WorkflowStoreError && error.explanation) return explainedFailure(error.code, error.explanation);
    if (error instanceof WorkflowStoreError) return fail(error.code, error.message);
    throw error;
  }
}
