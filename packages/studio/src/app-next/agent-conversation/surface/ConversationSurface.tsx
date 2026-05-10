import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, ExternalLink, Pencil, Sparkles, FileCode, Info, Archive, ArrowLeft, CodeXml, Pin, Image } from "lucide-react";

import type { ToolResultArtifact } from "../../tool-results";
import type { SlashCommandExecutionContext, SlashCommandExecutionResult } from "../slash-command-registry";
import { Composer } from "./Composer";
import { ConfirmationGate, type ConversationConfirmation } from "./ConfirmationGate";
import { UserQuestionGate } from "./UserQuestionGate";
import type { ConversationSessionConfigPatch, ConversationStatus } from "./ConversationStatusBar";
import { MessageStream, type ConversationSurfaceMessage } from "./MessageStream";
import { NarratorStatusBar } from "./NarratorStatusBar";
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
}: ConversationSurfaceProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [codeCollapsed, setCodeCollapsed] = useState(false);
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

  const handleMessageContextAction = (messageId: string, action: string) => {
    if (action === "compact-before" && onCompactSession) {
      const msgIndex = messages.findIndex((m) => m.id === messageId);
      if (msgIndex > 0) {
        void onCompactSession(`压缩到消息 #${msgIndex} 之前的 ${msgIndex} 条消息`);
      }
    }
  };

  const isWorking = status.narratorState === "working" || status.state === "running";
  const isInterrupted = status.substatus === "interrupted";
  const effectiveStreamingStartedAt = isWorking ? (status.streamingStartedAt ?? streamingStartedAt) : null;

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
            <SheetContent>
              <SheetHeader>
                <SheetTitle>会话信息</SheetTitle>
                <SheetDescription>当前会话的详细信息</SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-4 space-y-3">
                <InfoRow label="标题" value={title} />
                {sessionId && <InfoRow label="会话 ID" value={sessionId} mono />}
                <InfoRow label="状态" value={status.narratorState ?? status.state ?? "未知"} />
                {status.modelLabel && <InfoRow label="模型" value={status.modelLabel} />}
                {status.modelId && !status.modelLabel && <InfoRow label="模型 ID" value={status.modelId} mono />}
                {status.permissionMode && <InfoRow label="权限模式" value={status.permissionMode} />}
                {status.reasoningEffort && <InfoRow label="推理强度" value={status.reasoningEffort} />}
                <InfoRow label="消息数" value={String(messages.length)} />
                {status.contextUsage && status.contextUsage.maxTokens && (
                  <InfoRow label="上下文" value={`${status.contextUsage.usedTokens} / ${status.contextUsage.maxTokens} (${Math.round((status.contextUsage.usedTokens / status.contextUsage.maxTokens) * 100)}%)`} />
                )}
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

      {/* ── Recovery notice ── */}
      {recoveryNotice && recoveryNotice.state !== "idle" && (
        <div className="shrink-0 border-b border-border bg-yellow-50 px-4 py-2 text-xs text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
          {recoveryNotice.state === "failed" ? "会话恢复失败" : "正在恢复会话..."} {recoveryNotice.reason && `— ${recoveryNotice.reason}`}
        </div>
      )}

      {/* ── Message stream ── */}
      <div className="flex flex-col flex-1 min-h-0 px-4 py-3 overflow-hidden">
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

      {/* ── Footer actions (if any) ── */}
      {footerActions}

      {/* ── Git status bar (when workspace is available) ── */}
      {status.workspace && (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-border bg-muted/30 px-4 py-1 text-[10px] text-muted-foreground">
          <span>🏠</span>
          <span className="truncate font-medium">{status.workspace.path?.split(/[/\\]/).pop() ?? "工作区"}</span>
          {status.workspace.branch && (
            <>
              <span>·</span>
              <span className="truncate font-mono">{status.workspace.branch}</span>
            </>
          )}
          {status.workspace.changes != null && (
            <>
              <span>·</span>
              <span className="rounded bg-blue-500/10 px-1 text-blue-600">{status.workspace.changes} 变更</span>
            </>
          )}
          {status.workspace.git?.status === "clean" && (
            <>
              <span>·</span>
              <span className="text-green-600">✓ 干净</span>
            </>
          )}
          {status.workspace.git?.status === "dirty" && (
            <>
              <span>·</span>
              <span className="text-yellow-600">{status.workspace.git.summary}</span>
            </>
          )}
        </div>
      )}

      {/* ── NarratorStatusBar (above Composer) ── */}
      <NarratorStatusBar
        status={status}
        streamingStartedAt={effectiveStreamingStartedAt}
        onUpdateModel={(providerId, modelId) => { void onUpdateSessionConfig?.({ providerId, modelId }); }}
        onUpdateReasoningEffort={(effort) => { void onUpdateSessionConfig?.({ reasoningEffort: effort }); }}
        onUpdatePermissionMode={(mode) => { void onUpdateSessionConfig?.({ permissionMode: mode }); }}
      />

      {/* ── Composer ── */}
      <Composer
        onSend={onSend}
        onAbort={onAbort}
        onAttach={onAttach}
        onSlashCommandResult={handleSlashCommandResult}
        slashCommandContext={{ status, compactSession: onCompactSession }}
        isRunning={isWorking}
        isInterrupted={isInterrupted}
        disabledReason={sendDisabledReason}
        settingsHref={settingsHref}
      />
    </section>
    </TooltipProvider>
  );
}

export type { ConversationSurfaceMessage };

// ---------------------------------------------------------------------------
// InfoRow — 会话信息面板的键值行
// ---------------------------------------------------------------------------

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={`text-xs text-right break-all ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

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
