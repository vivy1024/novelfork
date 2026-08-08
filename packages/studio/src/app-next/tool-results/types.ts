import type { ReactNode } from "react";

export interface ToolResultArtifact {
  kind: string;
  id: string;
  title?: string;
  [key: string]: unknown;
}

export interface ToolResultRendererContext {
  toolName: string;
  result: unknown;
  onOpenArtifact?: (artifact: ToolResultArtifact) => void;
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

export function getToolResultData(result: unknown): unknown {
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
