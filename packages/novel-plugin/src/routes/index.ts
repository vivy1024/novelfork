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
export { createWritingModesRouter } from "./writing-modes.js";
export { createPipelineRouter, createPipelineRun, updatePipelineStage, completePipelineRun } from "./pipeline.js";
export { createFilterRouter, type CreateFilterRouterOptions } from "./filter.js";
export { createComplianceRouter } from "./compliance.js";
export { createWritingToolsRouter } from "./writing-tools.js";
export { createContextManagerRouter } from "./context-manager.js";
export { createQualityTrendRouter } from "./quality-trend.js";
export { createWritingSkillsRouter, type CreateWritingSkillsRouterOptions } from "./writing-skills.js";
export { createChapterLinksRouter } from "./chapter-links.js";
export { createWritingResourceRouter } from "./writing-resource.js";
export { createWriteReadinessRouter, type CreateWriteReadinessRouterOptions } from "./write-readiness.js";
export { createOverviewRouter } from "./overview.js";
export { createNarrativeMemoryRouter } from "./narrative-memory.js";
export { createNarrativeLineRouter, type CreateNarrativeLineRouterOptions } from "./narrative-line.js";
export type {
  AiObservationScope,
  AiObservationSuccess,
  AiRequestObserver,
  ContextGovernance,
  RouterContext,
  RuntimeModelStatus,
  SessionLlmOverrides,
} from "./context.js";
