import type { ReactNode } from "react";

export interface ToolResultArtifact {
  kind: string;
  id: string;
  title?: string;
  [key: string]: unknown;
}

export interface ToolResultAction {
  type: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolResultRendererContext {
  toolName: string;
  result: unknown;
  onOpenArtifact?: (artifact: ToolResultArtifact) => void;
  onAction?: (action: ToolResultAction) => Promise<unknown> | unknown;
}

export type ToolResultRenderer = (context: ToolResultRendererContext) => ReactNode;

export interface SecondaryModelCallRow {
  readonly id: string;
  readonly sequence: number;
  readonly purpose: string;
  readonly provider: string;
  readonly model: string;
  readonly status: "completed" | "failed";
  readonly durationMs: number | null;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  readonly messageCount: number | null;
  readonly error: string;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * 解包 Runtime 对长工具输出生成的 `{ _truncated: true, preview: "{\"ok\":true,\"summary\":\"...\"}", fullLength }` 包装：
 * - 若 `preview` 本身是完整 JSON，直接解析还原；
 * - 若 `preview` 在半截被截断，用正则安全提取 `ok`、`summary`、`error` 等顶层核心字段，避免小卡片把转义 JSON 字符串原样吐给作者。
 */
export function unwrapTruncatedToolPayload(result: unknown): {
  readonly unwrapped: Record<string, unknown> | null;
  readonly isTruncated: boolean;
  readonly fullLength: number | null;
  readonly rawPreview: string;
} {
  const outer = asRecord(result);
  if (!outer || outer._truncated !== true || typeof outer.preview !== "string") {
    return { unwrapped: outer, isTruncated: false, fullLength: null, rawPreview: "" };
  }
  const preview = outer.preview;
  const fullLength = typeof outer.fullLength === "number" && Number.isFinite(outer.fullLength) ? outer.fullLength : null;
  try {
    const parsed = JSON.parse(preview) as unknown;
    const rec = asRecord(parsed);
    if (rec) {
      return { unwrapped: rec, isTruncated: true, fullLength, rawPreview: preview };
    }
  } catch {
    // JSON 在中间被截断：从 preview 提取顶层 summary / error / ok
  }
  const decodeEscaped = (raw: string): string => {
    try {
      return JSON.parse(`"${raw}"`) as string;
    } catch {
      return raw.replace(/\\"/g, "\"").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
    }
  };
  const summaryMatch = /"summary"\s*:\s*"((?:\\.|[^"\\])*)/u.exec(preview);
  const errorMatch = /"error"\s*:\s*"((?:\\.|[^"\\])*)/u.exec(preview);
  const okMatch = /"ok"\s*:\s*(true|false)/u.exec(preview);
  const extracted: Record<string, unknown> = {};
  if (okMatch) extracted.ok = okMatch[1] === "true";
  if (summaryMatch?.[1]) extracted.summary = decodeEscaped(summaryMatch[1]);
  if (errorMatch?.[1]) extracted.error = decodeEscaped(errorMatch[1]);
  return {
    unwrapped: Object.keys(extracted).length > 0 ? extracted : null,
    isTruncated: true,
    fullLength,
    rawPreview: preview,
  };
}

export function getToolResultData(result: unknown): unknown {
  const { unwrapped } = unwrapTruncatedToolPayload(result);
  if (unwrapped && "data" in unwrapped) return unwrapped.data;
  if (unwrapped) return unwrapped;
  const record = asRecord(result);
  return record && "data" in record ? record.data : result;
}

export function getToolResultArtifact(result: unknown): ToolResultArtifact | null {
  const record = asRecord(result);
  const data = asRecord(record?.data);
  const artifact = asRecord(record?.artifact) ?? asRecord(data?.artifact);
  if (!artifact || typeof artifact.kind !== "string" || typeof artifact.id !== "string") return null;
  return artifact as ToolResultArtifact;
}

export function getString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function readSecondaryModelCalls(value: unknown): SecondaryModelCallRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const usage = asRecord(record.usage);
    const request = asRecord(record.request);
    const status: SecondaryModelCallRow["status"] = record.status === "failed" ? "failed" : "completed";
    return [{
      id: getString(record.id, `model-call-${index}`),
      sequence: getNumber(record.sequence) ?? index + 1,
      purpose: getString(record.purpose, "内部模型处理"),
      provider: getString(record.provider, "runtime"),
      model: getString(record.model, "current"),
      status,
      durationMs: getNumber(record.durationMs),
      promptTokens: getNumber(usage?.promptTokens),
      completionTokens: getNumber(usage?.completionTokens),
      totalTokens: getNumber(usage?.totalTokens),
      messageCount: getNumber(request?.messageCount),
      error: getString(record.error),
    }];
  }).sort((left, right) => left.sequence - right.sequence);
}
