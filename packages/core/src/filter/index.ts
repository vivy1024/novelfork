export { runFilter, mapAiTasteLevel, summarizeHitCounts, FILTER_ENGINE_VERSION, FILTER_RULES, type FilterRule, type RuleContext, type RunFilterOptions } from "./engine/index.js";
export { AhoCorasickMatcher, type KeywordMatch } from "./engine/ac-matcher.js";
export { loadFilterDictionary, type FilterDictionaryName } from "./engine/dictionaries.js";
export { tokenizeChineseText, stdDev, variance, type TextSegment, type TokenizedChineseText } from "./engine/tokenizer.js";
export { scanChapterAndStoreFilterReport, type ScanChapterAndStoreFilterReportInput } from "./integration/pipeline-hook.js";
export { createFilterReportRepository } from "./repositories/filter-report-repo.js";
export { suggestSevenTactics, SEVEN_TACTICS, type SevenTacticSuggestion } from "./suggestions/seven-tactics.js";
export { getZhuqueConfigFromKv, scanWithZhuque, type ZhuqueConfig } from "./zhuque/client.js";
export type {
  AiTasteLevel,
  CreateStoredFilterReportInput,
  CrossSpecHint,
  FilterReport,
  RuleHit,
  RuleSeverity,
  RuleSpan,
  StoredFilterReportRecord,
  ZhuqueResult,
  ZhuqueStatus,
} from "./types.js";
