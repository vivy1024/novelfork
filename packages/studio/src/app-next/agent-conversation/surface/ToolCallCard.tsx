import { useMemo, useState } from "react";

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

const SECRET_KEY_PATTERN = /(api[-_]?key|access[-_]?token|token|secret|password|credential|authorization)/i;
const SECRET_VALUE_PATTERN = /\b(sk-[A-Za-z0-9_-]{6,}|secret-[A-Za-z0-9_-]+)\b/g;

function redactString(value: string): string {
  return value.replace(SECRET_VALUE_PATTERN, "[REDACTED]");
}

function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSecrets(entry)]));
}

function sanitizeToolCall(toolCall: ConversationToolCall): ConversationToolCall {
  return {
    ...toolCall,
    summary: toolCall.summary ? redactString(toolCall.summary) : toolCall.summary,
    input: redactSecrets(toolCall.input),
    result: redactSecrets(toolCall.result),
    output: toolCall.output ? redactString(toolCall.output) : toolCall.output,
    error: toolCall.error ? redactString(toolCall.error) : toolCall.error,
  };
}

function toolCallTranscript(toolCall: ConversationToolCall): string {
  return [
    `工具：${toolCall.toolName}`,
    toolCall.status ? `状态：${STATUS_LABELS[toolCall.status]}` : undefined,
    toolCall.summary ? `摘要：${toolCall.summary}` : undefined,
    toolCall.input !== undefined ? `输入：${JSON.stringify(toolCall.input, null, 2)}` : undefined,
    toolCall.result !== undefined ? `结果：${JSON.stringify(toolCall.result, null, 2)}` : undefined,
    toolCall.output ? `输出：${toolCall.output}` : undefined,
    toolCall.error ? `错误：${toolCall.error}` : undefined,
  ].filter((part): part is string => Boolean(part)).join("\n\n");
}

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
  const [fullscreenVisible, setFullscreenVisible] = useState(false);
  const sanitizedToolCall = useMemo(() => sanitizeToolCall(toolCall), [toolCall]);
  const checkpointSummary = checkpointSummaryFrom(sanitizedToolCall.result);

  async function copySummary() {
    await navigator.clipboard?.writeText(toolCallTranscript(sanitizedToolCall));
  }

  return (
    <article data-testid={`tool-call-card-${toolCall.id}`} className="tool-call-card">
      {hasLegacyBlockDetails(sanitizedToolCall) ? (
        <ToolCallBlock
          toolCall={toSessionToolCall(sanitizedToolCall)}
          defaultExpanded={sanitizedToolCall.status === "error" || sanitizedToolCall.status === "running"}
          onOpenCanvas={onOpenArtifact as ((artifact: unknown) => void) | undefined}
        />
      ) : (
        <>
          <header>
            <strong>{sanitizedToolCall.toolName}</strong>
            <span>{STATUS_LABELS[sanitizedToolCall.status ?? "pending"]}</span>
            {typeof sanitizedToolCall.durationMs === "number" ? <span>{sanitizedToolCall.durationMs}ms</span> : null}
            <button type="button" aria-label="复制工具调用摘要" onClick={() => void copySummary()}>复制</button>
            <button type="button" aria-label="全屏查看" onClick={() => setFullscreenVisible(true)}>全屏查看</button>
          </header>
          {sanitizedToolCall.summary ? <p>{sanitizedToolCall.summary}</p> : null}
          {sanitizedToolCall.result !== undefined ? renderToolResult({ toolName: sanitizedToolCall.toolName, result: sanitizedToolCall.result, onOpenArtifact }) : null}
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
      {rawVisible ? <pre>{JSON.stringify({ input: sanitizedToolCall.input, result: sanitizedToolCall.result }, null, 2)}</pre> : null}
      {fullscreenVisible ? (
        <section role="dialog" aria-label="工具调用全屏详情">
          <button type="button" onClick={() => setFullscreenVisible(false)}>关闭</button>
          <pre>{toolCallTranscript(sanitizedToolCall)}</pre>
        </section>
      ) : null}
    </article>
  );
}
