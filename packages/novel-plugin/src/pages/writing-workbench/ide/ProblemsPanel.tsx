/**
 * ProblemsPanel — VS Code 风格的"问题"面板
 *
 * 功能：
 * - 标题栏：图标 + "问题" + 问题计数 + 折叠按钮
 * - 内容：问题列表（severity 图标 + 行号 + 消息 + 来源文件）
 * - 高度可拖拽调整（顶部 resize handle）
 * - 默认折叠，点击标题栏展开
 * - 点击问题条目 → 回调
 */
import { useState, useRef, useCallback, useMemo } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IssueSeverity = "error" | "warning" | "info";

export interface EditorIssue {
  id: string;
  severity: IssueSeverity;
  message: string;
  /** 行号（从 1 开始） */
  line?: number;
  /** 列号 */
  column?: number;
  /** 来源文件或来源标识 */
  source?: string;
}

export interface ProblemsPanelProps {
  issues: readonly EditorIssue[];
  /** 点击问题条目时回调（传入 issue） */
  onIssueClick?: (issue: EditorIssue) => void;
  /** 关闭面板（可选） */
  onClose?: () => void;
  /** 初始是否展开（默认 false = 折叠） */
  defaultExpanded?: boolean;
  /** 面板高度（默认 180） */
  defaultHeight?: number;
  /** 最小高度 */
  minHeight?: number;
  /** 最大高度 */
  maxHeight?: number;
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

const SEVERITY_ICON: Record<IssueSeverity, typeof AlertCircle> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_COLOR: Record<IssueSeverity, string> = {
  error: "text-red-500",
  warning: "text-yellow-500",
  info: "text-blue-400",
};

const SEVERITY_BG: Record<IssueSeverity, string> = {
  error: "hover:bg-red-500/5",
  warning: "hover:bg-yellow-500/5",
  info: "hover:bg-blue-400/5",
};

function severityLabel(severity: IssueSeverity): string {
  switch (severity) {
    case "error": return "错误";
    case "warning": return "警告";
    case "info": return "信息";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProblemsPanel({
  issues,
  onIssueClick,
  onClose,
  defaultExpanded = false,
  defaultHeight = 180,
  minHeight = 80,
  maxHeight = 500,
}: ProblemsPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [height, setHeight] = useState(defaultHeight);
  const resizeRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 按严重程度排序：error > warning > info
  const sorted = useMemo(() => {
    const order: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };
    return [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  }, [issues]);

  // 各级别计数
  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 };
    for (const issue of issues) c[issue.severity]++;
    return c;
  }, [issues]);

  // 拖拽调整高度
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = height;

      const onMove = (ev: MouseEvent) => {
        const delta = startY - ev.clientY;
        const newHeight = Math.max(minHeight, Math.min(maxHeight, startHeight + delta));
        setHeight(newHeight);
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
    },
    [height, minHeight, maxHeight],
  );

  return (
    <div
      ref={panelRef}
      className="flex flex-col border-t border-border bg-card shrink-0"
      style={{ height: expanded ? height : "auto" }}
    >
      {/* Resize handle（仅展开时显示） */}
      {expanded && (
        <div
          ref={resizeRef}
          className="shrink-0 h-1 cursor-ns-resize hover:bg-primary/20 transition-colors"
          onMouseDown={handleResizeStart}
        />
      )}

      {/* Title bar */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex h-8 shrink-0 items-center gap-2 px-3 border-b border-border bg-secondary/50 hover:bg-secondary/80 transition-colors text-left"
      >
        {/* Severity summary icons */}
        {counts.error > 0 && (
          <span className="flex items-center gap-0.5 text-[11px]">
            <AlertCircle className="size-3.5 text-red-500" />
            <span className="text-red-500 font-medium">{counts.error}</span>
          </span>
        )}
        {counts.warning > 0 && (
          <span className="flex items-center gap-0.5 text-[11px]">
            <AlertTriangle className="size-3.5 text-yellow-500" />
            <span className="text-yellow-500 font-medium">{counts.warning}</span>
          </span>
        )}
        {counts.info > 0 && (
          <span className="flex items-center gap-0.5 text-[11px]">
            <Info className="size-3.5 text-blue-400" />
            <span className="text-blue-400 font-medium">{counts.info}</span>
          </span>
        )}

        <span className="text-xs font-medium text-foreground">问题</span>
        <span className="text-[11px] text-muted-foreground">
          {issues.length > 0 ? `(${issues.length})` : ""}
        </span>

        {/* Expand/collapse + close */}
        <div className="ml-auto flex items-center gap-1">
          {onClose && (
            <span
              role="button"
              tabIndex={0}
              className="flex size-5 items-center justify-center rounded hover:bg-muted text-muted-foreground"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onClose?.(); } }}
              title="关闭面板"
            >
              <X className="size-3" />
            </span>
          )}
          {expanded ? (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronUp className="size-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Issue list（仅展开时渲染） */}
      {expanded && (
        <div className="flex-1 overflow-y-auto min-h-0">
          {sorted.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              暂无问题
            </div>
          ) : (
            <div className="py-0.5">
              {sorted.map((issue) => {
                const Icon = SEVERITY_ICON[issue.severity];
                return (
                  <button
                    key={issue.id}
                    type="button"
                    className={`flex w-full items-center gap-2 px-3 py-1 text-left text-xs transition-colors ${SEVERITY_BG[issue.severity]}`}
                    onClick={() => onIssueClick?.(issue)}
                  >
                    <Icon className={`size-3.5 shrink-0 ${SEVERITY_COLOR[issue.severity]}`} />
                    {issue.line != null && (
                      <span className="shrink-0 font-mono text-muted-foreground w-10 text-right">
                        {issue.line}
                        {issue.column != null ? `:${issue.column}` : ""}
                      </span>
                    )}
                    <span className="flex-1 truncate text-foreground">{issue.message}</span>
                    {issue.source && (
                      <span className="shrink-0 text-muted-foreground max-w-[120px] truncate">
                        {issue.source}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
