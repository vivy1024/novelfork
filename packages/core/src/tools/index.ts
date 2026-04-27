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
export type {
  ConflictDialecticExtension,
  ConflictNature,
  ConflictRank,
  ConflictResolutionState,
  ConflictTransformation,
} from "./conflicts/conflict-types.js";
export type { ArcBeat, ArcBeatDirection, ArcType, CharacterArc } from "./arcs/arc-types.js";
export type { ToneDriftResult } from "./tone/tone-types.js";
