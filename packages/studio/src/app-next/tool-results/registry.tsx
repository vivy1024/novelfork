import type { ReactNode } from "react";

import { BookDissectCard } from "./BookDissectCard";
import { ChapterAuditCard } from "./ChapterAuditCard";
import { ChapterRevisionCard } from "./ChapterRevisionCard";
import { CockpitSnapshotCard } from "./CockpitSnapshotCard";
import { GenericToolResultRenderer } from "./GenericToolResultCard";
import { GuidedPlanCard } from "./GuidedPlanCard";
import { LoreProposalCard } from "./LoreProposalCard";
import { LoreTreeCard } from "./LoreTreeCard";
import { MemoryEventsCard } from "./MemoryEventsCard";
import { MemoryReadCard } from "./MemoryReadCard";
import { NarrativeLineCard } from "./NarrativeLineCard";
import { OutlineVolumeCard } from "./OutlineVolumeCard";
import { PipelineChapterResultCard } from "./PipelineChapterResultCard";
import { PublishExportCard } from "./PublishExportCard";
import { PublishReadinessCard } from "./PublishReadinessCard";
import { QuestionnaireCard } from "./QuestionnaireCard";
import { SceneSpecCard } from "./SceneSpecCard";
import { SelectionCandidateCard } from "./SelectionCandidateCard";
import { WorkflowProgressRenderer } from "./WorkflowProgressCard";
import { WritePreflightCard } from "./WritePreflightCard";
import type { ToolResultRenderer, ToolResultRendererContext } from "./types";

const customRenderers = new Map<string, ToolResultRenderer>();

export const RESERVED_TOOL_RESULT_RENDERERS = [
  "cockpit",
  "questionnaire",
  "guided",
  "narrative",
  "workflow",
  "pipeline",
  "write-preflight",
  "book-dissect",
  "outline-volume",
  "publish-readiness",
  "publish-export",
  "scene-spec",
  "selection-candidate",
  "chapter-revision",
  "lore-update-proposal",
  "chapter-audit",
  "memory-read",
  "memory-graph",
  "memory-events",
  "lore-tree",
] as const;

const DEFAULT_RENDERERS: Record<(typeof RESERVED_TOOL_RESULT_RENDERERS)[number], ToolResultRenderer> = {
  cockpit: CockpitSnapshotCard,
  questionnaire: QuestionnaireCard,
  guided: GuidedPlanCard,
  narrative: NarrativeLineCard,
  workflow: WorkflowProgressRenderer,
  pipeline: PipelineChapterResultCard,
  "write-preflight": WritePreflightCard,
  "book-dissect": BookDissectCard,
  "outline-volume": OutlineVolumeCard,
  "publish-readiness": PublishReadinessCard,
  "publish-export": PublishExportCard,
  "scene-spec": SceneSpecCard,
  "selection-candidate": SelectionCandidateCard,
  "chapter-revision": ChapterRevisionCard,
  "lore-update-proposal": LoreProposalCard,
  "chapter-audit": ChapterAuditCard,
  "memory-read": MemoryReadCard,
  // memory.graph 改走树：原来把图数据渲染成三元组文本行，本来是图却画成文字
  "memory-graph": LoreTreeCard,
  "memory-events": MemoryEventsCard,
  "lore-tree": LoreTreeCard,
};

const EXACT_RUNTIME_RENDERERS: Record<string, (typeof RESERVED_TOOL_RESULT_RENDERERS)[number]> = {
  cockpit: "cockpit",
  "cockpit.snapshot": "cockpit",
  questionnaire: "questionnaire",
  guided: "guided",
  narrative: "narrative",
  // memory.read_line 声明 renderer="narrative.line"，同样此前未登记。
  "narrative.line": "narrative",
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
  "publish.export": "publish-export",
  "publish-export": "publish-export",
  "scene.spec": "scene-spec",
  "scene-spec": "scene-spec",
  "chapter.propose_selection": "selection-candidate",
  "chapter.selection-candidate": "selection-candidate",
  "selection-candidate": "selection-candidate",
  "chapter.propose_revision": "chapter-revision",
  "chapter.revision": "chapter-revision",
  "chapter-revision": "chapter-revision",
  "lore.propose_update": "lore-update-proposal",
  "lore.update-proposal": "lore-update-proposal",
  "lore-update-proposal": "lore-update-proposal",
  "chapter.audit": "chapter-audit",
  "chapter-audit": "chapter-audit",
  "narrative-memory.read": "memory-read",
  "memory-read": "memory-read",
  "narrative-memory.graph": "memory-graph",
  "memory-graph": "memory-graph",
  "narrative-memory.events": "memory-events",
  "memory-events": "memory-events",
  // lore.read / jingwei.read 此前没有任何渲染器登记，落到 generic 吐原始结构；
  // 现在走树，与工作台「故事树」同一实现。
  "lore.read": "lore-tree",
  "lore-read": "lore-tree",
  "lore-tree": "lore-tree",
  "jingwei.read": "lore-tree",
  "jingwei-read": "lore-tree",
  "jingwei.read_brief": "lore-tree",
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
export type { ToolResultAction, ToolResultArtifact, ToolResultRenderer, ToolResultRendererContext } from "./types";
