export type {
  BibleChapterSummaryRecord,
  BibleCharacterRecord,
  BibleContextItem,
  BibleContextItemType,
  BibleEventRecord,
  BibleMode,
  BibleSettingRecord,
  BibleVisibilitySource,
  BuildBibleContextInput,
  BuildBibleContextResult,
  BookRecord,
  CreateBibleChapterSummaryInput,
  CreateBibleCharacterInput,
  CreateBibleEventInput,
  CreateBibleSettingInput,
  CreateBookInput,
  UpdateBibleChapterSummaryInput,
  UpdateBibleCharacterInput,
  UpdateBibleEventInput,
  UpdateBibleSettingInput,
  UpdateBookInput,
  VisibilityRule,
} from "./types.js";

export { createAliasMatcher, matchTrackedByAliases, AliasMatcher, type AliasMatchEntry } from "./context/alias-matcher.js";
export { buildBibleContext, injectCharacterArcs, injectConflicts, injectPremise, injectWorldModel, type BuildBibleContextOptions } from "./context/build-bible-context.js";
export { composeBibleContext, formatBibleContextItem, type ComposableBibleContextItem, type ComposeBibleContextOptions } from "./context/compose-context.js";
export { resolveNestedRefs, type NestedRefEntry, type ResolveNestedRefsOptions } from "./context/nested-resolver.js";
export { applyTokenBudget, estimateTokens, sortByContextPriority, type BudgetedBibleContextItem, type TokenBudgetResult } from "./context/token-budget.js";
export { filterEntriesVisibleAtChapter, getVisibilityRule, isVisibleAtChapter, parseVisibilityRule, type VisibilityRuleEntry } from "./context/visibility-filter.js";
export { createBookRepository } from "./repositories/book-repo.js";
export { createBibleCharacterRepository } from "./repositories/character-repo.js";
export { createBibleEventRepository } from "./repositories/event-repo.js";
export { createBibleSettingRepository } from "./repositories/setting-repo.js";
export { createBibleChapterSummaryRepository } from "./repositories/chapter-summary-repo.js";
