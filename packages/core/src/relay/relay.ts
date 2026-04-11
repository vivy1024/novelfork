/**
 * AIRelay — abstract interface that decouples callers from the concrete
 * PipelineRunner and its filesystem / LLM-client dependencies.
 *
 * Two families of operations:
 *   • Streaming (long-running): return a {@link RunHandle}; callers
 *     subscribe to progress via SSE or polling.
 *   • Request/response: return the result directly.
 */

import type { AuditResult } from "../agents/continuity.js";
import type { DetectionResult } from "../agents/detector.js";
import type { StyleProfile } from "../models/style-profile.js";
import type { DraftResult, ChapterPipelineResult, ReviseResult } from "../pipeline/runner.js";
import type { LLMRelayConfig, RunHandle, RunState } from "./types.js";

// ---------------------------------------------------------------------------
// WriteSnapshot — the minimal, frozen slice of book state the relay needs
// ---------------------------------------------------------------------------

export interface WriteSnapshot {
  readonly bookId: string;
  readonly projectRoot: string;
  readonly externalContext?: string;
  readonly wordCount?: number;
  readonly temperatureOverride?: number;
}

// ---------------------------------------------------------------------------
// AIRelay interface
// ---------------------------------------------------------------------------

export interface AIRelay {
  // --- streaming (long-running) operations --------------------------------

  /**
   * Write the next chapter end-to-end (plan → compose → write → audit → revise).
   * Returns a {@link RunHandle}; result delivered via {@link getRunState}.
   */
  startWriteNext(
    snapshot: WriteSnapshot,
    llm: LLMRelayConfig,
  ): Promise<RunHandle>;

  /**
   * Write a single draft (no audit / revise).
   */
  startDraft(
    snapshot: WriteSnapshot,
    llm: LLMRelayConfig,
    wordCount?: number,
  ): Promise<RunHandle>;

  /**
   * Revise an existing chapter draft.
   */
  startRevise(
    snapshot: WriteSnapshot,
    chapterNum: number,
    llm: LLMRelayConfig,
  ): Promise<RunHandle>;

  // --- request / response operations --------------------------------------

  /**
   * Run a continuity audit on a chapter draft.
   */
  audit(
    snapshot: WriteSnapshot,
    chapterNum: number,
    llm: LLMRelayConfig,
  ): Promise<AuditResult>;

  /**
   * Detect AI-generated content.
   */
  detect(
    content: string,
    llm: LLMRelayConfig,
  ): Promise<DetectionResult>;

  /**
   * Analyse the stylistic profile of a text sample.
   */
  analyzeStyle(
    text: string,
    llm: LLMRelayConfig,
  ): Promise<StyleProfile>;

  // --- run management -----------------------------------------------------

  /** Cancel an in-flight run. */
  cancelRun(runId: string): Promise<void>;

  /** Poll the current state of a run. */
  getRunState(runId: string): Promise<RunState>;
}

// ---------------------------------------------------------------------------
// Result wrappers stored inside the run map
// ---------------------------------------------------------------------------

export type RunResult =
  | { readonly kind: "writeNext"; readonly value: ChapterPipelineResult }
  | { readonly kind: "draft"; readonly value: DraftResult }
  | { readonly kind: "revise"; readonly value: ReviseResult };
