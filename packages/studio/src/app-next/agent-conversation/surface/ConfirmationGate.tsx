export interface ConversationConfirmation {
  id: string;
  title: string;
  summary?: string;
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
      <button type="button" onClick={() => onApprove(confirmation.id)}>
        批准
      </button>
      <button type="button" onClick={() => onReject(confirmation.id)}>
        拒绝
      </button>
    </aside>
  );
}
