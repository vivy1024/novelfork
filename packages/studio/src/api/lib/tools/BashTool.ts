/**
 * BashTool - Shell 命令执行工具
 * ⚠️ 安全警告：需要严格权限控制
 */

import type { ToolDefinition, ToolContext, ToolResult } from "../tool-executor.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export const BashTool: ToolDefinition = {
  name: "Bash",
  description: "执行 shell 命令（⚠️ 需要严格权限控制）",
  parameters: [
    {
      name: "command",
      type: "string",
      required: true,
      description: "要执行的 shell 命令",
    },
    {
      name: "timeout",
      type: "number",
      required: false,
      description: "超时时间（毫秒，默认 120000ms = 2分钟）",
      default: 120000,
    },
  ],
  execute: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
    const command = params.command as string;
    const timeout = (params.timeout as number) ?? 120000;

    if (!command) {
      return { success: false, error: "command is required" };
    }

    // 检查权限
    if (!context.permissions.has("bash")) {
      return {
        success: false,
        error: "Permission denied: bash execution requires 'bash' permission",
      };
    }

    // 危险命令黑名单
    const dangerousPatterns = [
      /rm\s+-rf\s+\//, // rm -rf /
      /:\(\)\{.*\}/, // fork bomb
      /mkfs/, // 格式化文件系统
      /dd\s+if=.*of=\/dev/, // 写入设备
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return {
          success: false,
          error: `Dangerous command blocked: ${command}`,
        };
      }
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: context.workspaceRoot,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      return {
        success: true,
        data: {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        },
        metadata: {
          command,
          timeout,
        },
      };
    } catch (error: unknown) {
      const err = error as { code?: number; signal?: string; stdout?: string; stderr?: string; message?: string };

      // 超时错误
      if (err.signal === "SIGTERM") {
        return {
          success: false,
          error: `Command timed out after ${timeout}ms`,
        };
      }

      // 命令执行失败
      return {
        success: false,
        error: err.message || String(error),
        data: {
          stdout: err.stdout?.trim() || "",
          stderr: err.stderr?.trim() || "",
          exitCode: err.code,
        },
      };
    }
  },
};
