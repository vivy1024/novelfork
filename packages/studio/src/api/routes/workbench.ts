/**
 * Workbench routes — sandboxed file operations for the IDE layout.
 *
 * All paths are relative to the workspace root and validated by workspace-service.
 * Endpoints:
 *   GET    /api/workbench/tree        — project structure tree (story-aware)
 *   GET    /api/workbench/file        — read file (?path=...)
 *   PUT    /api/workbench/file        — write file (with mtime conflict detection)
 *   POST   /api/workbench/mkdir       — create directory
 *   POST   /api/workbench/rename      — rename/move
 *   POST   /api/workbench/delete      — delete file
 *   GET    /api/workbench/search      — full-text search (?q=...&scope=...)
 */

import { Hono } from "hono";
import { ApiError } from "../errors.js";
import {
  buildProjectTree,
  readWorkspaceFile,
  writeWorkspaceFile,
  mkdirWorkspace,
  renameWorkspace,
  deleteWorkspace,
  searchWorkspace,
  WorkspaceSecurityError,
} from "../lib/workspace-service.js";

export function createWorkbenchRouter(root: string, token?: string): Hono {
  const app = new Hono();

  // --- Token middleware ---
  if (token) {
    app.use("/api/workbench/*", async (c, next) => {
      const auth = c.req.header("Authorization");
      const queryToken = c.req.query("token");
      const provided = auth?.startsWith("Bearer ") ? auth.slice(7) : queryToken;
      if (provided !== token) {
        throw new ApiError(401, "UNAUTHORIZED", "Invalid or missing workbench token");
      }
      await next();
    });
  }

  // --- Error wrapper for security errors ---
  app.onError((error, c) => {
    if (error instanceof WorkspaceSecurityError) {
      return c.json(
        { error: { code: "WORKSPACE_SECURITY", message: error.message } },
        403,
      );
    }
    throw error; // re-throw to parent error handler
  });

  // --- GET /api/workbench/tree ---
  app.get("/api/workbench/tree", async (c) => {
    const depth = parseInt(c.req.query("depth") ?? "4", 10);
    const subdir = c.req.query("path") ?? "";
    const tree = await buildProjectTree(root, subdir, Math.min(depth, 8));
    return c.json({ tree });
  });

  // --- GET /api/workbench/file ---
  app.get("/api/workbench/file", async (c) => {
    const path = c.req.query("path");
    if (!path) {
      throw new ApiError(400, "MISSING_PATH", "Query parameter 'path' is required");
    }
    try {
      const result = await readWorkspaceFile(root, path);
      return c.json(result);
    } catch (e) {
      if (e instanceof WorkspaceSecurityError) throw e;
      throw new ApiError(404, "FILE_NOT_FOUND", `File not found: ${path}`);
    }
  });

  // --- PUT /api/workbench/file ---
  app.put("/api/workbench/file", async (c) => {
    const body = await c.req.json<{
      path: string;
      content: string;
      expectedMtime?: string;
    }>();
    if (!body.path || typeof body.content !== "string") {
      throw new ApiError(400, "INVALID_BODY", "'path' and 'content' are required");
    }
    try {
      const result = await writeWorkspaceFile(root, body.path, body.content, body.expectedMtime);
      return c.json({ ok: true, ...result });
    } catch (e) {
      if (e instanceof WorkspaceSecurityError) {
        if (e.message.includes("modified since")) {
          throw new ApiError(409, "MTIME_CONFLICT", e.message);
        }
        throw e;
      }
      throw new ApiError(500, "WRITE_FAILED", `Failed to write: ${e}`);
    }
  });

  // --- POST /api/workbench/mkdir ---
  app.post("/api/workbench/mkdir", async (c) => {
    const body = await c.req.json<{ path: string }>();
    if (!body.path) {
      throw new ApiError(400, "MISSING_PATH", "'path' is required");
    }
    await mkdirWorkspace(root, body.path);
    return c.json({ ok: true });
  });

  // --- POST /api/workbench/rename ---
  app.post("/api/workbench/rename", async (c) => {
    const body = await c.req.json<{ from: string; to: string }>();
    if (!body.from || !body.to) {
      throw new ApiError(400, "INVALID_BODY", "'from' and 'to' are required");
    }
    await renameWorkspace(root, body.from, body.to);
    return c.json({ ok: true });
  });

  // --- POST /api/workbench/delete ---
  app.post("/api/workbench/delete", async (c) => {
    const body = await c.req.json<{ path: string }>();
    if (!body.path) {
      throw new ApiError(400, "MISSING_PATH", "'path' is required");
    }
    await deleteWorkspace(root, body.path);
    return c.json({ ok: true });
  });

  // --- GET /api/workbench/search ---
  app.get("/api/workbench/search", async (c) => {
    const q = c.req.query("q");
    if (!q || q.trim().length === 0) {
      throw new ApiError(400, "MISSING_QUERY", "Query parameter 'q' is required");
    }
    const scope = c.req.query("scope") as "all" | "chapters" | "truth" | "state" | undefined;
    const maxResults = parseInt(c.req.query("limit") ?? "100", 10);
    const results = await searchWorkspace(root, q, {
      scope: scope ?? "all",
      maxResults: Math.min(maxResults, 500),
    });
    return c.json({ results, total: results.length });
  });

  return app;
}
