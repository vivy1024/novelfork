import { useState } from "react";
import { Check, X, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ConversationToolCall {
  id: string;
  toolName: string;
  status?: "pending" | "running" | "success" | "error";
  summary?: string;
  input?: unknown;
  result?: unknown;
  output?: string;
  error?: string;
  exitCode?: number;
  durationMs?: number;
}

/**
 * 紧凑工具调用卡片 — 对标 NarraFork
 * 一行显示：状态图标 + 工具名 + 耗时badge
 * 点击展开详情
 */
export function ToolCallCard({ toolCall }: { toolCall: ConversationToolCall; onOpenArtifact?: unknown }) {
  const [expanded, setExpanded] = useState(false);

  const isSuccess = toolCall.status === "success";
  const isError = toolCall.status === "error";
  const isRunning = toolCall.status === "running";
  const isPending = toolCall.status === "pending";

  return (
    <div className="my-1">
      {/* Compact one-line header */}
      <Button
        type="button"
        variant="ghost"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm h-auto justify-start"
      >
        {/* Status icon */}
        {isSuccess && <Check className="size-3.5 text-green-600 dark:text-green-400" />}
        {isError && <X className="size-3.5 text-red-600 dark:text-red-400" />}
        {isRunning && <Loader2 className="size-3.5 animate-spin text-blue-600 dark:text-blue-400" />}
        {isPending && <div className="size-3.5 rounded-full border-2 border-yellow-500" />}

        {/* Tool name */}
        <span className="font-mono text-xs text-foreground">{toolCall.toolName}</span>

        {/* Duration badge */}
        {typeof toolCall.durationMs === "number" && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {toolCall.durationMs < 1000 ? `${toolCall.durationMs}ms` : `${(toolCall.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}

        {/* Summary (truncated) */}
        {toolCall.summary && (
          <span className="flex-1 truncate text-xs text-muted-foreground">{toolCall.summary}</span>
        )}

        {/* Expand chevron */}
        {expanded ? <ChevronDown className="size-3 text-muted-foreground" /> : <ChevronRight className="size-3 text-muted-foreground" />}
      </Button>

      {/* Expanded details */}
      {expanded && (
        <div className="ml-6 mt-1 space-y-1 rounded-md border border-border bg-muted/20 p-2 text-xs">
          {toolCall.input !== undefined && (
            <div>
              <span className="font-medium text-muted-foreground">输入：</span>
              <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap text-[11px]">{JSON.stringify(toolCall.input, null, 2)}</pre>
            </div>
          )}
          {toolCall.output && (
            <div>
              <span className="font-medium text-muted-foreground">输出：</span>
              <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap text-[11px]">{toolCall.output}</pre>
            </div>
          )}
          {toolCall.error && (
            <div className="text-red-600 dark:text-red-400">
              <span className="font-medium">错误：</span>{toolCall.error}
            </div>
          )}
          {toolCall.result !== undefined && !toolCall.output && !toolCall.error && (
            <div>
              <span className="font-medium text-muted-foreground">结果：</span>
              <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap text-[11px]">{JSON.stringify(toolCall.result, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
