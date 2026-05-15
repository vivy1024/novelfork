export * from "./types.js";
export * from "./templates.js";

// Auto-linker
export { linkChapterToEntries, type LinkResult } from "./auto-linker.js";

// Jingwei context
export { buildJingweiContext, estimateJingweiTokens, type BuildJingweiContextOptions } from "./context/build-jingwei-context.js";
export { createLegacyJingweiAdapter, createLegacyBibleJingweiAdapter } from "./context/section-adapter.js";

// Jingwei repositories
export { createStoryJingweiEntryRepository } from "./repositories/entry-repo.js";
export { createStoryJingweiSectionRepository } from "./repositories/section-repo.js";

// Legacy Jingwei context (renamed from Bible)
export { createAliasMatcher, matchTrackedByAliases, AliasMatcher, type AliasMatchEntry } from "./context/alias-matcher.js";
export { buildJingweiLegacyContext, buildBibleContext, injectCharacterArcs, injectConflicts, injectPremise, injectWorldModel, type BuildJingweiLegacyContextOptions, type BuildBibleContextOptions } from "./context/build-bible-context.js";
export { composeJingweiContext, composeBibleContext, formatJingweiContextItem, formatBibleContextItem, type ComposableJingweiContextItem, type ComposableBibleContextItem, type ComposeJingweiContextOptions, type ComposeBibleContextOptions } from "./context/compose-context.js";
export { resolveNestedRefs, type NestedRefEntry, type ResolveNestedRefsOptions } from "./context/nested-resolver.js";
export { formatJingweiContextForPrompt, mergeJingweiContextWithExternalContext, formatBibleContextForPrompt, mergeBibleContextWithExternalContext } from "./context/pipeline-bridge.js";
export { formatDescriptor, hasDescriptorContent, safeParseDescriptor } from "./context/format-descriptor.js";
export { detectStalledConflict, detectStalledConflicts, getStalledConflicts, type StalledConflictWarning } from "./context/stalled-detector.js";
export { applyTokenBudget, estimateTokens, sortByContextPriority, type BudgetedJingweiContextItem, type BudgetedBibleContextItem, type TokenBudgetResult } from "./context/token-budget.js";
export { filterEntriesVisibleAtChapter, getVisibilityRule, isVisibleAtChapter, parseVisibilityRule, type VisibilityRuleEntry } from "./context/visibility-filter.js";

// Core shift
export { acceptCoreShift, proposeCoreShift, rejectCoreShift, type ProposeCoreShiftInput } from "./core-shift/core-shift-service.js";
export { analyzeCoreShiftImpact, type AnalyzeCoreShiftImpactInput, type CoreShiftImpactAnalysis } from "./core-shift/impact-analysis.js";

// Questionnaires
export { suggestQuestionnaireAnswer, type SuggestQuestionnaireAnswerInput, type SuggestQuestionnaireAnswerResult } from "./questionnaires/ai-suggest.js";
export { applyQuestionnaireMappings, type QuestionnaireAnswers } from "./questionnaires/apply-mapping.js";
export { createRatifyQuestionnaireForChapter, type RatifyCandidate, type RatifyQuestionnaire } from "./questionnaires/ratify-questionnaire.js";
export { loadBuiltinQuestionnaireTemplates, seedQuestionnaireTemplates, type SeedQuestionnaireTemplatesResult } from "./questionnaires/seed/index.js";
export { submitQuestionnaireResponse, type SubmitQuestionnaireResponseInput, type SubmitQuestionnaireResponseResult } from "./questionnaires/submit-response.js";
export { validateQuestionnaireTemplate } from "./questionnaires/template-validator.js";

// Long-novel coherence
export { buildRecursiveSummaryContext, saveVolumeSummary, getVolumeSummary, buildVolumeSummaryPrompt, type VolumeSummary } from "./context/recursive-summaries.js";
export { buildChangeExtractionPrompt, applyChapterChanges, type ChapterChange } from "./context/auto-update.js";
export { buildChapterBriefing } from "./context/chapter-briefing.js";
export { updateCausalChainUrgency, createCausalChain, progressCausalChain, type CausalChain, type CausalChainStatus, type CausalChainUrgency } from "./context/causal-chains.js";
export { updateCharacterLifecycles } from "./context/lifecycle-manager.js";

// PGI
export { generatePGIQuestions, formatPGIAnswersForPrompt, type GeneratePGIQuestionsInput, type GeneratePGIQuestionsResult, type PGIQuestion } from "./pgi/pgi-engine.js";

// Preset reflection
export { buildPresetReflectionPrompt, parsePresetSuggestions, type PresetSuggestion } from "./context/preset-reflection.js";

// Associative layer
export { extractChapterEntities, updateCooccurrence, type CooccurrenceEdge } from "./associative/cooccurrence.js";
export { propagateSpikes, type SpikeResult } from "./associative/spike-routing.js";
export { buildDreamPrompt, parseDreamDiscoveries, type DreamDiscovery } from "./associative/dream-system.js";

// Jingwei repositories (renamed from Bible)
export { createBookRepository } from "./repositories/book-repo.js";
export { createJingweiCharacterArcRepository, createBibleCharacterArcRepository } from "./repositories/character-arc-repo.js";
export { createJingweiCharacterRepository, createBibleCharacterRepository } from "./repositories/character-repo.js";
export { createJingweiConflictRepository, createBibleConflictRepository } from "./repositories/conflict-repo.js";
export { createCoreShiftRepository } from "./repositories/core-shift-repo.js";
export { createJingweiEventRepository, createBibleEventRepository } from "./repositories/event-repo.js";
export { createJingweiPremiseRepository, createBiblePremiseRepository } from "./repositories/premise-repo.js";
export { createQuestionnaireResponseRepository } from "./repositories/questionnaire-response-repo.js";
export { createQuestionnaireTemplateRepository } from "./repositories/questionnaire-template-repo.js";
export { createJingweiSettingRepository, createBibleSettingRepository } from "./repositories/setting-repo.js";
export { createJingweiWorldModelRepository, createBibleWorldModelRepository } from "./repositories/world-model-repo.js";
export { createJingweiChapterSummaryRepository, createBibleChapterSummaryRepository } from "./repositories/chapter-summary-repo.js";
