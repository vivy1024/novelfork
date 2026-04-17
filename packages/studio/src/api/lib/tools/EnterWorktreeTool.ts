/**
 * EnterWorktree 工具
 * 创建并进入 Git worktree
 */

import type { ToolDefinition, ToolContext, ToolResult } from "../tool-executor.js";
import {
  createWorktree,
  listWorktrees,
  isGitRepository,
  getCurrentBranch,
} from "../git-utils.js";
import * as path from "node:path";

/**
 * 会话状态管理（简化版，实际应该存储在 Redis/内存中）
 * 从 ExitWorktreeTool 导入共享状态
 */
import { sessionWorktrees } from "./ExitWorktreeTool.js";

export const EnterWorktreeTool: ToolDefinition = {
  name: "EnterWorktree",
  description:
    "创建并进入 Git worktree 隔离环境。可以创建新 worktree 或进入已存在的 worktree。",
  parameters: [
    {
      name: "name",
      type: "string",
      required: false,
      description:
        "Worktree 名称（创建新 worktree 时使用）。如果不提供，将生成随机名称。与 path 参数互斥。",
    },
    {
      name: "path",
      type: "string",
      required: false,
      description:
        "已存在的 worktree 路径（进入已有 worktree 时使用）。必须是当前仓库的有效 worktree。与 name 参数互斥。",
    },
  ],
  execute: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
    const { name, path: existingPath } = params as {
      name?: string;
      path?: string;
    };

    // 参数验证
    if (name && existingPath) {
      return {
        success: false,
        error: "Parameters 'name' and 'path' are mutually exclusive",
      };
    }

    const { workspaceRoot, sessionId } = context;

    // 检查是否已在 worktree 中
    if (sessionWorktrees.has(sessionId)) {
      return {
        success: false,
        error: "Already in a worktree session. Use ExitWorktree first.",
      };
    }

    // 检查是否在 Git 仓库中
    const isRepo = await isGitRepository(workspaceRoot);
    if (!isRepo) {
      return {
        success: false,
        error: "Not in a Git repository",
      };
    }

    try {
      let worktreePath: string;
      let branch: string;

      if (existingPath) {
        // 进入已存在的 worktree
        const existing = await listWorktrees(workspaceRoot);
        const worktree = existing.find((w: { path: string; branch: string }) => w.path === existingPath);

        if (!worktree) {
          return {
            success: false,
            error: `Worktree not found: ${existingPath}. Use 'git worktree list' to see available worktrees.`,
          };
        }

        worktreePath = worktree.path;
        branch = worktree.branch;
      } else {
        // 创建新 worktree
        const worktreeName = name || `worktree-${Date.now()}`;

        // 获取当前分支（用于生成新分支名）
        const currentBranch = await getCurrentBranch(workspaceRoot);

        worktreePath = await createWorktree(workspaceRoot, worktreeName);
        branch = `worktree/${worktreeName}`;
      }

      // 记录会话状态
      sessionWorktrees.set(sessionId, {
        path: worktreePath,
        originalCwd: workspaceRoot,
      });

      return {
        success: true,
        data: {
          path: worktreePath,
          branch,
          message: existingPath
            ? `Entered existing worktree at ${worktreePath}`
            : `Created and entered new worktree at ${worktreePath}`,
        },
        metadata: {
          originalCwd: workspaceRoot,
          sessionId,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
