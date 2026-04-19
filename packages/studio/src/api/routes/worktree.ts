/**
 * Worktree 管理路由
 * 提供 worktree 列表、创建、删除、状态查询
 */

import { Hono } from "hono";
import { listWorktrees, createWorktree, removeWorktree, getWorktreeStatus } from "../lib/git-utils.js";
import { ApiError } from "../errors.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";

export function createWorktreeRouter(): Hono {
  const app = new Hono();

  /**
   * GET /api/worktree/list
   * 列出所有 worktrees 及其状态
   */
  app.get("/api/worktree/list", async (c) => {
    try {
      const root = process.env.NOVELFORK_WORKSPACE || process.env.INKOS_WORKSPACE || process.cwd();
      const worktrees = await listWorktrees(root);

      // 获取每个 worktree 的状态
      const worktreesWithStatus = await Promise.all(
        worktrees.map(async (wt) => {
          try {
            const status = await getWorktreeStatus(wt.path);
            return {
              ...wt,
              status: {
                modified: status.modified.length,
                added: status.added.length,
                deleted: status.deleted.length,
                untracked: status.untracked.length,
              },
            };
          } catch (error) {
            // 如果无法获取状态，返回默认值
            return {
              ...wt,
              status: { modified: 0, added: 0, deleted: 0, untracked: 0 },
            };
          }
        })
      );

      return c.json({ worktrees: worktreesWithStatus });
    } catch (error) {
      throw new ApiError(500, "WORKTREE_LIST_FAILED", error instanceof Error ? error.message : "Failed to list worktrees");
    }
  });

  /**
   * POST /api/worktree/create
   * 创建新 worktree
   * Body: { name: string, branch?: string }
   */
  app.post("/api/worktree/create", async (c) => {
    try {
      const body = await c.req.json<{ name?: string; branch?: string }>();

      if (!body.name?.trim()) {
        throw new ApiError(400, "NAME_REQUIRED", "Worktree name is required");
      }

      const root = process.env.NOVELFORK_WORKSPACE || process.env.INKOS_WORKSPACE || process.cwd();
      const worktreePath = await createWorktree(root, body.name.trim(), body.branch?.trim());

      return c.json({ ok: true, path: worktreePath });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "WORKTREE_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create worktree");
    }
  });

  /**
   * DELETE /api/worktree/remove
   * 删除 worktree
   * Body: { path: string, force?: boolean }
   */
  app.delete("/api/worktree/remove", async (c) => {
    try {
      const body = await c.req.json<{ path?: string; force?: boolean }>();

      if (!body.path?.trim()) {
        throw new ApiError(400, "PATH_REQUIRED", "Worktree path is required");
      }

      const root = process.env.NOVELFORK_WORKSPACE || process.env.INKOS_WORKSPACE || process.cwd();

      // 验证路径是否存在
      try {
        await fs.access(body.path);
      } catch {
        throw new ApiError(404, "WORKTREE_NOT_FOUND", `Worktree not found: ${body.path}`);
      }

      await removeWorktree(root, body.path, body.force || false);

      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "WORKTREE_REMOVE_FAILED", error instanceof Error ? error.message : "Failed to remove worktree");
    }
  });

  /**
   * GET /api/worktree/status?path=<worktree-path>
   * 获取指定 worktree 的详细状态
   */
  app.get("/api/worktree/status", async (c) => {
    try {
      const worktreePath = c.req.query("path");

      if (!worktreePath?.trim()) {
        throw new ApiError(400, "PATH_REQUIRED", "Worktree path is required");
      }

      const status = await getWorktreeStatus(worktreePath);

      return c.json({ status });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "STATUS_FAILED", error instanceof Error ? error.message : "Failed to get worktree status");
    }
  });

  /**
   * GET /api/worktree/diff?path=<worktree-path>&file=<file-path>
   * 获取指定文件的 diff
   */
  app.get("/api/worktree/diff", async (c) => {
    try {
      const worktreePath = c.req.query("path");
      const filePath = c.req.query("file");

      if (!worktreePath?.trim()) {
        throw new ApiError(400, "PATH_REQUIRED", "Worktree path is required");
      }

      if (!filePath?.trim()) {
        throw new ApiError(400, "FILE_REQUIRED", "File path is required");
      }

      // 导入 getFileDiff 函数
      const { getFileDiff } = await import("../lib/git-utils.js");
      const diff = await getFileDiff(worktreePath, filePath);

      return c.json({ diff });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "DIFF_FAILED", error instanceof Error ? error.message : "Failed to get file diff");
    }
  });

  /**
   * POST /api/worktree/merge
   * 合并分支到当前分支
   * Body: { path: string, sourceBranch: string, noFf?: boolean }
   */
  app.post("/api/worktree/merge", async (c) => {
    try {
      const body = await c.req.json<{ path?: string; sourceBranch?: string; noFf?: boolean }>();

      if (!body.path?.trim()) {
        throw new ApiError(400, "PATH_REQUIRED", "Worktree path is required");
      }

      if (!body.sourceBranch?.trim()) {
        throw new ApiError(400, "SOURCE_BRANCH_REQUIRED", "Source branch is required");
      }

      const { mergeBranch } = await import("../lib/git-utils.js");
      const result = await mergeBranch(body.path, body.sourceBranch.trim(), body.noFf ?? true);

      return c.json({ ok: result.success, message: result.message });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "MERGE_FAILED", error instanceof Error ? error.message : "Failed to merge branch");
    }
  });

  /**
   * POST /api/worktree/fork
   * 从当前分支创建新分支（Fork）
   * Body: { path: string, newBranch: string }
   */
  app.post("/api/worktree/fork", async (c) => {
    try {
      const body = await c.req.json<{ path?: string; newBranch?: string }>();

      if (!body.path?.trim()) {
        throw new ApiError(400, "PATH_REQUIRED", "Worktree path is required");
      }

      if (!body.newBranch?.trim()) {
        throw new ApiError(400, "NEW_BRANCH_REQUIRED", "New branch name is required");
      }

      const { forkBranch } = await import("../lib/git-utils.js");
      const branchName = await forkBranch(body.path, body.newBranch.trim());

      return c.json({ ok: true, branch: branchName });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "FORK_FAILED", error instanceof Error ? error.message : "Failed to fork branch");
    }
  });

  return app;
}
