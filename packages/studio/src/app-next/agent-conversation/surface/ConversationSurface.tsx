import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, ExternalLink, Pencil, Sparkles, FileCode, Info, Archive, ArrowLeft, CodeXml, Image } from "lucide-react";

import { GitPanel } from "./GitPanel";
import { FileChangesPanel } from "./FileChangesPanel";
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
import { createDefaultSlashCommandRegistry, mergeUserCommandsIntoRegistry, expandUserCommandPrompt, type UserCommand, type SlashCommandRegistry } from "../slash-command-registry";
import { Composer } from "./Composer";
import { ConfirmationGate, type ConversationConfirmation } from "./ConfirmationGate";
import { UserQuestionGate } from "./UserQuestionGate";
import type { ConversationSessionConfigPatch, ConversationStatus } from "./ConversationStatusBar";
import { MessageStream, type ConversationSurfaceMessage } from "./MessageStream";
import { NarratorStatusBar } from "./NarratorStatusBar";
import { SessionDetailPanel, type SessionDetailData } from "./SessionDetailPanel";
import { TerminalListPanel } from "./TerminalListPanel";
import { SafetyPauseCard } from "./SafetyPauseCard";
import { CompactProgressIndicator } from "./CompactProgressIndicator";
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
  /** 安全暂停事件 */
  pendingSafetyPause?: { id: string; toolName: string; input: Record<string, unknown>; reason: string } | null;
  /** 压缩进度（0-100），null 表示未在压缩 */
  compactProgress?: number | null;
  sendDisabledReason?: string;
  settingsHref?: string;
  footerActions?: ReactNode;
  isRunning?: boolean;
  /** Streaming 开始时间戳（用于计时） */
  streamingStartedAt?: number | null;
  onApproveConfirmation: (id: string, answers?: Record<string, unknown>) => void;
  onRejectConfirmation: (id: string) => void;
  /** Called when user clicks "始终允许此类" — approves + adds pattern to session toolPolicy */
  onAlwaysAllowConfirmation?: (id: string, pattern: string) => void;
  onSend: (content: string, attachments?: Array<{ type: "image"; mimeType: string; data: string; fileName?: string }>) => void;
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
  /** 更新会话配置（来自 SessionDetailPanel） */
  onUpdateSessionConfigFromDetail?: (patch: Record<string, unknown>) => Promise<void> | void;
  /** 更新访问规则 */
  onUpdateAccessRules?: (patch: { directoryAllowlist?: string[]; directoryBlocklist?: string[]; commandAllowlist?: string[]; commandBlocklist?: string[] }) => Promise<void> | void;
  /** 更新 Subagent 模型 */
  onUpdateSubagentModels?: (patch: { explore?: string; plan?: string; general?: string }) => Promise<void> | void;
  /** 模型选项列表（供 SessionDetailPanel 子代理模型选择） */
  modelOptions?: Array<{ value: string; label: string }>;
  /** 可用工具列表（供 SessionDetailPanel 工具限制选择） */
  availableTools?: Array<{ name: string; description?: string }>;
  /** 对话面板顶部插槽（工具配置栏、快捷按钮等） */
  headerSlot?: ReactNode;
  /** 当前运行时错误（来自 session:error 事件） */
  error?: { message: string; code?: string; retryable?: boolean } | null;
  /** 错误操作回调 */
  onRetryError?: () => void;
  onDismissError?: () => void;
  onAutoRetryError?: (errorCode: string) => void;
  /** 中断后继续：发送 session:continue WebSocket 事件 */
  onContinueSession?: () => void;
  /** 安全暂停决策回调 */
  onSafetyPauseDecision?: (id: string, decision: "approve" | "reject") => void;
}

export function ConversationSurface({
  title,
  sessionId,
  status,
  messages,
  pendingConfirmation = null,
  recoveryNotice = null,
  pendingSafetyPause = null,
  compactProgress = null,
  sendDisabledReason,
  settingsHref,
  footerActions = null,
  isRunning = false,
  streamingStartedAt,
  onApproveConfirmation,
  onRejectConfirmation,
  onAlwaysAllowConfirmation,
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
  onUpdateSessionConfigFromDetail,
  onUpdateAccessRules,
  onUpdateSubagentModels,
  modelOptions,
  availableTools,
  headerSlot,
  error = null,
  onRetryError,
  onDismissError,
  onAutoRetryError,
  onContinueSession,
  onSafetyPauseDecision,
}: ConversationSurfaceProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [codeCollapsed, setCodeCollapsed] = useState(false);
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const [filesPanelOpen, setFilesPanelOpen] = useState(false);
  const [filesPanelDismissed, setFilesPanelDismissed] = useState(false);
  const [terminalPanelOpen, setTerminalPanelOpen] = useState(false);
  const [userCommands, setUserCommands] = useState<UserCommand[]>([]);
  const [disabledCommands, setDisabledCommands] = useState<string[]>([]);
  const routerNavigate = useNavigate();

  // 加载用户自定义命令和禁用命令列表
  useEffect(() => {
    fetch("/api/routines/global")
      .then(res => res.ok ? res.json() : null)
      .then((data: { routines?: { commands?: UserCommand[]; disabledCommands?: string[] } } | null) => {
        if (data?.routines?.commands) setUserCommands(data.routines.commands);
        if (data?.routines?.disabledCommands) setDisabledCommands(data.routines.disabledCommands);
      })
      .catch(() => { /* non-fatal */ });
  }, []);

  // 合并内置命令和用户自定义命令
  const slashRegistry: SlashCommandRegistry = useMemo(
    () => mergeUserCommandsIntoRegistry(createDefaultSlashCommandRegistry(), userCommands),
    [userCommands],
  );

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

    if (action === "compact-before" && sessionId) {
      if (msgIndex > 0) {
        const msg = messages[msgIndex];
        const beforeSeq = (msg as unknown as { seq?: number }).seq;
        if (beforeSeq != null) {
          void (async () => {
            try {
              const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/compact-segment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ beforeSeq }),
              });
              if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                console.error("compact-segment failed:", errData);
              }
            } catch (err) {
              console.error("compact-segment error:", err);
            }
          })();
        } else if (onCompactSession) {
          void onCompactSession(`压缩到消息 #${msgIndex} 之前的 ${msgIndex} 条消息`);
        }
      }
    }

    if (action === "rollback" && sessionId) {
      const msg = messages[msgIndex];
      if (msg) {
        void (async () => {
          try {
            const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/rollback/${encodeURIComponent(msg.id)}`, { method: "POST" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            // Reload snapshot
            const snapshot = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/chat/state`).then(r => r.json());
            if (snapshot) window.location.reload();
          } catch (err) {
            console.error("rollback failed:", err);
          }
        })();
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
        const prevUser = messages.slice(0, msgIndex).reverse().find((m) => m.role === "user");
        if (prevUser) setEditingMessage({ id: prevUser.id, content: prevUser.content });
      }
    }

    if (action === "delete") {
      const msg = messages[msgIndex];
      if (msgIndex >= 0 && msg) {
        if (onDeleteMessage) {
          void onDeleteMessage(msg.id);
        } else if (onCompactSession && confirm("确认删除此消息？")) {
          void onCompactSession(`删除：丢弃消息 #${msgIndex} 及之后的所有内容`);
        }
      }
    }
  };

  const handleEditRegenerate = (newContent: string) => {
    if (!editingMessage || !sessionId) return;
    setEditingMessage(null);
    // Use atomic edit-and-regenerate API, then resend
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/edit-and-regenerate/${encodeURIComponent(editingMessage.id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newContent }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // After server deletes old messages, send the new content to trigger agent
        setTimeout(() => onSend(newContent), 100);
      } catch (err) {
        console.error("edit-and-regenerate failed:", err);
        // Fallback: just send as new message
        onSend(newContent);
      }
    })();
  };

  const isWorking = localSending || status.narratorState === "working" || status.state === "running";
  const isInterrupted = status.substatus === "interrupted";
  const effectiveStreamingStartedAt = isWorking ? (status.streamingStartedAt ?? streamingStartedAt) : null;

  // 检测最后一轮是否失败（用于显示重试按钮）
  const lastTurnFailed = !isWorking && (
    status.substatus === "error" ||
    (messages.length > 0 && messages[messages.length - 1]?.role === "assistant" &&
      (messages[messages.length - 1]?.metadata as Record<string, unknown> | undefined)?.error != null)
  );

  // 重试：重新发送最后一条用户消息
  const handleRetry = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
    if (lastUserMsg) {
      onSend(lastUserMsg.content);
    }
  }, [messages, onSend]);

  // 计算当前 streaming 消息的字符数（用于输出速率显示）
  const streamingChars = isWorking ? (messages.filter(m => m.isStreaming).reduce((sum, m) => sum + m.content.length, 0)) : 0;

  // 检测回复到达，重置 localSending
  useEffect(() => {
    if (messages.length > prevMessageCount.current && localSending) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === "assistant") setLocalSending(false);
    }
    prevMessageCount.current = messages.length;
  }, [messages.length, localSending, messages]);

  // Auto-show FileChangesPanel when write tools complete
  const prevMsgLenForFiles = useRef(messages.length);
  // Reset dismissed state when session changes
  useEffect(() => {
    setFilesPanelDismissed(false);
    setFilesPanelOpen(false);
  }, [sessionId]);
  useEffect(() => {
    if (messages.length <= prevMsgLenForFiles.current || filesPanelDismissed) {
      prevMsgLenForFiles.current = messages.length;
      return;
    }
    prevMsgLenForFiles.current = messages.length;
    const WRITE_TOOLS = new Set([
      "Write", "Edit", "candidate.create_chapter",
      "questionnaire.submit_response", "narrative.propose_change",
    ]);
    // Check recent messages for completed write tool calls
    const recentMsgs = messages.slice(-3);
    for (const msg of recentMsgs) {
      const toolCalls = (msg as unknown as { toolCalls?: Array<{ toolName: string; status?: string }> }).toolCalls;
      if (!toolCalls?.length) continue;
      for (const tc of toolCalls) {
        if (WRITE_TOOLS.has(tc.toolName) && tc.status === "success") {
          setFilesPanelOpen(true);
          return;
        }
      }
    }
  }, [messages, filesPanelDismissed]);

  // 搜索过滤（对标 NarraFork messageSearchPlaceholder: "搜索已加载消息..."）
  const searchFiltered = searchQuery
    ? messages.filter((m) => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages;

  // ── 分页：初始只渲染最近 50 条，滚动到顶部时加载更多 ──
  const PAGE_SIZE = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // 当 sessionId 变化时重置可见数量
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [sessionId]);

  // 新消息到来时，如果用户在底部附近，自动扩展可见范围
  const prevMsgCountForPaging = useRef(searchFiltered.length);
  useEffect(() => {
    if (searchFiltered.length > prevMsgCountForPaging.current) {
      // 新消息追加，扩展可见范围以包含新消息
      setVisibleCount((prev) => Math.max(prev, searchFiltered.length - Math.max(0, searchFiltered.length - PAGE_SIZE - (prev - PAGE_SIZE))));
    }
    prevMsgCountForPaging.current = searchFiltered.length;
  }, [searchFiltered.length]);

  const filteredMessages = useMemo(() => {
    if (searchQuery) return searchFiltered; // 搜索时显示所有匹配结果
    if (searchFiltered.length <= visibleCount) return searchFiltered;
    return searchFiltered.slice(-visibleCount);
  }, [searchFiltered, visibleCount, searchQuery]);

  // 是否还有更多本地消息可以展示（未搜索时）
  const hasMoreLocalMessages = !searchQuery && searchFiltered.length > visibleCount;

  // 加载更多：先展示本地缓存的历史消息，本地用完后调用 onLoadPreviousMessages
  const handleLoadPreviousWrapped = useCallback(async (): Promise<ConversationSurfaceMessage[]> => {
    if (hasMoreLocalMessages) {
      setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, searchFiltered.length));
      return [];
    }
    if (onLoadPreviousMessages) {
      return await onLoadPreviousMessages();
    }
    return [];
  }, [hasMoreLocalMessages, searchFiltered.length, onLoadPreviousMessages]);

  const effectiveHasPrevious = hasMoreLocalMessages || hasPreviousMessages;

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
            <TooltipContent>{codeCollapsed ? "展开工具卡片" : "折叠工具卡片"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => onAttach && document.querySelector<HTMLInputElement>('input[type="file"]')?.click()}>
                <Image className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>图片附件</TooltipContent>
          </Tooltip>
          <Sheet open={filesPanelOpen} onOpenChange={(open) => {
            setFilesPanelOpen(open);
            if (!open) setFilesPanelDismissed(true);
          }}>
            <SheetTrigger
              className="inline-flex shrink-0 items-center justify-center rounded-lg text-sm font-medium transition-all outline-none select-none hover:bg-muted hover:text-foreground size-7"
              title="文件修改"
              onClick={() => { setFilesPanelDismissed(false); }}
            >
              <FileCode className="size-4" />
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>文件修改</SheetTitle>
                <SheetDescription>本次会话中修改的文件列表</SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-4">
                <FileChangesPanel sessionId={sessionId ?? ""} />
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
                  onUpdateSessionConfig={onUpdateSessionConfigFromDetail}
                  onUpdateAccessRules={onUpdateAccessRules}
                  onUpdateSubagentModels={onUpdateSubagentModels}
                  modelOptions={modelOptions}
                  availableTools={availableTools}
                />
              </div>
            </SheetContent>
          </Sheet>
          {/* 归档按钮 — 书籍叙述者不可归档 */}
          {!status.binding?.projectId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => onArchive?.()}>
                <Archive className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>归档</TooltipContent>
          </Tooltip>
          )}
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

      {/* ── Header slot (tool config bar, quick actions, etc.) ── */}
      {headerSlot}

      {/* ── Error bubble — 对齐 NarraFork 错误透传 ── */}
      {error && (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950/30">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <svg className="h-4 w-4 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                {error.message}
              </p>
              {error.code && (
                <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
                  错误代码: {error.code}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {onAutoRetryError && error.code && (
                <button
                  onClick={() => onAutoRetryError(error.code!)}
                  className="text-xs px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/50 dark:hover:bg-red-900 dark:text-red-300 transition-colors"
                >
                  自动重试此类错误
                </button>
              )}
              {onRetryError && (
                <button
                  onClick={onRetryError}
                  className="text-xs px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/50 dark:hover:bg-red-900 dark:text-red-300 transition-colors"
                >
                  重试
                </button>
              )}
              {onDismissError && (
                <button
                  onClick={onDismissError}
                  className="text-xs px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/50 dark:hover:bg-red-900 dark:text-red-300 transition-colors"
                >
                  忽略
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* ── Recovery notice (non-error) — 保留原有恢复状态提示 ── */}
      {!error && recoveryNotice && recoveryNotice.state === "failed" && messages.length > 0 && (
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
            <MessageStream messages={filteredMessages} hasPrevious={effectiveHasPrevious} onLoadPrevious={handleLoadPreviousWrapped} onContextAction={handleMessageContextAction} codeCollapsed={codeCollapsed} />
            {/* Confirmation gate / User question gate inline */}
            {pendingConfirmation && (
              <div className="my-3">
                {isUserQuestionToolName(pendingConfirmation.toolName) ? (
                  <UserQuestionGate
                    confirmation={pendingConfirmation}
                    onSubmitAnswers={(id, answers) => onApproveConfirmation(id, answers)}
                    onSkip={(id) => onApproveConfirmation(id, {})}
                  />
                ) : (
                  <ConfirmationGate confirmation={pendingConfirmation} onApprove={onApproveConfirmation} onReject={onRejectConfirmation} onAlwaysAllow={onAlwaysAllowConfirmation ?? ((id, pattern) => {
                    onApproveConfirmation?.(id);
                    void onUpdateSessionConfig?.({ toolPolicy: { allow: [pattern] } } as ConversationSessionConfigPatch);
                  })} />
                )}
              </div>
            )}
            {/* Safety pause card */}
            {pendingSafetyPause && onSafetyPauseDecision && (
              <div className="my-3">
                <SafetyPauseCard
                  pause={pendingSafetyPause}
                  onDecision={onSafetyPauseDecision}
                />
              </div>
            )}
            {/* Compact progress indicator */}
            {compactProgress != null && (
              <div className="my-3">
                <CompactProgressIndicator progress={compactProgress} />
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Edit & Regenerate dialog ── */}
      {editingMessage && (
        <div className="shrink-0 border-t border-border bg-muted/30 px-4 py-3">
          <div className="flex items-start gap-2" data-edit-container>
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
              <Button size="sm" onClick={(e) => { const textarea = (e.target as HTMLElement).closest('[data-edit-container]')?.querySelector('textarea'); if (textarea) handleEditRegenerate(textarea.value); }}>
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
        sessionId={sessionId}
        streamingStartedAt={effectiveStreamingStartedAt}
        streamingChars={streamingChars}
        onUpdateModel={(providerId, modelId) => { void onUpdateSessionConfig?.({ providerId, modelId }); }}
        onUpdateReasoningEffort={(effort) => { void onUpdateSessionConfig?.({ reasoningEffort: effort }); }}
        onUpdatePermissionMode={(mode) => { void onUpdateSessionConfig?.({ permissionMode: mode }); }}
        fastMode={status.serviceTier === "priority"}
        onToggleFastMode={() => { void onUpdateSessionConfig?.({ serviceTier: status.serviceTier === "priority" ? "default" : "priority" }); }}
        onCompact={onCompactSession ? () => { onCompactSession("压缩上下文到目标阈值").catch((e) => { alert(`压缩失败: ${e instanceof Error ? e.message : String(e)}`); }); } : undefined}
        onReset={() => {
          if (!window.confirm("确定要清空上下文吗？Agent 将忘记之前的对话内容，但聊天记录仍然保留可查看。")) return;
          fetch(`/api/sessions/${encodeURIComponent(sessionId ?? "")}/truncate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ seq: 999999999 }),
          }).then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          }).then(() => {
            window.location.reload();
          }).catch(e => { alert(`清空上下文失败: ${e instanceof Error ? e.message : String(e)}`); });
        }}
        onOpenTerminal={() => setTerminalPanelOpen(true)}
      />

      {/* ── Composer ── */}
      <Composer
        onSend={(content, attachments) => { setLocalSending(true); onSend(content, attachments); }}
        onAbort={onAbort}
        onContinue={() => { setLocalSending(true); if (onContinueSession) { onContinueSession(); } else { onSend(""); } }}
        onRetry={handleRetry}
        onAttach={onAttach}
        onSlashCommandResult={handleSlashCommandResult}
        slashCommandContext={{ registry: slashRegistry, status, compactSession: onCompactSession, bookId: status.binding?.projectId, userCommands, commandEnabledRegistry: { isEnabled: (id: string) => !disabledCommands.includes(id) } }}
        isRunning={isWorking}
        isInterrupted={isInterrupted}
        lastTurnFailed={lastTurnFailed}
        disabledReason={sendDisabledReason}
        settingsHref={settingsHref}
      />
      </div>
    </section>

    {/* ── Terminal Panel (right-side Sheet) ── */}
    <Sheet open={terminalPanelOpen} onOpenChange={setTerminalPanelOpen}>
      <SheetContent side="right" className="w-[400px] sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>终端</SheetTitle>
          <SheetDescription>Agent 创建和管理的终端进程</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <TerminalListPanel />
        </div>
      </SheetContent>
    </Sheet>

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
  "AskUserQuestion",
]);

function isUserQuestionToolName(toolName: string | undefined): boolean {
  if (!toolName) return false;
  return USER_QUESTION_TOOL_NAMES.has(toolName);
}
