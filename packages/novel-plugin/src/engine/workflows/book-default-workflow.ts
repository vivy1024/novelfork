/**
 * 每本书的默认工作流：存在 book.json 的 `defaultWorkflowRecipeId`（书籍配置的唯一权威源），
 * 只记方案 id，方案本身仍在 story/workflow_recipes.json。
 *
 * - 写入经 book.json 的按书锁读改写，不整份覆盖别处刚改的设置；
 * - 只能设成本书已发布的方案（草稿不能运行，设成默认也启动不了）；
 * - 读取时若记的方案已被删除或转回草稿，有效默认为空并附说明，由调用方展示，不静默改写 book.json。
 */

import { readBookConfigFile, updateBookConfig } from "../book-config/book-config-lock.js";
import type { WorkflowExplanationText } from "./workflow-graph.js";
import { readWorkflowRecipes, WorkflowStoreError } from "./workflow-store.js";

export const BOOK_DEFAULT_WORKFLOW_FIELD = "defaultWorkflowRecipeId";

export interface BookDefaultWorkflow {
  /** book.json 里记的方案 id（可能已失效）。 */
  readonly storedRecipeId: string | null;
  /** 实际生效的默认方案 id：存在且已发布才算；否则为 null。 */
  readonly recipeId: string | null;
  readonly recipeName: string | null;
  /** 记的默认方案失效时的说明。 */
  readonly notice?: WorkflowExplanationText;
}

function storedIdOf(config: Record<string, unknown> | null): string | null {
  const raw = config?.[BOOK_DEFAULT_WORKFLOW_FIELD];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export async function readBookDefaultWorkflow(bookRoot: string): Promise<BookDefaultWorkflow> {
  const storedRecipeId = storedIdOf(await readBookConfigFile(bookRoot));
  if (!storedRecipeId) return { storedRecipeId: null, recipeId: null, recipeName: null };
  const recipes = await readWorkflowRecipes(bookRoot);
  const recipe = recipes.find((item) => item.id === storedRecipeId);
  if (!recipe) {
    return {
      storedRecipeId,
      recipeId: null,
      recipeName: null,
      notice: {
        what: "本书记的默认工作流已经不存在",
        why: "方案被删除后，启动时不知道该用哪个",
        action: "重新选一个已发布的方案作为本书默认",
      },
    };
  }
  if (recipe.status !== "published") {
    return {
      storedRecipeId,
      recipeId: null,
      recipeName: recipe.name,
      notice: {
        what: `默认工作流「${recipe.name}」现在是草稿`,
        why: "草稿不能运行，启动时会改用你临时选的方案",
        action: "把它重新发布，或换一个已发布的方案作为默认",
      },
    };
  }
  return { storedRecipeId, recipeId: recipe.id, recipeName: recipe.name };
}

/** 设为默认（recipeId 为 null 表示清除）。方案必须存在且已发布。 */
export async function setBookDefaultWorkflow(bookRoot: string, recipeId: string | null): Promise<BookDefaultWorkflow> {
  const normalized = recipeId?.trim() || null;
  if (normalized) {
    const recipes = await readWorkflowRecipes(bookRoot);
    const recipe = recipes.find((item) => item.id === normalized);
    if (!recipe) {
      throw new WorkflowStoreError(`找不到工作流方案「${normalized}」`, "recipe-not-found", 404, {
        what: `找不到工作流方案「${normalized}」`,
        why: "方案可能刚被删除",
        action: "刷新方案列表后重新选择",
      });
    }
    if (recipe.status !== "published") {
      throw new WorkflowStoreError(`「${recipe.name}」还是草稿`, "recipe-not-published", 400, {
        what: `「${recipe.name}」还是草稿，不能设为默认`,
        why: "只有已发布的方案能运行，草稿设成默认也启动不了",
        action: "先检查并发布这个方案，再设为默认",
      });
    }
  }
  await updateBookConfig(bookRoot, (current) => {
    if (!current) {
      throw new WorkflowStoreError("本书的 book.json 不存在", "BOOK_CONFIG_MISSING", 404, {
        what: "找不到本书的配置文件",
        why: "默认工作流记在书籍配置里",
        action: "确认这本书已经建好后重试",
      });
    }
    const next = { ...current };
    if (normalized) next[BOOK_DEFAULT_WORKFLOW_FIELD] = normalized;
    else delete next[BOOK_DEFAULT_WORKFLOW_FIELD];
    return next;
  });
  return readBookDefaultWorkflow(bookRoot);
}
