import { useState } from "react";

export interface ConversationToolCall {
  id: string;
  toolName: string;
  status?: "pending" | "running" | "success" | "error";
  summary?: string;
  input?: unknown;
  result?: unknown;
  durationMs?: number;
}

const STATUS_LABELS: Record<NonNullable<ConversationToolCall["status"]>, string> = {
  pending: "待确认",
  running: "执行中",
  success: "完成",
  error: "失败",
};

export function ToolCallCard({ toolCall }: { toolCall: ConversationToolCall }) {
  const [rawVisible, setRawVisible] = useState(false);

  return (
    <article data-testid={`tool-call-card-${toolCall.id}`} className="tool-call-card">
      <header>
        <strong>{toolCall.toolName}</strong>
        <span>{STATUS_LABELS[toolCall.status ?? "pending"]}</span>
        {typeof toolCall.durationMs === "number" ? <span>{toolCall.durationMs}ms</span> : null}
      </header>
      {toolCall.summary ? <p>{toolCall.summary}</p> : null}
      <button type="button" onClick={() => setRawVisible((visible) => !visible)}>
        展开工具原始数据
      </button>
      {rawVisible ? <pre>{JSON.stringify({ input: toolCall.input, result: toolCall.result }, null, 2)}</pre> : null}
    </article>
  );
}
