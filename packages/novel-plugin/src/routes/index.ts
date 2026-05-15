/**
 * Novel-domain route factories — moved from studio to novel-plugin (Batch 3).
 * These routes handle AI writing, pipeline, jingwei, bible, filter, compliance,
 * writing-modes, writing-tools, and context-manager.
 */

export { createAIRouter } from "./ai.js";
export { createJingweiRouter, type CreateJingweiRouterOptions } from "./jingwei.js";
export { createWritingModesRouter } from "./writing-modes.js";
export { createPipelineRouter, createPipelineRun, updatePipelineStage, completePipelineRun } from "./pipeline.js";
export { createFilterRouter, type CreateFilterRouterOptions } from "./filter.js";
export { createComplianceRouter } from "./compliance.js";
export { createBibleRouter, type CreateBibleRouterOptions } from "./bible.js";
export { createWritingToolsRouter } from "./writing-tools.js";
export { createContextManagerRouter } from "./context-manager.js";
export { createQualityTrendRouter } from "./quality-trend.js";
export { createPresetHitsRouter } from "./preset-hits.js";
export { createChapterLinksRouter } from "./chapter-links.js";
export type { RouterContext } from "./context.js";
