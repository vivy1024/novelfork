export type { GeneratedHook, HookGeneratorInput, HookStyle, RetentionEstimate } from "./chapter-hooks/hook-types.js";
export { generateChapterHooks, parseGeneratedHooks, type GenerateChapterHooksParams } from "./chapter-hooks/hook-generator.js";
export type { PovCharacter, PovDashboard, PovSuggestion, PovWarning } from "./pov/pov-types.js";
export { buildPovDashboard, type BuildPovDashboardInput } from "./pov/pov-tracker.js";
export type { DailyProgress, ProgressConfig, WritingLog } from "./progress/progress-types.js";
export { getDailyProgress, getProgressTrend, recordChapterCompletion } from "./progress/daily-tracker.js";
export type { HistogramBucket, RhythmAnalysis, RhythmIssue, SentenceRange } from "./analysis/rhythm-types.js";
export { analyzeRhythm } from "./analysis/rhythm-analyzer.js";
export type { DialogueAnalysis, DialogueChapterType } from "./analysis/dialogue-types.js";
export { analyzeDialogue } from "./analysis/dialogue-analyzer.js";
export type { BookHealthSummary, ChapterAuditLog } from "./health/health-types.js";
export { persistChapterAuditLog, type PersistAuditLogInput } from "./health/audit-log-persist.js";
export { buildBookHealthSummary } from "./health/book-health-summary.js";
export type {
  ConflictDialecticExtension,
  ConflictNature,
  ConflictRank,
  ConflictResolutionState,
  ConflictTransformation,
} from "./conflicts/conflict-types.js";
export type { ConflictMapEntry, MainConflictDrift } from "./conflicts/conflict-tracker.js";
export { buildConflictMap, detectMainConflictDrift } from "./conflicts/conflict-tracker.js";
export type { ArcBeat, ArcBeatDirection, ArcType, CharacterArc } from "./arcs/arc-types.js";
export type { ArcInconsistency, StagnantArc } from "./arcs/character-arc-tracker.js";
export { detectArcInconsistency, detectStagnantArc } from "./arcs/character-arc-tracker.js";
export type { ToneDriftResult } from "./tone/tone-types.js";
export { GENRE_TONE_MAP, detectToneDrift } from "./tone/tone-drift-detector.js";
export type { ParsedChapter, ParseResult } from "./import/file-parser.js";
export { parseTxt, parseFile } from "./import/file-parser.js";
export type { StyleProfile as ImportStyleProfile, RangeStats, PersonalStyleProfile } from "./import/multi-work-style.js";
export { mergeStyleProfiles } from "./import/multi-work-style.js";
export type { DriftResult } from "./import/style-drift-detector.js";
export { detectStyleDrift } from "./import/style-drift-detector.js";
