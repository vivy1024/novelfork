import type { StorageDatabase } from "../../storage/db.js";
import { chapterAuditLogs } from "../../storage/schema.js";
import type { AuditResult } from "../../agents/continuity.js";

export interface PersistAuditLogInput {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly auditResult: AuditResult;
}

export function persistChapterAuditLog(
  storage: StorageDatabase,
  input: PersistAuditLogInput,
): void {
  const { bookId, chapterNumber, auditResult } = input;
  const aiTasteIssues = auditResult.issues.filter(
    (i) => i.category === "ai-taste" || i.category === "ai-tell",
  );
  const hookHealthIssues = auditResult.issues.filter(
    (i) => i.category.toLowerCase().includes("hook"),
  );
  const fatigueIssues = auditResult.issues.filter(
    (i) => i.category.toLowerCase().includes("fatigue") || i.category.toLowerCase().includes("long-span"),
  );
  const sensitiveIssues = auditResult.issues.filter(
    (i) => i.category.toLowerCase().includes("sensitive"),
  );

  storage.db
    .insert(chapterAuditLogs)
    .values({
      bookId,
      chapterNumber,
      auditedAt: new Date().toISOString(),
      continuityPassed: auditResult.passed,
      continuityIssueCount: auditResult.issues.length,
      aiTasteScore: aiTasteIssues.length,
      hookHealthIssues: hookHealthIssues.length,
      longSpanFatigueIssues: fatigueIssues.length,
      sensitiveWordCount: sensitiveIssues.length,
      rhythmDiversityScore: 0,
      summary: auditResult.summary || "",
    })
    .run();
}
