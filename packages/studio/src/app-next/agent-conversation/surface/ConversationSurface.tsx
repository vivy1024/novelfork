import type { ReactNode } from "react";

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

  const handleSlashCommandResult = (result: SlashCommandExecutionResult) => {
    onSlashCommandResult?.(result);
    if (result.ok && result.kind === "update-session-config") {
      void onUpdateSessionConfig?.(result.patch);
    }
  };

  return (
    <section data-testid="conversation-surface" className="conversation-surface flex h-full flex-col">
      <header className="conversation-surface__header shrink-0">
        <h2>{title}</h2>
        <ConversationStatusBar status={status} onUpdateSessionConfig={onUpdateSessionConfig} />
      </header>
      {showRecoveryNotice ? (
        <aside data-testid="conversation-recovery-notice" className="conversation-recovery-notice shrink-0">
          <strong>{recoveryTitle(recoveryNotice)}</strong>
          {recoveryNotice.reason ? <span> / {recoveryNotice.reason}</span> : null}
          {recoveryCursorText(recoveryNotice) ? <span> / {recoveryCursorText(recoveryNotice)}</span> : null}
          {recoveryNotice.actionLabel ? <button type="button" onClick={() => undefined}>{recoveryNotice.actionLabel}</button> : null}
        </aside>
      ) : null}
      {pendingConfirmation ? (
        <ConfirmationGate confirmation={pendingConfirmation} onApprove={onApproveConfirmation} onReject={onRejectConfirmation} />
      ) : null}
      <MessageStream messages={messages} onOpenArtifact={onOpenArtifact} />
      {footerActions}
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
