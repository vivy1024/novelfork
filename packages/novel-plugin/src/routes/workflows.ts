import { Hono } from "hono";

import {
  checkWorkflowGraph,
  createCustomSubagent,
  deleteCustomSubagent,
  deleteWorkflowRecipe,
  NOVEL_SUBAGENT_ROSTER,
  readBookDefaultWorkflow,
  readCustomSubagents,
  readWorkflowRecipes,
  setBookDefaultWorkflow,
  saveWorkflowRecipe,
  saveWorkflowRecipes,
  updateCustomSubagent,
  WorkflowStoreError,
  type NovelWorkflowRecipe,
} from "../engine/index.js";
import { BookConfigUnreadableError } from "../engine/book-config/book-config-lock.js";
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

  // 本书默认工作流：写作台启动「写下一章」时默认选它。记在 book.json，只能设成已发布的方案。
  app.get("/api/books/:bookId/workflow-default", async (c) => {
    try {
      const bookId = sanitizeBookId(c.req.param("bookId"));
      return c.json({ bookId, ...(await readBookDefaultWorkflow(resolveBookRoot(bookId))) });
    } catch (error) {
      if (error instanceof WorkflowStoreError) {
        return c.json(storeErrorBody(error), error.status as 400 | 404 | 409 | 500);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message, code: "READ_WORKFLOW_DEFAULT_FAILED" }, 500);
    }
  });

  app.put("/api/books/:bookId/workflow-default", async (c) => {
    try {
      const bookId = sanitizeBookId(c.req.param("bookId"));
      const body = (await c.req.json().catch(() => null)) as { recipeId?: unknown } | null;
      const recipeId = body?.recipeId;
      if (!body || (recipeId !== null && typeof recipeId !== "string")) {
        return c.json({ error: "recipeId must be a string or null", code: "INVALID_RECIPE_ID" }, 400);
      }
      const result = await setBookDefaultWorkflow(resolveBookRoot(bookId), recipeId);
      return c.json({ ok: true, bookId, ...result });
    } catch (error) {
      if (error instanceof WorkflowStoreError) {
        return c.json(storeErrorBody(error), error.status as 400 | 404 | 409 | 500);
      }
      if (error instanceof BookConfigUnreadableError) {
        return c.json({ error: error.message, code: error.code }, 400);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message, code: "SAVE_WORKFLOW_DEFAULT_FAILED" }, 500);
    }
  });

  // 按书自定义子代理工坊：读取内置+自定义列表、复制新建、更新与删除。
  app.get("/api/books/:bookId/subagents", async (c) => {
    try {
      const bookId = sanitizeBookId(c.req.param("bookId"));
      const custom = await readCustomSubagents(resolveBookRoot(bookId));
      return c.json({ ok: true, bookId, builtin: NOVEL_SUBAGENT_ROSTER, custom });
    } catch (error) {
      if (error instanceof WorkflowStoreError) {
        return c.json(storeErrorBody(error), error.status as 400 | 404 | 409 | 500);
      }
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/books/:bookId/subagents", async (c) => {
    try {
      const bookId = sanitizeBookId(c.req.param("bookId"));
      const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      const nameZh = typeof body?.nameZh === "string" ? body.nameZh : "";
      if (!nameZh.trim()) return c.json({ error: "子代理名称不能为空" }, 400);
      const subagent = await createCustomSubagent(resolveBookRoot(bookId), {
        ...(typeof body?.id === "string" ? { id: body.id } : {}),
        nameZh,
        ...(typeof body?.description === "string" ? { description: body.description } : {}),
        ...(Array.isArray(body?.tools) ? { tools: body.tools.filter((t): t is string => typeof t === "string") } : {}),
        ...(typeof body?.prompt === "string" ? { prompt: body.prompt } : {}),
        ...(typeof body?.defaultModel === "string" ? { defaultModel: body.defaultModel } : {}),
        ...(typeof body?.basedOn === "string" ? { basedOn: body.basedOn } : {}),
      });
      return c.json({ ok: true, subagent }, 201);
    } catch (error) {
      if (error instanceof WorkflowStoreError) {
        return c.json(storeErrorBody(error), error.status as 400 | 404 | 409 | 500);
      }
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.put("/api/books/:bookId/subagents/:subagentId", async (c) => {
    try {
      const bookId = sanitizeBookId(c.req.param("bookId"));
      const subagentId = c.req.param("subagentId");
      const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) return c.json({ error: "Invalid JSON body" }, 400);
      const updated = await updateCustomSubagent(resolveBookRoot(bookId), subagentId, {
        ...(typeof body.nameZh === "string" ? { nameZh: body.nameZh } : {}),
        ...(typeof body.description === "string" ? { description: body.description } : {}),
        ...(Array.isArray(body.tools) ? { tools: body.tools.filter((t): t is string => typeof t === "string") } : {}),
        ...(typeof body.prompt === "string" ? { prompt: body.prompt } : {}),
        ...(typeof body.defaultModel === "string" ? { defaultModel: body.defaultModel } : {}),
      });
      if (!updated) return c.json({ error: "找不到该自定义子代理" }, 404);
      return c.json({ ok: true, subagent: updated });
    } catch (error) {
      if (error instanceof WorkflowStoreError) {
        return c.json(storeErrorBody(error), error.status as 400 | 404 | 409 | 500);
      }
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.delete("/api/books/:bookId/subagents/:subagentId", async (c) => {
    try {
      const bookId = sanitizeBookId(c.req.param("bookId"));
      const deleted = await deleteCustomSubagent(resolveBookRoot(bookId), c.req.param("subagentId"));
      if (!deleted) return c.json({ error: "找不到该自定义子代理" }, 404);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof WorkflowStoreError) {
        return c.json(storeErrorBody(error), error.status as 400 | 404 | 409 | 500);
      }
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  return app;
}

