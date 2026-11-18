import { createHash } from "node:crypto";

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { chapterAuditLogs } from "@vivy1024/novelfork-core/storage";
import { chapterContentFingerprint } from "../../narrative-memory/settlement-idempotency.js";
import type { AuditResult, AuditIssue } from "../../agents/continuity.js";

export interface PersistAuditLogInput {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly auditResult: AuditResult;
  /** 审计时的正文原文；传入则落指纹，供改章 stale 判定。 */
  readonly content?: string;
}

/** T4b 稳定 issue_id：同章同维同描述跨轮次保持一致（内容哈希，OpenWrite 式）。 */
export function buildAuditIssueId(
  bookId: string,
  chapterNumber: number,
  issue: Pick<AuditIssue, "category" | "description">,
  index: number,
): string {
  const hash = createHash("sha256")
    .update(`${bookId}|${chapterNumber}|${issue.category}|${issue.description}|${index}`, "utf8")
    .digest("hex");
  return `issue_${hash.slice(0, 12)}`;
}

interface SerializedAuditIssue {
  readonly issueId: string;
  readonly severity: string;
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

function serializeIssues(
  bookId: string,
  chapterNumber: number,
  issues: readonly AuditIssue[],
): SerializedAuditIssue[] {
  return issues.map((issue, index) => ({
    issueId: buildAuditIssueId(bookId, chapterNumber, issue, index),
    severity: issue.severity,
    category: issue.category,
    description: issue.description,
    suggestion: issue.suggestion,
  }));
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
      // T4b：明细+指纹随行落盘；新审计天然不 stale。
      issuesJson: JSON.stringify(serializeIssues(bookId, chapterNumber, auditResult.issues)),
      ...(input.content !== undefined
        ? { contentFingerprint: chapterContentFingerprint(input.content) }
        : {}),
      stale: false,
    })
    .run();
}

// ---------------------------------------------------------------------------
// T4b · stale 判定与 issue 差集（OpenWrite 式闭环）
// ---------------------------------------------------------------------------

export interface StoredAuditIssue extends SerializedAuditIssue {
  readonly stale?: boolean;
}

/** 改章 stale：该章最新审计的指纹 ≠ 当前正文指纹 → 标记过期。幂等。 */
export function markChapterAuditStale(
  storage: StorageDatabase,
  bookId: string,
  chapterNumber: number,
  currentContentFingerprint: string,
): boolean {
  const latest = storage.sqlite.prepare<{ id: number; content_fingerprint: string | null; stale: number }>(`
    SELECT id, content_fingerprint, stale FROM chapter_audit_log
    WHERE book_id = ? AND chapter_number = ?
    ORDER BY audited_at DESC LIMIT 1
  `).get(bookId, chapterNumber);
  if (!latest?.content_fingerprint || latest.stale) return false;
  if (latest.content_fingerprint === currentContentFingerprint) return false;
  storage.sqlite.prepare(
    "UPDATE chapter_audit_log SET stale = 1 WHERE id = ?",
  ).run(latest.id);
  return true;
}

export interface IssueDelta {
  resolved: ReadonlyArray<StoredAuditIssue>;
  remaining: ReadonlyArray<StoredAuditIssue>;
  fresh: ReadonlyArray<StoredAuditIssue>;
}

/** 再审差集：按 issueId 对比上一轮，算 resolved / remaining / new。 */
export function computeIssueDelta(
  previousIssues: readonly StoredAuditIssue[],
  nextIssues: readonly StoredAuditIssue[],
): IssueDelta {
  const prevIds = new Set(previousIssues.map((issue) => issue.issueId));
  const nextIds = new Set(nextIssues.map((issue) => issue.issueId));
  return {
    resolved: previousIssues.filter((issue) => !nextIds.has(issue.issueId)),
    remaining: previousIssues.filter((issue) => nextIds.has(issue.issueId)),
    fresh: nextIssues.filter((issue) => !prevIds.has(issue.issueId)),
  };
}

/** 某章最新一次审计的 issue 明细（含 stale 标记与指纹）。 */
export function readLatestAuditIssues(
  storage: StorageDatabase,
  bookId: string,
  chapterNumber: number,
): { issues: ReadonlyArray<StoredAuditIssue>; stale: boolean; auditedAt: string; contentFingerprint: string | null } | null {
  const row = storage.sqlite.prepare<{
    issues_json: string | null;
    stale: number;
    audited_at: string;
    content_fingerprint: string | null;
  }>(`
    SELECT issues_json, stale, audited_at, content_fingerprint
    FROM chapter_audit_log
    WHERE book_id = ? AND chapter_number = ?
    ORDER BY audited_at DESC LIMIT 1
  `).get(bookId, chapterNumber);
  if (!row) return null;
  let issues: StoredAuditIssue[] = [];
  try {
    issues = row.issues_json ? (JSON.parse(row.issues_json) as StoredAuditIssue[]) : [];
  } catch {
    issues = [];
  }
  return { issues, stale: Boolean(row.stale), auditedAt: row.audited_at, contentFingerprint: row.content_fingerprint };
}

export interface ChapterAuditIssueSummary {
  readonly chapterNumber: number;
  readonly issueCount: number;
  readonly criticalCount: number;
  readonly stale: boolean;
}

/** 汇总全书各章最新一次审计的问题数与严重级别，供资源管理器标注红标/筛选。 */
export function listLatestAuditIssueSummaries(
  storage: StorageDatabase,
  bookId: string,
): ChapterAuditIssueSummary[] {
  const rows = storage.sqlite.prepare<{
    chapter_number: number;
    issues_json: string | null;
    continuity_issue_count: number;
    stale: number;
  }>(`
    SELECT c.chapter_number, c.issues_json, c.continuity_issue_count, c.stale
    FROM chapter_audit_log c
    INNER JOIN (
      SELECT chapter_number, MAX(id) AS max_id
      FROM chapter_audit_log
      WHERE book_id = ?
      GROUP BY chapter_number
    ) latest ON latest.max_id = c.id
    WHERE c.book_id = ?
    ORDER BY c.chapter_number ASC
  `).all(bookId, bookId);

  return rows.map((row) => {
    let issues: StoredAuditIssue[] = [];
    try {
      issues = row.issues_json ? (JSON.parse(row.issues_json) as StoredAuditIssue[]) : [];
    } catch {
      issues = [];
    }
    const issueCount = issues.length > 0 ? issues.length : Number(row.continuity_issue_count ?? 0);
    const criticalCount = issues.filter((issue) => (issue.severity ?? "").toLowerCase() === "critical").length;
    return {
      chapterNumber: row.chapter_number,
      issueCount,
      criticalCount,
      stale: Boolean(row.stale),
    };
  });
}
