/**
 * Novel engine barrel — re-exports all novel-domain modules.
 *
 * Subdirectories:
 * - pipeline/ — writing pipeline, scheduling, detection
 * - agents/ — planner, composer, writer, auditor, reviser, etc.
 * - jingwei/ — worldbuilding, questionnaires, PGI, causal chains
 * - filter/ — AI taste detection, Zhuque integration
 * - writing-skills/ — file-based writing skill loading and validation
 * - compliance/ — sensitive word scanning, publish readiness
 * - tools/ — chapter hooks, POV, progress, rhythm, arcs, tone, import
 */

// ─── Pipeline ────────────────────────────────────────────────────────────────
export type { PipelineConfig } from "./pipeline/types.js";
export { getAgentRole, AGENT_ROLES } from "./pipeline/agent-roles.js";
export type { AgentRoleConfig } from "./pipeline/agent-roles.js";


// ─── Agents ──────────────────────────────────────────────────────────────────
export { BaseAgent } from "./agents/base.js";
export type { AgentContext } from "./agents/base.js";
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
export { buildWriterSystemPrompt } from "./agents/writer-prompts.js";
export { analyzeAITells } from "./agents/ai-tells.js";
export type { AITellResult, AITellIssue } from "./agents/ai-tells.js";
export { analyzeSensitiveWords } from "./agents/sensitive-words.js";
export type { SensitiveWordResult, SensitiveWordMatch } from "./agents/sensitive-words.js";
export { analyzeStyle } from "./agents/style-analyzer.js";
export { validatePostWrite, detectParagraphLengthDrift, detectParagraphShapeWarnings, detectDuplicateTitle } from "./agents/post-write-validator.js";
export type { PostWriteViolation } from "./agents/post-write-validator.js";
export { parseWriterOutput, parseCreativeOutput } from "./agents/writer-parser.js";
export type { ParsedWriterOutput, CreativeOutput } from "./agents/writer-parser.js";
export { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "./agents/settler-prompts.js";
export { parseSettlementOutput } from "./agents/settler-parser.js";
export type { SettlementOutput } from "./agents/settler-parser.js";
export { parseSettlerDeltaOutput } from "./agents/settler-delta-parser.js";
export type { SettlerDeltaOutput } from "./agents/settler-delta-parser.js";
export { getFanficDimensionConfig, FANFIC_DIMENSIONS } from "./agents/fanfic-dimensions.js";
export type { FanficDimensionConfig } from "./agents/fanfic-dimensions.js";
export { buildFanficCanonSection, buildCharacterVoiceProfiles, buildFanficModeInstructions } from "./agents/fanfic-prompt-sections.js";
export { StateValidatorAgent } from "./agents/state-validator.js";

// Inline writing modes
export {
  buildContinuationPrompt,
  parseContinuationResult,
  buildExpansionPrompt,
  parseExpansionResult,
  buildBridgePrompt,
  parseBridgeResult,
  buildPolishPrompt,
  parsePolishResult,
  buildRewritePrompt,
  parseRewriteResult,
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
  PolishInput,
  RewriteInput,
} from "./agents/inline-writer.js";
export { buildDialoguePrompt, parseDialogueResult } from "./agents/dialogue-generator.js";
export type { DialogueCharacter, DialogueInput, DialogueLine, DialogueResult } from "./agents/dialogue-generator.js";
export { buildVariantPrompts, parseVariantResult } from "./agents/variant-generator.js";
export type { VariantInput, VariantResult } from "./agents/variant-generator.js";
export { buildBranchPrompt, parseBranchResult } from "./agents/outline-brancher.js";
export type { OutlineNode as OutlineBranchNode, HookState, ChapterSummary as BranchChapterSummary, OutlineBranch, OutlineBranchChapter } from "./agents/outline-brancher.js";

// ─── Writing Skills (file-based, no registry) ────────────────────────────────
export {
  BUILTIN_WRITING_SKILLS_DIR,
  authorWritingSkillsDir,
  forkWritingSkillForEditing,
  getWritingSkillRawContentSync,
  loadWritingSkills,
  loadWritingSkillsSync,
  parseWritingSkill,
  removeAuthorWritingSkill,
  splitFrontmatter,
  writeAuthorWritingSkill,
} from "./writing-skills/loader.js";
export {
  MAX_RECOMMENDED_WRITING_SKILLS,
  recommendWritingSkills,
} from "./writing-skills/recommend.js";
export type {
  RecommendedWritingSkill,
  WritingSkillRecommendation,
  WritingSkillRecommendationInput,
} from "./writing-skills/recommend.js";
export {
  WRITING_SKILL_COMPLIANCE_CHECK_TYPES,
  WRITING_SKILL_KINDS,
} from "./writing-skills/types.js";
export type {
  ParsedWritingSkill,
  WritingSkillComplianceCheck,
  WritingSkillComplianceCheckType,
  WritingSkillForbiddenTermsCheck,
  WritingSkillKind,
  WritingSkillMode,
  WritingSkillPatternCheck,
  WritingSkillProvenance,
  WritingSkillRequiredTermsCheck,
  WritingSkillSource,
} from "./writing-skills/types.js";

// ─── Jingwei (worldbuilding) ─────────────────────────────────────────────────
export * from "./jingwei/index.js";

// ─── Filter (AI taste detection) ─────────────────────────────────────────────
export * from "./filter/index.js";

// ─── Compliance (platform publishing) ────────────────────────────────────────
export * from "./compliance/index.js";

// ─── Platform writing profiles ───────────────────────────────────────────────
export {
  SUPPORTED_PUBLISH_PLATFORMS,
  checkPlatformChapterTarget,
  getPlatformProfile,
  isSupportedPlatform,
  resolvePlatformProfile,
  resolvePublishPlatform,
  type BookPlatform,
  type PlatformProfile,
  type PlatformTargetCheck,
} from "./platform/platform-profile.js";

// ─── Tools (novel analysis) ──────────────────────────────────────────────────
export * from "./tools/index.js";


// ─── Writing Resource ─────────────────────────────────────────────────────
export * from "./writing-resource/index.js";

// ─── Narrative Memory Settlement ──────────────────────────────────────────
export { extractNarrativeEventsFromChapter } from "./narrative-memory/chapter-event-extractor.js";
export type { ChapterEventExtractorInput, ChapterEventExtractionResult } from "./narrative-memory/chapter-event-extractor.js";
export { decideSettlementRisk } from "./narrative-memory/settlement-risk-gate.js";
export type { ChapterSettlementInput, ChapterSettlementResult, NarrativeEventDraft, SettlementRiskDecision } from "./narrative-memory/settlement-risk-gate.js";
