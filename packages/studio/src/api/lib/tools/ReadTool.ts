/**
 * ReadTool - 读取文件工具
 * 支持完整读取或按行范围读取
 */

import type { ToolDefinition, ToolContext, ToolResult } from "../tool-executor";
import { readFile } from "../file-utils";

export const ReadTool: ToolDefinition = {
  name: "Read",
  description: "读取文件内容，支持行范围选择（默认最多 2000 行）",
  parameters: [
    {
      name: "file_path",
      type: "string",
      required: true,
      description: "文件路径（相对于工作空间根目录）",
    },
    {
      name: "offset",
      type: "number",
      required: false,
      description: "起始行号（从 0 开始）",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: "读取行数（默认 2000）",
      default: 2000,
    },
  ],
  execute: async (params, context: ToolContext): Promise<ToolResult> => {
    const filePath = params.file_path as string;
    const offset = params.offset as number | undefined;
    const limit = (params.limit as number | undefined) ?? 2000;

    if (!filePath) {
      return { success: false, error: "file_path is required" };
    }

    const result = await readFile(filePath, context.workspaceRoot, {
      offset,
      limit,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: result.content,
      metadata: {
        path: filePath,
        offset,
        limit,
      },
    };
  },
};
