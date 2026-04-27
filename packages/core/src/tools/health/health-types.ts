import type { AuditIssue } from "../../agents/continuity.js";
import type { StalledConflictWarning } from "../../bible/context/stalled-detector.js";
import type { HookRecord } from "../../models/runtime-state.js";
import type { LongSpanFatigueIssue } from "../../utils/long-span-fatigue.js";

export interface ChapterAuditLog {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly auditedAt: string;
  readonly continuityPassed: boolean;
  readonly continuityIssueCount: number;
  readonly aiTasteScore: number;
  readonly hookHealthIssues: number;
  readonly longSpanFatigueIssues: number;
  readonly sensitiveWordCount: number;
  readonly chapterType: string;
  readonly mood: string;
  readonly povCharacter?: string;
  readonly conflictsAdvanced: ReadonlyArray<string>;
  readonly arcBeats: ReadonlyArray<{
    readonly characterId: string;
    readonly event: string;
  }>;
}

export interface BookHealthSummary {
  readonly totalChapters: number;
  readonly totalWords: number;
  readonly consistencyScore: number;
  readonly hookRecoveryRate: number;
  readonly pendingHooks: ReadonlyArray<HookRecord>;
  readonly aiTasteAvg: number;
  readonly aiTasteTrend: ReadonlyArray<number>;
  readonly pacingDiversityScore: number;
  readonly emotionCurve: ReadonlyArray<string>;
  readonly sensitiveWordTotal: number;
  readonly stalledConflicts: ReadonlyArray<StalledConflictWarning>;
  readonly hookDebtWarnings: ReadonlyArray<AuditIssue>;
  readonly fatigueWarnings: ReadonlyArray<LongSpanFatigueIssue>;
  readonly povGapWarnings: ReadonlyArray<{
    readonly character: string;
    readonly gap: number;
  }>;
  readonly mainConflictDrift?: {
    readonly conflictId: string;
    readonly stalledChapters: number;
  };
}
