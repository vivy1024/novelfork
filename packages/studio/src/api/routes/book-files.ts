/**
 * Book Files routes — 书籍绑定目录的真实文件树 + 文件 CRUD（IDE 资源管理器用）。
 *
 * 每本书的 root 动态解析为 resolveBookStorageDir（绑定目录或默认 books 目录）。
 * 复用 workspace-service 的文件操作（含路径越界守卫）。
 *
 * 端点（全部相对书籍存储目录）：
 *   GET    /api/books/:bookId/files/tree    — 文件树
 *   GET    /api/books/:bookId/files/read    — 读文件 (?path=)
 *   PUT    /api/books/:bookId/files         — 写文件
 *   POST   /api/books/:bookId/files/mkdir   — 新建目录
 *   POST   /api/books/:bookId/files/rename  — 重命名/移动
 *   POST   /api/books/:bookId/files/delete  — 删除
 */
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { Hono } from "hono";
import { resolveBookStorageDir } from "@vivy1024/novelfork-core";
import { ApiError } from "../errors.js";
import {
  buildProjectTree,
  readWorkspaceFile,
  writeWorkspaceFile,
  mkdirWorkspace,
  renameWorkspace,
  deleteWorkspace,
  resolveWithinWorkspace,
  WorkspaceSecurityError,
} from "../lib/workspace-service.js";

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function contentTypeForPath(path: string): string {
  return IMAGE_CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export function createBookFilesRouter(projectRoot: string): Hono {
  const app = new Hono();

  const bookRoot = (bookId: string) => resolveBookStorageDir(projectRoot, bookId);

  app.onError((error, c) => {
    if (error instanceof WorkspaceSecurityError) {
      return c.json({ error: { code: "WORKSPACE_SECURITY", message: error.message } }, 403);
    }
    throw error;
  });

  app.get("/api/books/:bookId/files/tree", async (c) => {
    const root = bookRoot(c.req.param("bookId"));
    const depth = parseInt(c.req.query("depth") ?? "8", 10);
    const subdir = c.req.query("path") ?? "";
    const tree = await buildProjectTree(root, subdir, Math.min(depth, 8));
    return c.json({ tree });
  });

  app.get("/api/books/:bookId/files/read", async (c) => {
    const root = bookRoot(c.req.param("bookId"));
    const path = c.req.query("path");
    if (!path) throw new ApiError(400, "MISSING_PATH", "Query parameter 'path' is required");
    try {
      const result = await readWorkspaceFile(root, path);
      return c.json(result);
    } catch (e) {
      if (e instanceof WorkspaceSecurityError) throw e;
      throw new ApiError(404, "FILE_NOT_FOUND", `File not found: ${path}`);
    }
  });

  app.get("/api/books/:bookId/files/raw", async (c) => {
    const root = bookRoot(c.req.param("bookId"));
    const path = c.req.query("path");
    if (!path) throw new ApiError(400, "MISSING_PATH", "Query parameter 'path' is required");
    try {
      const absPath = resolveWithinWorkspace(root, path);
      const [buffer, fileStat] = await Promise.all([readFile(absPath), stat(absPath)]);
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": contentTypeForPath(path),
          "Content-Length": String(fileStat.size),
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      if (e instanceof WorkspaceSecurityError) throw e;
      throw new ApiError(404, "FILE_NOT_FOUND", `File not found: ${path}`);
    }
  });

  app.put("/api/books/:bookId/files", async (c) => {
    const root = bookRoot(c.req.param("bookId"));
    const body = await c.req.json<{ path: string; content: string; expectedMtime?: string }>();
    if (!body.path || typeof body.content !== "string") {
      throw new ApiError(400, "INVALID_BODY", "'path' and 'content' are required");
    }
    try {
      const result = await writeWorkspaceFile(root, body.path, body.content, body.expectedMtime);
      return c.json({ ok: true, ...result });
    } catch (e) {
      if (e instanceof WorkspaceSecurityError) {
        if (e.message.includes("modified since")) throw new ApiError(409, "MTIME_CONFLICT", e.message);
        throw e;
      }
      throw new ApiError(500, "WRITE_FAILED", `Failed to write: ${e}`);
    }
  });

  app.post("/api/books/:bookId/files/mkdir", async (c) => {
    const root = bookRoot(c.req.param("bookId"));
    const body = await c.req.json<{ path: string }>();
    if (!body.path) throw new ApiError(400, "MISSING_PATH", "'path' is required");
    await mkdirWorkspace(root, body.path);
    return c.json({ ok: true });
  });

  app.post("/api/books/:bookId/files/rename", async (c) => {
    const root = bookRoot(c.req.param("bookId"));
    const body = await c.req.json<{ from: string; to: string }>();
    if (!body.from || !body.to) throw new ApiError(400, "INVALID_BODY", "'from' and 'to' are required");
    await renameWorkspace(root, body.from, body.to);
    return c.json({ ok: true });
  });

  app.post("/api/books/:bookId/files/delete", async (c) => {
    const root = bookRoot(c.req.param("bookId"));
    const body = await c.req.json<{ path: string }>();
    if (!body.path) throw new ApiError(400, "MISSING_PATH", "'path' is required");
    await deleteWorkspace(root, body.path);
    return c.json({ ok: true });
  });

  return app;
}
