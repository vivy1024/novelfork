/**
 * GitChangesView — 对话框内的 Git 变更视图
 *
 * 在 ConversationPanel 中作为切换视图，显示变更/提交/暂存。
 * 参考 NarraFork 的对话框底部 git 面板。
 */

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type FileChangeStatus = "M" | "A" | "D" | "R" | "?";

export interface FileChange {
  readonly path: string;
  readonly status: FileChangeStatus;
  readonly additions?: number;
  readonly deletions?: number;
}

export interface GitChangesViewProps {
  /** 变更文件列表 */
  readonly changes: readonly FileChange[];
  /** 已暂存文件列表 */
  readonly staged: readonly FileChange[];
  /** 暂存单个文件 */
  readonly onStage?: (path: string) => void;
  /** 取消暂存 */
  readonly onUnstage?: (path: string) => void;
  /** 全部暂存 */
  readonly onStageAll?: () => void;
  /** 丢弃全部 */
  readonly onDiscardAll?: () => void;
  /** 提交 */
  readonly onCommit?: (message: string) => void;
  /** 加载中 */
  readonly loading?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Status badge                                                       */
/* ------------------------------------------------------------------ */

const STATUS_COLORS: Record<FileChangeStatus, string> = {
  M: "text-amber-600",
  A: "text-emerald-600",
  D: "text-destructive",
  R: "text-blue-600",
  "?": "text-muted-foreground",
};

function StatusBadge({ status }: { readonly status: FileChangeStatus }) {
  return <span className={cn("shrink-0 text-[10px] font-bold", STATUS_COLORS[status])}>{status}</span>;
}

/* ------------------------------------------------------------------ */
/*  File list                                                          */
/* ------------------------------------------------------------------ */

function FileList({
  files,
  actionLabel,
  onAction,
}: {
  readonly files: readonly FileChange[];
  readonly actionLabel: string;
  readonly onAction?: (path: string) => void;
}) {
  if (files.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">无文件</p>;
  }

  return (
    <div className="space-y-0">
      {files.map((file) => (
        <div
          key={file.path}
          className="group flex items-center gap-2 px-3 py-1 text-xs hover:bg-muted/50"
        >
          <StatusBadge status={file.status} />
          <span className="min-w-0 flex-1 truncate text-foreground">{file.path}</span>
          {(file.additions !== undefined || file.deletions !== undefined) && (
            <span className="shrink-0 text-[10px]">
              {file.additions !== undefined && <span className="text-emerald-600">+{file.additions}</span>}
              {file.deletions !== undefined && <span className="ml-1 text-destructive">-{file.deletions}</span>}
            </span>
          )}
          {onAction && (
            <button
              type="button"
              className="shrink-0 rounded px-1 py-0.5 text-[10px] text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100"
              onClick={() => onAction(file.path)}
            >
              {actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  GitChangesView                                                     */
/* ------------------------------------------------------------------ */

export function GitChangesView({
  changes,
  staged,
  onStage,
  onUnstage,
  onStageAll,
  onDiscardAll,
  onCommit,
  loading = false,
}: GitChangesViewProps) {
  const [activeTab, setActiveTab] = useState<"changes" | "staged" | "commit">("changes");
  const [commitMessage, setCommitMessage] = useState("");

  return (
    <div className="flex h-full flex-col" data-testid="git-changes-view">
      {/* Tab 栏 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1">
        {(["changes", "staged", "commit"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={cn(
              "rounded px-2 py-0.5 text-xs",
              activeTab === tab ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "changes" ? `变更 (${changes.length})` : tab === "staged" ? `暂存 (${staged.length})` : "提交"}
          </button>
        ))}
        {activeTab === "changes" && (
          <div className="ml-auto flex items-center gap-1">
            {onStageAll && (
              <button type="button" className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onStageAll}>
                全部暂存
              </button>
            )}
            {onDiscardAll && (
              <button type="button" className="rounded px-1.5 py-0.5 text-[10px] text-destructive hover:bg-destructive/10" onClick={onDiscardAll}>
                丢弃全部
              </button>
            )}
          </div>
        )}
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">加载中...</p>
        ) : activeTab === "changes" ? (
          <FileList files={changes} actionLabel="暂存" onAction={onStage} />
        ) : activeTab === "staged" ? (
          <FileList files={staged} actionLabel="取消" onAction={onUnstage} />
        ) : (
          <div className="space-y-2 p-3">
            <textarea
              aria-label="提交消息"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none"
              placeholder="提交消息..."
              rows={3}
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
            />
            <button
              type="button"
              className="w-full rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={!commitMessage.trim() || staged.length === 0}
              onClick={() => {
                if (commitMessage.trim() && onCommit) {
                  onCommit(commitMessage.trim());
                  setCommitMessage("");
                }
              }}
            >
              提交 ({staged.length} 个文件)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
