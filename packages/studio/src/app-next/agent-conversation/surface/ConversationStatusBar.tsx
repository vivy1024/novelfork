export interface ConversationStatus {
  state: string;
  label: string;
  modelLabel?: string;
}

export function ConversationStatusBar({ status }: { status: ConversationStatus }) {
  return (
    <div className="conversation-status-bar">
      <span>{status.label}</span>
      {status.modelLabel ? <span>{status.modelLabel}</span> : null}
    </div>
  );
}
