/**
 * Chapter State Recovery — retry settlement when state validation fails.
 *
 * Instead of re-writing the entire chapter, this module retries only
 * the "settlement" step (state update extraction) with validation
 * feedback, allowing the model to fix state inconsistencies without
 * touching the prose.
 *
 * Ported from InkOS chapter-state-recovery.ts.
 */

export interface SettlementRetryResult {
  kind: "recovered" | "degraded";
  updatedState?: string;
  updatedHooks?: string;
  issues: string[];
}

/**
 * Retry settlement after state validation failure.
 *
 * @param params.content - Chapter prose content (untouched)
 * @param params.chapterNumber - Chapter number
 * @param params.oldState - Previous state snapshot
 * @param params.validationWarnings - Warnings from failed validation
 * @param params.settleFn - Settlement function that extracts state + hooks from content
 * @param params.validateFn - Validation function that checks old vs new state
 */
export async function retrySettlementAfterValidationFailure(params: {
  content: string;
  chapterNumber: number;
  oldState: string;
  validationWarnings: string[];
  settleFn: (
    content: string,
    chapterNumber: number,
    feedback: string,
  ) => Promise<{ state: string; hooks: string }>;
  validateFn: (
    content: string,
    chapterNumber: number,
    oldState: string,
    newState: string,
  ) => Promise<{ passed: boolean; warnings: string[] }>;
}): Promise<SettlementRetryResult> {
  const feedback = params.validationWarnings
    .map((w, i) => `${i + 1}. ${w}`)
    .join("\n");

  try {
    const retryResult = await params.settleFn(
      params.content,
      params.chapterNumber,
      feedback,
    );

    const revalidation = await params.validateFn(
      params.content,
      params.chapterNumber,
      params.oldState,
      retryResult.state,
    );

    if (revalidation.passed) {
      return {
        kind: "recovered",
        updatedState: retryResult.state,
        updatedHooks: retryResult.hooks,
        issues: revalidation.warnings,
      };
    }

    return {
      kind: "degraded",
      updatedState: retryResult.state,
      updatedHooks: retryResult.hooks,
      issues: [
        ...revalidation.warnings,
        "State validation still failing after retry — chapter marked as degraded.",
      ],
    };
  } catch (error) {
    return {
      kind: "degraded",
      issues: [
        `Settlement retry failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}
