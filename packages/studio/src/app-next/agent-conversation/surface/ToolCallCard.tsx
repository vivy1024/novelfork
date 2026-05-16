import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense, type CSSProperties } from "react";
import { Check, X, ChevronDown, ChevronRight, Loader2, Terminal, Eye, Search, Globe, Bot, HelpCircle, Pencil, FileText, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";

// Lazy-load syntax highlighter to avoid blocking initial render
const SyntaxHighlighter = lazy(() => import("react-syntax-highlighter"));
const syntaxStylePromise = import("react-syntax-highlighter/dist/esm/styles/hljs").then((mod) => mod.vs2015);


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
  /** 工具超时上限（毫秒） */
  timeoutMs?: number;
  /** 子代理调用数 */
  childCallCount?: number;
  /** 子代理工具调用链（嵌套渲染） */
  childCalls?: ConversationToolCall[];
  /** 工具开始执行时间戳（Unix ms，用于实时计时） */
  startedAt?: number;
  /** @internal 流式输出缓冲（运行时） */
  _streamingOutput?: string;
  /** @internal 流式输入缓冲（工具参数流入时） */
  _streamingInput?: string;
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
const NOVEL_AUDIT_TOOLS = new Set(["chapter.audit", "presets.check_compliance"]);

type ToolCategory = "bash" | "read" | "search" | "write" | "browser" | "agent" | "question" | "novel-audit" | "other";

function getToolCategory(toolName: string): ToolCategory {
  if (BASH_TOOLS.has(toolName)) return "bash";
  if (READ_TOOLS.has(toolName)) return "read";
  if (SEARCH_TOOLS.has(toolName)) return "search";
  if (WRITE_TOOLS.has(toolName)) return "write";
  if (BROWSER_TOOLS.has(toolName)) return "browser";
  if (AGENT_TOOLS.has(toolName)) return "agent";
  if (QUESTION_TOOLS.has(toolName)) return "question";
  if (NOVEL_AUDIT_TOOLS.has(toolName)) return "novel-audit";
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
  "novel-audit": { bg: "bg-rose-500/15", text: "text-rose-600 dark:text-rose-400" },
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
      case "novel-audit": return <ShieldAlert className={iconClass} />;
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
// TruncatedOutput — 超过 MAX_LINES 行时截断，显示"展开全部"按钮
// ---------------------------------------------------------------------------

const OUTPUT_MAX_LINES = 50;

function TruncatedOutput({ content, className }: { content: string; className?: string }) {
  const [showAll, setShowAll] = useState(false);
  const lines = content.split("\n");
  const isTruncated = lines.length > OUTPUT_MAX_LINES;
  const displayContent = !showAll && isTruncated
    ? lines.slice(0, OUTPUT_MAX_LINES).join("\n")
    : content;

  return (
    <div className="relative">
      <pre className={className}>
        {displayContent}
        {!showAll && isTruncated && (
          <span className="text-muted-foreground/60">{"\n"}… ({lines.length - OUTPUT_MAX_LINES} 行已隐藏)</span>
        )}
      </pre>
      {isTruncated && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="mt-1 text-[10px] text-blue-500 hover:text-blue-400 cursor-pointer"
        >
          {showAll ? "收起" : `显示全部 (${lines.length} 行)`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolCallGroup — 同一消息中多个同类工具的分组渲染
// ---------------------------------------------------------------------------

export function ToolCallGroup({ toolCalls, toolName }: { toolCalls: ConversationToolCall[]; toolName: string }) {
  const [expanded, setExpanded] = useState(false);
  const category = getToolCategory(toolName);
  const colors = CATEGORY_COLORS[category];
  const allDone = toolCalls.every((tc) => tc.status === "success" || tc.status === "error");
  const errorCount = toolCalls.filter((tc) => tc.status === "error").length;
  const totalDuration = toolCalls.reduce((sum, tc) => sum + (tc.durationMs ?? 0), 0);

  return (
    <div className={`my-1 rounded-lg border border-border overflow-hidden ${allDone ? (errorCount > 0 ? "tool-card-error" : "tool-card-done") : "tool-card-running"}`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left cursor-pointer hover:bg-muted/30 transition-colors"
      >
        <ToolIconBadge category={category} />
        <span className={`text-xs font-semibold font-mono shrink-0 ${colors.text}`}>
          {toolName}
        </span>
        <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">×{toolCalls.length}</Badge>
        <span className="flex-1" />
        {allDone && (
          <span className="flex items-center gap-1 shrink-0">
            {errorCount > 0 ? <X className="size-3 text-red-500" /> : <Check className="size-3 text-green-600" />}
            {totalDuration > 0 && (
              <span className="text-[10px] text-muted-foreground">{formatDuration(totalDuration)}</span>
            )}
          </span>
        )}
        {expanded
          ? <ChevronDown className="size-3 text-muted-foreground shrink-0" />
          : <ChevronRight className="size-3 text-muted-foreground shrink-0" />}
      </button>
      {expanded && (
        <div className="px-2 pb-2 space-y-1">
          {toolCalls.map((tc) => (
            <ToolCallCard key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}
    </div>
  );
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
      if (pattern) return toolCall.toolName === "Glob" ? `Glob: ${pattern}` : pattern;
      return toolCall.summary ?? null;
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

export function ToolCallCard({ toolCall, forceCollapsed = false }: { toolCall: ConversationToolCall; onOpenArtifact?: unknown; forceCollapsed?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const effectiveExpanded = expanded && !forceCollapsed;
  const [longRunning, setLongRunning] = useState(false);
  const category = getToolCategory(toolCall.toolName);
  const colors = CATEGORY_COLORS[category];

  const isRunning = toolCall.status === "running";
  const isPending = toolCall.status === "pending";
  const isError = toolCall.status === "error";
  const isSuccess = toolCall.status === "success";

  // Long-running notification: show after 10s with no result
  useEffect(() => {
    if (!isRunning && !isPending) {
      setLongRunning(false);
      return;
    }
    const timer = setTimeout(() => setLongRunning(true), 10000);
    return () => clearTimeout(timer);
  }, [isRunning, isPending]);

  // Auto-expand running Bash tools to show streaming output
  useEffect(() => {
    if (isRunning && category === "bash") {
      setExpanded(true);
    }
  }, [isRunning, category]);

  const description = getDescription(toolCall, category);

  // Status animation class (对标 NarraFork .tool-running-shimmer / .tool-done-shimmer)
  const statusAnimClass = isRunning ? "tool-card-running"
    : isPending ? "tool-card-pending"
    : isError ? "tool-card-error"
    : isSuccess ? "tool-card-done"
    : "";

  return (
    <div className={`my-1 rounded-lg border border-border overflow-hidden ${statusAnimClass}`}>
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

        {/* 长时间运行提示 */}
        {longRunning && (isRunning || isPending) && (
          <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 shrink-0">
            <Loader2 className="size-3 animate-spin" />
            仍在执行中...
          </span>
        )}

        {/* 状态图标 + 耗时 */}
        <span className="flex items-center gap-1 shrink-0">
          {isSuccess && <Check className="size-3 text-green-600" />}
          {isError && <X className="size-3 text-red-500" />}
          {typeof toolCall.durationMs === "number" && (
            <span className="text-[10px] text-muted-foreground">
              {formatDuration(toolCall.durationMs)}{toolCall.timeoutMs ? ` / ${formatDuration(toolCall.timeoutMs)}` : ""}
            </span>
          )}
        </span>

        {/* 展开箭头 */}
        {effectiveExpanded
          ? <ChevronDown className="size-3 text-muted-foreground shrink-0" />
          : <ChevronRight className="size-3 text-muted-foreground shrink-0" />}
      </button>

      {/* 展开内容 */}
      {effectiveExpanded && (
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

      {/* Novel audit — AI味高亮 + 审计结果 */}
      {category === "novel-audit" && <NovelAuditExpanded toolCall={toolCall} />}

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
// Bash 展开 — 实时流式进度 + 自动滚动 + 行数统计
// ---------------------------------------------------------------------------

/** 实时计时器 hook：从 startedAt 开始每秒更新 */
function useElapsedTimer(startedAt?: number, isRunning?: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isRunning || !startedAt) {
      setElapsed(0);
      return;
    }
    const update = () => setElapsed(Date.now() - startedAt);
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt, isRunning]);
  return elapsed;
}

function BashExpanded({ toolCall }: { toolCall: ConversationToolCall }) {
  const command = extractBashCommand(toolCall.input);
  const streamingOutput = toolCall._streamingOutput;
  const displayOutput = toolCall.output || streamingOutput;
  const isRunning = toolCall.status === "running";
  const outputRef = useRef<HTMLPreElement>(null);

  // Real-time elapsed timer
  const elapsedMs = useElapsedTimer(toolCall.startedAt, isRunning);

  // Auto-scroll to bottom when streaming output updates
  useEffect(() => {
    if (isRunning && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [streamingOutput, isRunning]);

  // Line count & byte count for streaming progress
  const lineCount = displayOutput ? displayOutput.split("\n").length : 0;
  const byteCount = displayOutput ? new Blob([displayOutput]).size : 0;

  return (
    <>
      {command && (
        <pre className="rounded-md bg-gray-900 dark:bg-gray-950 px-3 py-2 text-[11px] text-gray-100 font-mono overflow-x-auto">
          <span className="text-gray-500 select-none">$ </span>{command}
        </pre>
      )}
      {/* Streaming progress bar */}
      {isRunning && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin text-blue-500" />
          <span>{formatDuration(elapsedMs)}</span>
          {toolCall.timeoutMs && (
            <span className="text-muted-foreground/60">/ {formatDuration(toolCall.timeoutMs)}</span>
          )}
          {lineCount > 0 && <span>· {lineCount} 行</span>}
          {byteCount > 1024 && <span>· {(byteCount / 1024).toFixed(1)} KB</span>}
        </div>
      )}
      {displayOutput && (
        <div className="space-y-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {toolCall.output ? "输出" : "实时输出"}
          </span>
          {isRunning ? (
            <pre
              ref={outputRef}
              className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-[11px] font-mono"
            >
              {displayOutput}
            </pre>
          ) : (
            <TruncatedOutput
              content={displayOutput}
              className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-[11px] font-mono"
            />
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Read 展开 — 文件路径 + 代码内容（带行号）
// ---------------------------------------------------------------------------

function inferLanguageClass(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "language-typescript", tsx: "language-typescript",
    js: "language-javascript", jsx: "language-javascript",
    json: "language-json", md: "language-markdown",
    css: "language-css", scss: "language-css",
    html: "language-html", xml: "language-xml",
    py: "language-python", rs: "language-rust",
    go: "language-go", sql: "language-sql",
    yaml: "language-yaml", yml: "language-yaml",
    sh: "language-bash", bash: "language-bash",
    toml: "language-toml",
  };
  return map[ext] ?? "";
}

/** Map language-* class to highlight.js language name */
function langClassToName(langClass: string): string | undefined {
  if (!langClass) return undefined;
  return langClass.replace("language-", "") || undefined;
}

function ReadExpanded({ toolCall }: { toolCall: ConversationToolCall }) {
  const filePath = extractFilePath(toolCall.input);
  const langClass = filePath ? inferLanguageClass(filePath) : "";
  const language = langClassToName(langClass);
  const [syntaxStyle, setSyntaxStyle] = useState<Record<string, CSSProperties> | null>(null);

  useEffect(() => {
    syntaxStylePromise.then(setSyntaxStyle).catch(() => {});
  }, []);

  // WebSearch / WebFetch 特殊处理
  if (toolCall.toolName === "WebSearch" || toolCall.toolName === "WebFetch") {
    return <WebSearchExpanded toolCall={toolCall} />;
  }

  // 尝试从 output 或 result 中获取内容
  const outputContent = toolCall.output
    ?? (typeof toolCall.result === "string" ? toolCall.result : null)
    ?? (toolCall.result && typeof toolCall.result === "object" && "content" in (toolCall.result as Record<string, unknown>)
      ? String((toolCall.result as Record<string, unknown>).content)
      : null)
    ?? (toolCall.result ? JSON.stringify(toolCall.result, null, 2) : null);

  const canHighlight = language && syntaxStyle && outputContent;

  return (
    <>
      {filePath && (
        <code className="block text-[10px] text-muted-foreground font-mono truncate" title={filePath}>
          {filePath}
        </code>
      )}
      {outputContent && (
        canHighlight ? (
          <Suspense fallback={
            <pre className={`max-h-72 overflow-auto rounded-md border border-border bg-background px-3 py-2 text-[11px] font-mono leading-relaxed ${langClass}`}>
              {outputContent}
            </pre>
          }>
            <SyntaxHighlighter
              language={language}
              style={syntaxStyle}
              customStyle={{ maxHeight: "18rem", overflow: "auto", borderRadius: "0.375rem", padding: "0.5rem 0.75rem", fontSize: "11px", lineHeight: "1.625", margin: 0 }}
              showLineNumbers
              lineNumberStyle={{ minWidth: "2em", paddingRight: "0.75em", color: "rgba(128,128,128,0.5)", userSelect: "none" }}
            >
              {outputContent}
            </SyntaxHighlighter>
          </Suspense>
        ) : (
          <TruncatedOutput
            content={outputContent}
            className="max-h-72 overflow-auto rounded-md border border-border bg-background px-3 py-2 text-[11px] font-mono leading-relaxed whitespace-pre-wrap"
          />
        )
      )}
      {!outputContent && toolCall.status === "success" && (
        <span className="text-[10px] text-muted-foreground italic">（无输出内容）</span>
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
  const isGlob = toolCall.toolName === "Glob" || toolCall.toolName === "Find";

  // 尝试从 output 或 result 获取内容
  const outputContent = toolCall.output
    ?? (typeof toolCall.result === "string" ? toolCall.result : null)
    ?? (toolCall.result && typeof toolCall.result === "object" ? JSON.stringify(toolCall.result, null, 2) : null);

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {pattern && (
          <Badge variant="secondary" className="h-5 font-mono text-[10px]">
            <Search className="size-2.5 mr-1" />
            {pattern}
          </Badge>
        )}
        {searchPath && (
          <span className="text-[10px] text-muted-foreground font-mono">in {searchPath}</span>
        )}
      </div>
      {outputContent && (
        isGlob ? (
          /* Glob: 匹配路径列表，每行一个 */
          <div className="max-h-48 overflow-auto rounded-md bg-muted/40 px-3 py-2">
            {outputContent.split("\n").filter(Boolean).map((line, i) => (
              <div key={i} className="text-[11px] font-mono text-muted-foreground py-px truncate" title={line}>
                {line}
              </div>
            ))}
          </div>
        ) : (
          /* Grep: file:line:content 格式 */
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-[11px] font-mono">
            {outputContent}
          </pre>
        )
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
  const isWrite = toolCall.toolName === "Write" || toolCall.toolName === "create_file" || toolCall.toolName === "write_file";
  const isRunning = toolCall.status === "running";
  const streamingInput = toolCall._streamingInput;
  const outputRef = useRef<HTMLPreElement>(null);

  // Auto-scroll streaming input
  useEffect(() => {
    if (isRunning && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [streamingInput, isRunning]);

  // Extract write content from input
  const writeContent = useMemo(() => {
    if (!isWrite || !toolCall.input || typeof toolCall.input !== "object") return null;
    const record = toolCall.input as Record<string, unknown>;
    if (typeof record.content === "string") return record.content;
    return null;
  }, [isWrite, toolCall.input]);

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

  // Extract streaming content (file content being generated)
  const streamingContent = useMemo(() => {
    if (!isRunning || !streamingInput) return null;
    // Try to extract "content" field from partial JSON input
    const contentMatch = streamingInput.match(/"content"\s*:\s*"([\s\S]*)$/);
    if (contentMatch) {
      // Unescape JSON string (basic)
      return contentMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return null;
  }, [isRunning, streamingInput]);

  return (
    <>
      {filePath && (
        <code className="block text-[10px] text-muted-foreground font-mono truncate" title={filePath}>
          {filePath}
        </code>
      )}

      {/* Streaming: 实时显示正在生成的内容 */}
      {isRunning && streamingContent && (
        <div className="space-y-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider animate-pulse">生成中…</span>
          <pre ref={outputRef} className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] font-mono">
            {streamingContent}
          </pre>
        </div>
      )}

      {/* Edit: diff 渲染 */}
      {!isRunning && diffLines && (
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
      {/* Write: 写入内容 */}
      {!isRunning && !diffLines && writeContent && (
        <div className="space-y-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">写入内容</span>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background px-3 py-2 text-[11px] font-mono">
            {writeContent}
          </pre>
        </div>
      )}
      {/* Fallback: output */}
      {!isRunning && !diffLines && !writeContent && toolCall.output && (
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
      {/* 子代理工具调用链 — 嵌套渲染 */}
      {toolCall.childCalls && toolCall.childCalls.length > 0 && (
        <div className="ml-2 pl-2 border-l-2 border-blue-200 dark:border-blue-800 space-y-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            子调用 ({toolCall.childCalls.length})
          </span>
          {toolCall.childCalls.map((child) => (
            <ToolCallCard key={child.id} toolCall={child} />
          ))}
        </div>
      )}
      {toolCall.output && (
        <div className="space-y-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">输出</span>
          <TruncatedOutput
            content={toolCall.output}
            className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-[11px] font-mono"
          />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// WebSearch 展开 — query badge + 结果列表
// ---------------------------------------------------------------------------

function extractWebSearchQuery(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  return typeof record.query === "string" ? record.query
    : typeof record.q === "string" ? record.q
    : null;
}

function WebSearchExpanded({ toolCall }: { toolCall: ConversationToolCall }) {
  const query = extractWebSearchQuery(toolCall.input);
  return (
    <>
      {query && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="h-5 font-mono text-[10px]">
            <Globe className="size-2.5 mr-1" />
            {query}
          </Badge>
        </div>
      )}
      {toolCall.output && (
        <div className="max-h-60 overflow-auto rounded-md bg-muted/40 px-3 py-2 space-y-1">
          {toolCall.output.split("\n").filter(Boolean).map((line, i) => (
            <div key={i} className="text-[11px] text-muted-foreground">
              {line}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Generic 展开 (fallback)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Novel Audit 展开 — AI味标红 + 审计结果结构化展示
// ---------------------------------------------------------------------------

function NovelAuditExpanded({ toolCall }: { toolCall: ConversationToolCall }) {
  let parsed: Record<string, unknown> | null = null;
  try {
    if (toolCall.output) {
      parsed = JSON.parse(toolCall.output);
    }
  } catch { /* not JSON */ }

  if (!parsed) {
    return <GenericExpanded toolCall={toolCall} />;
  }

  const data = (parsed as { data?: Record<string, unknown> }).data ?? parsed;
  const results = (data as { results?: Record<string, unknown> }).results;
  const violations = (data as { violations?: Array<{ presetName: string; rule: string; violation: string; severity: string }> }).violations;

  // chapter.audit results
  if (results) {
    const aiTaste = results.ai_taste as { markersFound?: string[]; count?: number; severity?: string; highlights?: Array<{ marker: string; line: number; context: string }> } | undefined;
    const rhythm = results.rhythm as { totalLines?: number; dialogueLines?: number; dialogueRatio?: number } | undefined;
    const hooks = results.hooks as { dueHooks?: string[]; count?: number } | undefined;

    return (
      <div className="space-y-2">
        {/* AI 味检测结果 — 标红高亮 */}
        {aiTaste && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">AI 味检测</span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                aiTaste.severity === "high" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                aiTaste.severity === "medium" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" :
                "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              }`}>
                {aiTaste.severity === "high" ? "高风险" : aiTaste.severity === "medium" ? "中风险" : "低风险"}
                {aiTaste.count ? ` (${aiTaste.count} 处)` : ""}
              </span>
            </div>
            {aiTaste.highlights && aiTaste.highlights.length > 0 && (
              <div className="rounded-md bg-muted/40 px-3 py-2 space-y-1 max-h-48 overflow-y-auto">
                {aiTaste.highlights.map((h, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    <span className="shrink-0 text-muted-foreground tabular-nums">L{h.line}</span>
                    <span className="font-mono">
                      {h.context.split(h.marker).map((part, j, arr) => (
                        <span key={j}>
                          {part}
                          {j < arr.length - 1 && (
                            <mark className="bg-red-200 text-red-800 dark:bg-red-900/50 dark:text-red-300 px-0.5 rounded">{h.marker}</mark>
                          )}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {(!aiTaste.highlights || aiTaste.highlights.length === 0) && aiTaste.markersFound && aiTaste.markersFound.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {aiTaste.markersFound.map((m, i) => (
                  <span key={i} className="inline-flex items-center rounded bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px] text-red-700 dark:text-red-400">
                    {m}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 节奏分析 */}
        {rhythm && (
          <div className="space-y-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">段落节奏</span>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span>总行数: {rhythm.totalLines}</span>
              <span>对话行: {rhythm.dialogueLines}</span>
              <span>对话比: {rhythm.dialogueRatio}%</span>
            </div>
          </div>
        )}

        {/* 伏笔到期 */}
        {hooks && hooks.count !== undefined && hooks.count > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">伏笔到期 ({hooks.count})</span>
            <div className="rounded-md bg-muted/40 px-3 py-2 space-y-0.5">
              {hooks.dueHooks?.map((h, i) => (
                <div key={i} className="text-[11px] text-muted-foreground">• {h}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // presets.check_compliance results
  if (violations) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">合规检查</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
            violations.length > 0 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          }`}>
            {violations.length > 0 ? `${violations.length} 处违规` : "全部通过"}
          </span>
        </div>
        {violations.length > 0 && (
          <div className="rounded-md bg-muted/40 px-3 py-2 space-y-1.5 max-h-48 overflow-y-auto">
            {violations.map((v, i) => (
              <div key={i} className="text-[11px] space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className={`size-1.5 rounded-full ${v.severity === "error" ? "bg-red-500" : "bg-yellow-500"}`} />
                  <span className="font-medium">{v.presetName}</span>
                  <span className="text-muted-foreground">— {v.rule}</span>
                </div>
                <div className="pl-3 text-muted-foreground">{v.violation}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return <GenericExpanded toolCall={toolCall} />;
}

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
