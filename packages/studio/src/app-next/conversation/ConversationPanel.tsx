/**
 * ConversationPanel — 右侧对话框
 *
 * 结构参考 NarraFork：
 * - 顶部：会话头（标题/详情/归档 + 图标按钮组）
 * - 中间：对话流 或 Git 变更视图（可切换）
 * - Git 状态栏
 * - 底部：输入区（上下文监控 + 模型/权限/推理 + 输入框）
 */

import { useState, type ReactNode } from "react";
import { Archive, Info, Pencil, Sparkles, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  ConversationHeader                                                 */
/* ------------------------------------------------------------------ */

export interface ConversationHeaderProps {
  readonly title: string;
  readonly onEditTitle?: () => void;
  readonly onGenerateTitle?: () => void;
  readonly onShowDetails?: () => void;
  readonly onArchive?: () => void;
}

export function ConversationHeader({
  title,
  onEditTitle,
  onGenerateTitle,
  onShowDetails,
  onArchive,
}: ConversationHeaderProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h3>
      <div className="flex shrink-0 items-center gap-0.5">
        {onEditTitle && (
          <button type="button" title="编辑标题" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onEditTitle}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {onGenerateTitle && (
          <button type="button" title="生成标题" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onGenerateTitle}>
            <Sparkles className="h-3.5 w-3.5" />
          </button>
        )}
        {onShowDetails && (
          <button type="button" title="会话详情" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onShowDetails}>
            <Info className="h-3.5 w-3.5" />
          </button>
        )}
        {onArchive && (
          <button type="button" title="归档" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onArchive}>
            <Archive className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  GitStatusBar                                                       */
/* ------------------------------------------------------------------ */

export interface GitStatusBarProps {
  readonly branch?: string;
  readonly additions?: number;
  readonly deletions?: number;
}

export function GitStatusBar({ branch, additions, deletions }: GitStatusBarProps) {
  if (!branch) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1 text-[10px] text-muted-foreground">
      <span>🏠</span>
      <span className="font-medium">{branch}</span>
      {(additions !== undefined || deletions !== undefined) && (
        <span>
          <span className="text-emerald-600">+{additions ?? 0}</span>
          {" "}
          <span className="text-destructive">-{deletions ?? 0}</span>
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  InputArea                                                          */
/* ------------------------------------------------------------------ */

export interface InputAreaProps {
  readonly onSend: (message: string) => void;
  readonly onAbort?: () => void;
  readonly isGenerating?: boolean;
  readonly disabled?: boolean;
  readonly contextPercent?: number;
  readonly modelLabel?: string;
  readonly permissionLabel?: string;
}

export function InputArea({
  onSend,
  onAbort,
  isGenerating = false,
  disabled = false,
  contextPercent,
  modelLabel,
  permissionLabel,
}: InputAreaProps) {
  const [value, setValue] = useState("");

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <div className="shrink-0 space-y-1.5 border-t border-border px-3 py-2">
      {/* 状态栏 */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        {contextPercent !== undefined && (
          <span className="flex items-center gap-1" title="上下文使用率">
            <span className={cn("inline-block h-2 w-2 rounded-full", contextPercent > 80 ? "bg-destructive" : contextPercent > 50 ? "bg-amber-500" : "bg-emerald-500")} />
            {contextPercent.toFixed(1)}%
          </span>
        )}
        {modelLabel && <span className="truncate">{modelLabel}</span>}
        {permissionLabel && <span>{permissionLabel}</span>}
      </div>

      {/* 输入框 */}
      <div className="flex items-end gap-2">
        <textarea
          aria-label="消息输入框"
          className="min-h-[2rem] max-h-[8rem] flex-1 resize-none rounded-lg border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="发送消息..."
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        {isGenerating ? (
          <button
            type="button"
            className="shrink-0 rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
            onClick={onAbort}
          >
            中断
          </button>
        ) : (
          <button
            type="button"
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={disabled || !value.trim()}
            onClick={handleSend}
          >
            发送
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ConversationPanel                                                  */
/* ------------------------------------------------------------------ */

export interface ConversationPanelProps {
  /** 会话标题 */
  readonly title?: string;
  /** 对话流内容 */
  readonly chatContent?: ReactNode;
  /** Git 变更内容 */
  readonly gitContent?: ReactNode;
  /** Git 状态 */
  readonly gitStatus?: GitStatusBarProps;
  /** 输入区 props */
  readonly inputProps?: InputAreaProps;
  /** 头部 props */
  readonly headerProps?: Omit<ConversationHeaderProps, "title">;
  /** 是否有活跃会话 */
  readonly hasSession?: boolean;
}

export function ConversationPanel({
  title = "叙述者",
  chatContent,
  gitContent,
  gitStatus,
  inputProps,
  headerProps,
  hasSession = false,
}: ConversationPanelProps) {
  const [activeView, setActiveView] = useState<"chat" | "git">("chat");

  if (!hasSession) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" data-testid="conversation-empty">
        <p className="text-sm text-muted-foreground">从叙事线选择书籍开始工作，或新建独立会话。</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="conversation-panel">
      {/* 头部 */}
      <ConversationHeader title={title} {...headerProps} />

      {/* 视图切换 */}
      {gitContent && (
        <div className="flex shrink-0 gap-1 border-b border-border px-3 py-1">
          <button
            type="button"
            className={cn("rounded px-2 py-0.5 text-xs", activeView === "chat" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground")}
            onClick={() => setActiveView("chat")}
          >
            对话
          </button>
          <button
            type="button"
            className={cn("rounded px-2 py-0.5 text-xs", activeView === "git" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground")}
            onClick={() => setActiveView("git")}
          >
            Git
          </button>
        </div>
      )}

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeView === "chat" ? chatContent : gitContent}
      </div>

      {/* Git 状态栏 */}
      {gitStatus && <GitStatusBar {...gitStatus} />}

      {/* 输入区 */}
      {inputProps && <InputArea {...inputProps} />}
    </div>
  );
}
