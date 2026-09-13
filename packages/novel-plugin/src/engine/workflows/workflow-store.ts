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

  constructor(message: string, code = "INVALID_WORKFLOW_RECIPES", status = 400) {
    super(message);
    this.name = "WorkflowStoreError";
    this.code = code;
    this.status = status;
  }
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

  return {
    id,
    kind,
    label,
    enabled,
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

/**
 * 校验并规范化工作流 Recipe 列表。
 * 限制枚举、唯一 ID、嵌套结构合法性，同时保留用户合法的自定义值（自定义代理/模型/提示词/工具）。
 */
export function validateWorkflowRecipes(raw: unknown): NovelWorkflowRecipe[] {
  if (!Array.isArray(raw)) {
    throw new WorkflowStoreError("Workflow recipes payload must be an array");
  }
  if (raw.length === 0) {
    throw new WorkflowStoreError("Workflow recipes must not be empty");
  }

  const seenRecipeIds = new Set<string>();
  const validated: NovelWorkflowRecipe[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!isPlainObject(item)) {
      throw new WorkflowStoreError(`Recipe #${i + 1} must be an object`);
    }

    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) {
      throw new WorkflowStoreError(`Recipe #${i + 1} requires a non-empty id`);
    }
    if (seenRecipeIds.has(id)) {
      throw new WorkflowStoreError(`Duplicate recipe id found: "${id}"`);
    }
    seenRecipeIds.add(id);

    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) {
      throw new WorkflowStoreError(`Recipe "${id}" requires a non-empty name`);
    }

    const commandId = typeof item.commandId === "string" ? item.commandId.trim() : "";
    if (!commandId) {
      throw new WorkflowStoreError(`Recipe "${id}" requires a non-empty commandId`);
    }

    const description = typeof item.description === "string" ? item.description : "";
    const genre = typeof item.genre === "string" ? item.genre.trim() : undefined;

    if (!Array.isArray(item.steps) || item.steps.length === 0) {
      throw new WorkflowStoreError(`Recipe "${id}" must contain at least one step`);
    }

    const seenStepIds = new Set<string>();
    const steps: NovelWorkflowStep[] = item.steps.map((step, stepIndex) =>
      validateStep(step, i, stepIndex, seenStepIds),
    );

    if (
      typeof item.resultStrategy !== "string" ||
      !ALLOWED_RESULT_STRATEGIES.has(item.resultStrategy as NovelWorkflowResultStrategy)
    ) {
      throw new WorkflowStoreError(
        `Recipe "${id}" has invalid resultStrategy: "${String(item.resultStrategy)}"`,
      );
    }
    const resultStrategy = item.resultStrategy as NovelWorkflowResultStrategy;

    if (typeof item.requireFinalApproval !== "boolean") {
      throw new WorkflowStoreError(
        `Recipe "${id}" requireFinalApproval must be a boolean`,
      );
    }
    const requireFinalApproval = item.requireFinalApproval;

    if (
      typeof item.maxRetries !== "number" ||
      !Number.isInteger(item.maxRetries) ||
      item.maxRetries < 0 ||
      item.maxRetries > 10
    ) {
      throw new WorkflowStoreError(
        `Recipe "${id}" maxRetries must be an integer between 0 and 10`,
      );
    }
    const maxRetries = item.maxRetries;

    validated.push({
      id,
      name,
      commandId,
      description,
      ...(genre !== undefined ? { genre } : {}),
      steps,
      resultStrategy,
      requireFinalApproval,
      maxRetries,
    });
  }

  return validated;
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

/**
 * 保存工作流方案列表到作品目录（story/workflow_recipes.json）。
 * 必须使用原子写入模式（写临时文件 + rename），写坏时不覆盖原文件。
 */
export async function saveWorkflowRecipes(
  bookRoot: string,
  recipes: readonly NovelWorkflowRecipe[],
): Promise<readonly NovelWorkflowRecipe[]> {
  const validated = validateWorkflowRecipes(recipes);
  const filePath = join(bookRoot, WORKFLOW_RECIPES_RELATIVE_PATH);
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tempPath = join(dir, `.${randomUUID()}.tmp`);
  const content = JSON.stringify(validated, null, 2);

  await writeFile(tempPath, `${content}\n`, "utf8");
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }

  return validated;
}

