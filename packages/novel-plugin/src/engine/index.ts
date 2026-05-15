/**
 * Novel engine barrel — re-exports all novel-domain modules.
 *
 * Subdirectories:
 * - pipeline/ — writing pipeline, scheduling, detection
 * - agents/ — planner, composer, writer, auditor, reviser, etc.
 * - jingwei/ — worldbuilding, questionnaires, PGI, causal chains
 * - filter/ — AI taste detection, Zhuque integration
 * - presets/ — genre presets, beat templates, compliance checking
 * - compliance/ — sensitive word scanning, publish readiness
 * - tools/ — chapter hooks, POV, progress, rhythm, arcs, tone, import
 * - bible/ — backward compat re-export of jingwei
 */

// ─── Pipeline ────────────────────────────────────────────────────────────────
export { PipelineRunner } from "./pipeline/runner.js";
export type { PipelineConfig, ChapterPipelineResult, DraftResult, PlanChapterResult, ComposeChapterResult, ReviseResult, JingweiFiles, TruthFiles, BookStatusInfo, ImportChaptersInput, ImportChaptersResult, TokenUsageSummary } from "./pipeline/runner.js";
export { Scheduler } from "./pipeline/scheduler.js";
export type { SchedulerConfig } from "./pipeline/scheduler.js";
export { runAgentLoop, AGENT_TOOLS } from "./pipeline/agent.js";
export type { AgentLoopOptions } from "./pipeline/agent.js";
export { getAgentSystemPrompt, AGENT_SYSTEM_PROMPTS } from "./pipeline/agent-prompts.js";
export { runWritingPipeline, runAuditPipeline } from "./pipeline/agent-pipeline.js";
export type { PipelineResult, PipelineError } from "./pipeline/agent-pipeline.js";
export { detectChapter, detectAndRewrite, loadDetectionHistory } from "./pipeline/detection-runner.js";
export type { DetectChapterResult, DetectAndRewriteResult } from "./pipeline/detection-runner.js";
export { pipelineEvents } from "./pipeline/pipeline-events.js";
export type { PipelineEvent, PipelineEventHandler, PipelineStageUpdate, PipelineRunStart, PipelineRunComplete } from "./pipeline/pipeline-events.js";

// ─── Agents ──────────────────────────────────────────────────────────────────
export { BaseAgent } from "./agents/base.js";
export type { AgentContext } from "./agents/base.js";
export { PlannerAgent } from "./agents/planner.js";
export type { PlanChapterInput, PlanChapterOutput } from "./agents/planner.js";
export { ComposerAgent } from "./agents/composer.js";
export type { ComposeChapterInput, ComposeChapterOutput } from "./agents/composer.js";
export { ArchitectAgent } from "./agents/architect.js";
export type { ArchitectOutput } from "./agents/architect.js";
export { WriterAgent } from "./agents/writer.js";
export type { WriteChapterInput, WriteChapterOutput, TokenUsage } from "./agents/writer.js";
export { LengthNormalizerAgent } from "./agents/length-normalizer.js";
export type { NormalizeLengthInput, NormalizeLengthOutput } from "./agents/length-normalizer.js";
export { ContinuityAuditor } from "./agents/continuity.js";
export type { AuditResult, AuditIssue } from "./agents/continuity.js";
export { ReviserAgent, DEFAULT_REVISE_MODE } from "./agents/reviser.js";
export type { ReviseOutput, ReviseMode } from "./agents/reviser.js";
export { RadarAgent } from "./agents/radar.js";
export type { RadarResult, RadarRecommendation } from "./agents/radar.js";
export { FanqieRadarSource, QidianRadarSource, TextRadarSource } from "./agents/radar-source.js";
export type { RadarSource, PlatformRankings, RankingEntry } from "./agents/radar-source.js";
export { readGenreProfile, readBookRules, listAvailableGenres, getBuiltinGenresDir } from "./agents/rules-reader.js";
export { buildWriterSystemPrompt, buildPresetInjections } from "./agents/writer-prompts.js";
export { analyzeAITells } from "./agents/ai-tells.js";
export type { AITellResult, AITellIssue } from "./agents/ai-tells.js";
export { analyzeSensitiveWords } from "./agents/sensitive-words.js";
export type { SensitiveWordResult, SensitiveWordMatch } from "./agents/sensitive-words.js";
export { detectAIContent } from "./agents/detector.js";
export type { DetectionResult } from "./agents/detector.js";
export { analyzeStyle } from "./agents/style-analyzer.js";
export { analyzeDetectionInsights } from "./agents/detection-insights.js";
export { validatePostWrite, detectParagraphLengthDrift, detectParagraphShapeWarnings, detectDuplicateTitle } from "./agents/post-write-validator.js";
export type { PostWriteViolation } from "./agents/post-write-validator.js";
export { ChapterAnalyzerAgent } from "./agents/chapter-analyzer.js";
export type { AnalyzeChapterInput, AnalyzeChapterOutput } from "./agents/chapter-analyzer.js";
export { parseWriterOutput, parseCreativeOutput } from "./agents/writer-parser.js";
export type { ParsedWriterOutput, CreativeOutput } from "./agents/writer-parser.js";
export { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "./agents/settler-prompts.js";
export { parseSettlementOutput } from "./agents/settler-parser.js";
export type { SettlementOutput } from "./agents/settler-parser.js";
export { parseSettlerDeltaOutput } from "./agents/settler-delta-parser.js";
export type { SettlerDeltaOutput } from "./agents/settler-delta-parser.js";
export { FanficCanonImporter } from "./agents/fanfic-canon-importer.js";
export type { FanficCanonOutput } from "./agents/fanfic-canon-importer.js";
export { getFanficDimensionConfig, FANFIC_DIMENSIONS } from "./agents/fanfic-dimensions.js";
export type { FanficDimensionConfig } from "./agents/fanfic-dimensions.js";
export { buildFanficCanonSection, buildCharacterVoiceProfiles, buildFanficModeInstructions } from "./agents/fanfic-prompt-sections.js";
export { ConsolidatorAgent } from "./agents/consolidator.js";
export { StateValidatorAgent } from "./agents/state-validator.js";

// Inline writing modes
export {
  buildContinuationPrompt,
  parseContinuationResult,
  buildExpansionPrompt,
  parseExpansionResult,
  buildBridgePrompt,
  parseBridgeResult,
} from "./agents/inline-writer.js";
export type {
  InlineWriteMode,
  InlineWriteContext,
  InlineWriteInput,
  InlineWriteResult,
  ContinuationInput,
  ExpansionDirection,
  ExpansionInput,
  ExpansionResult,
  BridgePurpose,
  BridgeInput,
} from "./agents/inline-writer.js";
export { buildDialoguePrompt, parseDialogueResult } from "./agents/dialogue-generator.js";
export type { DialogueCharacter, DialogueInput, DialogueLine, DialogueResult } from "./agents/dialogue-generator.js";
export { buildVariantPrompts, parseVariantResult } from "./agents/variant-generator.js";
export type { VariantInput, VariantResult } from "./agents/variant-generator.js";
export { buildBranchPrompt, parseBranchResult } from "./agents/outline-brancher.js";
export type { OutlineNode as OutlineBranchNode, HookState, ChapterSummary as BranchChapterSummary, OutlineBranch, OutlineBranchChapter } from "./agents/outline-brancher.js";

// ─── Jingwei (worldbuilding) ─────────────────────────────────────────────────
export * from "./jingwei/index.js";

// ─── Filter (AI taste detection) ─────────────────────────────────────────────
export * from "./filter/index.js";

// ─── Presets ─────────────────────────────────────────────────────────────────
export * from "./presets/index.js";
export { registerBuiltinPresets } from "./presets/builtin.js";
export { checkPresetCompliance } from "./presets/compliance-checker.js";
export type { ComplianceViolation, ComplianceCheckResult } from "./presets/compliance-checker.js";

// ─── Compliance (platform publishing) ────────────────────────────────────────
export * from "./compliance/index.js";

// ─── Tools (novel analysis) ──────────────────────────────────────────────────
export * from "./tools/index.js";

// ─── Bible (backward compat) ─────────────────────────────────────────────────
export * from "./bible/index.js";
