/**
 * EditTool - 编辑文件工具
 * 精确字符串替换
 */

import type { ToolDefinition, ToolContext, ToolResult } from "../tool-executor.js";
import { editFile } from "../file-utils.js";

export const EditTool: ToolDefinition = {
  name: "Edit",
  description: "编辑文件内容（精确字符串替换）",
  parameters: [
    {
      name: "file_path",
      type: "string",
      required: true,
      description: "文件路径（相对于工作空间根目录）",
    },
    {
      name: "old_string",
      type: "string",
      required: true,
      description: "要替换的字符串",
    },
    {
      name: "new_string",
      type: "string",
      required: true,
      description: "替换后的字符串",
    },
    {
      name: "replace_all",
      type: "boolean",
      required: false,
      description: "是否替换所有匹配项（默认 false，仅替换第一个）",
      default: false,
    },
  ],
  execute: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
    const filePath = params.file_path as string;
    const oldString = params.old_string as string;
    const newString = params.new_string as string;
    const replaceAll = (params.replace_all as boolean) ?? false;

    if (!filePath) {
      return { success: false, error: "file_path is required" };
    }

    if (oldString === undefined || oldString === null) {
      return { success: false, error: "old_string is required" };
    }

    if (newString === undefined || newString === null) {
      return { success: false, error: "new_string is required" };
    }

    if (oldString === newString) {
      return { success: false, error: "old_string and new_string are identical" };
    }

    const result = await editFile(filePath, oldString, newString, context.workspaceRoot, {
      replaceAll,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: `Replaced ${result.replacements} occurrence(s) in ${filePath}`,
      metadata: {
        path: filePath,
        replacements: result.replacements,
        replaceAll,
      },
    };
  },
};
