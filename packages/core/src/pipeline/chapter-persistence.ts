import type { AuditIssue, AuditResult } from "../agents/continuity.js";
import type { ChapterMeta } from "../models/chapter.js";
import type { LengthTelemetry } from "../models/length-governance.js";
import { buildStateDegradedReviewNote } from "./chapter-state-recovery.js";

export interface ChapterPersistenceUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export type ChapterPersistenceStatus = "ready-for-review" | "audit-failed" | "state-degraded";

export async function persistChapterArtifacts(params: {
  readonly chapterNumber: number;
  readonly chapterTitle: string;
  readonly status: ChapterPersistenceStatus;
  readonly auditResult: AuditResult;
  readonly finalWordCount: number;
  readonly lengthWarnings: ReadonlyArray<string>;
  readonly lengthTelemetry?: LengthTelemetry;
  readonly degradedIssues: ReadonlyArray<AuditIssue>;
  readonly tokenUsage?: ChapterPersistenceUsage;
  readonly loadChapterIndex: () => Promise<ReadonlyArray<ChapterMeta>>;
  readonly saveChapter: () => Promise<void>;
  readonly saveTruthFiles: () => Promise<void>;
  readonly saveChapterIndex: (index: ReadonlyArray<ChapterMeta>) => Promise<void>;
  readonly markBookActiveIfNeeded: () => Promise<void>;
  readonly persistAuditDriftGuidance: (issues: ReadonlyArray<AuditIssue>) => Promise<void>;
  readonly snapshotState: () => Promise<void>;
  readonly syncCurrentStateFactHistory: () => Promise<void>;
  readonly logSnapshotStage: () => void;
  readonly now?: () => string;
}): Promise<{ readonly entry: ChapterMeta }> {
  await params.saveChapter();
  if (params.status !== "state-degraded") {
    await params.saveTruthFiles();
  }

  const existingIndex = await params.loadChapterIndex();
  const now = params.now?.() ?? new Date().toISOString();
  const entry: ChapterMeta = {
    number: params.chapterNumber,
    title: params.chapterTitle,
    status: params.status,
    wordCount: params.finalWordCount,
    createdAt: now,
    updatedAt: now,
    auditIssues: params.auditResult.issues.map((issue) => `[${issue.severity}] ${issue.description}`),
    lengthWarnings: [...params.lengthWarnings],
    reviewNote: params.status === "state-degraded"
      ? buildStateDegradedReviewNote(
          params.auditResult.passed ? "ready-for-review" : "audit-failed",
          params.degradedIssues,
        )
      : undefined,
    lengthTelemetry: params.lengthTelemetry,
    tokenUsage: params.tokenUsage,
  };
  await params.saveChapterIndex([...existingIndex, entry]);
  await params.markBookActiveIfNeeded();

  const driftIssues = params.auditResult.issues.filter(
    (issue) => issue.severity === "critical" || issue.severity === "warning",
  );
  await params.persistAuditDriftGuidance(params.status === "state-degraded" ? [] : driftIssues);

  if (params.status !== "state-degraded") {
    params.logSnapshotStage();
    await params.snapshotState();
    await params.syncCurrentStateFactHistory();
  }

  return { entry };
}
