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

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function getToolResultData(result: unknown): unknown {
  const record = asRecord(result);
  return record && "data" in record ? record.data : result;
}

export function getToolResultArtifact(result: unknown): ToolResultArtifact | null {
  const record = asRecord(result);
  const artifact = asRecord(record?.artifact);
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
