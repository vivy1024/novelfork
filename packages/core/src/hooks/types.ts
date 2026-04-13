/**
 * Pipeline Hooks - Lifecycle interceptors for PipelineRunner
 *
 * Inspired by VoltAgent's Hooks system, this module provides a flexible
 * mechanism to intercept and extend pipeline behavior at key lifecycle points.
 */

import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";
import type { AuditResult } from "../agents/continuity.js";
import type { PlanChapterOutput } from "../agents/planner.js";
import type { WriteChapterOutput } from "../agents/writer.js";

/**
 * Context passed to hook handlers at each lifecycle point.
 * Contains read-only access to pipeline state and mutable metadata.
 */
export interface HookContext {
  /** Book configuration */
  readonly book: BookConfig;
  /** Current chapter number */
  readonly chapterNumber: number;
  /** Chapter metadata (if available) */
  readonly chapterMeta?: ChapterMeta;
  /** Pipeline stage name */
  readonly stage: PipelineStage;
  /** Mutable metadata bag for cross-hook communication */
  readonly metadata: Record<string, unknown>;
  /** Timestamp when hook was triggered */
  readonly timestamp: Date;
}

/**
 * Pipeline stages where hooks can be registered
 */
export type PipelineStage =
  | "before-plan"
  | "after-plan"
  | "before-compose"
  | "after-compose"
  | "before-write"
  | "after-write"
  | "before-normalize"
  | "after-normalize"
  | "before-settle"
  | "after-settle"
  | "before-audit"
  | "after-audit"
  | "before-revise"
  | "after-revise"
  | "chapter-complete"
  | "chapter-failed";

/**
 * Hook handler function signature
 */
export type HookHandler = (ctx: HookContext) => Promise<void> | void;

/**
 * Pipeline hooks interface - all hooks are optional
 */
export interface PipelineHooks {
  /** Before planning phase */
  onBeforePlan?: HookHandler;
  /** After planning phase - plan output available in metadata */
  onAfterPlan?: HookHandler;
  /** Before composition phase */
  onBeforeCompose?: HookHandler;
  /** After composition phase */
  onAfterCompose?: HookHandler;
  /** Before writing phase */
  onBeforeWrite?: HookHandler;
  /** After writing phase - draft available in metadata */
  onAfterWrite?: HookHandler;
  /** Before length normalization */
  onBeforeNormalize?: HookHandler;
  /** After length normalization */
  onAfterNormalize?: HookHandler;
  /** Before state settlement */
  onBeforeSettle?: HookHandler;
  /** After state settlement */
  onAfterSettle?: HookHandler;
  /** Before continuity audit */
  onBeforeAudit?: HookHandler;
  /** After continuity audit - audit result available in metadata */
  onAfterAudit?: HookHandler;
  /** Before revision phase */
  onBeforeRevise?: HookHandler;
  /** After revision phase */
  onAfterRevise?: HookHandler;
  /** Chapter pipeline completed successfully */
  onChapterComplete?: HookHandler;
  /** Chapter pipeline failed */
  onChapterFailed?: HookHandler;
}

/**
 * Hook configuration from inkos.json
 */
export interface HookConfig {
  /** Hook name/identifier */
  readonly name: string;
  /** Pipeline stages to trigger on */
  readonly stages: ReadonlyArray<PipelineStage>;
  /** Hook type: builtin or custom script */
  readonly type: "builtin" | "script";
  /** For builtin hooks: handler name */
  readonly handler?: string;
  /** For script hooks: script path */
  readonly script?: string;
  /** Hook-specific configuration */
  readonly config?: Record<string, unknown>;
  /** Whether hook is enabled */
  readonly enabled?: boolean;
}
