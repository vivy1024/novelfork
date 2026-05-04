import type { ReactNode } from "react";

import { CandidateCreatedCard } from "./CandidateCreatedCard";
import { CockpitSnapshotCard } from "./CockpitSnapshotCard";
import { GenericToolResultRenderer } from "./GenericToolResultCard";
import { GuidedPlanCard } from "./GuidedPlanCard";
import { NarrativeLineCard } from "./NarrativeLineCard";
import { PgiCard } from "./PgiCard";
import { QuestionnaireCard } from "./QuestionnaireCard";
import type { ToolResultRenderer, ToolResultRendererContext } from "./types";

const customRenderers = new Map<string, ToolResultRenderer>();

export const RESERVED_TOOL_RESULT_RENDERERS = ["cockpit", "questionnaire", "pgi", "guided", "candidate", "narrative"] as const;

const DEFAULT_RENDERERS: Record<(typeof RESERVED_TOOL_RESULT_RENDERERS)[number], ToolResultRenderer> = {
  cockpit: CockpitSnapshotCard,
  questionnaire: QuestionnaireCard,
  pgi: PgiCard,
  guided: GuidedPlanCard,
  candidate: CandidateCreatedCard,
  narrative: NarrativeLineCard,
};

const TOOL_PREFIX_TO_RENDERER: Record<string, (typeof RESERVED_TOOL_RESULT_RENDERERS)[number]> = {
  cockpit: "cockpit",
  questionnaire: "questionnaire",
  pgi: "pgi",
  guided: "guided",
  candidate: "candidate",
  narrative: "narrative",
};

function rendererFromValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const [prefix] = value.split(".");
  if (prefix && prefix in TOOL_PREFIX_TO_RENDERER) return TOOL_PREFIX_TO_RENDERER[prefix];
  return prefix || null;
}

export function resolveToolResultRendererKey(context: ToolResultRendererContext): string {
  if (context.result && typeof context.result === "object") {
    const renderer = rendererFromValue((context.result as Record<string, unknown>).renderer);
    if (renderer) return renderer;
  }

  return rendererFromValue(context.toolName) ?? "generic";
}

export function registerToolResultRenderer(key: string, renderer: ToolResultRenderer) {
  customRenderers.set(key, renderer);
}

export function getToolResultRenderer(key: string): ToolResultRenderer {
  if (customRenderers.has(key)) return customRenderers.get(key)!;
  if (key in DEFAULT_RENDERERS) return DEFAULT_RENDERERS[key as keyof typeof DEFAULT_RENDERERS];
  return GenericToolResultRenderer;
}

export function renderToolResult(context: ToolResultRendererContext): ReactNode {
  const key = resolveToolResultRendererKey(context);
  const renderer = getToolResultRenderer(key);
  return renderer(context);
}

export { GenericToolResultRenderer };
export type { ToolResultArtifact, ToolResultRenderer, ToolResultRendererContext } from "./types";
