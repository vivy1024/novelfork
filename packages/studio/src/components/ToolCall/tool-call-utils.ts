import type { ToolCall, ToolCallStatus } from "@/stores/windowStore";

const TOOL_NAME_KEYS = ["toolName", "name", "tool", "tool_name"] as const;
const TOOL_CALL_COLLECTION_KEYS = ["toolCalls", "tool_calls", "tools"] as const;
const TEXT_CONTENT_KEYS = ["content", "message", "text", "response"] as const;

export type ToolCallKind = "bash" | "read" | "write" | "search" | "web" | "mcp" | "agent" | "other";

export interface ParsedAssistantPayload {
  content: string;
  toolCalls: ToolCall[];
}

export function parseAssistantPayload(raw: unknown, fallbackContent = ""): ParsedAssistantPayload {
  if (typeof raw === "string") {
    return { content: raw, toolCalls: [] };
  }

  if (!isRecord(raw)) {
    return { content: fallbackContent, toolCalls: [] };
  }

  const content = pickFirstString(raw, TEXT_CONTENT_KEYS) ?? fallbackContent;

  const toolCalls = TOOL_CALL_COLLECTION_KEYS.flatMap((key) => {
    const value = raw[key];
    return Array.isArray(value)
      ? value.map((item, index) => normalizeToolCall(item, index)).filter((item): item is ToolCall => item !== null)
      : [];
  });

  return { content, toolCalls };
}

export function normalizeToolCall(raw: unknown, index = 0): ToolCall | null {
  if (!isRecord(raw)) {
    return null;
  }

  const toolName = pickFirstString(raw, TOOL_NAME_KEYS) ?? `tool-${index + 1}`;
  const command = pickFirstString(raw, ["command", "cmd", "description"]);
  const output = stringifyUnknown(raw.output ?? raw.result ?? raw.data);
  const error = pickFirstString(raw, ["error", "stderr", "message"]);
  const summary =
    pickFirstString(raw, ["summary", "label", "title"]) ??
    command ??
    firstLine(output) ??
    (error ? `执行失败：${truncate(error, 80)}` : undefined);

  const duration = pickFirstNumber(raw, ["duration", "durationMs", "elapsedMs"]);
  const exitCode = pickFirstNumber(raw, ["exitCode", "code"]);
  const status = normalizeStatus(raw.status, error, exitCode);
  const startedAt = pickFirstNumber(raw, ["startedAt", "startTime", "timestamp"]);
  const finishedAt = pickFirstNumber(raw, ["finishedAt", "endTime"]);
  const input = raw.input ?? raw.params ?? raw.arguments ?? raw.args;
  const result = raw.result ?? raw.data;

  return {
    id: typeof raw.id === "string" ? raw.id : `${toolName}-${index}`,
    toolName,
    status,
    summary,
    command,
    input,
    duration,
    output,
    result,
    error,
    exitCode,
    startedAt,
    finishedAt,
  };
}

export function buildToolCallSummary(toolCall: ToolCall): string {
  if (toolCall.summary?.trim()) {
    return toolCall.summary.trim();
  }

  if (toolCall.error?.trim()) {
    return `执行失败：${truncate(toolCall.error.trim(), 80)}`;
  }

  if (toolCall.command?.trim()) {
    return truncate(toolCall.command.trim(), 100);
  }

  const inputPreview = stringifyUnknown(toolCall.input);
  if (inputPreview) {
    return `调用参数：${truncate(firstLine(inputPreview) ?? inputPreview, 80)}`;
  }

  const outputPreview = firstLine(toolCall.output);
  if (outputPreview) {
    return truncate(outputPreview, 100);
  }

  return "暂无摘要";
}

export function formatToolCallDuration(duration?: number): string {
  if (typeof duration !== "number" || Number.isNaN(duration) || duration < 0) {
    return "--";
  }

  if (duration < 1000) {
    return `${Math.round(duration)}ms`;
  }

  return `${(duration / 1000).toFixed(duration >= 10_000 ? 0 : 1)}s`;
}

export function getToolCallStatusLabel(status?: ToolCallStatus): string {
  switch (status) {
    case "pending":
      return "待执行";
    case "running":
      return "执行中";
    case "error":
      return "失败";
    case "success":
    default:
      return "完成";
  }
}

export function getToolCallKind(toolName: string): ToolCallKind {
  const normalized = toolName.trim().toLowerCase();

  if (!normalized) {
    return "other";
  }

  if (normalized.startsWith("mcp__") || normalized.includes("mcp")) {
    return "mcp";
  }

  if (["bash", "shell", "terminal", "command"].includes(normalized)) {
    return "bash";
  }

  if (["read", "open", "view"].includes(normalized)) {
    return "read";
  }

  if (["write", "edit", "update", "patch"].includes(normalized)) {
    return "write";
  }

  if (["grep", "glob", "search", "find"].includes(normalized)) {
    return "search";
  }

  if (["webfetch", "fetch", "browser", "web", "openurl", "web_search"].includes(normalized)) {
    return "web";
  }

  if (normalized.includes("agent") || normalized.includes("delegate") || normalized.includes("task")) {
    return "agent";
  }

  return "other";
}

export function getToolCallPrimaryTarget(toolCall: ToolCall): string | undefined {
  const inputRecord = asRecord(toolCall.input);

  switch (getToolCallKind(toolCall.toolName)) {
    case "read":
    case "write":
      return pickFirstString(inputRecord, ["file_path", "path", "target", "url"]);
    case "search":
      return pickFirstString(inputRecord, ["pattern", "glob", "path", "query"]);
    case "web":
      return pickFirstString(inputRecord, ["url", "selector", "purpose"]);
    case "mcp": {
      const mcpParts = parseMcpToolName(toolCall.toolName);
      if (mcpParts) {
        return `${mcpParts.server} / ${mcpParts.tool}`;
      }
      return pickFirstString(inputRecord, ["serverName", "toolName", "tool", "resource"]);
    }
    case "agent":
      return pickFirstString(inputRecord, ["description", "subagent_type", "task_id", "prompt"]);
    default:
      return pickFirstString(inputRecord, ["path", "target", "url"]);
  }
}

export function getToolCallTimelineLabel(timestamp?: number): string | undefined {
  if (typeof timestamp !== "number" || Number.isNaN(timestamp) || timestamp <= 0) {
    return undefined;
  }

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function buildToolCallTranscript(toolCall: ToolCall): string {
  const parts = [
    toolCall.command ? `命令\n${toolCall.command}` : undefined,
    stringifyUnknown(toolCall.input) ? `输入\n${stringifyUnknown(toolCall.input)}` : undefined,
    toolCall.output?.trim() ? `输出\n${toolCall.output.trim()}` : undefined,
    stringifyUnknown(toolCall.result) ? `结果\n${stringifyUnknown(toolCall.result)}` : undefined,
    toolCall.error?.trim() ? `错误\n${toolCall.error.trim()}` : undefined,
  ].filter((part): part is string => Boolean(part));

  return parts.join("\n\n");
}

function normalizeStatus(rawStatus: unknown, error?: string, exitCode?: number): ToolCallStatus {
  if (rawStatus === "pending" || rawStatus === "running" || rawStatus === "success" || rawStatus === "error") {
    return rawStatus;
  }

  if (error || (typeof exitCode === "number" && exitCode !== 0)) {
    return "error";
  }

  return outputLikePending(rawStatus) ? "running" : "success";
}

function outputLikePending(rawStatus: unknown): boolean {
  return rawStatus === "in_progress" || rawStatus === "processing";
}

function pickFirstString(record: Record<string, unknown> | undefined, keys: readonly string[]): string | undefined {
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function pickFirstNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringifyUnknown(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function firstLine(value?: string): string | undefined {
  return value?.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
}

function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  const parts = toolName.split("__").filter(Boolean);
  if (parts.length < 3 || parts[0]?.toLowerCase() !== "mcp") {
    return null;
  }

  return {
    server: parts[1] ?? "server",
    tool: parts.slice(2).join("__") || "tool",
  };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
