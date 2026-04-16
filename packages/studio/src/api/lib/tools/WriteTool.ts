/**
 * WriteTool - 写入文件工具
 * 创建新文件或覆盖现有文件
 */

import type { ToolDefinition, ToolContext, ToolResult } from "../tool-executor";
import { writeFile, fileExists } from "../file-utils";

export const WriteTool: ToolDefinition = {
  name: "Write",
  description: "写入文件内容（创建新文件或覆盖现有文件）",
  parameters: [
    {
      name: "file_path",
      type: "string",
      required: true,
      description: "文件路径（相对于工作空间根目录）",
    },
    {
      name: "content",
      type: "string",
      required: true,
      description: "文件内容",
    },
  ],
  execute: async (params, context: ToolContext): Promise<ToolResult> => {
    const filePath = params.file_path as string;
    const content = params.content as string;

    if (!filePath) {
      return { success: false, error: "file_path is required" };
    }

    if (content === undefined || content === null) {
      return { success: false, error: "content is required" };
    }

    // 检查文件是否已存在
    const existsResult = await fileExists(filePath, context.workspaceRoot);
    const isOverwrite = existsResult.exists;

    const result = await writeFile(filePath, content, context.workspaceRoot, {
      createDirs: true,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: `File ${isOverwrite ? "overwritten" : "created"}: ${filePath}`,
      metadata: {
        path: filePath,
        isOverwrite,
        size: content.length,
      },
    };
  },
};
