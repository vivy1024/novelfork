/**
 * BashTool - Shell 命令执行工具
 * ⚠️ 安全警告：需要严格权限控制
 */

import { execCommand } from "@vivy1024/novelfork-core/runtime/process-adapter";
import type { ToolDefinition, ToolContext, ToolResult } from "../tool-executor.js";

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

    const result = await execCommand(command, {
      cwd: context.workspaceRoot,
      timeout,
    });

    if (result.signal === "SIGTERM") {
      return {
        success: false,
        error: `Command timed out after ${timeout}ms`,
      };
    }

    if ((result.exitCode ?? 0) !== 0) {
      return {
        success: false,
        error: result.stderr || `Command failed with exit code ${result.exitCode}`,
        data: {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        },
      };
    }

    return {
      success: true,
      data: {
        stdout: result.stdout,
        stderr: result.stderr,
      },
      metadata: {
        command,
        timeout,
      },
    };
  },
};
