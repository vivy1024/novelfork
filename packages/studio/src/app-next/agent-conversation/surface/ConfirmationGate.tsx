export interface ConversationConfirmation {
  id: string;
  title: string;
  summary?: string;
  target?: string;
  risk?: string;
  permissionSource?: string;
  operation?: string;
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
      <dl>
        {confirmation.target ? <><dt>目标</dt><dd>目标：{confirmation.target}</dd></> : null}
        {confirmation.risk ? <><dt>风险</dt><dd>风险：{confirmation.risk}</dd></> : null}
        {confirmation.permissionSource ? <><dt>来源</dt><dd>来源：{confirmation.permissionSource}</dd></> : null}
        {confirmation.operation ? <><dt>操作</dt><dd>操作：{confirmation.operation}</dd></> : null}
      </dl>
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
