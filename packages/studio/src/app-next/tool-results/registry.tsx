import type { ReactNode } from "react";

import { BookDissectCard } from "./BookDissectCard";
import { CockpitSnapshotCard } from "./CockpitSnapshotCard";
import { GenericToolResultRenderer } from "./GenericToolResultCard";
import { GuidedPlanCard } from "./GuidedPlanCard";
import { NarrativeLineCard } from "./NarrativeLineCard";
import { OutlineVolumeCard } from "./OutlineVolumeCard";
import { PgiCard } from "./PgiCard";
import { PipelineChapterResultCard } from "./PipelineChapterResultCard";
import { PublishReadinessCard } from "./PublishReadinessCard";
import { QuestionnaireCard } from "./QuestionnaireCard";
import { WorkflowProgressRenderer } from "./WorkflowProgressCard";
import { WritePreflightCard } from "./WritePreflightCard";
import type { ToolResultRenderer, ToolResultRendererContext } from "./types";

const customRenderers = new Map<string, ToolResultRenderer>();

export const RESERVED_TOOL_RESULT_RENDERERS = [
  "cockpit",
  "questionnaire",
  "pgi",
  "guided",
  "narrative",
  "workflow",
  "pipeline",
  "write-preflight",
  "book-dissect",
  "outline-volume",
  "publish-readiness",
] as const;

const DEFAULT_RENDERERS: Record<(typeof RESERVED_TOOL_RESULT_RENDERERS)[number], ToolResultRenderer> = {
  cockpit: CockpitSnapshotCard,
  questionnaire: QuestionnaireCard,
  pgi: PgiCard,
  guided: GuidedPlanCard,
  narrative: NarrativeLineCard,
  workflow: WorkflowProgressRenderer,
  pipeline: PipelineChapterResultCard,
  "write-preflight": WritePreflightCard,
  "book-dissect": BookDissectCard,
  "outline-volume": OutlineVolumeCard,
  "publish-readiness": PublishReadinessCard,
};

const EXACT_RUNTIME_RENDERERS: Record<string, (typeof RESERVED_TOOL_RESULT_RENDERERS)[number]> = {
  cockpit: "cockpit",
  "cockpit.snapshot": "cockpit",
  questionnaire: "questionnaire",
  pgi: "pgi",
  guided: "guided",
  narrative: "narrative",
  workflow: "workflow",
  pipeline: "pipeline",
  "pipeline.chapter-result": "pipeline",
  "pipeline.write": "pipeline",
  "write.preflight": "write-preflight",
  "write-preflight": "write-preflight",
  "book.dissect": "book-dissect",
  "book-dissect": "book-dissect",
  "outline.volume": "outline-volume",
  "outline-volume": "outline-volume",
  "publish.check": "publish-readiness",
  "publish-readiness": "publish-readiness",
  "compliance.publish-readiness": "publish-readiness",
};

function rendererFromValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return EXACT_RUNTIME_RENDERERS[value] ?? null;
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
  return renderer(context) ?? GenericToolResultRenderer(context);
}

export { GenericToolResultRenderer };
export type { ToolResultArtifact, ToolResultRenderer, ToolResultRendererContext } from "./types";
