/**
 * Novel-domain route factories — moved from studio to novel-plugin (Batch 3).
 * These routes handle AI writing, pipeline, jingwei, filter, compliance,
 * writing-modes, writing-tools, and context-manager.
 */

export {
  AUTHOR_REVIEW_FILES,
  buildRadarReviewMarkdown,
  buildWebCaptureReviewMarkdown,
  type AuthorMaterialFile,
  type AuthorMaterialPersistenceInfo,
  type AuthorMaterialRadarRecommendation,
  type AuthorMaterialRadarResult,
  type AuthorWebCaptureInput,
  type AuthorWebCaptureResult,
} from "./author-materials.js";
export { createJingweiRouter, type CreateJingweiRouterOptions } from "./jingwei.js";
export {
  createCharacterVoiceRouter,
  type CharacterVoiceWarning,
  type CreateCharacterVoiceRouterOptions,
} from "./character-voice.js";
export { createWritingModesRouter } from "./writing-modes.js";
export { createStyleDistillationsRouter, type CreateStyleDistillationsRouterOptions } from "./style-distillations.js";
export { createPipelineRouter, createPipelineRun, updatePipelineStage, completePipelineRun } from "./pipeline.js";
export { createFilterRouter, type CreateFilterRouterOptions } from "./filter.js";
export { createComplianceRouter } from "./compliance.js";
export { createWritingToolsRouter } from "./writing-tools.js";
export { createContextManagerRouter } from "./context-manager.js";
export { createQualityTrendRouter } from "./quality-trend.js";
export { createWritingSkillsRouter, type CreateWritingSkillsRouterOptions } from "./writing-skills.js";
export { createWritingLayersRouter, type CreateWritingLayersRouterOptions } from "./writing-layers.js";
export { createWorkflowsRouter, type CreateWorkflowsRouterOptions } from "./workflows.js";
export { createChapterLinksRouter } from "./chapter-links.js";
export { createWritingResourceRouter } from "./writing-resource.js";
export { createWriteReadinessRouter, type CreateWriteReadinessRouterOptions } from "./write-readiness.js";
export { createOverviewRouter } from "./overview.js";
export { createMarketRouter } from "./market.js";
export { createEmbeddingSettingsRouter } from "./embedding.js";
export { createCockpitRouter, type CreateCockpitRouterOptions } from "./cockpit.js";
export { createNarrativeMemoryRouter } from "./narrative-memory.js";
export { createChapterTimelineRouter, type CreateChapterTimelineRouterOptions } from "./chapter-timeline.js";
export { createEntityGraphRouter, type EntityGraphRouterOptions } from "./entity-graph.js";
export { createKnowledgeRouter, type KnowledgeRouterOptions } from "./knowledge.js";
export { createChapterRevisionRouter, type CreateChapterRevisionRouterOptions } from "./chapter-revision.js";
export { createNarrativeStructureRouter, type NarrativeStructureRouterOptions } from "./narrative-structure.js";
export {
  createWorkflowRunsRouter,
  serializeWorkflowRunDetail,
  type CreateWorkflowRunsRouterOptions,
} from "./workflow-runs.js";
export { createNarrativeLineRouter, type CreateNarrativeLineRouterOptions } from "./narrative-line.js";
export {
  createPendingReviewRouter,
  collectPendingReview,
  PENDING_REVIEW_KINDS,
  PENDING_REVIEW_LABELS,
  type CreatePendingReviewRouterOptions,
  type PendingReviewGroup,
  type PendingReviewItem,
  type PendingReviewKind,
  type PendingReviewSummary,
  type PendingReviewTarget,
  type PendingReviewWarning,
} from "./pending-review.js";
export { createBookArchiveRouter, type BookArchiveImportRequest, type BookArchiveImportResult, type CreateBookArchiveRouterOptions } from "./book-archive.js";
export type {
  AiObservationScope,
  AiObservationSuccess,
  AiRequestObserver,
  ContextGovernance,
  RouterContext,
  RuntimeModelStatus,
  SessionLlmOverrides,
} from "./context.js";
