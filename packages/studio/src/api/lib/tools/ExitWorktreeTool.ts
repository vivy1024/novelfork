/**
 * ExitWorktree 工具
 * 退出当前 worktree 并可选删除
 */

import type { ToolDefinition, ToolContext, ToolResult } from "../tool-executor";
import { removeWorktree, getWorktreeStatus } from "../git-utils";

/**
 * 会话状态管理（与 EnterWorktreeTool 共享）
 * 导出供 EnterWorktreeTool 使用，避免循环依赖
 */
export const sessionWorktrees = new Map<string, { path: string; originalCwd: string }>();

export const ExitWorktreeTool: ToolDefinition = {
  name: "ExitWorktree",
  description:
    "退出当前 worktree 会话并恢复到原始工作目录。可选择保留或删除 worktree。",
  parameters: [
    {
      name: "action",
      type: "string",
      required: true,
      description:
        "退出操作：'keep' 保留 worktree 和分支在磁盘上；'remove' 删除 worktree 目录和分支。",
    },
    {
      name: "discard_changes",
      type: "boolean",
      required: false,
      default: false,
      description:
        "当 action='remove' 且 worktree 有未提交更改时，是否强制删除。默认 false（有更改时拒绝删除）。",
    },
  ],
  execute: async (params, context): Promise<ToolResult> => {
    const { action, discard_changes } = params as {
      action: string;
      discard_changes?: boolean;
    };

    // 参数验证
    if (action !== "keep" && action !== "remove") {
      return {
        success: false,
        error: "Parameter 'action' must be 'keep' or 'remove'",
      };
    }

    const { sessionId, workspaceRoot } = context;

    // 检查是否在 worktree 会话中
    const session = sessionWorktrees.get(sessionId);
    if (!session) {
      return {
        success: false,
        error: "No active worktree session. Nothing to exit.",
      };
    }

    const { path: worktreePath, originalCwd } = session;

    try {
      if (action === "remove") {
        // 检查未提交更改
        const status = await getWorktreeStatus(worktreePath);

        if (status.hasChanges && !discard_changes) {
          // 有更改且未允许丢弃，拒绝删除
          const changes = [
            ...status.modified.map((f) => `M ${f}`),
            ...status.added.map((f) => `A ${f}`),
            ...status.deleted.map((f) => `D ${f}`),
            ...status.untracked.map((f) => `? ${f}`),
          ];

          return {
            success: false,
            error: `Worktree has uncommitted changes. Set discard_changes=true to force removal.\n\nChanges:\n${changes.join("\n")}`,
            data: {
              hasChanges: true,
              changes: {
                modified: status.modified,
                added: status.added,
                deleted: status.deleted,
                untracked: status.untracked,
              },
            },
          };
        }

        // 删除 worktree
        await removeWorktree(originalCwd, worktreePath, discard_changes || false);
      }

      // 清除会话状态
      sessionWorktrees.delete(sessionId);

      return {
        success: true,
        data: {
          action,
          worktreePath,
          originalCwd,
          message:
            action === "remove"
              ? `Exited and removed worktree at ${worktreePath}`
              : `Exited worktree at ${worktreePath} (kept on disk)`,
        },
        metadata: {
          sessionId,
          restoredCwd: originalCwd,
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
