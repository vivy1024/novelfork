import { useState } from "react";

import { ToolCallBlock } from "@/components/ToolCall";
import type { ToolCall } from "@/shared/session-types";

import { renderToolResult, type ToolResultArtifact } from "../../tool-results";

export interface ConversationToolCall {
  id: string;
  toolName: string;
  status?: "pending" | "running" | "success" | "error";
  summary?: string;
  input?: unknown;
  result?: unknown;
  output?: string;
  error?: string;
  exitCode?: number;
  durationMs?: number;
}

const STATUS_LABELS: Record<NonNullable<ConversationToolCall["status"]>, string> = {
  pending: "待确认",
  running: "执行中",
  success: "完成",
  error: "失败",
};

function toSessionToolCall(toolCall: ConversationToolCall): ToolCall {
  return {
    id: toolCall.id,
    toolName: toolCall.toolName,
    status: toolCall.status,
    summary: toolCall.summary,
    input: toolCall.input,
    result: toolCall.result as ToolCall["result"],
    output: toolCall.output,
    error: toolCall.error,
    exitCode: toolCall.exitCode,
    duration: toolCall.durationMs,
  };
}

function hasLegacyBlockDetails(toolCall: ConversationToolCall): boolean {
  return Boolean(toolCall.output?.trim() || toolCall.error?.trim() || toolCall.exitCode !== undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resourcePathFrom(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.path === "string" && value.path.trim() ? value.path : null;
}

function checkpointSummaryFrom(result: unknown): { checkpointId: string; paths: string[] } | null {
  if (!isRecord(result) || typeof result.checkpointId !== "string") return null;
  const candidates = [result.restoredResources, result.resources, isRecord(result.preview) ? result.preview.resources : undefined]
    .find((value): value is unknown[] => Array.isArray(value));
  const paths = (candidates ?? []).flatMap((resource) => {
    const path = resourcePathFrom(resource);
    return path ? [path] : [];
  });
  return { checkpointId: result.checkpointId, paths };
}

export function ToolCallCard({ toolCall, onOpenArtifact }: { toolCall: ConversationToolCall; onOpenArtifact?: (artifact: ToolResultArtifact) => void }) {
  const [rawVisible, setRawVisible] = useState(false);
  const checkpointSummary = checkpointSummaryFrom(toolCall.result);

  return (
    <article data-testid={`tool-call-card-${toolCall.id}`} className="tool-call-card">
      {hasLegacyBlockDetails(toolCall) ? (
        <ToolCallBlock
          toolCall={toSessionToolCall(toolCall)}
          defaultExpanded={toolCall.status === "error" || toolCall.status === "running"}
          onOpenCanvas={onOpenArtifact as ((artifact: unknown) => void) | undefined}
        />
      ) : (
        <>
          <header>
            <strong>{toolCall.toolName}</strong>
            <span>{STATUS_LABELS[toolCall.status ?? "pending"]}</span>
            {typeof toolCall.durationMs === "number" ? <span>{toolCall.durationMs}ms</span> : null}
          </header>
          {toolCall.summary ? <p>{toolCall.summary}</p> : null}
          {toolCall.result !== undefined ? renderToolResult({ toolName: toolCall.toolName, result: toolCall.result, onOpenArtifact }) : null}
        </>
      )}
      {checkpointSummary ? (
        <section data-testid="tool-checkpoint-summary" className="tool-checkpoint-summary">
          <strong>{`Checkpoint ${checkpointSummary.checkpointId}`}</strong>
          {checkpointSummary.paths.length > 0 ? (
            <ul>
              {checkpointSummary.paths.map((path) => <li key={path}>{path}</li>)}
            </ul>
          ) : null}
        </section>
      ) : null}
      <button type="button" onClick={() => setRawVisible((visible) => !visible)}>
        展开工具原始数据
      </button>
      {rawVisible ? <pre>{JSON.stringify({ input: toolCall.input, result: toolCall.result }, null, 2)}</pre> : null}
    </article>
  );
}
