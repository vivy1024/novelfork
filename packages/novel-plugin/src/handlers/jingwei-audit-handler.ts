import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

export interface JingweiAuditInput {
  readonly bookId: string;
  readonly entryIds?: readonly string[];
  readonly chapterNumber?: number;
  readonly storage?: StorageDatabase;
}

export type JingweiAuditSeverity = "error" | "warning";

export interface JingweiAuditFinding {
  readonly entryId: string;
  readonly title: string;
  readonly sectionId: string;
  readonly sectionName: string;
  readonly severity: JingweiAuditSeverity;
  readonly reasons: readonly string[];
}

export interface JingweiAuditResult {
  readonly ok: true;
  readonly renderer: "jingwei.audit";
  readonly summary: string;
  readonly data: {
    readonly bookId: string;
    readonly checkedEntryCount: number;
    readonly findingCount: number;
    readonly findings: readonly JingweiAuditFinding[];
  };
}

interface JingweiAuditRow {
  readonly entry_id: string;
  readonly title: string;
  readonly section_id: string;
  readonly section_name: string;
  readonly entry_participates_in_ai: number;
  readonly status: string | null;
  readonly lifecycle: string | null;
  readonly visibility_rule_json: string | null;
  readonly section_enabled: number;
  readonly section_participates_in_ai: number;
}

function parseVisibilityRule(value: string | null): { visibleAfterChapter?: number; visibleUntilChapter?: number } {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as { visibleAfterChapter?: unknown; visibleUntilChapter?: unknown };
    return {
      visibleAfterChapter: typeof parsed.visibleAfterChapter === "number" ? parsed.visibleAfterChapter : undefined,
      visibleUntilChapter: typeof parsed.visibleUntilChapter === "number" ? parsed.visibleUntilChapter : undefined,
    };
  } catch {
    return {};
  }
}

function isVisibleAtChapter(row: JingweiAuditRow, chapterNumber: number | undefined): string | null {
  if (chapterNumber === undefined) return null;
  const rule = parseVisibilityRule(row.visibility_rule_json);
  if (rule.visibleAfterChapter !== undefined && chapterNumber < rule.visibleAfterChapter) {
    return `visibleAfterChapter=${rule.visibleAfterChapter}`;
  }
  if (rule.visibleUntilChapter !== undefined && chapterNumber > rule.visibleUntilChapter) {
    return `visibleUntilChapter=${rule.visibleUntilChapter}`;
  }
  return null;
}

function reasonsForRow(row: JingweiAuditRow, chapterNumber: number | undefined): string[] {
  const reasons: string[] = [];
  const status = row.status ?? "confirmed";
  const lifecycle = row.lifecycle ?? "active";
  if (lifecycle !== "active") reasons.push(`lifecycle=${lifecycle}`);
  if (status !== "confirmed") reasons.push(`status=${status}`);
  if (!Boolean(row.entry_participates_in_ai)) reasons.push("entry.participates_in_ai=false");
  if (!Boolean(row.section_enabled)) reasons.push("section.enabled=false");
  if (!Boolean(row.section_participates_in_ai)) reasons.push("section.participates_in_ai=false");
  const visibilityReason = isVisibleAtChapter(row, chapterNumber);
  if (visibilityReason) reasons.push(visibilityReason);
  return reasons;
}

function buildEntryFilter(entryIds: readonly string[] | undefined): { clause: string; params: readonly string[] } {
  const ids = (entryIds ?? []).map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) return { clause: "", params: [] };
  return {
    clause: ` AND e."id" IN (${ids.map(() => "?").join(", ")})`,
    params: ids,
  };
}

export async function handleJingweiAudit(input: JingweiAuditInput): Promise<JingweiAuditResult> {
  const bookId = input.bookId?.trim();
  if (!bookId) {
    return {
      ok: true,
      renderer: "jingwei.audit",
      summary: "bookId 为空，未执行经纬审计。",
      data: { bookId: "", checkedEntryCount: 0, findingCount: 0, findings: [] },
    };
  }

  const storage = input.storage ?? getStorageDatabase();
  const filter = buildEntryFilter(input.entryIds);
  const rows = storage.sqlite.prepare(`
    SELECT
      e."id" AS "entry_id",
      e."title" AS "title",
      e."section_id" AS "section_id",
      s."name" AS "section_name",
      e."participates_in_ai" AS "entry_participates_in_ai",
      COALESCE(e."status", 'confirmed') AS "status",
      COALESCE(e."lifecycle", 'active') AS "lifecycle",
      e."visibility_rule_json" AS "visibility_rule_json",
      s."enabled" AS "section_enabled",
      s."participates_in_ai" AS "section_participates_in_ai"
    FROM "story_jingwei_entry" e
    LEFT JOIN "story_jingwei_section" s
      ON s."book_id" = e."book_id" AND s."id" = e."section_id" AND s."deleted_at" IS NULL
    WHERE e."book_id" = ?
      AND e."deleted_at" IS NULL
      ${filter.clause}
    ORDER BY e."updated_at" DESC, e."title" ASC
  `).all(bookId, ...filter.params) as JingweiAuditRow[];

  const findings = rows.flatMap((row): JingweiAuditFinding[] => {
    const reasons = reasonsForRow(row, input.chapterNumber);
    if (reasons.length === 0) return [];
    return [{
      entryId: row.entry_id,
      title: row.title,
      sectionId: row.section_id,
      sectionName: row.section_name ?? "未找到分区",
      severity: "error",
      reasons,
    }];
  });

  return {
    ok: true,
    renderer: "jingwei.audit",
    summary: findings.length > 0
      ? `经纬审计完成：检查 ${rows.length} 条，发现 ${findings.length} 项不满足 active + confirmed + participates_in_ai 的读取门禁。`
      : `经纬审计完成：检查 ${rows.length} 条，未发现读取门禁问题。`,
    data: {
      bookId,
      checkedEntryCount: rows.length,
      findingCount: findings.length,
      findings,
    },
  };
}
