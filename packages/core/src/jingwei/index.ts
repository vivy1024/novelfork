export * from "./types.js";
export * from "./templates.js";

// Jingwei context
export { buildJingweiContext, estimateJingweiTokens, type BuildJingweiContextOptions } from "./context/build-jingwei-context.js";
export { createLegacyBibleJingweiAdapter } from "./context/section-adapter.js";

// Jingwei repositories
export { createStoryJingweiEntryRepository } from "./repositories/entry-repo.js";
export { createStoryJingweiSectionRepository } from "./repositories/section-repo.js";

// Legacy Bible context
export { createAliasMatcher, matchTrackedByAliases, AliasMatcher, type AliasMatchEntry } from "./context/alias-matcher.js";
export { buildBibleContext, injectCharacterArcs, injectConflicts, injectPremise, injectWorldModel, type BuildBibleContextOptions } from "./context/build-bible-context.js";
export { composeBibleContext, formatBibleContextItem, type ComposableBibleContextItem, type ComposeBibleContextOptions } from "./context/compose-context.js";
export { resolveNestedRefs, type NestedRefEntry, type ResolveNestedRefsOptions } from "./context/nested-resolver.js";
export { formatBibleContextForPrompt, mergeBibleContextWithExternalContext } from "./context/pipeline-bridge.js";
export { formatDescriptor, hasDescriptorContent, safeParseDescriptor } from "./context/format-descriptor.js";
export { detectStalledConflict, detectStalledConflicts, getStalledConflicts, type StalledConflictWarning } from "./context/stalled-detector.js";
export { applyTokenBudget, estimateTokens, sortByContextPriority, type BudgetedBibleContextItem, type TokenBudgetResult } from "./context/token-budget.js";
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

// PGI
export { generatePGIQuestions, formatPGIAnswersForPrompt, type GeneratePGIQuestionsInput, type GeneratePGIQuestionsResult, type PGIQuestion } from "./pgi/pgi-engine.js";

// Legacy Bible repositories
export { createBookRepository } from "./repositories/book-repo.js";
export { createBibleCharacterArcRepository } from "./repositories/character-arc-repo.js";
export { createBibleCharacterRepository } from "./repositories/character-repo.js";
export { createBibleConflictRepository } from "./repositories/conflict-repo.js";
export { createCoreShiftRepository } from "./repositories/core-shift-repo.js";
export { createBibleEventRepository } from "./repositories/event-repo.js";
export { createBiblePremiseRepository } from "./repositories/premise-repo.js";
export { createQuestionnaireResponseRepository } from "./repositories/questionnaire-response-repo.js";
export { createQuestionnaireTemplateRepository } from "./repositories/questionnaire-template-repo.js";
export { createBibleSettingRepository } from "./repositories/setting-repo.js";
export { createBibleWorldModelRepository } from "./repositories/world-model-repo.js";
export { createBibleChapterSummaryRepository } from "./repositories/chapter-summary-repo.js";
