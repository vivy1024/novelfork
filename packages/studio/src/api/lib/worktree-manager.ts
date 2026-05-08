/**
 * WorktreeManager — Git worktree 隔离管理
 *
 * 对标 Claude Code CLI 的 subagent worktree 隔离：
 * - 每个子代理在独立的 git worktree 中执行
 * - 避免与主工作区的文件冲突
 * - 子代理完成后可选择合并或丢弃 worktree
 *
 * 依赖：git CLI（通过 child_process 调用）
 */

import { execSync, type ExecSyncOptions } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

export interface WorktreeInfo {
  readonly path: string;
  readonly branch: string;
  readonly sessionId: string;
  readonly createdAt: number;
}

export interface CreateWorktreeOptions {
  /** 主仓库路径 */
  repoPath: string;
  /** 会话 ID（用于命名 worktree） */
  sessionId: string;
  /** 基于哪个分支创建（默认 HEAD） */
  baseBranch?: string;
  /** worktree 存放目录（默认 .novelfork-worktrees/） */
  worktreeDir?: string;
}

export interface WorktreeManagerResult {
  readonly ok: boolean;
  readonly worktree?: WorktreeInfo;
  readonly error?: string;
}

const DEFAULT_WORKTREE_DIR = ".novelfork-worktrees";

function execGit(args: string[], options: ExecSyncOptions): string {
  const command = `git ${args.join(" ")}`;
  const result = execSync(command, { encoding: "utf-8", ...options });
  return typeof result === "string" ? result.trim() : result.toString("utf-8").trim();
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
}

/**
 * 创建一个独立的 git worktree 供子代理使用
 */
export function createWorktree(options: CreateWorktreeOptions): WorktreeManagerResult {
  const { repoPath, sessionId, baseBranch, worktreeDir = DEFAULT_WORKTREE_DIR } = options;

  try {
    // 确保主仓库是 git 仓库
    const gitDir = execGit(["rev-parse", "--git-dir"], { cwd: repoPath });
    if (!gitDir) {
      return { ok: false, error: "不是 git 仓库" };
    }

    // 创建 worktree 目录
    const worktreeBase = resolve(repoPath, worktreeDir);
    if (!existsSync(worktreeBase)) {
      mkdirSync(worktreeBase, { recursive: true });
    }

    // 生成 worktree 路径和分支名
    const safeName = sanitizeSessionId(sessionId);
    const branchName = `novelfork/agent/${safeName}`;
    const worktreePath = join(worktreeBase, safeName);

    // 如果 worktree 已存在，直接返回
    if (existsSync(worktreePath)) {
      return {
        ok: true,
        worktree: {
          path: worktreePath,
          branch: branchName,
          sessionId,
          createdAt: Date.now(),
        },
      };
    }

    // 创建新分支和 worktree
    const base = baseBranch || "HEAD";
    execGit(["worktree", "add", "-b", branchName, worktreePath, base], { cwd: repoPath });

    return {
      ok: true,
      worktree: {
        path: worktreePath,
        branch: branchName,
        sessionId,
        createdAt: Date.now(),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 移除一个 git worktree
 */
export function removeWorktree(repoPath: string, worktreePath: string): WorktreeManagerResult {
  try {
    // 先尝试正常移除
    execGit(["worktree", "remove", worktreePath, "--force"], { cwd: repoPath });
    return { ok: true };
  } catch {
    // 如果 git worktree remove 失败，手动清理
    try {
      if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true, force: true });
      }
      execGit(["worktree", "prune"], { cwd: repoPath });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * 列出当前仓库的所有 worktree
 */
export function listWorktrees(repoPath: string): WorktreeInfo[] {
  try {
    const output = execGit(["worktree", "list", "--porcelain"], { cwd: repoPath });
    const worktrees: WorktreeInfo[] = [];
    let currentPath = "";
    let currentBranch = "";
    let currentSessionId = "";

    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (currentPath && currentSessionId) {
          worktrees.push({ path: currentPath, branch: currentBranch, sessionId: currentSessionId, createdAt: 0 });
        }
        currentPath = line.slice(9);
        currentBranch = "";
        currentSessionId = "";
      } else if (line.startsWith("branch ")) {
        currentBranch = line.slice(7).replace("refs/heads/", "");
        const match = currentBranch.match(/^novelfork\/agent\/(.+)$/);
        if (match) currentSessionId = match[1];
      }
    }
    if (currentPath && currentSessionId) {
      worktrees.push({ path: currentPath, branch: currentBranch, sessionId: currentSessionId, createdAt: 0 });
    }

    return worktrees;
  } catch {
    return [];
  }
}

/**
 * 清理所有过期的 agent worktrees（超过 24 小时未活动）
 */
export function pruneStaleWorktrees(repoPath: string, maxAgeMs = 24 * 60 * 60 * 1000): number {
  const worktrees = listWorktrees(repoPath);
  let pruned = 0;

  for (const worktree of worktrees) {
    if (worktree.createdAt > 0 && Date.now() - worktree.createdAt > maxAgeMs) {
      const result = removeWorktree(repoPath, worktree.path);
      if (result.ok) pruned++;
    }
  }

  return pruned;
}
