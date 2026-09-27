import { Hono } from "hono";

import {
  checkWorkflowGraph,
  deleteWorkflowRecipe,
  readWorkflowRecipes,
  saveWorkflowRecipe,
  saveWorkflowRecipes,
  WorkflowStoreError,
  type NovelWorkflowRecipe,
} from "../engine/index.js";
import type { RouterContext } from "./context.js";

export interface CreateWorkflowsRouterOptions {
  readonly resolveBookRoot?: (bookId: string) => string;
}

function sanitizeBookId(bookId: string | undefined): string {
  const trimmed = bookId?.trim() ?? "";
  if (!trimmed || trimmed === "." || trimmed === "..") {
    throw new WorkflowStoreError("Invalid bookId", "INVALID_BOOK_ID", 400);
  }
  // 防止路径穿越
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    throw new WorkflowStoreError("Invalid bookId path traversal", "INVALID_BOOK_ID", 400);
  }
  return trimmed;
}

/** 每个方案的结构问题：画布据此逐个标红，发布按钮据此禁用。 */
function issuesByRecipe(recipes: readonly NovelWorkflowRecipe[]) {
  return Object.fromEntries(recipes.map((recipe) => [recipe.id, checkWorkflowGraph(recipe)]));
}

function storeErrorBody(error: WorkflowStoreError) {
  return { error: error.message, code: error.code, ...(error.explanation ? { explanation: error.explanation } : {}) };
}

export function createWorkflowsRouter(
  ctx: RouterContext,
  options: CreateWorkflowsRouterOptions = {},
): Hono {
  const app = new Hono();
  const resolveBookRoot =
    options.resolveBookRoot ?? ((bookId: string) => ctx.state.bookDir(bookId));

  app.get("/api/books/:bookId/workflow-recipes", async (c) => {
    try {
      const bookId = sanitizeBookId(c.req.param("bookId"));
      const bookRoot = resolveBookRoot(bookId);
      const recipes = await readWorkflowRecipes(bookRoot);
      return c.json({
        bookId,
        recipes,
        issues: issuesByRecipe(recipes),
      });
    } catch (error) {
      if (error instanceof WorkflowStoreError) {
        return c.json(storeErrorBody(error), error.status as 400 | 404 | 409 | 500);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message, code: "READ_WORKFLOW_FAILED" }, 500);
    }
  });

  app.put("/api/books/:bookId/workflow-recipes", async (c) => {
    try {
      const bookId = sanitizeBookId(c.req.param("bookId"));
      const bookRoot = resolveBookRoot(bookId);

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, 400);
      }

      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return c.json({ error: "Request body must be an object", code: "INVALID_BODY" }, 400);
      }

      const rawRecipes = (body as { recipes?: unknown }).recipes;
      if (!Array.isArray(rawRecipes)) {
        return c.json({ error: "recipes must be an array", code: "INVALID_RECIPES" }, 400);
      }
      if (rawRecipes.length === 0) {
        return c.json({ error: "recipes must not be empty", code: "EMPTY_RECIPES" }, 400);
      }

      const saved = await saveWorkflowRecipes(bookRoot, rawRecipes);
      return c.json({
        ok: true,
        bookId,
        recipes: saved,
      });
    } catch (error) {
      if (error instanceof WorkflowStoreError) {
        return c.json(storeErrorBody(error), error.status as 400 | 404 | 409 | 500);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message, code: "SAVE_WORKFLOW_FAILED" }, 500);
    }
  });

  // 单个方案：画布保存 / 发布 / 删除。expectedRevision 与磁盘不一致返回 409。
  app.put("/api/books/:bookId/workflow-recipes/:recipeId", async (c) => {
    try {
      const bookId = sanitizeBookId(c.req.param("bookId"));
      const bookRoot = resolveBookRoot(bookId);
      const recipeId = c.req.param("recipeId");
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, 400);
      }
      const { recipe, expectedRevision } = (body ?? {}) as { recipe?: unknown; expectedRevision?: unknown };
      if (typeof recipe !== "object" || recipe === null || (recipe as { id?: unknown }).id !== recipeId) {
        return c.json({ error: "recipe.id must match the URL", code: "RECIPE_ID_MISMATCH" }, 400);
      }
      if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision)) {
        return c.json({ error: "expectedRevision is required", code: "REVISION_REQUIRED" }, 400);
      }
      const saved = await saveWorkflowRecipe(bookRoot, recipe, { expectedRevision });
      return c.json({ ok: true, bookId, recipe: saved, issues: checkWorkflowGraph(saved) });
    } catch (error) {
      if (error instanceof WorkflowStoreError) {
        return c.json(storeErrorBody(error), error.status as 400 | 404 | 409 | 500);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message, code: "SAVE_WORKFLOW_FAILED" }, 500);
    }
  });

  app.delete("/api/books/:bookId/workflow-recipes/:recipeId", async (c) => {
    try {
      const bookId = sanitizeBookId(c.req.param("bookId"));
      const bookRoot = resolveBookRoot(bookId);
      const expectedRevision = Number(c.req.query("expectedRevision"));
      if (!Number.isInteger(expectedRevision)) {
        return c.json({ error: "expectedRevision is required", code: "REVISION_REQUIRED" }, 400);
      }
      await deleteWorkflowRecipe(bookRoot, c.req.param("recipeId"), { expectedRevision });
      return c.json({ ok: true, bookId });
    } catch (error) {
      if (error instanceof WorkflowStoreError) {
        return c.json(storeErrorBody(error), error.status as 400 | 404 | 409 | 500);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message, code: "DELETE_WORKFLOW_FAILED" }, 500);
    }
  });

  return app;
}

