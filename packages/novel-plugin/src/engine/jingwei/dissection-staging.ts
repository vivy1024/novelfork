/**
 * 拆书暂存区：候选不进正式经纬，确认前不参与 AI 召回。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

export type DissectionStagingStatus = "needs-review" | "accepted" | "rejected";
export type DissectionStagingKind =
  | "characters"
  | "locations"
  | "factions"
  | "power-system"
  | "rules"
  | "props"
  | "world-model"
  | "relationships"
  | "foreshadowing"
  | "chapter-summaries";

export interface DissectionSourceRef {
  readonly chapterNumber: number;
  readonly excerpt: string;
  readonly path?: string;
  readonly fileName?: string;
  readonly startLine?: number;
  readonly endLine?: number;
}

export interface DissectionDuplicateCandidate {
  readonly entryId: string;
  readonly title: string;
  readonly reason: "title" | "alias" | "entry-key";
}

export interface DissectionStagingRecord {
  readonly id: string;
  readonly bookId: string;
  readonly kind: DissectionStagingKind;
  readonly category: string;
  readonly proposedTitle: string;
  readonly entryKey: string;
  readonly aliases: readonly string[];
  readonly sourceRefs: readonly DissectionSourceRef[];
  readonly evidenceRanges: readonly DissectionSourceRef[];
  readonly classificationReason: string;
  readonly confidence: number;
  readonly duplicateCandidates: readonly DissectionDuplicateCandidate[];
  readonly status: DissectionStagingStatus;
  readonly participatesInAi: false;
  readonly contentMd: string;
  readonly fields: Record<string, unknown>;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface DissectionStagingWriteInput {
  readonly bookId: string;
  readonly kind: DissectionStagingKind;
  readonly category: string;
  readonly proposedTitle: string;
  readonly entryKey?: string;
  readonly aliases?: readonly string[];
  readonly sourceRefs: readonly DissectionSourceRef[];
  readonly evidenceRanges?: readonly DissectionSourceRef[];
  readonly classificationReason: string;
  readonly confidence?: number;
  readonly duplicateCandidates?: readonly DissectionDuplicateCandidate[];
  readonly contentMd: string;
  readonly fields?: Record<string, unknown>;
  readonly now?: () => Date;
}

export interface JingweiDuplicateLookup {
  readonly id: string;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly category: string;
}

const PRONOUNS = new Set(["他", "她", "它", "你", "我", "他们", "她们", "它们", "你爸", "你妈", "此人", "该人"]);
const ACTION_FRAGMENT = /^(低头|站在|走道|来到|回到|离开|说道|冷声|淡淡|望着|看着)/u;
const PRONOUN_PREFIXED_ACTION = /^(他|她|它|你|我)(低头|站在|站在|走进|走来|抬头|沉声|冷声|笑着|看向)/u;
const SENTENCE_PUNCT = /[。！？!?,，、；;：:\s]/u;

export function makeEntryKey(kind: string, title: string): string {
  const normalized = title.trim().replace(/\s+/gu, "").toLowerCase();
  return `${kind}:${normalized.slice(0, 48) || "untitled"}`;
}

export function isInvalidEntityTitle(title: string, kind: DissectionStagingKind): string | undefined {
  const trimmed = title.trim();
  if (!trimmed) return "empty-title";
  if (trimmed.length < 2) return "too-short";
  if (PRONOUNS.has(trimmed)) return "pronoun";
  if (SENTENCE_PUNCT.test(trimmed) || trimmed.length > 16) return "sentence-fragment";
  if ((kind === "characters" || kind === "locations" || kind === "factions")
    && (ACTION_FRAGMENT.test(trimmed) || PRONOUN_PREFIXED_ACTION.test(trimmed))) {
    return "verb-phrase";
  }
  if ((kind === "characters" || kind === "locations" || kind === "factions")
    && trimmed.length > 4
    && /(站在|走进|走来|来到|回到|离开|看着|望着|抬头|低头|说道|冷声|淡淡)/u.test(trimmed)) {
    return "sentence-fragment";
  }
  return undefined;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function ensureDissectionStagingSchema(storage: StorageDatabase): void {
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS dissection_staging (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      category TEXT NOT NULL,
      proposed_title TEXT NOT NULL,
      entry_key TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      evidence_ranges_json TEXT NOT NULL DEFAULT '[]',
      classification_reason TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0,
      duplicate_candidates_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'needs-review',
      participates_in_ai INTEGER NOT NULL DEFAULT 0,
      content_md TEXT NOT NULL DEFAULT '',
      fields_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dissection_staging_book_status
      ON dissection_staging(book_id, status);
    CREATE INDEX IF NOT EXISTS idx_dissection_staging_book_key
      ON dissection_staging(book_id, entry_key);
  `);
}

function rowToRecord(row: Record<string, unknown>): DissectionStagingRecord {
  return {
    id: String(row.id),
    bookId: String(row.book_id),
    kind: row.kind as DissectionStagingKind,
    category: String(row.category),
    proposedTitle: String(row.proposed_title),
    entryKey: String(row.entry_key),
    aliases: parseJson<string[]>(String(row.aliases_json ?? "[]"), []),
    sourceRefs: parseJson<DissectionSourceRef[]>(String(row.source_refs_json ?? "[]"), []),
    evidenceRanges: parseJson<DissectionSourceRef[]>(String(row.evidence_ranges_json ?? "[]"), []),
    classificationReason: String(row.classification_reason ?? ""),
    confidence: Number(row.confidence ?? 0),
    duplicateCandidates: parseJson<DissectionDuplicateCandidate[]>(String(row.duplicate_candidates_json ?? "[]"), []),
    status: (row.status as DissectionStagingStatus) ?? "needs-review",
    participatesInAi: false,
    contentMd: String(row.content_md ?? ""),
    fields: parseJson<Record<string, unknown>>(String(row.fields_json ?? "{}"), {}),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export function findDuplicateJingweiEntries(
  existing: readonly JingweiDuplicateLookup[],
  input: { readonly title: string; readonly aliases?: readonly string[]; readonly entryKey?: string; readonly category?: string },
): DissectionDuplicateCandidate[] {
  const title = input.title.trim();
  const aliases = new Set((input.aliases ?? []).map((item) => item.trim()).filter(Boolean));
  const out: DissectionDuplicateCandidate[] = [];
  for (const entry of existing) {
    if (input.category && entry.category !== input.category) continue;
    if (entry.title === title) {
      out.push({ entryId: entry.id, title: entry.title, reason: "title" });
      continue;
    }
    if (input.category && makeEntryKey(input.category, entry.title) === (input.entryKey?.trim() || makeEntryKey(input.category, title))) {
      out.push({ entryId: entry.id, title: entry.title, reason: "entry-key" });
      continue;
    }
    if (entry.aliases.some((alias) => alias === title || aliases.has(alias) || aliases.has(entry.title))) {
      out.push({ entryId: entry.id, title: entry.title, reason: "alias" });
    }
  }
  return out;
}

export function insertDissectionStaging(
  storage: StorageDatabase,
  input: DissectionStagingWriteInput,
): DissectionStagingRecord {
  ensureDissectionStagingSchema(storage);
  const invalid = isInvalidEntityTitle(input.proposedTitle, input.kind);
  if (invalid) throw new Error(`invalid-entity:${invalid}`);
  if (!input.sourceRefs.some((ref) => ref.chapterNumber > 0 && ref.excerpt.trim().length > 0)) {
    throw new Error("missing-evidence");
  }
  const entryKey = input.entryKey ?? makeEntryKey(input.kind, input.proposedTitle);
  const existingPending = storage.sqlite.prepare(`
    SELECT * FROM dissection_staging
    WHERE book_id = ? AND entry_key = ? AND status = 'needs-review'
    ORDER BY created_at ASC
    LIMIT 1
  `).get(input.bookId, entryKey) as Record<string, unknown> | undefined;
  if (existingPending) return rowToRecord(existingPending);

  const now = (input.now?.() ?? new Date()).getTime();
  const record: DissectionStagingRecord = {
    id: crypto.randomUUID(),
    bookId: input.bookId,
    kind: input.kind,
    category: input.category,
    proposedTitle: input.proposedTitle.trim(),
    entryKey,
    aliases: [...(input.aliases ?? [])],
    sourceRefs: [...input.sourceRefs],
    evidenceRanges: [...(input.evidenceRanges ?? input.sourceRefs)],
    classificationReason: input.classificationReason,
    confidence: input.confidence ?? 0,
    duplicateCandidates: [...(input.duplicateCandidates ?? [])],
    status: "needs-review",
    participatesInAi: false,
    contentMd: input.contentMd,
    fields: input.fields ?? {},
    createdAt: now,
    updatedAt: now,
  };
  storage.sqlite.prepare(`
    INSERT INTO dissection_staging (
      id, book_id, kind, category, proposed_title, entry_key, aliases_json, source_refs_json,
      evidence_ranges_json, classification_reason, confidence, duplicate_candidates_json,
      status, participates_in_ai, content_md, fields_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'needs-review', 0, ?, ?, ?, ?)
  `).run(
    record.id,
    record.bookId,
    record.kind,
    record.category,
    record.proposedTitle,
    record.entryKey,
    JSON.stringify(record.aliases),
    JSON.stringify(record.sourceRefs),
    JSON.stringify(record.evidenceRanges),
    record.classificationReason,
    record.confidence,
    JSON.stringify(record.duplicateCandidates),
    record.contentMd,
    JSON.stringify(record.fields),
    record.createdAt,
    record.updatedAt,
  );
  return record;
}

export function listDissectionStaging(
  storage: StorageDatabase,
  bookId: string,
  status: DissectionStagingStatus = "needs-review",
): DissectionStagingRecord[] {
  ensureDissectionStagingSchema(storage);
  const rows = storage.sqlite.prepare(`
    SELECT * FROM dissection_staging WHERE book_id = ? AND status = ? ORDER BY created_at ASC
  `).all(bookId, status) as Array<Record<string, unknown>>;
  return rows.map(rowToRecord);
}

export function getDissectionStaging(
  storage: StorageDatabase,
  bookId: string,
  id: string,
): DissectionStagingRecord | null {
  ensureDissectionStagingSchema(storage);
  const row = storage.sqlite.prepare(`
    SELECT * FROM dissection_staging WHERE book_id = ? AND id = ?
  `).get(bookId, id) as Record<string, unknown> | undefined;
  return row ? rowToRecord(row) : null;
}

export function updateDissectionStagingStatus(
  storage: StorageDatabase,
  bookId: string,
  id: string,
  status: Exclude<DissectionStagingStatus, "needs-review">,
  now = Date.now(),
): DissectionStagingRecord | null {
  ensureDissectionStagingSchema(storage);
  const result = storage.sqlite.prepare(`
    UPDATE dissection_staging SET status = ?, participates_in_ai = 0, updated_at = ?
    WHERE book_id = ? AND id = ? AND status = 'needs-review'
  `).run(status, now, bookId, id);
  if (result.changes === 0) return null;
  return getDissectionStaging(storage, bookId, id);
}

/**
 * 在同一个 SQLite 短事务中执行 staging 决策与正式写入。
 * 回调抛错时，正式条目和 staging 状态一并回滚；状态条件同时提供幂等抢占门禁。
 */
export function withPendingDissectionStaging<T>(
  storage: StorageDatabase,
  bookId: string,
  id: string,
  decision: Exclude<DissectionStagingStatus, "needs-review">,
  action: (staging: DissectionStagingRecord) => T,
  now = Date.now(),
): T {
  ensureDissectionStagingSchema(storage);
  const run = storage.sqlite.transaction(() => {
    const row = storage.sqlite.prepare(`
      SELECT * FROM dissection_staging
      WHERE book_id = ? AND id = ? AND status = 'needs-review'
    `).get(bookId, id) as Record<string, unknown> | undefined;
    if (!row) throw new Error("staging-not-pending");
    const claimed = storage.sqlite.prepare(`
      UPDATE dissection_staging SET status = ?, participates_in_ai = 0, updated_at = ?
      WHERE book_id = ? AND id = ? AND status = 'needs-review'
    `).run(decision, now, bookId, id);
    if (claimed.changes !== 1) throw new Error("staging-not-pending");
    return action(rowToRecord(row));
  });
  return run();
}
