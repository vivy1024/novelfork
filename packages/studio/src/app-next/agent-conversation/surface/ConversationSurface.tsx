import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, ExternalLink, Pencil, Sparkles, FileCode, Info, Archive, ArrowLeft, CodeXml, Pin, Image } from "lucide-react";

import { GitPanel } from "./GitPanel";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { ToolResultArtifact } from "../../tool-results";
import type { SlashCommandExecutionContext, SlashCommandExecutionResult } from "../slash-command-registry";
import { Composer } from "./Composer";
import { ConfirmationGate, type ConversationConfirmation } from "./ConfirmationGate";
import { UserQuestionGate } from "./UserQuestionGate";
import type { ConversationSessionConfigPatch, ConversationStatus } from "./ConversationStatusBar";
import { MessageStream, type ConversationSurfaceMessage } from "./MessageStream";
import { NarratorStatusBar } from "./NarratorStatusBar";
import { SessionDetailPanel, type SessionDetailData } from "./SessionDetailPanel";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

export interface ConversationRecoveryNotice {
  state: string;
  reason?: string;
  lastSeq?: number;
  ackedSeq?: number;
  actionLabel?: string;
}

export interface ConversationSurfaceProps {
  title: string;
  sessionId?: string;
  status: ConversationStatus;
  messages: readonly ConversationSurfaceMessage[];
  pendingConfirmation?: ConversationConfirmation | null;
  recoveryNotice?: ConversationRecoveryNotice | null;
  sendDisabledReason?: string;
  settingsHref?: string;
  footerActions?: ReactNode;
  isRunning?: boolean;
  /** Streaming 开始时间戳（用于计时） */
  streamingStartedAt?: number | null;
  onApproveConfirmation: (id: string, answers?: Record<string, unknown>) => void;
  onRejectConfirmation: (id: string) => void;
  onSend: (content: string) => void;
  onAbort?: () => void;
  onUpdateSessionConfig?: (patch: ConversationSessionConfigPatch) => Promise<void> | void;
  onCompactSession?: SlashCommandExecutionContext["compactSession"];
  /** 截断会话到指定消息（删除该消息及之后的所有消息） */
  onTruncateToMessage?: (messageId: string) => Promise<void> | void;
  /** 删除单条消息 */
  onDeleteMessage?: (messageId: string) => Promise<void> | void;
  onSlashCommandResult?: (result: SlashCommandExecutionResult) => void;
  onOpenArtifact?: (artifact: ToolResultArtifact) => void;
  /** 附件上传回调 */
  onAttach?: (files: FileList) => void;
  /** 历史消息分页 */
  hasPreviousMessages?: boolean;
  onLoadPreviousMessages?: () => Promise<ConversationSurfaceMessage[]>;
  /** 工具栏回调 */
  onEditTitle?: (newTitle: string) => void;
  onGenerateTitle?: () => void;
  onArchive?: () => void;
  onPin?: () => void;
  isPinned?: boolean;
  /** /fork 命令回调 */
  onForkSession?: (title?: string) => void;
  /** 会话详情数据 */
  sessionDetail?: SessionDetailData;
  /** 更新工作目录 */
  onUpdateWorkDir?: (path: string) => Promise<void> | void;
}

export function ConversationSurface({
  title,
  sessionId,
  status,
  messages,
  pendingConfirmation = null,
  recoveryNotice = null,
  sendDisabledReason,
  settingsHref,
  footerActions = null,
  isRunning = false,
  streamingStartedAt,
  onApproveConfirmation,
  onRejectConfirmation,
  onSend,
  onAbort = () => undefined,
  onUpdateSessionConfig,
  onCompactSession,
  onTruncateToMessage,
  onDeleteMessage,
  onSlashCommandResult,
  onAttach,
  hasPreviousMessages = false,
  onLoadPreviousMessages,
  onEditTitle,
  onGenerateTitle,
  onArchive,
  onPin,
  isPinned = false,
  onForkSession,
  sessionDetail,
  onUpdateWorkDir,
}: ConversationSurfaceProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [codeCollapsed, setCodeCollapsed] = useState(false);
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const routerNavigate = useNavigate();

  const handleEditTitle = () => {
    const newTitle = prompt("编辑标题", title);
    if (newTitle && newTitle !== title) {
      onEditTitle?.(newTitle);
    }
  };

  const handleOpenExternal = () => {
    if (sessionId) {
      window.open(`/next/narrators/${encodeURIComponent(sessionId)}`, "_blank");
    }
  };

  const handleSlashCommandResult = (result: SlashCommandExecutionResult) => {
    onSlashCommandResult?.(result);
    if (result.ok && result.kind === "update-session-config") {
      void onUpdateSessionConfig?.(result.patch);
    }
    if (result.ok && result.kind === "fork-session") {
      void onForkSession?.((result as { title?: string }).title);
    }
  };

  const [editingMessage, setEditingMessage] = useState<{ id: string; content: string } | null>(null);
  const [localSending, setLocalSending] = useState(false);
  const prevMessageCount = useRef(messages.length);

  const handleMessageContextAction = (messageId: string, action: string) => {
    const msgIndex = messages.findIndex((m) => m.id === messageId);

    if (action === "compact-before" && onCompactSession) {
      if (msgIndex > 0) {
        void onCompactSession(`压缩到消息 #${msgIndex} 之前的 ${msgIndex} 条消息`);
      }
    }

    if (action === "rollback") {
      if (msgIndex >= 0) {
        const msg = messages[msgIndex];
        if (onTruncateToMessage && msg) {
          void onTruncateToMessage(msg.id);
        } else if (onCompactSession) {
          void onCompactSession(`回退：丢弃消息 #${msgIndex} 及之后的所有消息`);
        }
      }
    }

    if (action === "fork" && onForkSession) {
      const msg = messages[msgIndex];
      void onForkSession(`从消息 "${msg?.content?.slice(0, 20) ?? messageId}" 分叉`);
    }

    if (action === "edit-regenerate") {
      const msg = messages[msgIndex];
      if (msg && msg.role === "user") {
        setEditingMessage({ id: msg.id, content: msg.content });
      } else if (msg && msg.role === "assistant" && msgIndex > 0) {
        // 编辑上一条用户消息并重新生成
        const prevUser = messages.slice(0, msgIndex).reverse().find((m) => m.role === "user");
        if (prevUser) setEditingMessage({ id: prevUser.id, content: prevUser.content });
      }
    }

    if (action === "delete") {
      const msg = messages[msgIndex];
      if (msgIndex >= 0 && msg) {
        if (onDeleteMessage) {
          void onDeleteMessage(msg.id);
        } else if (onCompactSession && confirm("确认删除此消息及之后的所有消息？")) {
          void onCompactSession(`删除：丢弃消息 #${msgIndex} 及之后的所有内容`);
        }
      }
    }
  };

  const handleEditRegenerate = (newContent: string) => {
    if (!editingMessage) return;
    setEditingMessage(null);
    // Compact to before the edited message, then resend with new content
    const msgIndex = messages.findIndex((m) => m.id === editingMessage.id);
    if (msgIndex >= 0 && onCompactSession) {
      void onCompactSession(`编辑重生成：丢弃消息 #${msgIndex} 及之后`).then(() => {
        onSend(newContent);
      });
    } else {
      // Fallback: just send as new message
      onSend(newContent);
    }
  };

  const isWorking = localSending || status.narratorState === "working" || status.state === "running";
  const isInterrupted = status.substatus === "interrupted";
  const effectiveStreamingStartedAt = isWorking ? (status.streamingStartedAt ?? streamingStartedAt) : null;

  // 检测回复到达，重置 localSending
  useEffect(() => {
    if (messages.length > prevMessageCount.current && localSending) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === "assistant") setLocalSending(false);
    }
    prevMessageCount.current = messages.length;
  }, [messages.length, localSending, messages]);

  // 搜索过滤（对标 NarraFork messageSearchPlaceholder: "搜索已加载消息..."）
  const filteredMessages = searchQuery
    ? messages.filter((m) => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages;

  return (
    <TooltipProvider>
    <section data-testid="conversation-surface" className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      {/* ── Top toolbar ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={() => routerNavigate({ to: ".." })}>
                <ArrowLeft className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>返回</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={handleOpenExternal}>
                <ExternalLink className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>在新标签打开</TooltipContent>
          </Tooltip>
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={handleEditTitle}>
                <Pencil className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>编辑标题</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={() => onGenerateTitle?.()}>
                <Sparkles className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>生成标题</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => setSearchOpen(!searchOpen)}>
                <Search className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>搜索</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => setCodeCollapsed(!codeCollapsed)} className={codeCollapsed ? "text-primary" : ""}>
                <CodeXml className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{codeCollapsed ? "展开代码块" : "折叠代码块"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => onPin?.()} className={isPinned ? "text-primary" : ""}>
                <Pin className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isPinned ? "取消固定" : "固定会话"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => onAttach && document.querySelector<HTMLInputElement>('input[type="file"]')?.click()}>
                <Image className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>图片附件</TooltipContent>
          </Tooltip>
          <Sheet>
            <SheetTrigger
              className="inline-flex shrink-0 items-center justify-center rounded-lg text-sm font-medium transition-all outline-none select-none hover:bg-muted hover:text-foreground size-7"
              title="文件修改"
            >
              <FileCode className="size-4" />
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>文件修改</SheetTitle>
                <SheetDescription>本次会话中修改的文件列表</SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-4">
                <FileChangesPanel messages={messages} />
              </div>
            </SheetContent>
          </Sheet>
          <Sheet>
            <SheetTrigger
              className="inline-flex shrink-0 items-center justify-center rounded-lg text-sm font-medium transition-all outline-none select-none hover:bg-muted hover:text-foreground size-7"
              title="会话信息"
            >
              <Info className="size-4" />
            </SheetTrigger>
            <SheetContent className="overflow-y-auto">
              <SheetHeader>
                <SheetTitle>会话详情</SheetTitle>
                <SheetDescription>当前会话的完整信息与配置</SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-4">
                <SessionDetailPanel
                  status={status}
                  messages={messages}
                  detail={sessionDetail ?? {
                    sessionId: sessionId ?? "",
                    workDir: status.workspace?.path,
                  }}
                  onUpdateWorkDir={onUpdateWorkDir}
                />
              </div>
            </SheetContent>
          </Sheet>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => onArchive?.()}>
                <Archive className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>归档</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* ── Search bar ── */}
      {searchOpen && (
        <div className="shrink-0 border-b border-border px-4 py-2">
          <Input
            placeholder="搜索已加载消息..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setSearchOpen(false); setSearchQuery(""); } }}
            autoFocus
          />
        </div>
      )}

      {/* ── Recovery notice — only show "failed" state, hide transient recovery states ── */}
      {recoveryNotice && recoveryNotice.state === "failed" && messages.length > 0 && (
        <div className="shrink-0 border-b border-border bg-yellow-50 px-4 py-2 text-xs text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
          会话恢复失败 {recoveryNotice.reason && `— ${recoveryNotice.reason}`}
        </div>
      )}

      {/* ── Message stream ── */}
      <div className="flex flex-col flex-1 min-h-0 min-w-0 px-4 py-2 overflow-y-auto overflow-x-hidden">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-sm text-muted-foreground">
              <p className="mb-2">还没有消息</p>
              <p className="text-xs">输入写作目标，或使用 <code className="rounded bg-muted px-1">/help</code> 查看可用命令</p>
            </div>
          </div>
        ) : filteredMessages.length === 0 && searchQuery ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">无匹配结果</p>
          </div>
        ) : (
          <>
            <MessageStream messages={filteredMessages} hasPrevious={hasPreviousMessages} onLoadPrevious={onLoadPreviousMessages} onContextAction={handleMessageContextAction} codeCollapsed={codeCollapsed} />
            {/* Confirmation gate / User question gate inline */}
            {pendingConfirmation && (
              <div className="my-3">
                {isUserQuestionToolName(pendingConfirmation.toolName) ? (
                  <UserQuestionGate
                    confirmation={pendingConfirmation}
                    onSubmitAnswers={(id, answers) => onApproveConfirmation(id, answers)}
                    onSkip={onRejectConfirmation}
                  />
                ) : (
                  <ConfirmationGate confirmation={pendingConfirmation} onApprove={onApproveConfirmation} onReject={onRejectConfirmation} />
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Edit & Regenerate dialog ── */}
      {editingMessage && (
        <div className="shrink-0 border-t border-border bg-muted/30 px-4 py-3">
          <div className="flex items-start gap-2">
            <textarea
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[60px] resize-y focus:outline-none focus:ring-2 focus:ring-ring"
              defaultValue={editingMessage.content}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  handleEditRegenerate((e.target as HTMLTextAreaElement).value);
                }
                if (e.key === "Escape") setEditingMessage(null);
              }}
              ref={(el) => el?.select()}
            />
            <div className="flex flex-col gap-1">
              <Button size="sm" onClick={(e) => { const textarea = (e.target as HTMLElement).closest('.flex')?.querySelector('textarea'); if (textarea) handleEditRegenerate(textarea.value); }}>
                重新生成
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingMessage(null)}>
                取消
              </Button>
            </div>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">Ctrl+Enter 发送 · Esc 取消</p>
        </div>
      )}

      {/* ── Footer actions (if any) ── */}
      {footerActions}

      {/* ── Bottom area: Git + Status + Composer — 统一容器，单一 border-t ── */}
      <div className="shrink-0 border-t border-border">
      {/* ── Git status bar — NarraFork 风格 ── */}
      {status.workspace && (
        <div className="flex items-center justify-between gap-1.5 bg-muted/30 px-4 py-1 text-[11px]">
          <button type="button" onClick={() => setGitPanelOpen(!gitPanelOpen)} className="flex items-center gap-1.5 min-w-0 flex-1 hover:bg-muted/50 rounded px-1 -mx-1 py-0.5 transition-colors">
            <span className={status.workspace.git?.status === "dirty" ? "text-orange-500" : "text-green-500"}>🏠</span>
            <span className="truncate font-medium text-blue-600 dark:text-blue-400">
              {status.binding?.label?.split(/[/·]/)[0]?.trim() || status.workspace.path?.split(/[/\\]/).pop() || "工作区"}
            </span>
            {(status.workspace.branch || status.workspace.path) && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="truncate font-mono text-muted-foreground">
                  {status.workspace.branch || status.workspace.path?.split(/[/\\]/).pop() || ""}
                </span>
              </>
            )}
            {status.workspace.git?.status === "dirty" && status.workspace.git.summary && (
              <span className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 bg-muted text-[10px] font-mono">
                <span className="text-green-600">+{status.workspace.git.summary.match(/(\d+)/)?.[1] ?? "?"}</span>
                <span className="text-red-500">-{status.workspace.git.summary.match(/\d+.*?(\d+)/)?.[1] ?? "?"}</span>
              </span>
            )}
            {status.workspace.git?.status === "clean" && (
              <span className="text-[10px] text-green-600">✓</span>
            )}
          </button>
          {/* Right: Git action buttons */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button type="button" onClick={() => setGitPanelOpen(!gitPanelOpen)} className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Git 变更">
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </button>
            <GitBranchMenu workDir={status.workspace?.path} />
            <button type="button" className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="会话设置">
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* ── Git Panel (展开时显示) ── */}
      {gitPanelOpen && status.workspace?.path && (
        <GitPanel workDir={status.workspace.path} onClose={() => setGitPanelOpen(false)} />
      )}

      {/* ── NarratorStatusBar (above Composer) ── */}
      <NarratorStatusBar
        status={status}
        streamingStartedAt={effectiveStreamingStartedAt}
        onUpdateModel={(providerId, modelId) => { void onUpdateSessionConfig?.({ providerId, modelId }); }}
        onUpdateReasoningEffort={(effort) => { void onUpdateSessionConfig?.({ reasoningEffort: effort }); }}
        onUpdatePermissionMode={(mode) => { void onUpdateSessionConfig?.({ permissionMode: mode }); }}
        onCompact={onCompactSession ? () => { void onCompactSession("压缩上下文到目标阈值"); } : undefined}
        onReset={onCompactSession ? () => { void onCompactSession("reset"); } : undefined}
      />

      {/* ── Composer ── */}
      <Composer
        onSend={(content) => { setLocalSending(true); onSend(content); }}
        onAbort={onAbort}
        onContinue={() => { setLocalSending(true); onSend(""); }}
        onAttach={onAttach}
        onSlashCommandResult={handleSlashCommandResult}
        slashCommandContext={{ status, compactSession: onCompactSession, bookId: status.binding?.projectId }}
        isRunning={isWorking}
        isInterrupted={isInterrupted}
        disabledReason={sendDisabledReason}
        settingsHref={settingsHref}
      />
      </div>
    </section>
    </TooltipProvider>
  );
}

// ── GitBranchMenu — 分叉/合并快捷菜单 ──

function GitBranchMenu({ workDir }: { workDir?: string }) {
  const handleFork = async () => {
    const name = prompt("新分支名称：");
    if (!name?.trim() || !workDir) return;
    try {
      await fetch("/api/git/worktree/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workDir, name: name.trim() }),
      });
    } catch { /* ignore */ }
  };

  const handleMerge = async () => {
    const branch = prompt("要合并的分支名：");
    if (!branch?.trim() || !workDir) return;
    try {
      await fetch("/api/git/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workDir, sourceBranch: branch.trim() }),
      });
    } catch { /* ignore */ }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Git 分支操作">
        <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/></svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="min-w-[120px]">
        <DropdownMenuLabel>Git</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void handleFork()} className="gap-2 text-xs">
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/></svg>
          分叉
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleMerge()} className="gap-2 text-xs">
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 009 9"/></svg>
          合并
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type { ConversationSurfaceMessage };

// ---------------------------------------------------------------------------
// isUserQuestionToolName — 判断是否为问题类型的 permission
// ---------------------------------------------------------------------------

const USER_QUESTION_TOOL_NAMES = new Set([
  "pgi.generate_questions",
  "guided.enter",
  "guided.answer_question",
]);

function isUserQuestionToolName(toolName: string | undefined): boolean {
  if (!toolName) return false;
  return USER_QUESTION_TOOL_NAMES.has(toolName);
}

// ---------------------------------------------------------------------------
// FileChangesPanel — 从 toolCalls 中提取文件修改记录
// ---------------------------------------------------------------------------

const FILE_TOOL_NAMES = new Set(["Write", "Edit", "Read", "Bash", "write_file", "edit_file", "read_file", "create_file"]);

interface FileChangeEntry {
  path: string;
  tool: string;
  action: "write" | "edit" | "read" | "other";
}

function extractFileChanges(messages: readonly ConversationSurfaceMessage[]): FileChangeEntry[] {
  const seen = new Map<string, FileChangeEntry>();

  for (const msg of messages) {
    if (!msg.toolCalls) continue;
    for (const tc of msg.toolCalls) {
      if (!FILE_TOOL_NAMES.has(tc.toolName) && !tc.toolName.toLowerCase().includes("file")) continue;
      const input = tc.input as Record<string, unknown> | undefined;
      if (!input) continue;

      const filePath = typeof input.file_path === "string" ? input.file_path
        : typeof input.path === "string" ? input.path
        : typeof input.filePath === "string" ? input.filePath
        : null;

      if (!filePath) continue;

      const action: FileChangeEntry["action"] =
        tc.toolName === "Write" || tc.toolName === "write_file" || tc.toolName === "create_file" ? "write"
        : tc.toolName === "Edit" || tc.toolName === "edit_file" ? "edit"
        : tc.toolName === "Read" || tc.toolName === "read_file" ? "read"
        : "other";

      // 只保留写入/编辑操作，读取不算修改
      if (action === "read") continue;

      const key = filePath;
      if (!seen.has(key)) {
        seen.set(key, { path: filePath, tool: tc.toolName, action });
      }
    }
  }

  return Array.from(seen.values());
}

function FileChangesPanel({ messages }: { messages: readonly ConversationSurfaceMessage[] }) {
  const changes = extractFileChanges(messages);

  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">暂无文件修改记录</p>;
  }

  return (
    <ul className="space-y-1 py-2">
      {changes.map((entry) => (
        <li key={entry.path} className="flex items-center gap-2 py-1.5 border-b border-border/50 last:border-0">
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${entry.action === "write" ? "bg-green-500/10 text-green-600" : "bg-blue-500/10 text-blue-600"}`}>
            {entry.action === "write" ? "新建" : "编辑"}
          </span>
          <span className="text-xs font-mono truncate">{entry.path.split(/[/\\]/).slice(-2).join("/")}</span>
        </li>
      ))}
    </ul>
  );
}
