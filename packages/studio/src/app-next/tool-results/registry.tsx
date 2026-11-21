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
import { asRecord, getToolResultArtifact, getToolResultData, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

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
  "chapter-revision": (context) => <ChapterRevisionCard {...context} />,
  "lore-update-proposal": (context) => <LoreProposalCard {...context} />,
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
  // 保留历史叙事线结果使用的 renderer 声明。
  "narrative.line": "narrative",
  workflow: "workflow",
  pipeline: "pipeline",
  "pipeline.chapter-result": "pipeline",
  "chapter.commit": "pipeline",
  "chapter_commit": "pipeline",
  "book.overview": "cockpit",
  "book_overview": "cockpit",
  "chapter.preflight": "write-preflight",
  "chapter_preflight": "write-preflight",
  "chapter.blueprint": "scene-spec",
  "chapter_blueprint": "scene-spec",
  "book.import": "book-dissect",
  "book_import": "book-dissect",
  "workflow.step": "workflow",
  "workflow_step": "workflow",
  "workflow.manage": "workflow",
  "workflow_manage": "workflow",
  "write.preflight": "write-preflight",
  "write-preflight": "write-preflight",
  "book.dissect": "book-dissect",
  "book-dissect": "book-dissect",
  "outline.volume": "outline-volume",
  "outline-volume": "outline-volume",
  "publish-readiness": "publish-readiness",
  "compliance.publish-readiness": "publish-readiness",
  "publish.export": "publish-export",
  "publish-export": "publish-export",
  "scene.spec": "scene-spec",
  "scene-spec": "scene-spec",
  "chapter.propose_selection": "selection-candidate",
  "chapter.selection-candidate": "selection-candidate",
  "selection-candidate": "selection-candidate",
  "chapter_propose_selection": "selection-candidate",
  "chapter.revision": "chapter-revision",
  "chapter-revision": "chapter-revision",
  "lore.update-proposal": "lore-update-proposal",
  "lore-update-proposal": "lore-update-proposal",
  "chapter.audit": "chapter-audit",
  "chapter_audit": "chapter-audit",
  "chapter-audit": "chapter-audit",
  "memory.read": "memory-read",
  "memory_read": "memory-read",
  "narrative-memory.read": "memory-read",
  "memory-read": "memory-read",
  "memory.graph": "memory-graph",
  "memory_graph": "memory-graph",
  "narrative-memory.graph": "memory-graph",
  "memory-graph": "memory-graph",
  "memory.events": "memory-events",
  "memory_events": "memory-events",
  "narrative-memory.events": "memory-events",
  "memory-events": "memory-events",
  // 经纬结果卡复用工作台的「故事树」。
  "jingwei_read": "lore-tree",
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
  const renderer = rendererFromValue(asRecord(context.result)?.renderer);
  const toolRenderer = rendererFromValue(context.toolName);
  // 合并后的经纬写工具只在返回改动候选时使用差异卡。
  if (context.toolName === "jingwei.write" || context.toolName === "jingwei_write") {
    if (getToolResultArtifact(context.result)?.kind === "lore-update") return "lore-update-proposal";
  }
  // 投稿检查与常规审计共用 chapter.audit 声明，但返回不同的数据结构。
  if ((renderer ?? toolRenderer) === "chapter-audit") {
    const data = asRecord(getToolResultData(context.result));
    if (typeof data?.platformLabel === "string" && typeof data.checkedChapters === "number") {
      return "publish-readiness";
    }
  }
  return renderer ?? toolRenderer ?? "generic";
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
