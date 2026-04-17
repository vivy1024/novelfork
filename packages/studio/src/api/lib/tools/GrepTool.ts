/**
 * GrepTool - 内容搜索工具
 * 在文件中搜索正则表达式模式
 */

import type { ToolDefinition, ToolContext, ToolResult } from "../tool-executor.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";

type OutputMode = "content" | "files_with_matches" | "count";

interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

export const GrepTool: ToolDefinition = {
  name: "Grep",
  description: "在文件中搜索正则表达式模式",
  parameters: [
    {
      name: "pattern",
      type: "string",
      required: true,
      description: "正则表达式模式",
    },
    {
      name: "path",
      type: "string",
      required: false,
      description: "搜索路径（相对于工作空间根目录，默认为根目录）",
    },
    {
      name: "glob",
      type: "string",
      required: false,
      description: "文件过滤模式（如 *.ts, **/*.json）",
    },
    {
      name: "output_mode",
      type: "string",
      required: false,
      description: "输出模式：content（匹配行）、files_with_matches（文件列表）、count（计数）",
      default: "files_with_matches",
    },
  ],
  execute: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
    const patternStr = params.pattern as string;
    const searchPath = (params.path as string) || ".";
    const globPattern = (params.glob as string) || "**/*";
    const outputMode = ((params.output_mode as string) || "files_with_matches") as OutputMode;

    if (!patternStr) {
      return { success: false, error: "pattern is required" };
    }

    try {
      // 编译正则表达式
      const regex = new RegExp(patternStr, "g");

      // 获取文件列表
      const cwd = path.resolve(context.workspaceRoot, searchPath);
      const files = await glob(globPattern, {
        cwd,
        nodir: true,
        dot: false,
        ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
      });

      const matches: GrepMatch[] = [];
      const filesWithMatches = new Set<string>();
      let totalMatches = 0;

      // 搜索每个文件
      for (const file of files) {
        const fullPath = path.join(cwd, file);

        try {
          const content = await fs.readFile(fullPath, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (regex.test(line)) {
              matches.push({
                file,
                line: i + 1,
                content: line.trim(),
              });
              filesWithMatches.add(file);
              totalMatches++;
            }
            // 重置正则表达式的 lastIndex
            regex.lastIndex = 0;
          }
        } catch (error) {
          // 跳过无法读取的文件（如二进制文件）
          continue;
        }
      }

      // 根据输出模式返回结果
      switch (outputMode) {
        case "content":
          return {
            success: true,
            data: matches,
            metadata: {
              pattern: patternStr,
              totalMatches,
              filesSearched: files.length,
            },
          };

        case "files_with_matches":
          return {
            success: true,
            data: Array.from(filesWithMatches),
            metadata: {
              pattern: patternStr,
              totalMatches,
              filesSearched: files.length,
            },
          };

        case "count":
          return {
            success: true,
            data: {
              totalMatches,
              filesWithMatches: filesWithMatches.size,
              filesSearched: files.length,
            },
            metadata: {
              pattern: patternStr,
            },
          };

        default:
          return {
            success: false,
            error: `Invalid output_mode: ${outputMode}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
