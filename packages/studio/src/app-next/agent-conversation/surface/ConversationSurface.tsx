import { useState, type ReactNode } from "react";

import type { ToolResultArtifact } from "../../tool-results";
import type { SlashCommandExecutionContext, SlashCommandExecutionResult } from "../slash-command-registry";
import { Composer } from "./Composer";
import { ConfirmationGate, type ConversationConfirmation } from "./ConfirmationGate";
import { ConversationStatusBar, type ConversationSessionConfigPatch, type ConversationStatus } from "./ConversationStatusBar";
import { MessageStream, type ConversationSurfaceMessage } from "./MessageStream";

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
  onApproveConfirmation: (id: string) => void;
  onRejectConfirmation: (id: string) => void;
  onSend: (content: string) => void;
  onAbort?: () => void;
  onUpdateSessionConfig?: (patch: ConversationSessionConfigPatch) => Promise<void> | void;
  onCompactSession?: SlashCommandExecutionContext["compactSession"];
  onSlashCommandResult?: (result: SlashCommandExecutionResult) => void;
  onOpenArtifact?: (artifact: ToolResultArtifact) => void;
}

function recoveryTitle(notice: ConversationRecoveryNotice): string {
  if (notice.state === "resetting") return "需要重新加载快照";
  if (notice.state === "replaying") return "正在恢复会话历史";
  if (notice.state === "failed") return "会话恢复失败";
  return "会话恢复状态";
}

function recoveryCursorText(notice: ConversationRecoveryNotice): string | null {
  if (typeof notice.lastSeq !== "number" && typeof notice.ackedSeq !== "number") return null;
  return `最近成功 cursor：${notice.ackedSeq ?? 0} / ${notice.lastSeq ?? 0}`;
}

function conversationEmptyBinding(status: ConversationStatus): string {
  return status.binding?.label ?? "未绑定作品或章节";
}

function conversationEmptyModelStatus(status: ConversationStatus): string {
  const sessionConfigLoaded = status.sessionConfigLoaded ?? Boolean(status.providerId || status.modelId || status.permissionMode || status.reasoningEffort);
  if (!sessionConfigLoaded) return "session config 未加载";
  const provider = status.providerLabel ?? status.providerId;
  const model = status.modelLabel ?? status.modelId;
  if (provider && model) return `${provider} / ${model}`;
  return model ?? provider ?? "未选择模型";
}

function ConversationRuntimeControls({
  isRunning,
  onAbort,
  onCompactSession,
}: {
  readonly isRunning: boolean;
  readonly onAbort: () => void;
  readonly onCompactSession?: SlashCommandExecutionContext["compactSession"];
}) {
  const [status, setStatus] = useState<string | null>(null);

  async function compact() {
    if (!onCompactSession) return;
    const result = await onCompactSession();
    setStatus(`Compact 完成：${result.compactedMessageCount} 条，预算 ${result.budget.estimatedTokensBefore} → ${result.budget.estimatedTokensAfter}`);
  }

  return (
    <aside data-testid="conversation-runtime-controls" className="conversation-runtime-controls glass-panel flex shrink-0 flex-wrap items-center gap-2 rounded-2xl p-3 text-sm" aria-label="会话运行控制">
      <button type="button" aria-label="中断运行" disabled={!isRunning} onClick={onAbort}>中断</button>
      {!isRunning ? <span>无运行中的会话</span> : null}
      <button type="button" disabled>重试</button>
      <span>重试未接入真实 API</span>
      <button type="button" disabled>清空</button>
      <span>清空未接入真实 API</span>
      <button type="button" disabled={!onCompactSession} onClick={() => void compact()}>Compact</button>
      {!onCompactSession ? <span>Compact 未接入真实 API</span> : null}
      <button type="button" disabled>Fork</button>
      <span>Fork 请使用 /fork 或会话列表入口</span>
      <button type="button" disabled>Resume</button>
      <span>Resume 请使用 /resume 或会话列表入口</span>
      {status ? <span role="status">{status}</span> : null}
    </aside>
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
  onApproveConfirmation,
  onRejectConfirmation,
  onSend,
  onAbort = () => undefined,
  onUpdateSessionConfig,
  onCompactSession,
  onSlashCommandResult,
  onOpenArtifact,
}: ConversationSurfaceProps) {
  const showRecoveryNotice = recoveryNotice && recoveryNotice.state !== "idle";
  const showEmptyStateDisabledReason = Boolean(sendDisabledReason) && !footerActions;

  const handleSlashCommandResult = (result: SlashCommandExecutionResult) => {
    onSlashCommandResult?.(result);
    if (result.ok && result.kind === "update-session-config") {
      void onUpdateSessionConfig?.(result.patch);
    }
  };

  return (
    <section data-testid="conversation-surface" className="conversation-surface flex h-full min-h-0 flex-col gap-4 overflow-hidden bg-background/95 p-4">
      <header data-testid="conversation-session-header" className="conversation-surface__header conversation-session-header paper-sheet shrink-0 space-y-4 rounded-3xl p-4">
        <h2>{title}</h2>
        <ConversationStatusBar status={status} onUpdateSessionConfig={onUpdateSessionConfig} />
      </header>
      {showRecoveryNotice || pendingConfirmation ? (
        <section data-testid="conversation-recovery-confirmation-lane" className="conversation-recovery-confirmation-lane glass-panel shrink-0 space-y-3 rounded-2xl p-3" aria-label="恢复与权限事件">
          {showRecoveryNotice ? (
            <aside data-testid="conversation-recovery-notice" className="conversation-recovery-notice rounded-xl border border-border/70 bg-muted/40 p-3 text-sm">
              <strong>{recoveryTitle(recoveryNotice)}</strong>
              {recoveryNotice.reason ? <span> / {recoveryNotice.reason}</span> : null}
              {recoveryCursorText(recoveryNotice) ? <span> / {recoveryCursorText(recoveryNotice)}</span> : null}
              {recoveryNotice.actionLabel ? <button type="button" onClick={() => undefined}>{recoveryNotice.actionLabel}</button> : null}
            </aside>
          ) : null}
          {pendingConfirmation ? (
            <ConfirmationGate confirmation={pendingConfirmation} onApprove={onApproveConfirmation} onReject={onRejectConfirmation} />
          ) : null}
        </section>
      ) : null}
      {messages.length === 0 ? (
        <article data-testid="conversation-empty-state" className="conversation-empty-state paper-sheet mx-auto w-full max-w-2xl rounded-3xl p-6 text-center" aria-label="空会话提示">
          <h3>还没有消息</h3>
          <p>当前绑定：{conversationEmptyBinding(status)}</p>
          <p>可以输入写作目标、使用 /status 查看会话状态，或使用 /compact 压缩上下文。</p>
          <p>模型状态：{conversationEmptyModelStatus(status)}</p>
          {showEmptyStateDisabledReason ? <p role="alert">{sendDisabledReason}</p> : null}
          {showEmptyStateDisabledReason && settingsHref ? <a href={settingsHref}>打开设置</a> : null}
        </article>
      ) : null}
      <MessageStream messages={messages} onOpenArtifact={onOpenArtifact} />
      {footerActions}
      <ConversationRuntimeControls isRunning={isRunning} onAbort={onAbort} onCompactSession={onCompactSession} />
      <Composer
        onSend={onSend}
        onAbort={onAbort}
        onSlashCommandResult={handleSlashCommandResult}
        slashCommandContext={{ status, compactSession: onCompactSession }}
        isRunning={isRunning}
        disabledReason={sendDisabledReason}
        settingsHref={settingsHref}
      />
    </section>
  );
}

export type { ConversationSurfaceMessage };
