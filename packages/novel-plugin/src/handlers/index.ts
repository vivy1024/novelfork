export { handleChapterRead, type ChapterReadInput, type ChapterReadResult } from "./chapter-read.js";
export {
  handleJingweiReadBrief,
  handleJingweiReadCategory,
  handleJingweiSearch,
  handleJingweiReadContext,
  type JingweiReadBriefInput,
  type JingweiReadBriefResponse,
  type JingweiReadCategoryInput,
  type JingweiReadCategoryResponse,
  type JingweiSearchInput,
  type JingweiSearchResponse,
  type JingweiReadContextInput,
  type JingweiReadContextResult,
} from "./jingwei-read.js";

export { createCockpitService, CockpitService } from "./cockpit-service.js";
export type {
  CockpitBookSummary,
  CockpitCandidateItem,
  CockpitChapterSummaryItem,
  CockpitCurrentFocusSummary,
  CockpitDataStatus,
  CockpitHookItem,
  CockpitListResult,
  CockpitModelStatus,
  CockpitProgressSummary,
  CockpitRiskCard,
  CockpitServiceOptions,
  CockpitSnapshot,
} from "./cockpit-service.js";

export { createCandidateToolService } from "./candidate-tool-service.js";
export type {
  CandidateGenerationInput,
  CandidateToolService,
  CandidateToolServiceOptions,
} from "./candidate-tool-service.js";

export { createPGIToolService } from "./pgi-tool-service.js";
export type { PGIToolService, PGIToolServiceOptions } from "./pgi-tool-service.js";

export { createGuidedGenerationToolService } from "./guided-generation-tool-service.js";
export type { GuidedGenerationToolService, GuidedGenerationToolServiceOptions } from "./guided-generation-tool-service.js";

export { createQuestionnaireToolService } from "./questionnaire-tool-service.js";
export type {
  QuestionnaireSuggestionProvider,
  QuestionnaireSuggestionProviderInput,
  QuestionnaireToolService,
  QuestionnaireToolServiceOptions,
} from "./questionnaire-tool-service.js";

export { createNarrativeLineService, NarrativeLineService } from "./narrative-line-service.js";
export type {
  NarrativeLineApplyResult,
  NarrativeLineCheckpointService,
  NarrativeLineServiceOptions,
} from "./narrative-line-service.js";

export { executeNovelInit } from "./novel-init-handler.js";
export type { NovelInitInput, NovelInitResult } from "./novel-init-handler.js";

export { executeNovelAudit } from "./novel-audit-handler.js";
export type { AuditEngineResult, AuditFinding, NovelAuditInput, NovelAuditResult } from "./novel-audit-handler.js";

export { NOVEL_SESSION_TOOL_DEFINITIONS, NOVEL_TOOL_NAMES, NOVEL_AGENT_PRESETS } from "./tool-registry.js";

export { executeWritingModeTool } from "./writing-mode-tool.js";
export type { WritingMode, WritingModeInput, WritingModeResult } from "./writing-mode-tool.js";

export { executePipelineGenerate } from "./pipeline-generate-service.js";
export type {
  PipelineGenerateInput,
  PipelineGenerateOutput,
  PipelineGenerateError,
  PipelineGenerateResult,
  PipelineGenerateOptions,
  JingweiDelta,
  JingweiDeltaEntry,
} from "./pipeline-generate-service.js";
