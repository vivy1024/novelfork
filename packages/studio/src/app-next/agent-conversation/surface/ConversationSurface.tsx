import { useEffect, useRef, useState, type ReactNode } from "react";
import { Settings, Search, Clock } from "lucide-react";

import type { ToolResultArtifact } from "../../tool-results";
import type { SlashCommandExecutionContext, SlashCommandExecutionResult } from "../slash-command-registry";
import { Composer } from "./Composer";
import { ConfirmationGate, type ConversationConfirmation } from "./ConfirmationGate";
import type { ConversationSessionConfigPatch, ConversationStatus, NarratorSubstatus } from "./ConversationStatusBar";
import { MessageStream, type ConversationSurfaceMessage } from "./MessageStream";

/** 对标 NarraFork i18n narratorSubstatus 文案 */
const SUBSTATUS_LABELS: Record<NarratorSubstatus, string> = {
  unread: "已完成",
  error: "错误",
  interrupted: "已中断",
  suspended: "已暂停",
  manual_override: "手动接管",
  reasoning: "推理中",
  compacting: "压缩中",
  planning: "计划中",
  retrying: "重试中",
  queued: "排队中",
};

function substatusLabel(s: NarratorSubstatus): string {
  return SUBSTATUS_LABELS[s] ?? s;
}

export interface ConversationRecoveryNotice {
  state: string;
  reason?: string;
  lastSeq?: number;
  ackedSeq?: number;
  actionLabel?: string;
}

export interface ConversationSurfaceProps {
  title: string;
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
}: ConversationSurfaceProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

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
    <section data-testid="conversation-surface" className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {/* ── Top toolbar ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {status.state === "active" && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900 dark:text-green-300">活跃</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isWorking && effectiveStreamingStartedAt && <ThinkingTimer startedAt={effectiveStreamingStartedAt} />}
          {!isWorking && status.lastTurnDurationMs != null && (
            <span className="text-xs text-muted-foreground">空闲 · 上轮耗时 {formatDuration(status.lastTurnDurationMs)}</span>
          )}
          <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" title="搜索" onClick={() => setSearchOpen(!searchOpen)}>
            <Search className="size-4" />
          </button>
          <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" title="设置" onClick={() => settingsHref && (window.location.href = settingsHref)}>
            <Settings className="size-4" />
          </button>
        </div>
      </header>

      {/* ── Search bar ── */}
      {searchOpen && (
        <div className="shrink-0 border-b border-border px-4 py-2">
          <input
            type="text"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
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
      <div className="flex-1 overflow-y-auto px-4 py-3">
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
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* ── Footer actions (if any) ── */}
      {footerActions}

      {/* ── Bottom status bar ── */}
      <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-1 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <Clock className="size-3" />
          {status.substatus && (
            <span className="font-medium">{substatusLabel(status.substatus)}</span>
          )}
          <span>{messages.length} 条消息</span>
          {status.binding?.label && <span>· {status.binding.label}</span>}
          {status.workspace?.branch && <span>· {status.workspace.branch}</span>}
          {status.workspace?.changes != null && <span>· ±{status.workspace.changes}</span>}
        </div>
        <div className="flex items-center gap-2">
          {status.providerId && <span>{status.providerLabel ?? status.providerId}</span>}
        </div>
      </div>

      {/* ── Composer ── */}
      <Composer
        onSend={onSend}
        onAbort={onAbort}
        onSlashCommandResult={handleSlashCommandResult}
        slashCommandContext={{ status, compactSession: onCompactSession }}
        isRunning={isWorking}
        isInterrupted={isInterrupted}
        disabledReason={sendDisabledReason}
        settingsHref={settingsHref}
      />
    </section>
  );
}

export type { ConversationSurfaceMessage };
