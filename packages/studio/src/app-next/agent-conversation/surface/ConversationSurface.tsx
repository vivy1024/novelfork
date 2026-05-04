import { Composer } from "./Composer";
import { ConfirmationGate, type ConversationConfirmation } from "./ConfirmationGate";
import { ConversationStatusBar, type ConversationStatus } from "./ConversationStatusBar";
import { MessageStream, type ConversationSurfaceMessage } from "./MessageStream";

export interface ConversationSurfaceProps {
  title: string;
  status: ConversationStatus;
  messages: readonly ConversationSurfaceMessage[];
  pendingConfirmation?: ConversationConfirmation | null;
  isRunning?: boolean;
  onApproveConfirmation: (id: string) => void;
  onRejectConfirmation: (id: string) => void;
  onSend: (content: string) => void;
  onAbort?: () => void;
}

export function ConversationSurface({
  title,
  status,
  messages,
  pendingConfirmation = null,
  isRunning = false,
  onApproveConfirmation,
  onRejectConfirmation,
  onSend,
  onAbort = () => undefined,
}: ConversationSurfaceProps) {
  return (
    <section data-testid="conversation-surface" className="conversation-surface">
      <header>
        <h2>{title}</h2>
        <ConversationStatusBar status={status} />
      </header>
      {pendingConfirmation ? (
        <ConfirmationGate confirmation={pendingConfirmation} onApprove={onApproveConfirmation} onReject={onRejectConfirmation} />
      ) : null}
      <MessageStream messages={messages} />
      <Composer onSend={onSend} onAbort={onAbort} isRunning={isRunning} />
    </section>
  );
}

export type { ConversationSurfaceMessage };
