/**
 * Chapter Review Cycle — audit → revise → reassess closed loop.
 *
 * After Writer produces a chapter, run this cycle:
 * 1. Audit the chapter (existing ContinuityAuditor)
 * 2. If score < threshold and issues found, auto-revise
 * 3. Re-audit the revised content
 * 4. If still failing but improving, loop (max N times)
 * 5. Pick the best snapshot across all iterations
 *
 * Ported from InkOS chapter-review-cycle.ts with NovelFork adaptations.
 * NovelFork AuditResult uses `passed` boolean + issues list (no overallScore),
 * so we derive a score from issue severity counts.
 */

import type { AuditIssue, AuditResult } from "./continuity.js";

export interface ReviewCycleConfig {
  /** Max repair iterations (default: 1) */
  maxIterations: number;
  /** Score threshold to pass (0-100, default: 85) */
  passScore: number;
  /** Minimum score improvement to continue (default: 3) */
  minImprovement: number;
  /** Max word count drift allowed (fraction, default: 0.15 = ±15%) */
  maxDrift: number;
}

export const DEFAULT_REVIEW_CONFIG: ReviewCycleConfig = {
  maxIterations: 1,
  passScore: 85,
  minImprovement: 3,
  maxDrift: 0.15,
};

export interface ReviewCycleResult {
  /** Final chapter content (best snapshot) */
  content: string;
  /** Final word count */
  wordCount: number;
  /** Whether content was revised */
  revised: boolean;
  /** Final audit result */
  auditResult: AuditResult;
  /** Number of post-write revise iterations performed */
  iterations: number;
  /** Best score across all iterations */
  bestScore: number;
}

export interface ReviewSnapshot {
  content: string;
  wordCount: number;
  score: number;
  iteration: number;
  auditResult: AuditResult;
}

/**
 * Derive a numeric score (0–100) from an AuditResult.
 * NovelFork's AuditResult doesn't carry overallScore, so we compute one
 * from issue severity: critical = −10, warning = −3, info = −1.
 * Base score starts at 100 if passed, 70 if not.
 */
export function deriveScore(audit: AuditResult): number {
  const base = audit.passed ? 100 : 70;
  let penalty = 0;
  for (const issue of audit.issues) {
    switch (issue.severity) {
      case "critical":
        penalty += 10;
        break;
      case "warning":
        penalty += 3;
        break;
      case "info":
        penalty += 1;
        break;
    }
  }
  return Math.max(0, base - penalty);
}

/**
 * Run the chapter review cycle: assess → revise → reassess.
 *
 * @param chapterContent - The initial chapter content from Writer
 * @param chapterNumber - Chapter number for context
 * @param auditFn - Async function that audits content and returns AuditResult
 * @param reviseFn - Async function that takes content + issues and returns revised content
 * @param config - Optional config overrides
 */
export async function runChapterReviewCycle(
  chapterContent: string,
  chapterNumber: number,
  auditFn: (content: string, chapterNumber: number) => Promise<AuditResult>,
  reviseFn: (
    content: string,
    chapterNumber: number,
    issues: ReadonlyArray<AuditIssue>,
  ) => Promise<{ content: string; issues?: ReadonlyArray<AuditIssue> }>,
  config: Partial<ReviewCycleConfig> = {},
): Promise<ReviewCycleResult> {
  const cfg = { ...DEFAULT_REVIEW_CONFIG, ...config };
  const initialWordCount = estimateWordCount(chapterContent);

  // Snapshot 0: initial draft
  const initialAudit = await auditFn(chapterContent, chapterNumber);
  const initialScore = deriveScore(initialAudit);
  const snapshots: ReviewSnapshot[] = [
    {
      content: chapterContent,
      wordCount: initialWordCount,
      score: initialScore,
      iteration: 0,
      auditResult: initialAudit,
    },
  ];

  if (isPassed(initialAudit, cfg.passScore)) {
    return {
      content: chapterContent,
      wordCount: initialWordCount,
      revised: false,
      auditResult: initialAudit,
      iterations: 0,
      bestScore: initialScore,
    };
  }

  // Repair loop
  let currentContent = chapterContent;
  let currentAudit = initialAudit;
  let currentScore = initialScore;
  let bestSnapshot = snapshots[0];

  for (let i = 1; i <= cfg.maxIterations; i++) {
    const reviseResult = await reviseFn(
      currentContent,
      chapterNumber,
      currentAudit.issues,
    );

    if (!reviseResult.content || reviseResult.content === currentContent) {
      break; // No new content produced
    }

    const revisedWordCount = estimateWordCount(reviseResult.content);
    // Length drift check
    const drift =
      Math.abs(revisedWordCount - initialWordCount) / (initialWordCount || 1);
    if (drift > cfg.maxDrift) {
      // Length drifted too much — keep old snapshot
      break;
    }

    const revisedAudit = await auditFn(reviseResult.content, chapterNumber);
    const revisedScore = deriveScore(revisedAudit);

    const snapshot: ReviewSnapshot = {
      content: reviseResult.content,
      wordCount: revisedWordCount,
      score: revisedScore,
      iteration: i,
      auditResult: revisedAudit,
    };
    snapshots.push(snapshot);

    if (revisedScore > bestSnapshot.score) {
      bestSnapshot = snapshot;
    }

    if (isPassed(revisedAudit, cfg.passScore)) {
      return {
        content: reviseResult.content,
        wordCount: revisedWordCount,
        revised: true,
        auditResult: revisedAudit,
        iterations: i,
        bestScore: revisedScore,
      };
    }

    // Net improvement check
    if (revisedScore < currentScore + cfg.minImprovement) {
      break; // Not improving enough
    }

    currentContent = reviseResult.content;
    currentAudit = revisedAudit;
    currentScore = revisedScore;
  }

  // Return best snapshot across all iterations
  return {
    content: bestSnapshot.content,
    wordCount: bestSnapshot.wordCount,
    revised: snapshots.length > 1,
    auditResult: bestSnapshot.auditResult,
    iterations: snapshots.length - 1,
    bestScore: bestSnapshot.score,
  };
}

function isPassed(audit: AuditResult, threshold: number): boolean {
  return audit.passed === true && deriveScore(audit) >= threshold;
}

/**
 * Estimate word count for mixed CJK / Latin text.
 */
export function estimateWordCount(content: string): number {
  if (!content) return 0;
  // CJK: count characters; Latin: count words
  const cjkChars = (
    content.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []
  ).length;
  const latinWords = content
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return cjkChars + latinWords;
}
