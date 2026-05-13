/**
 * File Changes API routes — 会话文件变更追踪与回退
 */

import { Hono } from "hono";
import { getSessionFileChanges, revertFileChange } from "../lib/file-changes-tracker.js";
import { getSessionById } from "../lib/session-service.js";

const app = new Hono();

/**
 * GET /api/file-changes/:sessionId — 获取会话的文件变更列表
 */
app.get("/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = await getSessionById(sessionId);
  if (!session) {
    return c.json({ error: "session-not-found", message: "会话不存在。" }, 404);
  }

  const changes = getSessionFileChanges(sessionId);
  return c.json({
    sessionId,
    changes: changes.map((ch) => ({
      path: ch.path,
      type: ch.type,
      timestamp: ch.timestamp,
      toolName: ch.toolName,
      hasOriginal: ch.originalContent !== null,
    })),
  });
});

/**
 * POST /api/file-changes/:sessionId/revert — 回退单个文件
 * Body: { path: string }
 */
app.post("/:sessionId/revert", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = await getSessionById(sessionId);
  if (!session) {
    return c.json({ error: "session-not-found", message: "会话不存在。" }, 404);
  }

  const body = await c.req.json<{ path?: string }>();
  const filePath = body.path?.trim();
  if (!filePath) {
    return c.json({ error: "invalid-input", message: "path 不能为空。" }, 400);
  }

  const workDir = session.worktree?.trim() || process.cwd();
  const result = await revertFileChange(sessionId, filePath, workDir);

  if (!result.ok) {
    return c.json({ error: "revert-failed", message: result.error }, 400);
  }

  return c.json({ ok: true, path: filePath, message: `已回退 ${filePath}` });
});

/**
 * GET /api/file-changes/:sessionId/diff/:path — 获取文件的 before/after 对比
 * path 通过 query param 传递（因为文件路径含 /）
 */
app.get("/:sessionId/diff", async (c) => {
  const sessionId = c.req.param("sessionId");
  const filePath = c.req.query("path");
  if (!filePath) {
    return c.json({ error: "invalid-input", message: "path query 参数不能为空。" }, 400);
  }

  const session = await getSessionById(sessionId);
  if (!session) {
    return c.json({ error: "session-not-found", message: "会话不存在。" }, 404);
  }

  const changes = getSessionFileChanges(sessionId);
  const change = changes.find((ch) => ch.path === filePath);
  if (!change) {
    return c.json({ error: "not-found", message: `文件 "${filePath}" 不在变更记录中。` }, 404);
  }

  // Read current content
  const workDir = session.worktree?.trim() || process.cwd();
  let currentContent: string | null = null;
  try {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    currentContent = await readFile(resolve(workDir, filePath), "utf-8");
  } catch {
    currentContent = null; // file may have been deleted
  }

  return c.json({
    path: filePath,
    type: change.type,
    before: change.originalContent,
    after: currentContent,
  });
});

export function createFileChangesRouter() {
  return app;
}
