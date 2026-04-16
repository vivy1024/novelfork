/**
 * GlobTool - 文件匹配工具
 * 使用 glob 模式匹配文件
 */

import type { ToolDefinition, ToolContext, ToolResult } from "../tool-executor";
import { glob } from "glob";
import * as path from "node:path";

export const GlobTool: ToolDefinition = {
  name: "Glob",
  description: "使用 glob 模式匹配文件（如 **/*.ts）",
  parameters: [
    {
      name: "pattern",
      type: "string",
      required: true,
      description: "Glob 模式（如 **/*.ts, src/**/*.json）",
    },
    {
      name: "path",
      type: "string",
      required: false,
      description: "搜索目录（相对于工作空间根目录，默认为根目录）",
    },
  ],
  execute: async (params, context: ToolContext): Promise<ToolResult> => {
    const pattern = params.pattern as string;
    const searchPath = (params.path as string) || ".";

    if (!pattern) {
      return { success: false, error: "pattern is required" };
    }

    try {
      const cwd = path.resolve(context.workspaceRoot, searchPath);

      // 执行 glob 匹配
      const matches = await glob(pattern, {
        cwd,
        nodir: true, // 只返回文件，不返回目录
        dot: false, // 不匹配隐藏文件
        ignore: ["**/node_modules/**", "**/.git/**"], // 忽略常见目录
      });

      return {
        success: true,
        data: matches,
        metadata: {
          pattern,
          searchPath,
          count: matches.length,
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
