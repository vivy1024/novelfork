export type {
  BibleChapterSummaryRecord,
  BibleCharacterArcRecord,
  BibleCharacterRecord,
  BibleConflictRecord,
  BibleContextItem,
  BibleContextItemType,
  BibleEventRecord,
  BibleMode,
  BiblePremiseRecord,
  BibleSettingRecord,
  BibleVisibilitySource,
  BibleWorldModelRecord,
  BuildBibleContextInput,
  BuildBibleContextResult,
  BookRecord,
  CreateBibleChapterSummaryInput,
  CreateBibleCharacterArcInput,
  CreateBibleCharacterInput,
  CreateBibleConflictInput,
  CreateBibleEventInput,
  CreateBiblePremiseInput,
  CreateBibleSettingInput,
  CreateBibleWorldModelInput,
  CreateBookInput,
  UpdateBibleChapterSummaryInput,
  UpdateBibleCharacterArcInput,
  UpdateBibleCharacterInput,
  UpdateBibleConflictInput,
  UpdateBibleEventInput,
  UpdateBiblePremiseInput,
  UpdateBibleSettingInput,
  UpdateBibleWorldModelInput,
  UpdateBookInput,
  VisibilityRule,
} from "./types.js";

export { createAliasMatcher, matchTrackedByAliases, AliasMatcher, type AliasMatchEntry } from "./context/alias-matcher.js";
export { buildBibleContext, injectCharacterArcs, injectConflicts, injectPremise, injectWorldModel, type BuildBibleContextOptions } from "./context/build-bible-context.js";
export { composeBibleContext, formatBibleContextItem, type ComposableBibleContextItem, type ComposeBibleContextOptions } from "./context/compose-context.js";
export { resolveNestedRefs, type NestedRefEntry, type ResolveNestedRefsOptions } from "./context/nested-resolver.js";
export { formatBibleContextForPrompt, mergeBibleContextWithExternalContext } from "./context/pipeline-bridge.js";
export { formatDescriptor, hasDescriptorContent, safeParseDescriptor } from "./context/format-descriptor.js";
export { detectStalledConflict, detectStalledConflicts, getStalledConflicts, type StalledConflictWarning } from "./context/stalled-detector.js";
export { applyTokenBudget, estimateTokens, sortByContextPriority, type BudgetedBibleContextItem, type TokenBudgetResult } from "./context/token-budget.js";
export { filterEntriesVisibleAtChapter, getVisibilityRule, isVisibleAtChapter, parseVisibilityRule, type VisibilityRuleEntry } from "./context/visibility-filter.js";
export { createBookRepository } from "./repositories/book-repo.js";
export { createBibleCharacterArcRepository } from "./repositories/character-arc-repo.js";
export { createBibleCharacterRepository } from "./repositories/character-repo.js";
export { createBibleConflictRepository } from "./repositories/conflict-repo.js";
export { createBibleEventRepository } from "./repositories/event-repo.js";
export { createBiblePremiseRepository } from "./repositories/premise-repo.js";
export { createBibleSettingRepository } from "./repositories/setting-repo.js";
export { createBibleWorldModelRepository } from "./repositories/world-model-repo.js";
export { createBibleChapterSummaryRepository } from "./repositories/chapter-summary-repo.js";
