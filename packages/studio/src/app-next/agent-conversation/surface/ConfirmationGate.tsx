export interface ConversationConfirmation {
  id: string;
  title: string;
  summary?: string;
  error?: string;
  busy?: boolean;
}

export function ConfirmationGate({
  confirmation,
  onApprove,
  onReject,
}: {
  confirmation: ConversationConfirmation;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <aside data-testid="confirmation-gate" className="confirmation-gate">
      <h3>{confirmation.title}</h3>
      {confirmation.summary ? <p>{confirmation.summary}</p> : null}
      {confirmation.error ? <p role="alert">确认失败：{confirmation.error}</p> : null}
      <button type="button" disabled={confirmation.busy} onClick={() => onApprove(confirmation.id)}>
        批准
      </button>
      <button type="button" disabled={confirmation.busy} onClick={() => onReject(confirmation.id)}>
        拒绝
      </button>
    </aside>
  );
}
