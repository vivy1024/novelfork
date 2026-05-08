import { useEffect, useState, type ReactNode } from "react";
import { Settings, Search, ExternalLink, Pencil, Sparkles, FileCode, Info, Archive } from "lucide-react";

import type { ToolResultArtifact } from "../../tool-results";
import type { SlashCommandExecutionContext, SlashCommandExecutionResult } from "../slash-command-registry";
import { Composer } from "./Composer";
import { ConfirmationGate, type ConversationConfirmation } from "./ConfirmationGate";
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
  onApproveConfirmation: (id: string) => void;
  onRejectConfirmation: (id: string) => void;
  onSend: (content: string) => void;
  onAbort?: () => void;
  onUpdateSessionConfig?: (patch: ConversationSessionConfigPatch) => Promise<void> | void;
  onCompactSession?: SlashCommandExecutionContext["compactSession"];
  onSlashCommandResult?: (result: SlashCommandExecutionResult) => void;
  onOpenArtifact?: (artifact: ToolResultArtifact) => void;
  /** 附件上传回调 */
  onAttach?: (files: FileList) => void;
  /** 工具栏回调 */
  onEditTitle?: (newTitle: string) => void;
  onGenerateTitle?: () => void;
  onArchive?: () => void;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes > 0 ? `${minutes}:${secs.toString().padStart(2, "0")}` : `0:${secs.toString().padStart(2, "0")}`;
}

function ThinkingTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(Date.now() - startedAt);
  useEffect(() => {
    const interval = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);
  return (
    <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
      <span className="inline-block size-2 animate-pulse rounded-full bg-blue-500" />
      思考中 {formatDuration(elapsed)}
    </span>
  );
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
  onEditTitle,
  onGenerateTitle,
  onArchive,
}: ConversationSurfaceProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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
  };

  const modelLabel = status.modelLabel ?? status.modelId ?? "";
  const permissionLabel = status.permissionMode ?? "edit";
  const isWorking = status.narratorState === "working" || status.state === "running";
  const isInterrupted = status.substatus === "interrupted";
  const effectiveStreamingStartedAt = isWorking ? (status.streamingStartedAt ?? streamingStartedAt) : null;

  // 搜索过滤（对标 NarraFork messageSearchPlaceholder: "搜索已加载消息..."）
  const filteredMessages = searchQuery
    ? messages.filter((m) => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages;

  return (
    <TooltipProvider>
    <section data-testid="conversation-surface" className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {/* ── Top toolbar ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={handleOpenExternal} />}>
              <ExternalLink className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>在新标签打开</TooltipContent>
          </Tooltip>
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={handleEditTitle} />}>
              <Pencil className="size-3" />
            </TooltipTrigger>
            <TooltipContent>编辑标题</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={() => onGenerateTitle?.()} />}>
              <Sparkles className="size-3" />
            </TooltipTrigger>
            <TooltipContent>生成标题</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-0.5">
          {isWorking && effectiveStreamingStartedAt && <ThinkingTimer startedAt={effectiveStreamingStartedAt} />}
          {!isWorking && status.lastTurnDurationMs != null && (
            <span className="text-xs text-muted-foreground mr-2">空闲 · 上轮耗时 {formatDuration(status.lastTurnDurationMs)}</span>
          )}
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => setSearchOpen(!searchOpen)} />}>
              <Search className="size-4" />
            </TooltipTrigger>
            <TooltipContent>搜索</TooltipContent>
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
                <p className="text-sm text-muted-foreground py-8 text-center">暂无文件修改记录</p>
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
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => onArchive?.()} />}>
              <Archive className="size-4" />
            </TooltipTrigger>
            <TooltipContent>归档</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => settingsHref && (window.location.href = settingsHref)} />}>
              <Settings className="size-4" />
            </TooltipTrigger>
            <TooltipContent>设置</TooltipContent>
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
      <div className="flex-1 min-h-0 px-4 py-3 overflow-hidden">
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
            <MessageStream messages={filteredMessages} />
            {/* Confirmation gate inline */}
            {pendingConfirmation && (
              <div className="my-3">
                <ConfirmationGate confirmation={pendingConfirmation} onApprove={onApproveConfirmation} onReject={onRejectConfirmation} />
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
      <NarratorStatusBar status={status} />

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
