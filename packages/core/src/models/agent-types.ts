/**
 * Agent output types — shared between core and novel-plugin.
 *
 * These types were originally defined in the agents module (now in novel-plugin).
 * They are duplicated here so that core's utils/hooks/registry can reference them
 * without depending on novel-plugin (which would create a circular dependency).
 */

import type { ChapterIntent } from "./input-governance.js";
import type { RuntimeStateDelta } from "./runtime-state.js";

/** Result of a continuity audit */
export interface AuditResult {
  readonly passed: boolean;
  readonly issues: ReadonlyArray<AuditIssue>;
  readonly summary: string;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
  };
}

/** A single audit issue */
export interface AuditIssue {
  readonly severity: "critical" | "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

/** Output from the planner agent */
export interface PlanChapterOutput {
  readonly intent: ChapterIntent;
  readonly intentMarkdown: string;
  readonly plannerInputs: ReadonlyArray<string>;
  readonly runtimePath: string;
}

/** Output from the writer agent */
export interface WriteChapterOutput {
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly wordCount: number;
  readonly preWriteCheck: string;
  readonly postSettlement: string;
  readonly runtimeStateDelta?: RuntimeStateDelta;
  readonly runtimeStateSnapshot?: unknown;
  readonly updatedState: string;
  readonly updatedLedger: string;
  readonly updatedHooks: string;
  readonly chapterSummary: string;
  readonly updatedChapterSummaries?: string;
  readonly updatedSubplots: string;
  readonly updatedEmotionalArcs: string;
  readonly updatedCharacterMatrix: string;
  readonly lengthTelemetry?: unknown;
}

/** A post-write validation violation */
export interface PostWriteViolation {
  readonly rule: string;
  readonly severity: "error" | "warning";
  readonly description: string;
  readonly suggestion: string;
}

/** Revise mode options */
export type ReviseMode = "full" | "spot-fix" | "auto";
