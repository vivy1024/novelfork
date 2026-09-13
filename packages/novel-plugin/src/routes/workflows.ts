import { Hono } from "hono";

import {
  readWorkflowRecipes,
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
      });
    } catch (error) {
      if (error instanceof WorkflowStoreError) {
        return c.json({ error: error.message, code: error.code }, error.status as 400 | 500);
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

      const saved = await saveWorkflowRecipes(bookRoot, rawRecipes as readonly NovelWorkflowRecipe[]);
      return c.json({
        ok: true,
        bookId,
        recipes: saved,
      });
    } catch (error) {
      if (error instanceof WorkflowStoreError) {
        return c.json({ error: error.message, code: error.code }, error.status as 400 | 500);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message, code: "SAVE_WORKFLOW_FAILED" }, 500);
    }
  });

  return app;
}

