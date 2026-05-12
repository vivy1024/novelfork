import { useState, useMemo } from "react";
import { Check, X, ChevronDown, ChevronRight, Loader2, Terminal, Eye, Search, Globe, Bot, HelpCircle, Pencil, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";

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

// ---------------------------------------------------------------------------
// 工具分类与颜色映射（对标 NarraFork）
// ---------------------------------------------------------------------------

const BASH_TOOLS = new Set(["Bash", "Shell", "Execute", "Terminal"]);
const READ_TOOLS = new Set(["Read", "WebSearch", "WebFetch"]);
const SEARCH_TOOLS = new Set(["Glob", "Grep", "Find"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "create_file", "edit_file", "write_file"]);
const BROWSER_TOOLS = new Set(["Browser"]);
const AGENT_TOOLS = new Set(["Agent", "Task", "Send", "Await", "TeamStatus", "TaskCreate"]);
const QUESTION_TOOLS = new Set(["AskUserQuestion", "UserQuestionGate"]);

type ToolCategory = "bash" | "read" | "search" | "write" | "browser" | "agent" | "question" | "other";

function getToolCategory(toolName: string): ToolCategory {
  if (BASH_TOOLS.has(toolName)) return "bash";
  if (READ_TOOLS.has(toolName)) return "read";
  if (SEARCH_TOOLS.has(toolName)) return "search";
  if (WRITE_TOOLS.has(toolName)) return "write";
  if (BROWSER_TOOLS.has(toolName)) return "browser";
  if (AGENT_TOOLS.has(toolName)) return "agent";
  if (QUESTION_TOOLS.has(toolName)) return "question";
  return "other";
}

/** NarraFork 风格颜色映射 — 对标实测 */
const CATEGORY_COLORS: Record<ToolCategory, { bg: string; text: string }> = {
  bash:     { bg: "bg-orange-500/15", text: "text-orange-600 dark:text-orange-400" },
  read:     { bg: "bg-lime-500/15",   text: "text-lime-600 dark:text-lime-400" },
  search:   { bg: "bg-cyan-500/15",   text: "text-cyan-600 dark:text-cyan-400" },
  write:    { bg: "bg-violet-500/15",  text: "text-violet-600 dark:text-violet-400" },
  browser:  { bg: "bg-teal-500/15",   text: "text-teal-600 dark:text-teal-400" },
  agent:    { bg: "bg-blue-500/15",   text: "text-blue-600 dark:text-blue-400" },
  question: { bg: "bg-amber-500/15",  text: "text-amber-600 dark:text-amber-400" },
  other:    { bg: "bg-gray-500/15",   text: "text-gray-600 dark:text-gray-400" },
};

function ToolIconBadge({ category }: { category: ToolCategory }) {
  const colors = CATEGORY_COLORS[category];
  const iconClass = "size-2.5";

  const icon = (() => {
    switch (category) {
      case "bash": return <Terminal className={iconClass} />;
      case "read": return <Eye className={iconClass} />;
      case "search": return <Search className={iconClass} />;
      case "write": return <Pencil className={iconClass} />;
      case "browser": return <Globe className={iconClass} />;
      case "agent": return <Bot className={iconClass} />;
      case "question": return <HelpCircle className={iconClass} />;
      default: return <FileText className={iconClass} />;
    }
  })();

  return (
    <span className={`inline-flex items-center justify-center size-4 rounded-sm shrink-0 ${colors.bg} ${colors.text}`}>
      {icon}
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

// ---------------------------------------------------------------------------
// Input extractors
// ---------------------------------------------------------------------------

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
  const path = typeof record.file_path === "string" ? record.file_path
    : typeof record.path === "string" ? record.path
    : typeof record.filePath === "string" ? record.filePath
    : null;
  if (!path) return null;
  // 附加参数说明（如 offset/limit/pages）
  const extras: string[] = [];
  if (typeof record.offset === "number") extras.push(`${record.offset}`);
  if (typeof record.limit === "number") extras.push(`~${record.offset ? Number(record.offset) + Number(record.limit) : record.limit}`);
  if (typeof record.pages === "string") extras.push(`p${record.pages}`);
  return extras.length > 0 ? `${path} (${extras.join("")})` : path;
}

function extractGrepPattern(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  return typeof record.pattern === "string" ? record.pattern
    : typeof record.query === "string" ? record.query
    : null;
}

function extractGrepPath(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  return typeof record.path === "string" ? record.path : null;
}

function extractBrowserAction(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  return typeof record.action === "string" ? record.action : null;
}

function extractBrowserUrl(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  return typeof record.url === "string" ? record.url : null;
}

function extractAgentDescription(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  return typeof record.description === "string" ? record.description
    : typeof record.prompt === "string" ? record.prompt.slice(0, 80)
    : null;
}

function extractEditStrings(input: unknown): { oldStr: string; newStr: string } | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (typeof record.old_string === "string" && typeof record.new_string === "string") {
    return { oldStr: record.old_string, newStr: record.new_string };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 描述摘要生成
// ---------------------------------------------------------------------------

function getDescription(toolCall: ConversationToolCall, category: ToolCategory): string | null {
  // 折叠态只显示输入参数的描述，不显示输出/结果摘要
  // summary 仅在无法从 input 提取描述时作为 fallback
  switch (category) {
    case "bash":
      return extractBashCommand(toolCall.input) ?? toolCall.summary ?? null;
    case "read":
      return extractFilePath(toolCall.input) ?? toolCall.summary ?? null;
    case "search": {
      const pattern = extractGrepPattern(toolCall.input);
      const path = extractGrepPath(toolCall.input);
      if (pattern && path) return `${pattern} in ${path.split(/[/\\]/).pop()}`;
      return pattern ?? toolCall.summary ?? null;
    }
    case "write":
      return extractFilePath(toolCall.input) ?? toolCall.summary ?? null;
    case "browser": {
      const action = extractBrowserAction(toolCall.input);
      const url = extractBrowserUrl(toolCall.input);
      if (action && url) return `${action}: ${url}`;
      return action ?? toolCall.summary ?? null;
    }
    case "agent":
      return extractAgentDescription(toolCall.input) ?? toolCall.summary ?? null;
    default:
      return toolCall.summary ?? null;
  }
}

// ---------------------------------------------------------------------------
// ToolCallCard — 对标 NarraFork 风格，使用 shadcn 组件
// ---------------------------------------------------------------------------

export function ToolCallCard({ toolCall }: { toolCall: ConversationToolCall; onOpenArtifact?: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const category = getToolCategory(toolCall.toolName);
  const colors = CATEGORY_COLORS[category];

  const isRunning = toolCall.status === "running";
  const isPending = toolCall.status === "pending";
  const isError = toolCall.status === "error";
  const isSuccess = toolCall.status === "success";

  const description = getDescription(toolCall, category);

  return (
    <div className="my-1 rounded-lg border border-border overflow-hidden">
      {/* Header — NarraFork 风格：带边框卡片，紧凑行 */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left cursor-pointer hover:bg-muted/30 transition-colors overflow-hidden"
      >
        {/* 工具图标（彩色圆形背景） */}
        {isRunning ? (
          <span className="inline-flex items-center justify-center size-4 shrink-0">
            <Loader2 className="size-3 animate-spin text-blue-500" />
          </span>
        ) : isPending ? (
          <span className="inline-flex items-center justify-center size-4 shrink-0">
            <span className="size-2.5 rounded-full border-2 border-yellow-400" />
          </span>
        ) : (
          <ToolIconBadge category={category} />
        )}

        {/* 工具名 — 等宽粗体 */}
        <span className={`text-xs font-semibold font-mono shrink-0 ${colors.text}`}>
          {toolCall.toolName}
        </span>

        {/* 描述摘要 — 等宽 truncate */}
        {description ? (
          <span className="flex-1 min-w-0 truncate text-xs font-mono text-muted-foreground" title={description}>
            {description}
          </span>
        ) : (
          <span className="flex-1" />
        )}

        {/* 子代理调用数 */}
        {toolCall.childCallCount != null && toolCall.childCallCount > 0 && (
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{toolCall.childCallCount} calls</Badge>
        )}

        {/* 状态图标 + 耗时 */}
        <span className="flex items-center gap-1 shrink-0">
          {isSuccess && <Check className="size-3 text-green-600" />}
          {isError && <X className="size-3 text-red-500" />}
          {typeof toolCall.durationMs === "number" && (
            <span className="text-[10px] text-muted-foreground">{formatDuration(toolCall.durationMs)}</span>
          )}
        </span>

        {/* 展开箭头 */}
        {expanded
          ? <ChevronDown className="size-3 text-muted-foreground shrink-0" />
          : <ChevronRight className="size-3 text-muted-foreground shrink-0" />}
      </button>

      {/* 展开内容 */}
      {expanded && (
        <ToolCallExpanded toolCall={toolCall} category={category} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolCallExpanded — 按工具类型渲染展开内容
// ---------------------------------------------------------------------------

function ToolCallExpanded({ toolCall, category }: { toolCall: ConversationToolCall; category: ToolCategory }) {
  return (
    <div className="px-3 py-2 space-y-2 text-xs overflow-hidden">
      {/* Bash 终端风格 */}
      {category === "bash" && <BashExpanded toolCall={toolCall} />}

      {/* Read 工具 — 文件路径 + 代码内容 */}
      {category === "read" && <ReadExpanded toolCall={toolCall} />}

      {/* Search (Grep/Glob) — 搜索词 badge + 结果列表 */}
      {category === "search" && <SearchExpanded toolCall={toolCall} />}

      {/* Write/Edit — 文件路径 + diff */}
      {category === "write" && <WriteExpanded toolCall={toolCall} />}

      {/* Browser — action badge + 截图 */}
      {category === "browser" && <BrowserExpanded toolCall={toolCall} />}

      {/* Agent — 描述 + 输出 */}
      {category === "agent" && <AgentExpanded toolCall={toolCall} />}

      {/* 通用 fallback */}
      {category === "other" && <GenericExpanded toolCall={toolCall} />}
      {category === "question" && <GenericExpanded toolCall={toolCall} />}

      {/* 错误（所有类型通用） */}
      {toolCall.error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
          <span className="font-medium">错误：</span>{toolCall.error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bash 展开
// ---------------------------------------------------------------------------

function BashExpanded({ toolCall }: { toolCall: ConversationToolCall }) {
  const command = extractBashCommand(toolCall.input);
  return (
    <>
      {command && (
        <pre className="rounded-md bg-gray-900 dark:bg-gray-950 px-3 py-2 text-[11px] text-gray-100 font-mono overflow-x-auto">
          <span className="text-gray-500 select-none">$ </span>{command}
        </pre>
      )}
      {toolCall.output && (
        <div className="space-y-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">输出</span>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-[11px] font-mono">
            {toolCall.output}
          </pre>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Read 展开 — 文件路径 + 代码内容（带行号）
// ---------------------------------------------------------------------------

function ReadExpanded({ toolCall }: { toolCall: ConversationToolCall }) {
  const filePath = extractFilePath(toolCall.input);
  return (
    <>
      {filePath && (
        <code className="block text-[10px] text-muted-foreground font-mono truncate" title={filePath}>
          {filePath}
        </code>
      )}
      {toolCall.output && (
        <pre className="max-h-72 overflow-auto rounded-md border border-border bg-background px-3 py-2 text-[11px] font-mono leading-relaxed">
          {toolCall.output}
        </pre>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Search (Grep/Glob) 展开 — 搜索词 badge + 路径 + 结果
// ---------------------------------------------------------------------------

function SearchExpanded({ toolCall }: { toolCall: ConversationToolCall }) {
  const pattern = extractGrepPattern(toolCall.input);
  const searchPath = extractGrepPath(toolCall.input);
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {pattern && (
          <Badge variant="secondary" className="h-5 font-mono text-[10px]">
            {pattern}
          </Badge>
        )}
        {searchPath && (
          <span className="text-[10px] text-muted-foreground font-mono">in {searchPath}</span>
        )}
      </div>
      {toolCall.output && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-[11px] font-mono">
          {toolCall.output}
        </pre>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Write/Edit 展开 — 文件路径 + diff 渲染
// ---------------------------------------------------------------------------

function WriteExpanded({ toolCall }: { toolCall: ConversationToolCall }) {
  const filePath = extractFilePath(toolCall.input);
  const editStrings = extractEditStrings(toolCall.input);

  const diffLines = useMemo(() => {
    if (!editStrings) return null;
    const { oldStr, newStr } = editStrings;
    const oldLines = oldStr.split("\n");
    const newLines = newStr.split("\n");
    const lines: { type: "remove" | "add"; content: string }[] = [];
    for (const line of oldLines) lines.push({ type: "remove", content: line });
    for (const line of newLines) lines.push({ type: "add", content: line });
    return lines;
  }, [editStrings]);

  return (
    <>
      {filePath && (
        <code className="block text-[10px] text-muted-foreground font-mono truncate" title={filePath}>
          {filePath}
        </code>
      )}
      {diffLines && (
        <div className="rounded-md border border-border overflow-hidden text-[11px] font-mono leading-relaxed">
          {diffLines.map((line, i) => (
            <div
              key={i}
              className={
                line.type === "remove" ? "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 px-3 py-px"
                : "bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300 px-3 py-px"
              }
            >
              <span className="inline-block w-4 text-right text-muted-foreground/60 select-none mr-2">
                {line.type === "remove" ? "−" : "+"}
              </span>
              {line.content}
            </div>
          ))}
        </div>
      )}
      {!diffLines && toolCall.output && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-[11px] font-mono">
          {toolCall.output}
        </pre>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Browser 展开 — action badge + 截图内嵌
// ---------------------------------------------------------------------------

function BrowserExpanded({ toolCall }: { toolCall: ConversationToolCall }) {
  const action = extractBrowserAction(toolCall.input);
  const url = extractBrowserUrl(toolCall.input);
  const input = toolCall.input as Record<string, unknown> | undefined;
  const sessionId = typeof input?.session_id === "string" ? input.session_id : null;

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        {action && (
          <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-medium uppercase">
            {action}
          </Badge>
        )}
        {sessionId && (
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-mono">
            {sessionId.slice(0, 8)}
          </Badge>
        )}
        {url && (
          <span className="text-[10px] text-muted-foreground font-mono truncate">{url}</span>
        )}
      </div>
      {toolCall.output && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-[11px] font-mono">
          {toolCall.output}
        </pre>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Agent 展开
// ---------------------------------------------------------------------------

function AgentExpanded({ toolCall }: { toolCall: ConversationToolCall }) {
  const desc = extractAgentDescription(toolCall.input);
  return (
    <>
      {desc && (
        <div className="flex items-center gap-1.5">
          <Bot className="size-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] text-muted-foreground">{desc}</span>
        </div>
      )}
      {toolCall.output && (
        <div className="space-y-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">输出</span>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-[11px] font-mono">
            {toolCall.output}
          </pre>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Generic 展开 (fallback)
// ---------------------------------------------------------------------------

function GenericExpanded({ toolCall }: { toolCall: ConversationToolCall }) {
  return (
    <>
      {toolCall.input !== undefined && (
        <div className="space-y-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">输入</span>
          <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground max-h-32">
            {JSON.stringify(toolCall.input, null, 2)}
          </pre>
        </div>
      )}
      {toolCall.output && (
        <div className="space-y-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">输出</span>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px] rounded-md bg-muted/40 px-3 py-2">
            {toolCall.output}
          </pre>
        </div>
      )}
      {toolCall.result !== undefined && !toolCall.output && !toolCall.error && (
        <div className="space-y-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">结果</span>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
            {JSON.stringify(toolCall.result, null, 2)}
          </pre>
        </div>
      )}
    </>
  );
}
