/**
 * DiffViewer - Git diff 可视化组件
 * 解析并展示 Git diff 格式的文件变更
 */

import { useMemo } from "react";

export interface DiffViewerProps {
  diff: string;
  fileName: string;
}

interface DiffLine {
  lineNumber: number | null;
  type: "add" | "remove" | "context" | "header";
  content: string;
}

/**
 * 解析 Git diff 格式
 * @param diff Git diff 输出
 * @returns 解析后的行数组
 */
function parseDiff(diff: string): DiffLine[] {
  if (!diff.trim()) {
    return [];
  }

  const lines = diff.split("\n");
  const result: DiffLine[] = [];
  let currentLine = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      // Diff header: @@ -1,3 +1,4 @@
      result.push({ lineNumber: null, type: "header", content: line });

      // 解析新文件的起始行号
      const match = line.match(/\+(\d+)/);
      if (match) {
        currentLine = parseInt(match[1], 10);
      }
    } else if (line.startsWith("+")) {
      // 添加的行
      result.push({
        lineNumber: currentLine++,
        type: "add",
        content: line.slice(1)
      });
    } else if (line.startsWith("-")) {
      // 删除的行（不增加行号）
      result.push({
        lineNumber: null,
        type: "remove",
        content: line.slice(1)
      });
    } else if (line.startsWith(" ")) {
      // 上下文行
      result.push({
        lineNumber: currentLine++,
        type: "context",
        content: line.slice(1)
      });
    } else if (line.startsWith("diff --git") || line.startsWith("index ") ||
               line.startsWith("---") || line.startsWith("+++")) {
      // Git diff 元数据，跳过
      continue;
    } else if (line.trim()) {
      // 其他非空行作为上下文
      result.push({
        lineNumber: currentLine++,
        type: "context",
        content: line
      });
    }
  }

  return result;
}

export function DiffViewer({ diff, fileName }: DiffViewerProps) {
  const lines = useMemo(() => parseDiff(diff), [diff]);

  if (lines.length === 0) {
    return (
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-muted px-4 py-2 font-medium text-sm">{fileName}</div>
        <div className="p-8 text-center text-muted-foreground text-sm">
          无变更或无法解析 diff
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* 文件名头部 */}
      <div className="bg-muted px-4 py-2 font-medium text-sm border-b">
        {fileName}
      </div>

      {/* Diff 内容 */}
      <div className="font-mono text-xs overflow-x-auto">
        {lines.map((line, i) => (
          <div
            key={i}
            className={`flex ${
              line.type === "add"
                ? "bg-green-50 dark:bg-green-950/30"
                : line.type === "remove"
                ? "bg-red-50 dark:bg-red-950/30"
                : line.type === "header"
                ? "bg-blue-50 dark:bg-blue-950/30 font-medium"
                : ""
            }`}
          >
            {/* 行号 */}
            <span className="px-2 text-muted-foreground w-12 text-right select-none flex-shrink-0 border-r">
              {line.lineNumber ?? ""}
            </span>

            {/* +/- 符号 */}
            <span
              className={`px-2 w-6 flex-shrink-0 ${
                line.type === "add"
                  ? "text-green-600 dark:text-green-400"
                  : line.type === "remove"
                  ? "text-red-600 dark:text-red-400"
                  : ""
              }`}
            >
              {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
            </span>

            {/* 代码内容 */}
            <pre className="flex-1 px-2 py-0.5 whitespace-pre overflow-x-auto">
              {line.content}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
