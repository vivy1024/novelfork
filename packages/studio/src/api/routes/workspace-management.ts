/**
 * 工作区管理路由
 * 提供工作区设置读写、worktree 列表、合并、删除
 */

import { Hono } from "hono";

import { ApiError } from "../errors.js";
import {
  listWorktrees,
  removeWorktree,
  mergeBranch,
  getCurrentBranch,
  getWorktreeStatus,
  isPathInsideRoot,
  isValidBranchName,
  execGit,
  toGitPath,
} from "../lib/git-utils.js";
import { loadUserConfig, updateUserConfig } from "../lib/user-config-service.js";
import type { WorkspaceSettings } from "../../types/settings.js";

export function createWorkspaceManagementRouter(root: string): Hono {
  const app = new Hono();

  // GET /settings — 获取工作区设置
  app.get("/settings", async (c) => {
    try {
      const config = await loadUserConfig();
      return c.json(config.workspace);
    } catch (error) {
      throw new ApiError(
        500,
        "WORKSPACE_SETTINGS_LOAD_FAILED",
        error instanceof Error ? error.message : "Failed to load workspace settings",
      );
    }
  });

  // PUT /settings — 更新工作区设置
  app.put("/settings", async (c) => {
    try {
      const patch = await c.req.json<Partial<WorkspaceSettings>>();
      const updated = await updateUserConfig({ workspace: patch });
      return c.json(updated.workspace);
    } catch (error) {
      throw new ApiError(
        500,
        "WORKSPACE_SETTINGS_UPDATE_FAILED",
        error instanceof Error ? error.message : "Failed to update workspace settings",
      );
    }
  });

  // GET /worktrees — 列出所有 worktree
  app.get("/worktrees", async (c) => {
    try {
      const worktrees = await listWorktrees(root);
      const worktreesWithStatus = await Promise.all(
        worktrees.map(async (wt) => {
          try {
            const status = await getWorktreeStatus(wt.path);
            return {
              ...wt,
              isMain: toGitPath(wt.path) === toGitPath(root),
              isExternal: !isPathInsideRoot(wt.path, root),
              status: {
                modified: status.modified.length,
                added: status.added.length,
                deleted: status.deleted.length,
                untracked: status.untracked.length,
              },
            };
          } catch {
            return {
              ...wt,
              isMain: toGitPath(wt.path) === toGitPath(root),
              isExternal: !isPathInsideRoot(wt.path, root),
              status: { modified: 0, added: 0, deleted: 0, untracked: 0 },
            };
          }
        }),
      );

      return c.json({ worktrees: worktreesWithStatus });
    } catch (error) {
      throw new ApiError(
        500,
        "WORKTREE_LIST_FAILED",
        error instanceof Error ? error.message : "Failed to list worktrees",
      );
    }
  });

  // POST /worktrees/:name/merge — 合并 worktree 回主分支
  app.post("/worktrees/:name/merge", async (c) => {
    const name = c.req.param("name");

    if (!name?.trim()) {
      throw new ApiError(400, "NAME_REQUIRED", "Worktree name is required");
    }

    try {
      // 找到对应的 worktree
      const worktrees = await listWorktrees(root);
      const worktree = worktrees.find((wt) => {
        const wtPath = toGitPath(wt.path);
        return wtPath.endsWith(`/${name}`) || wt.branch.endsWith(`/${name}`) || wt.branch === name;
      });

      if (!worktree) {
        throw new ApiError(404, "WORKTREE_NOT_FOUND", `Worktree not found: ${name}`);
      }

      // 获取 worktree 的分支名
      const branch = worktree.branch.replace(/^refs\/heads\//, "");
      if (!isValidBranchName(branch)) {
        throw new ApiError(400, "INVALID_BRANCH", `Invalid branch name: ${branch}`);
      }

      // 在主工作区执行合并
      const result = await mergeBranch(root, branch, true);

      return c.json({
        ok: result.success,
        message: result.message,
        branch,
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        500,
        "MERGE_FAILED",
        error instanceof Error ? error.message : "Failed to merge worktree",
      );
    }
  });

  // DELETE /worktrees/:name — 删除已合并的 worktree
  app.delete("/worktrees/:name", async (c) => {
    const name = c.req.param("name");

    if (!name?.trim()) {
      throw new ApiError(400, "NAME_REQUIRED", "Worktree name is required");
    }

    try {
      // 找到对应的 worktree
      const worktrees = await listWorktrees(root);
      const worktree = worktrees.find((wt) => {
        const wtPath = toGitPath(wt.path);
        return wtPath.endsWith(`/${name}`) || wt.branch.endsWith(`/${name}`) || wt.branch === name;
      });

      if (!worktree) {
        throw new ApiError(404, "WORKTREE_NOT_FOUND", `Worktree not found: ${name}`);
      }

      // 不允许删除主 worktree
      if (toGitPath(worktree.path) === toGitPath(root)) {
        throw new ApiError(400, "CANNOT_DELETE_MAIN", "Cannot delete the main worktree");
      }

      // 检查分支是否已合并到当前分支
      const branch = worktree.branch.replace(/^refs\/heads\//, "");
      let isMerged = false;
      try {
        const mergedBranches = await execGit(["branch", "--merged"], root);
        isMerged = mergedBranches
          .split("\n")
          .map((b) => b.trim().replace(/^\* /, ""))
          .includes(branch);
      } catch {
        // 无法检查合并状态时允许强制删除
      }

      const force = c.req.query("force") === "true";
      if (!isMerged && !force) {
        throw new ApiError(
          400,
          "WORKTREE_NOT_MERGED",
          `Worktree branch "${branch}" has not been merged. Use ?force=true to force delete.`,
        );
      }

      await removeWorktree(root, worktree.path, force);

      // 删除对应的本地分支（如果已合并）
      if (isMerged && isValidBranchName(branch)) {
        try {
          await execGit(["branch", "-d", branch], root);
        } catch {
          // 分支删除失败不影响 worktree 删除结果
        }
      }

      return c.json({ ok: true, branch });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        500,
        "WORKTREE_DELETE_FAILED",
        error instanceof Error ? error.message : "Failed to delete worktree",
      );
    }
  });

  return app;
}
