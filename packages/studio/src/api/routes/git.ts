/**
 * 统一 Git 路由
 * 合并原 git.ts + worktree.ts + workspace-management.ts
 * 挂载在 /api/git，提供：
 *   - Git 面板操作（overview/status/log/branches/add/commit/stash 等）
 *   - Worktree 管理（list/create/remove/status/diff/merge/fork）
 *   - 工作区设置（settings GET/PUT）
 */

import { Hono } from "hono";

import { ApiError } from "../errors.js";
import {
  createWorktree,
  execGit,
  getFileDiff,
  getWorktreeStatus,
  forkBranch,
  isPathInsideRoot,
  isValidBranchName,
  listWorktrees,
  mergeBranch,
  removeWorktree,
  toGitPath,
} from "../lib/git-utils.js";
import { loadUserConfig, updateUserConfig } from "../lib/user-config-service.js";
import type { WorkspaceSettings } from "../../types/settings.js";

// ── path 安全校验 ──

function requireRepoPath(pathValue: string | undefined, root: string): string {
  const repoPath = pathValue?.trim();
  if (!repoPath) {
    throw new ApiError(400, "PATH_REQUIRED", "Repository path is required");
  }
  if (!isPathInsideRoot(repoPath, root)) {
    throw new ApiError(403, "PATH_OUTSIDE_ROOT", "Path is outside the workspace root");
  }
  return repoPath;
}

/**
 * 同 requireRepoPath 但允许 path === root（列表/概览等只需非空即可）
 * 对外暴露以便兼容层直接使用
 */
function requireRepoPathOrRoot(pathValue: string | undefined, root: string): string {
  const repoPath = pathValue?.trim();
  if (!repoPath) {
    throw new ApiError(400, "PATH_REQUIRED", "Repository path is required");
  }
  if (!isPathInsideRoot(repoPath, root)) {
    throw new ApiError(403, "PATH_OUTSIDE_ROOT", "Path is outside the workspace root");
  }
  return repoPath;
}

// ── Worktree 查找辅助 ──

async function findWorktreeByName(root: string, name: string) {
  const worktrees = await listWorktrees(root);
  const worktree = worktrees.find((wt) => {
    const wtPath = toGitPath(wt.path);
    return wtPath.endsWith(`/${name}`) || wt.branch.endsWith(`/${name}`) || wt.branch === name;
  });
  if (!worktree) {
    throw new ApiError(404, "WORKTREE_NOT_FOUND", `Worktree not found: ${name}`);
  }
  return worktree;
}

// ══════════════════════════════════════════════════════════════════════
// Router
// ══════════════════════════════════════════════════════════════════════

export function createGitRouter(root: string): Hono {
  const app = new Hono();

  // ────────────────────────────────────────────────────────────────────
  // Git Panel 操作（原 git.ts）
  // ────────────────────────────────────────────────────────────────────

  app.get("/overview", async (c) => {
    try {
      const repoPath = requireRepoPathOrRoot(c.req.query("path"), root);
      const [log, diff, status] = await Promise.all([
        execGit(["log", "--oneline", "-n", "20"], repoPath),
        execGit(["diff", "HEAD"], repoPath),
        execGit(["status", "--short"], repoPath),
      ]);
      return c.json({ log, diff, status });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_OVERVIEW_FAILED", error instanceof Error ? error.message : "Failed to load git overview");
    }
  });

  app.get("/branches", async (c) => {
    try {
      const repoPath = requireRepoPathOrRoot(c.req.query("path"), root);
      const output = await execGit(["branch", "-a"], repoPath);
      const branches = output
        .split("\n")
        .map((line) => line.replace(/^\*?\s+/, "").trim())
        .filter(Boolean);
      return c.json({ branches });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_BRANCHES_FAILED", error instanceof Error ? error.message : "Failed to list branches");
    }
  });

  app.post("/add", async (c) => {
    try {
      const body = await c.req.json<{ path?: string; file?: string }>();
      const repoPath = requireRepoPathOrRoot(body.path, root);
      const file = body.file?.trim();
      if (!file) {
        throw new ApiError(400, "FILE_REQUIRED", "File path is required");
      }
      await execGit(["add", file], repoPath);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_ADD_FAILED", error instanceof Error ? error.message : "Failed to stage file");
    }
  });

  app.post("/commit", async (c) => {
    try {
      const body = await c.req.json<{ path?: string; message?: string }>();
      const repoPath = requireRepoPathOrRoot(body.path, root);
      const message = body.message?.trim();
      if (!message) {
        throw new ApiError(400, "MESSAGE_REQUIRED", "Commit message is required");
      }
      await execGit(["commit", "-m", message], repoPath);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_COMMIT_FAILED", error instanceof Error ? error.message : "Failed to create commit");
    }
  });

  app.post("/merge", async (c) => {
    try {
      const body = await c.req.json<{ path?: string; sourceBranch?: string; noFf?: boolean }>();
      const repoPath = requireRepoPathOrRoot(body.path, root);
      const sourceBranch = body.sourceBranch?.trim();
      if (!sourceBranch) {
        throw new ApiError(400, "SOURCE_BRANCH_REQUIRED", "Source branch is required");
      }
      const result = await mergeBranch(repoPath, sourceBranch, body.noFf ?? true);
      return c.json({ ok: result.success, message: result.message });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_MERGE_FAILED", error instanceof Error ? error.message : "Failed to merge branch");
    }
  });

  // ── 结构化 status ──
  app.get("/status", async (c) => {
    try {
      const repoPath = requireRepoPathOrRoot(c.req.query("path"), root);
      const output = await execGit(["status", "--porcelain=v1"], repoPath);
      const branch = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], repoPath).then((s) => s.trim()).catch(() => "unknown");
      const files: Array<{ path: string; status: string; staged: boolean }> = [];

      for (const line of output.split("\n").filter(Boolean)) {
        const indexStatus = line[0];
        const workStatus = line[1];
        const filePath = line.slice(3).trim();
        const staged = indexStatus !== " " && indexStatus !== "?";
        let status = "modified";
        if (indexStatus === "?" || workStatus === "?") status = "untracked";
        else if (indexStatus === "A" || workStatus === "A") status = "added";
        else if (indexStatus === "D" || workStatus === "D") status = "deleted";
        else if (indexStatus === "R" || workStatus === "R") status = "renamed";

        files.push({ path: filePath, status, staged });
      }

      return c.json({ branch, files, total: files.length });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_STATUS_FAILED", error instanceof Error ? error.message : "Failed to get git status");
    }
  });

  // ── Git log（结构化） ──
  app.get("/log", async (c) => {
    try {
      const repoPath = requireRepoPathOrRoot(c.req.query("path"), root);
      const limit = Math.min(50, Math.max(1, Number(c.req.query("limit")) || 20));
      const output = await execGit(["log", `--format=%H|%h|%s|%an|%ar`, `-n`, String(limit)], repoPath);
      const commits = output.split("\n").filter(Boolean).map((line) => {
        const [hash, short, message, author, date] = line.split("|");
        return { hash, short, message, author, date };
      });
      return c.json({ commits });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_LOG_FAILED", error instanceof Error ? error.message : "Failed to get git log");
    }
  });

  // ── 暂存全部 ──
  app.post("/add-all", async (c) => {
    try {
      const body = await c.req.json<{ path?: string }>();
      const repoPath = requireRepoPathOrRoot(body.path, root);
      await execGit(["add", "-A"], repoPath);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_ADD_ALL_FAILED", error instanceof Error ? error.message : "Failed to stage all files");
    }
  });

  // ── 丢弃文件变更 ──
  app.post("/discard", async (c) => {
    try {
      const body = await c.req.json<{ path?: string; file?: string }>();
      const repoPath = requireRepoPathOrRoot(body.path, root);
      const file = body.file?.trim();
      if (!file) {
        throw new ApiError(400, "FILE_REQUIRED", "File path is required");
      }
      await execGit(["checkout", "--", file], repoPath);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_DISCARD_FAILED", error instanceof Error ? error.message : "Failed to discard changes");
    }
  });

  // ── 丢弃全部变更 ──
  app.post("/discard-all", async (c) => {
    try {
      const body = await c.req.json<{ path?: string; skipStash?: boolean }>();
      const repoPath = requireRepoPathOrRoot(body.path, root);
      if (!body.skipStash) {
        try {
          await execGit(["stash", "push", "-u", "-m", "novelfork-discard-all-backup"], repoPath);
        } catch { /* stash may fail if nothing to stash — proceed anyway */ }
      }
      await execGit(["checkout", "--", "."], repoPath);
      await execGit(["clean", "-fd"], repoPath);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_DISCARD_ALL_FAILED", error instanceof Error ? error.message : "Failed to discard all changes");
    }
  });

  // ── Stash ──
  app.post("/stash", async (c) => {
    try {
      const body = await c.req.json<{ path?: string; message?: string }>();
      const repoPath = requireRepoPathOrRoot(body.path, root);
      const args = ["stash", "push"];
      if (body.message?.trim()) args.push("-m", body.message.trim());
      await execGit(args, repoPath);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_STASH_FAILED", error instanceof Error ? error.message : "Failed to stash changes");
    }
  });

  // ── Stash pop ──
  app.post("/stash-pop", async (c) => {
    try {
      const body = await c.req.json<{ path?: string }>();
      const repoPath = requireRepoPathOrRoot(body.path, root);
      await execGit(["stash", "pop"], repoPath);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_STASH_POP_FAILED", error instanceof Error ? error.message : "Failed to pop stash");
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Worktree 管理（原 worktree.ts）
  // ────────────────────────────────────────────────────────────────────

  /** GET /worktrees — 列出所有 worktrees 及其状态 */
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
      throw new ApiError(500, "WORKTREE_LIST_FAILED", error instanceof Error ? error.message : "Failed to list worktrees");
    }
  });

  /** POST /worktrees — 创建新 worktree */
  app.post("/worktrees", async (c) => {
    try {
      const body = await c.req.json<{ name?: string; branch?: string }>();

      if (!body.name?.trim()) {
        throw new ApiError(400, "NAME_REQUIRED", "Worktree name is required");
      }

      const worktreePath = await createWorktree(root, body.name.trim(), body.branch?.trim());
      return c.json({ ok: true, path: worktreePath });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "WORKTREE_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create worktree");
    }
  });

  /** POST /worktree/create — 旧路径兼容（GitPanel 使用 body.path） */
  app.post("/worktree/create", async (c) => {
    try {
      const body = await c.req.json<{ path?: string; name?: string; branch?: string }>();
      const repoPath = requireRepoPathOrRoot(body.path, root);
      const name = body.name?.trim();
      if (!name) {
        throw new ApiError(400, "NAME_REQUIRED", "Worktree name is required");
      }
      const worktreePath = await createWorktree(repoPath, name, body.branch?.trim());
      return c.json({ ok: true, path: worktreePath });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_WORKTREE_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create worktree");
    }
  });

  /** DELETE /worktrees/:name — 删除 worktree（含合并检查） */
  app.delete("/worktrees/:name", async (c) => {
    const name = c.req.param("name");

    if (!name?.trim()) {
      throw new ApiError(400, "NAME_REQUIRED", "Worktree name is required");
    }

    try {
      const worktree = await findWorktreeByName(root, name);

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

  /** GET /worktrees/:name/status — 获取指定 worktree 的详细状态 */
  app.get("/worktrees/:name/status", async (c) => {
    try {
      const name = c.req.param("name");
      const worktree = await findWorktreeByName(root, name);
      const status = await getWorktreeStatus(worktree.path);
      return c.json({ status });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "STATUS_FAILED", error instanceof Error ? error.message : "Failed to get worktree status");
    }
  });

  /** GET /worktrees/:name/diff?file=<file-path> — 获取指定文件的 diff */
  app.get("/worktrees/:name/diff", async (c) => {
    try {
      const name = c.req.param("name");
      const filePath = c.req.query("file");

      if (!filePath?.trim()) {
        throw new ApiError(400, "FILE_REQUIRED", "File path is required");
      }

      const worktree = await findWorktreeByName(root, name);
      const diff = await getFileDiff(worktree.path, filePath);

      return c.json({ diff });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "DIFF_FAILED", error instanceof Error ? error.message : "Failed to get file diff");
    }
  });

  /** POST /worktrees/:name/merge — 合并 worktree 分支回主工作区 */
  app.post("/worktrees/:name/merge", async (c) => {
    const name = c.req.param("name");

    if (!name?.trim()) {
      throw new ApiError(400, "NAME_REQUIRED", "Worktree name is required");
    }

    try {
      const worktree = await findWorktreeByName(root, name);
      const branch = worktree.branch.replace(/^refs\/heads\//, "");
      if (!isValidBranchName(branch)) {
        throw new ApiError(400, "INVALID_BRANCH", `Invalid branch name: ${branch}`);
      }

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

  /** POST /worktrees/fork — 从当前分支创建新分支 */
  app.post("/worktrees/fork", async (c) => {
    try {
      const body = await c.req.json<{ path?: string; newBranch?: string }>();

      if (!body.path?.trim()) {
        throw new ApiError(400, "PATH_REQUIRED", "Worktree path is required");
      }

      if (!body.newBranch?.trim()) {
        throw new ApiError(400, "NEW_BRANCH_REQUIRED", "New branch name is required");
      }

      const branchName = await forkBranch(body.path, body.newBranch.trim());
      return c.json({ ok: true, branch: branchName });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "FORK_FAILED", error instanceof Error ? error.message : "Failed to fork branch");
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // 工作区设置（原 workspace-management.ts）
  // ────────────────────────────────────────────────────────────────────

  /** GET /workspace/settings — 获取工作区设置 */
  app.get("/workspace/settings", async (c) => {
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

  /** PUT /workspace/settings — 更新工作区设置 */
  app.put("/workspace/settings", async (c) => {
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

  return app;
}

// ══════════════════════════════════════════════════════════════════════
// Handler 导出（供兼容层 re-route 使用）
// ══════════════════════════════════════════════════════════════════════

export { findWorktreeByName };
