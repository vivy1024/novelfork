import { Composer } from "./Composer";
import { ConfirmationGate, type ConversationConfirmation } from "./ConfirmationGate";
import { ConversationStatusBar, type ConversationSessionConfigPatch, type ConversationStatus } from "./ConversationStatusBar";
import { MessageStream, type ConversationSurfaceMessage } from "./MessageStream";

export interface ConversationRecoveryNotice {
  state: string;
  reason?: string;
}

export interface ConversationSurfaceProps {
  title: string;
  status: ConversationStatus;
  messages: readonly ConversationSurfaceMessage[];
  pendingConfirmation?: ConversationConfirmation | null;
  recoveryNotice?: ConversationRecoveryNotice | null;
  sendDisabledReason?: string;
  settingsHref?: string;
  isRunning?: boolean;
  onApproveConfirmation: (id: string) => void;
  onRejectConfirmation: (id: string) => void;
  onSend: (content: string) => void;
  onAbort?: () => void;
  onUpdateSessionConfig?: (patch: ConversationSessionConfigPatch) => Promise<void> | void;
}

export function ConversationSurface({
  title,
  status,
  messages,
  pendingConfirmation = null,
  recoveryNotice = null,
  sendDisabledReason,
  settingsHref,
  isRunning = false,
  onApproveConfirmation,
  onRejectConfirmation,
  onSend,
  onAbort = () => undefined,
  onUpdateSessionConfig,
}: ConversationSurfaceProps) {
  const showRecoveryNotice = recoveryNotice && recoveryNotice.state !== "idle";

  return (
    <section data-testid="conversation-surface" className="conversation-surface flex h-full flex-col">
      <header className="conversation-surface__header shrink-0">
        <h2>{title}</h2>
        <ConversationStatusBar status={status} onUpdateSessionConfig={onUpdateSessionConfig} />
      </header>
      {showRecoveryNotice ? (
        <aside data-testid="conversation-recovery-notice" className="conversation-recovery-notice shrink-0">
          恢复状态：{recoveryNotice.state}{recoveryNotice.reason ? ` / ${recoveryNotice.reason}` : ""}
        </aside>
      ) : null}
      {pendingConfirmation ? (
        <ConfirmationGate confirmation={pendingConfirmation} onApprove={onApproveConfirmation} onReject={onRejectConfirmation} />
      ) : null}
      <MessageStream messages={messages} />
      <Composer onSend={onSend} onAbort={onAbort} isRunning={isRunning} disabledReason={sendDisabledReason} settingsHref={settingsHref} />
    </section>
  );
}

export type { ConversationSurfaceMessage };
