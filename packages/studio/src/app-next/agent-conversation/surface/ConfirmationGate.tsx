export interface ConversationConfirmationResource {
  kind: string;
  id: string;
  bookId?: string;
  title?: string;
}

export interface ConversationConfirmationSource {
  sessionId?: string;
  turnId?: string;
  messageId?: string;
  toolUseId?: string;
}

export interface ConversationConfirmationCheckpoint {
  required: boolean;
  checkpointId?: string;
  paths?: readonly string[];
}

export interface ConversationConfirmationOperation {
  action: string;
  label: string;
}

export interface ConversationConfirmation {
  id: string;
  title: string;
  summary?: string;
  target?: string;
  targetResources?: readonly ConversationConfirmationResource[];
  risk?: string;
  permissionSource?: string;
  source?: ConversationConfirmationSource;
  checkpoint?: ConversationConfirmationCheckpoint;
  diff?: unknown;
  operations?: readonly ConversationConfirmationOperation[];
  operation?: string;
  error?: string;
  busy?: boolean;
}

function resourceText(resource: ConversationConfirmationResource): string {
  return [resource.kind, resource.id, resource.title].filter(Boolean).join(" / ");
}

function sourceItems(source: ConversationConfirmationSource): string[] {
  return [
    source.sessionId ? `Session：${source.sessionId}` : null,
    source.turnId ? `Turn：${source.turnId}` : null,
    source.messageId ? `消息：${source.messageId}` : null,
    source.toolUseId ? `工具调用：${source.toolUseId}` : null,
  ].filter((value): value is string => Boolean(value));
}

function checkpointText(checkpoint: ConversationConfirmationCheckpoint): string {
  if (checkpoint.checkpointId) return `Checkpoint：${checkpoint.checkpointId}`;
  return checkpoint.required ? "Checkpoint：需要创建" : "Checkpoint：不需要";
}

function diffText(diff: unknown): string {
  if (!diff || typeof diff !== "object") return `Diff：${String(diff)}`;
  const record = diff as { status?: unknown; summary?: unknown };
  return [record.status, record.summary].filter((value): value is string => typeof value === "string" && value.length > 0).join(" / ") || JSON.stringify(diff);
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
        {confirmation.targetResources?.length ? <><dt>目标资源</dt><dd>{confirmation.targetResources.map((resource) => <span key={`${resource.kind}:${resource.id}`}>资源：{resourceText(resource)}</span>)}</dd></> : null}
        {confirmation.source ? <><dt>事件来源</dt><dd>{sourceItems(confirmation.source).map((item) => <span key={item}>{item}</span>)}</dd></> : null}
        {confirmation.checkpoint ? <><dt>Checkpoint</dt><dd>{checkpointText(confirmation.checkpoint)}{confirmation.checkpoint.paths?.map((path) => <span key={path}>{path}</span>)}</dd></> : null}
        {confirmation.diff ? <><dt>Diff</dt><dd>Diff：{diffText(confirmation.diff)}</dd></> : null}
        {confirmation.operations?.length ? <><dt>可执行操作</dt><dd>可执行：{confirmation.operations.map((operation) => operation.label).join(" / ")}</dd></> : null}
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
