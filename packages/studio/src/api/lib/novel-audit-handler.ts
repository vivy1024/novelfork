/**
 * /novel:audit Handler — run continuity audit against book chapters.
 *
 * 对标 core 的连续性审计引擎 (continuity.ts, chapter-jingwei-validation.ts)
 */

export interface AuditFinding {
  readonly type: "contradiction" | "setting-conflict" | "timeline-error" | "character-inconsistency";
  readonly severity: "high" | "medium" | "low";
  readonly description: string;
  readonly chapters: readonly string[];
}

export interface AuditEngineResult {
  readonly ok: boolean;
  readonly findings: readonly AuditFinding[];
  readonly summary: string;
  readonly error?: string;
}

export interface NovelAuditInput {
  readonly bookId: string;
  readonly auditEngine: (bookId: string) => Promise<AuditEngineResult>;
  readonly chapterIds?: readonly string[];
}

export interface NovelAuditResult {
  readonly ok: boolean;
  readonly findings?: readonly AuditFinding[];
  readonly summary?: string;
  readonly error?: string;
}

export async function executeNovelAudit(input: NovelAuditInput): Promise<NovelAuditResult> {
  try {
    const result = await input.auditEngine(input.bookId);
    if (!result.ok) {
      return { ok: false, error: result.error ?? "Audit engine returned failure" };
    }
    return { ok: true, findings: result.findings, summary: result.summary };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
