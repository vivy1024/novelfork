import { useState } from "react";
import { Check, X, ChevronDown, ChevronRight, Loader2, Terminal, FileText, Search, Globe, Bot, HelpCircle, Pencil } from "lucide-react";

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
  /** 子代理调用数 */
  childCallCount?: number;
}

// 工具类型分类
const BASH_TOOLS = new Set(["Bash", "Shell", "Execute", "Terminal"]);
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "Find", "WebSearch", "WebFetch"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "create_file", "edit_file", "write_file"]);
const AGENT_TOOLS = new Set(["Agent", "Task", "Send", "Await"]);
const QUESTION_TOOLS = new Set(["AskUserQuestion", "UserQuestionGate"]);

type ToolCategory = "bash" | "read" | "write" | "agent" | "question" | "other";

function getToolCategory(toolName: string): ToolCategory {
  if (BASH_TOOLS.has(toolName)) return "bash";
  if (READ_TOOLS.has(toolName)) return "read";
  if (WRITE_TOOLS.has(toolName)) return "write";
  if (AGENT_TOOLS.has(toolName)) return "agent";
  if (QUESTION_TOOLS.has(toolName)) return "question";
  return "other";
}

function ToolIcon({ category, status }: { category: ToolCategory; status?: string }) {
  const colorClass = status === "error" ? "text-red-500"
    : status === "running" ? "text-blue-500"
    : status === "success" ? "text-green-500"
    : "text-muted-foreground";

  const iconClass = `size-3.5 ${colorClass}`;

  switch (category) {
    case "bash": return <Terminal className={iconClass} />;
    case "read": return <Search className={iconClass} />;
    case "write": return <Pencil className={iconClass} />;
    case "agent": return <Bot className={iconClass} />;
    case "question": return <HelpCircle className={iconClass} />;
    default: return <FileText className={iconClass} />;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

function extractBashCommand(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (typeof record.command === "string") return record.command;
  if (typeof record.cmd === "string") return record.cmd;
  return null;
}

function extractFilePath(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  return typeof record.file_path === "string" ? record.file_path
    : typeof record.path === "string" ? record.path
    : typeof record.filePath === "string" ? record.filePath
    : null;
}

function extractAgentDescription(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  return typeof record.description === "string" ? record.description
    : typeof record.prompt === "string" ? record.prompt.slice(0, 80)
    : null;
}

/**
 * 工具调用卡片 — 对标 NarraFork 风格
 * 一行：工具图标(按类型着色) + 工具名 + 描述摘要 + 耗时
 * 展开：按工具类型格式化展示输入/输出
 */
export function ToolCallCard({ toolCall }: { toolCall: ConversationToolCall; onOpenArtifact?: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const category = getToolCategory(toolCall.toolName);

  const isRunning = toolCall.status === "running";
  const isPending = toolCall.status === "pending";

  // 生成描述摘要
  const description = toolCall.summary
    ?? (category === "bash" ? extractBashCommand(toolCall.input) : null)
    ?? (category === "read" || category === "write" ? extractFilePath(toolCall.input) : null)
    ?? (category === "agent" ? extractAgentDescription(toolCall.input) : null)
    ?? null;

  return (
    <div className="my-0.5">
      {/* Header — 可点击展开 */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/50 transition-colors"
      >
        {/* 工具图标 */}
        {isRunning ? <Loader2 className="size-3.5 animate-spin text-blue-500" /> : isPending ? <div className="size-3.5 rounded-full border-2 border-yellow-400" /> : <ToolIcon category={category} status={toolCall.status} />}

        {/* 工具名 */}
        <span className="text-xs font-medium text-foreground shrink-0">{toolCall.toolName}</span>

        {/* 描述摘要 */}
        {description && (
          <span className="flex-1 truncate text-xs text-muted-foreground" title={description}>
            {description}
          </span>
        )}
        {!description && <span className="flex-1" />}

        {/* 子代理调用数 */}
        {toolCall.childCallCount != null && toolCall.childCallCount > 0 && (
          <span className="text-[10px] text-muted-foreground">{toolCall.childCallCount} calls</span>
        )}

        {/* 耗时 */}
        {typeof toolCall.durationMs === "number" && (
          <span className="text-[10px] text-muted-foreground shrink-0">{formatDuration(toolCall.durationMs)}</span>
        )}

        {/* 展开箭头 */}
        {expanded ? <ChevronDown className="size-3 text-muted-foreground shrink-0" /> : <ChevronRight className="size-3 text-muted-foreground shrink-0" />}
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="ml-6 mt-1 space-y-1.5 rounded-md border border-border bg-muted/10 p-2.5 text-xs">
          {/* Bash 终端风格 */}
          {category === "bash" && extractBashCommand(toolCall.input) && (
            <pre className="rounded bg-gray-900 px-2.5 py-1.5 text-[11px] text-green-400 font-mono overflow-x-auto">
              <span className="text-gray-500">$ </span>{extractBashCommand(toolCall.input)}
            </pre>
          )}

          {/* 文件路径 */}
          {(category === "read" || category === "write") && extractFilePath(toolCall.input) && (
            <div className="flex items-center gap-1.5">
              <FileText className="size-3 text-muted-foreground" />
              <code className="text-[11px] text-muted-foreground">{extractFilePath(toolCall.input)}</code>
            </div>
          )}

          {/* Agent 描述 */}
          {category === "agent" && extractAgentDescription(toolCall.input) && (
            <div className="flex items-center gap-1.5">
              <Bot className="size-3 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">{extractAgentDescription(toolCall.input)}</span>
            </div>
          )}

          {/* 通用输入（非 bash/file/agent） */}
          {category === "other" && toolCall.input !== undefined && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">输入</span>
              <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground max-h-32">{JSON.stringify(toolCall.input, null, 2)}</pre>
            </div>
          )}

          {/* 输出 */}
          {toolCall.output && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">输出</span>
              <pre className="mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] rounded bg-muted/50 px-2 py-1.5">{toolCall.output}</pre>
            </div>
          )}

          {/* 错误 */}
          {toolCall.error && (
            <div className="rounded bg-red-500/10 px-2 py-1.5 text-red-600 dark:text-red-400">
              <span className="font-medium">错误：</span>{toolCall.error}
            </div>
          )}

          {/* 结果（无 output 和 error 时） */}
          {toolCall.result !== undefined && !toolCall.output && !toolCall.error && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">结果</span>
              <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">{JSON.stringify(toolCall.result, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
