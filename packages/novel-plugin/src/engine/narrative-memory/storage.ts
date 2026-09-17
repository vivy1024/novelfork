import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { z } from "zod";

import {
  NarrativeEventSchema,
  NarrativeEventStatusSchema,
  NarrativeContextVectorSchema,
  NarrativeFactSchema,
  NarrativeRetrievalDiagnosticsSchema,
  NarrativeRetrievalPurposeSchema,
  CharacterKernelSchema,
  type CharacterKernel,
  type NarrativeContextVector,
  type NarrativeEvent,
  type NarrativeEventStatus,
  type NarrativeFact,
  type NarrativeRetrievalDiagnostics,
  type NarrativeRetrievalPurpose,
} from "./types.js";
import type { ChapterMention } from "./chapter-mention.js";
import { parseCausedBy } from "./causal-resolve.js";

interface NarrativeFactRow {
  id: string;
  bookId: string;
  subject: string;
  predicate: string;
  object: string;
  category: string;
  layer: NarrativeFact["layer"];
  confidence: number;
  sourceType: NarrativeFact["sourceType"];
  sourceId: string | null;
  sourceChapter: number | null;
  evidenceText: string | null;
  validFromChapter: number | null;
  validUntilChapter: number | null;
  subjectEntryId: string | null;
  objectEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface NarrativeEventRow {
  id: string;
  bookId: string;
  chapterNumber: number;
  eventType: NarrativeEvent["eventType"];
  subject: string;
  predicate: string;
  object: string;
  evidenceText: string;
  confidence: number;
  source: NarrativeEvent["source"];
  status: NarrativeEventStatus;
  riskLevel: NarrativeEvent["riskLevel"];
  subjectEntryId: string | null;
  objectEntryId: string | null;
  causedByJson: string | null;
  createdAt: string;
  appliedAt: string | null;
}

const nonEmptyString = z.string().trim().min(1);
const positiveInteger = z.number().int().min(1);
const nonNegativeInteger = z.number().int().min(0);

export const QueryNarrativeFactsInputSchema = z.object({
  bookId: nonEmptyString,
  entities: z.array(z.string()).optional(),
  /** 经纬条目 id：匹配 subject_entry_id / object_entry_id，不走名字或别名。 */
  entryIds: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  predicates: z.array(z.string()).optional(),
  layer: NarrativeFactSchema.shape.layer.optional(),
  currentChapter: positiveInteger.optional(),
  // limit=0 is an internal full-scan mode used by ledger reconciliation.
  limit: z.number().int().min(0).max(500).optional(),
});
export type QueryNarrativeFactsInput = Readonly<{
  bookId: string;
  entities?: readonly string[];
  entryIds?: readonly string[];
  categories?: readonly string[];
  predicates?: readonly string[];
  layer?: NarrativeFact["layer"];
  currentChapter?: number;
  limit?: number;
}>;

export const UpdateNarrativeEventStatusInputSchema = z.object({
  id: nonEmptyString,
  status: NarrativeEventStatusSchema,
  appliedAt: z.string().optional(),
});
export type UpdateNarrativeEventStatusInput = Readonly<{
  id: string;
  status: NarrativeEventStatus;
  appliedAt?: string;
}>;

export const InsertRetrievalLogInputSchema = z.object({
  id: nonEmptyString,
  bookId: nonEmptyString,
  chapterNumber: positiveInteger.optional(),
  purpose: NarrativeRetrievalPurposeSchema,
  totalTokens: nonNegativeInteger,
  diagnostics: NarrativeRetrievalDiagnosticsSchema,
  createdAt: z.string().optional(),
});
export type InsertRetrievalLogInput = Readonly<{
  id: string;
  bookId: string;
  chapterNumber?: number;
  purpose: NarrativeRetrievalPurpose;
  totalTokens: number;
  diagnostics: NarrativeRetrievalDiagnostics;
  createdAt?: string;
}>;

export interface NarrativeRetrievalLogRecord {
  readonly id: string;
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly purpose: NarrativeRetrievalPurpose;
  readonly totalTokens: number;
  readonly diagnostics: NarrativeRetrievalDiagnostics;
  readonly createdAt: string;
}

interface NarrativeRetrievalLogRow {
  id: string;
  bookId: string;
  chapterNumber: number | null;
  purpose: NarrativeRetrievalPurpose;
  totalTokens: number;
  diagnosticsJson: string;
  createdAt: string;
}

interface NarrativeContextVectorRow {
  cardId: string;
  bookId: string;
  embeddingModelId: string;
  embeddingDim: number;
  vectorJson: string;
  vectorUpdatedAt: string;
  sourceCardJson: string;
}

export const QueryNarrativeContextVectorsInputSchema = z.object({
  bookId: nonEmptyString,
  embeddingModelId: nonEmptyString,
  embeddingDim: positiveInteger,
  currentChapter: positiveInteger.optional(),
  entities: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  // limit=0 is an internal full-scan mode used by entity embedding backfill.
  limit: z.number().int().min(0).max(5000).optional(),
});
export type QueryNarrativeContextVectorsInput = Readonly<{
  bookId: string;
  embeddingModelId: string;
  embeddingDim: number;
  currentChapter?: number;
  entities?: readonly string[];
  categories?: readonly string[];
  limit?: number;
}>;

export type QueryNarrativeContextVectorsResult = Readonly<{
  vectors: readonly NarrativeContextVector[];
  dimensionMismatchCardIds: readonly string[];
}>;

export const ListPendingNarrativeEventsInputSchema = z.object({
  bookId: nonEmptyString,
  limit: positiveInteger.max(200).optional(),
});
export type ListPendingNarrativeEventsInput = Readonly<{ bookId: string; limit?: number }>;

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function factRowToRecord(row: NarrativeFactRow): NarrativeFact {
  return NarrativeFactSchema.parse({
    id: row.id,
    bookId: row.bookId,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    category: row.category,
    layer: row.layer,
    confidence: row.confidence,
    sourceType: row.sourceType,
    sourceId: row.sourceId ?? undefined,
    sourceChapter: row.sourceChapter ?? undefined,
    evidenceText: row.evidenceText ?? undefined,
    validFromChapter: row.validFromChapter ?? undefined,
    validUntilChapter: row.validUntilChapter ?? undefined,
    subjectEntryId: row.subjectEntryId ?? undefined,
    objectEntryId: row.objectEntryId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function eventRowToRecord(row: NarrativeEventRow): NarrativeEvent {
  const causedBy = parseCausedBy(row.causedByJson);
  return NarrativeEventSchema.parse({
    id: row.id,
    bookId: row.bookId,
    chapterNumber: row.chapterNumber,
    eventType: row.eventType,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    evidenceText: row.evidenceText,
    confidence: row.confidence,
    source: row.source,
    status: row.status,
    riskLevel: row.riskLevel,
    subjectEntryId: row.subjectEntryId ?? undefined,
    objectEntryId: row.objectEntryId ?? undefined,
    ...(causedBy.length > 0 ? { causedBy } : {}),
    createdAt: row.createdAt,
    appliedAt: row.appliedAt ?? undefined,
  });
}

function retrievalLogRowToRecord(row: NarrativeRetrievalLogRow): NarrativeRetrievalLogRecord {
  return {
    id: row.id,
    bookId: row.bookId,
    chapterNumber: row.chapterNumber ?? undefined,
    purpose: NarrativeRetrievalPurposeSchema.parse(row.purpose),
    totalTokens: row.totalTokens,
    diagnostics: NarrativeRetrievalDiagnosticsSchema.parse(JSON.parse(row.diagnosticsJson)),
    createdAt: row.createdAt,
  };
}

function vectorRowToRecord(row: NarrativeContextVectorRow): NarrativeContextVector {
  return NarrativeContextVectorSchema.parse({
    cardId: row.cardId,
    bookId: row.bookId,
    embeddingModelId: row.embeddingModelId,
    embeddingDim: row.embeddingDim,
    vector: JSON.parse(row.vectorJson),
    vectorUpdatedAt: row.vectorUpdatedAt,
    sourceCard: JSON.parse(row.sourceCardJson),
  });
}

const FACT_SELECT = `
  SELECT
    id,
    book_id AS bookId,
    subject,
    predicate,
    object,
    category,
    layer,
    confidence,
    source_type AS sourceType,
    source_id AS sourceId,
    source_chapter AS sourceChapter,
    evidence_text AS evidenceText,
    valid_from_chapter AS validFromChapter,
    valid_until_chapter AS validUntilChapter,
    subject_entry_id AS subjectEntryId,
    object_entry_id AS objectEntryId,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM narrative_fact
`;

const EVENT_SELECT = `
  SELECT
    id,
    book_id AS bookId,
    chapter_number AS chapterNumber,
    event_type AS eventType,
    subject,
    predicate,
    object,
    evidence_text AS evidenceText,
    confidence,
    source,
    status,
    risk_level AS riskLevel,
    subject_entry_id AS subjectEntryId,
    object_entry_id AS objectEntryId,
    caused_by_json AS causedByJson,
    created_at AS createdAt,
    applied_at AS appliedAt
  FROM narrative_event
`;

export function ensureNarrativeMemorySchema(storage: StorageDatabase): void {
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS narrative_fact (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      category TEXT NOT NULL,
      layer TEXT NOT NULL,
      confidence REAL NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT,
      source_chapter INTEGER,
      evidence_text TEXT,
      valid_from_chapter INTEGER,
      valid_until_chapter INTEGER,
      subject_entry_id TEXT,
      object_entry_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_narrative_fact_book_subject ON narrative_fact(book_id, subject);
    CREATE INDEX IF NOT EXISTS idx_narrative_fact_book_object ON narrative_fact(book_id, object);
    CREATE INDEX IF NOT EXISTS idx_narrative_fact_book_category ON narrative_fact(book_id, category);
    CREATE INDEX IF NOT EXISTS idx_narrative_fact_book_predicate ON narrative_fact(book_id, predicate);
    CREATE INDEX IF NOT EXISTS idx_narrative_fact_book_layer ON narrative_fact(book_id, layer);
    CREATE INDEX IF NOT EXISTS idx_narrative_fact_book_source_chapter ON narrative_fact(book_id, source_chapter);
    CREATE INDEX IF NOT EXISTS idx_narrative_fact_book_validity ON narrative_fact(book_id, valid_from_chapter, valid_until_chapter);

    CREATE TABLE IF NOT EXISTS narrative_event (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      evidence_text TEXT NOT NULL,
      confidence REAL NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      subject_entry_id TEXT,
      object_entry_id TEXT,
      caused_by_json TEXT,
      created_at TEXT NOT NULL,
      applied_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_narrative_event_book_chapter ON narrative_event(book_id, chapter_number);
    CREATE INDEX IF NOT EXISTS idx_narrative_event_book_status ON narrative_event(book_id, status);

    -- T4 证据链：每次结算把「原始草案 + 逐条决策」序列化落盘，
    -- 回答作者「为什么抽出这些事件」。同一指纹重写即覆盖（幂等）。
    CREATE TABLE IF NOT EXISTS narrative_settlement_artifact (
      book_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      content_fingerprint TEXT NOT NULL,
      artifact_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (book_id, chapter_number, content_fingerprint)
    );

    CREATE INDEX IF NOT EXISTS idx_narrative_settlement_artifact_chapter
      ON narrative_settlement_artifact(book_id, chapter_number, created_at DESC);

    CREATE TABLE IF NOT EXISTS narrative_retrieval_log (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      chapter_number INTEGER,
      purpose TEXT NOT NULL,
      total_tokens INTEGER NOT NULL,
      diagnostics_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_narrative_retrieval_log_book_chapter ON narrative_retrieval_log(book_id, chapter_number, created_at);

    CREATE TABLE IF NOT EXISTS narrative_context_vector (
      card_id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      embedding_model_id TEXT NOT NULL,
      embedding_dim INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      vector_updated_at TEXT NOT NULL,
      source_card_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_narrative_context_vector_book_model ON narrative_context_vector(book_id, embedding_model_id);
    CREATE INDEX IF NOT EXISTS idx_narrative_context_vector_book_dim ON narrative_context_vector(book_id, embedding_dim);

    CREATE TABLE IF NOT EXISTS narrative_tag (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS narrative_card_tag (
      book_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (book_id, card_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS narrative_tag_edge (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      source_tag_id TEXT NOT NULL,
      target_tag_id TEXT NOT NULL,
      weight REAL NOT NULL,
      ordinal_potential REAL NOT NULL,
      chapter_proximity REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_narrative_tag_book_type ON narrative_tag(book_id, type);
    CREATE INDEX IF NOT EXISTS idx_narrative_card_tag_book_card ON narrative_card_tag(book_id, card_id);
    CREATE INDEX IF NOT EXISTS idx_narrative_tag_edge_book_source ON narrative_tag_edge(book_id, source_tag_id);

    CREATE TABLE IF NOT EXISTS character_kernel (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      entry_status TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      updated_chapter INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      origin TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_character_kernel_unique ON character_kernel(book_id, character_id);

    CREATE TABLE IF NOT EXISTS narrative_chapter_mention (
      book_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      position INTEGER NOT NULL,
      entity_name TEXT NOT NULL,
      entry_id TEXT,
      source TEXT NOT NULL DEFAULT 'dictionary',
      PRIMARY KEY (book_id, chapter_number, entity_name)
    );
    CREATE INDEX IF NOT EXISTS idx_chapter_mention_book_chapter
      ON narrative_chapter_mention(book_id, chapter_number, position);
    CREATE INDEX IF NOT EXISTS idx_chapter_mention_entry
      ON narrative_chapter_mention(book_id, entry_id);
  `);

  // 实体身份链：旧库的 narrative_event / narrative_fact 缺 subject_entry_id / object_entry_id 列，逐表逐列补齐。
  // CREATE TABLE IF NOT EXISTS 不会给已存在的表加列，因此这里显式 ALTER。
  // 注意：必须先补列，再创建依赖这些列的索引；否则旧库会在索引语句处提前失败。
  const existingColumns = (table: string): Set<string> =>
    new Set(
      storage.sqlite
        .prepare<{ name: string }>(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => row.name),
    );
  for (const table of ["narrative_event", "narrative_fact"]) {
    const columns = existingColumns(table);
    for (const column of ["subject_entry_id", "object_entry_id"]) {
      if (!columns.has(column)) {
        storage.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
      }
    }
  }
  const eventColumns = existingColumns("narrative_event");
  if (!eventColumns.has("caused_by_json")) {
    storage.sqlite.exec(`ALTER TABLE narrative_event ADD COLUMN caused_by_json TEXT`);
  }

  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS narrative_foreshadow (
      id TEXT PRIMARY KEY NOT NULL,
      book_id TEXT NOT NULL,
      label TEXT NOT NULL,
      entry_id TEXT,
      setup_chapter INTEGER,
      setup_event_id TEXT,
      trigger_chapter INTEGER,
      trigger_condition TEXT,
      payoff_chapter INTEGER,
      payoff_event_id TEXT,
      status TEXT NOT NULL DEFAULT 'planted',
      deadline_chapter INTEGER,
      importance INTEGER NOT NULL DEFAULT 50,
      evidence_text TEXT,
      recorded_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (status IN ('planted','reinforced','triggered','paying_off','paid_off','abandoned','contradicted'))
    );
    CREATE INDEX IF NOT EXISTS idx_narrative_foreshadow_status
      ON narrative_foreshadow(book_id, status, setup_chapter);
  `);

  // 场景与剧情线（同步自迁移 0035）。场景是两棵叙事树共用的叶子：
  // 承载树 卷 → 章 → 场景（在哪讲），因果树 剧情线 → 场景（为什么发生）。
  // 卷不在此列——它的权威源是经纬 outline 条目，章节归属由 chapterRange 推导。
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS narrative_storyline (
      id TEXT PRIMARY KEY NOT NULL,
      book_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'other',
      lifecycle TEXT NOT NULL DEFAULT 'active',
      goal TEXT NOT NULL DEFAULT '',
      entry_id TEXT,
      layer TEXT NOT NULL DEFAULT 'dynamic',
      status TEXT NOT NULL DEFAULT 'needs-review',
      source TEXT NOT NULL DEFAULT 'inferred',
      confidence REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_narrative_storyline_book
      ON narrative_storyline(book_id, lifecycle);

    CREATE TABLE IF NOT EXISTS narrative_scene (
      id TEXT PRIMARY KEY NOT NULL,
      book_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      function TEXT NOT NULL DEFAULT 'advance',
      pov_entity_id TEXT,
      location_entity_id TEXT,
      word_count INTEGER NOT NULL DEFAULT 0,
      layer TEXT NOT NULL DEFAULT 'dynamic',
      status TEXT NOT NULL DEFAULT 'needs-review',
      source TEXT NOT NULL DEFAULT 'inferred',
      confidence REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_narrative_scene_chapter
      ON narrative_scene(book_id, chapter_number, ordinal);
    CREATE INDEX IF NOT EXISTS idx_narrative_scene_pov
      ON narrative_scene(pov_entity_id);

    CREATE TABLE IF NOT EXISTS narrative_scene_storyline (
      scene_id TEXT NOT NULL,
      storyline_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'primary',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (scene_id, storyline_id)
    );
    CREATE INDEX IF NOT EXISTS idx_narrative_scene_storyline_line
      ON narrative_scene_storyline(storyline_id, role);
  `);

  storage.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_narrative_event_subject_entry ON narrative_event(book_id, subject_entry_id);
    CREATE INDEX IF NOT EXISTS idx_narrative_event_object_entry ON narrative_event(book_id, object_entry_id);
    CREATE INDEX IF NOT EXISTS idx_narrative_fact_book_subject_entry ON narrative_fact(book_id, subject_entry_id);
    CREATE INDEX IF NOT EXISTS idx_narrative_fact_book_object_entry ON narrative_fact(book_id, object_entry_id);
  `);

  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS narrative_structure_score (
      id TEXT PRIMARY KEY NOT NULL,
      book_id TEXT NOT NULL,
      chapter_number INTEGER,
      feature_id TEXT NOT NULL,
      dimension TEXT NOT NULL,
      value TEXT NOT NULL,
      numeric_value REAL,
      deviation REAL,
      model TEXT,
      recorded_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_structure_score_unique
      ON narrative_structure_score(book_id, chapter_number, feature_id);
    CREATE INDEX IF NOT EXISTS idx_structure_score_dimension
      ON narrative_structure_score(book_id, dimension);
  `);
}

/** T4 证据链读取：某章最新一次结算的证据 artifact（按 created_at 取最新）。 */
export function readLatestSettlementArtifact(
  storage: StorageDatabase,
  bookId: string,
  chapterNumber: number,
): { fingerprint: string; artifact: Record<string, unknown>; createdAt: string } | null {
  ensureNarrativeMemorySchema(storage);
  const row = storage.sqlite.prepare<{
    content_fingerprint: string;
    artifact_json: string;
    created_at: string;
  }>(`
    SELECT content_fingerprint, artifact_json, created_at
    FROM narrative_settlement_artifact
    WHERE book_id = ? AND chapter_number = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(bookId, chapterNumber);
  if (!row) return null;
  try {
    return {
      fingerprint: row.content_fingerprint,
      artifact: JSON.parse(row.artifact_json) as Record<string, unknown>,
      createdAt: row.created_at,
    };
  } catch {
    return null;
  }
}

export function insertNarrativeFact(storage: StorageDatabase, fact: NarrativeFact): NarrativeFact {
  ensureNarrativeMemorySchema(storage);
  const parsed = NarrativeFactSchema.parse(fact);
  storage.sqlite.prepare(`
    INSERT INTO narrative_fact (
      id,
      book_id,
      subject,
      predicate,
      object,
      category,
      layer,
      confidence,
      source_type,
      source_id,
      source_chapter,
      evidence_text,
      valid_from_chapter,
      valid_until_chapter,
      subject_entry_id,
      object_entry_id,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    parsed.id,
    parsed.bookId,
    parsed.subject,
    parsed.predicate,
    parsed.object,
    parsed.category,
    parsed.layer,
    parsed.confidence,
    parsed.sourceType,
    parsed.sourceId ?? null,
    parsed.sourceChapter ?? null,
    parsed.evidenceText ?? null,
    parsed.validFromChapter ?? null,
    parsed.validUntilChapter ?? null,
    parsed.subjectEntryId ?? null,
    parsed.objectEntryId ?? null,
    parsed.createdAt,
    parsed.updatedAt,
  );
  return parsed;
}

export function getNarrativeFactById(storage: StorageDatabase, bookId: string, factId: string): NarrativeFact | undefined {
  ensureNarrativeMemorySchema(storage);
  const row = storage.sqlite.prepare<NarrativeFactRow>(`${FACT_SELECT} WHERE id = ? AND book_id = ?`).get(factId, bookId);
  return row ? factRowToRecord(row) : undefined;
}

export function queryNarrativeFacts(storage: StorageDatabase, input: QueryNarrativeFactsInput): NarrativeFact[] {
  ensureNarrativeMemorySchema(storage);
  const parsed = QueryNarrativeFactsInputSchema.parse(input);
  const clauses = [`book_id = ?`];
  const params: unknown[] = [parsed.bookId];

  if (parsed.entities && parsed.entities.length > 0) {
    clauses.push(`(subject IN (${placeholders(parsed.entities.length)}) OR object IN (${placeholders(parsed.entities.length)}))`);
    params.push(...parsed.entities, ...parsed.entities);
  }

  if (parsed.entryIds && parsed.entryIds.length > 0) {
    clauses.push(`(subject_entry_id IN (${placeholders(parsed.entryIds.length)}) OR object_entry_id IN (${placeholders(parsed.entryIds.length)}))`);
    params.push(...parsed.entryIds, ...parsed.entryIds);
  }

  if (parsed.categories && parsed.categories.length > 0) {
    clauses.push(`category IN (${placeholders(parsed.categories.length)})`);
    params.push(...parsed.categories);
  }

  if (parsed.predicates && parsed.predicates.length > 0) {
    clauses.push(`predicate IN (${placeholders(parsed.predicates.length)})`);
    params.push(...parsed.predicates);
  }

  if (parsed.layer) {
    clauses.push(`layer = ?`);
    params.push(parsed.layer);
  }

  if (parsed.currentChapter !== undefined) {
    const visibleChapter = Math.max(0, parsed.currentChapter - 1);
    clauses.push(`(source_chapter IS NULL OR source_chapter <= ?)`);
    clauses.push(`(valid_from_chapter IS NULL OR valid_from_chapter <= ?)`);
    clauses.push(`(valid_until_chapter IS NULL OR valid_until_chapter >= ?)`);
    params.push(visibleChapter, visibleChapter, visibleChapter);
  }

  const limit = parsed.limit === 0 ? undefined : Math.max(1, Math.min(parsed.limit ?? 100, 500));
  const rows = storage.sqlite.prepare<NarrativeFactRow>(`
    ${FACT_SELECT}
    WHERE ${clauses.join(" AND ")}
    ORDER BY confidence DESC, updated_at DESC, id ASC
    ${limit === undefined ? "" : "LIMIT ?"}
  `).all(...params, ...(limit === undefined ? [] : [limit]));
  return rows.map(factRowToRecord);
}

export function insertNarrativeEvent(storage: StorageDatabase, event: NarrativeEvent): NarrativeEvent {
  ensureNarrativeMemorySchema(storage);
  const parsed = NarrativeEventSchema.parse(event);
  storage.sqlite.prepare(`
    INSERT INTO narrative_event (
      id,
      book_id,
      chapter_number,
      event_type,
      subject,
      predicate,
      object,
      evidence_text,
      confidence,
      source,
      status,
      risk_level,
      subject_entry_id,
      object_entry_id,
      caused_by_json,
      created_at,
      applied_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    parsed.id,
    parsed.bookId,
    parsed.chapterNumber,
    parsed.eventType,
    parsed.subject,
    parsed.predicate,
    parsed.object,
    parsed.evidenceText,
    parsed.confidence,
    parsed.source,
    parsed.status,
    parsed.riskLevel,
    parsed.subjectEntryId ?? null,
    parsed.objectEntryId ?? null,
    parsed.causedBy && parsed.causedBy.length > 0 ? JSON.stringify(parsed.causedBy) : null,
    parsed.createdAt,
    parsed.appliedAt ?? null,
  );
  return parsed;
}

export function updateNarrativeEventStatus(storage: StorageDatabase, input: UpdateNarrativeEventStatusInput): NarrativeEvent | undefined {
  ensureNarrativeMemorySchema(storage);
  const parsed = UpdateNarrativeEventStatusInputSchema.parse(input);
  const appliedAt = parsed.status === "applied" ? (parsed.appliedAt ?? new Date().toISOString()) : parsed.appliedAt;
  const result = storage.sqlite.prepare(`
    UPDATE narrative_event
    SET status = ?, applied_at = ?
    WHERE id = ?
  `).run(parsed.status, appliedAt ?? null, parsed.id);
  if (result.changes === 0) return undefined;
  const row = storage.sqlite.prepare<NarrativeEventRow>(`${EVENT_SELECT} WHERE id = ?`).get(parsed.id);
  return row ? eventRowToRecord(row) : undefined;
}

export function getNarrativeEventById(storage: StorageDatabase, bookId: string, eventId: string): NarrativeEvent | undefined {
  ensureNarrativeMemorySchema(storage);
  const row = storage.sqlite.prepare<NarrativeEventRow>(`${EVENT_SELECT} WHERE book_id = ? AND id = ?`).get(bookId, eventId);
  return row ? eventRowToRecord(row) : undefined;
}

/**
 * Update the editable fields of an event as one schema-validated row write.
 * This is used by edit-approve so the persisted event stays identical to the
 * event that is reduced into Narrative Memory facts.
 */
export function updateNarrativeEvent(storage: StorageDatabase, event: NarrativeEvent): NarrativeEvent | undefined {
  ensureNarrativeMemorySchema(storage);
  const parsed = NarrativeEventSchema.parse(event);
  const result = storage.sqlite.prepare(`
    UPDATE narrative_event
    SET chapter_number = ?,
        event_type = ?,
        subject = ?,
        predicate = ?,
        object = ?,
        evidence_text = ?,
        confidence = ?,
        source = ?,
        status = ?,
        risk_level = ?,
        subject_entry_id = ?,
        object_entry_id = ?,
        caused_by_json = ?,
        applied_at = ?
    WHERE book_id = ? AND id = ?
  `).run(
    parsed.chapterNumber,
    parsed.eventType,
    parsed.subject,
    parsed.predicate,
    parsed.object,
    parsed.evidenceText,
    parsed.confidence,
    parsed.source,
    parsed.status,
    parsed.riskLevel,
    parsed.subjectEntryId ?? null,
    parsed.objectEntryId ?? null,
    parsed.causedBy && parsed.causedBy.length > 0 ? JSON.stringify(parsed.causedBy) : null,
    parsed.appliedAt ?? null,
    parsed.bookId,
    parsed.id,
  );
  if (result.changes === 0) return undefined;
  const row = storage.sqlite.prepare<NarrativeEventRow>(`${EVENT_SELECT} WHERE book_id = ? AND id = ?`).get(parsed.bookId, parsed.id);
  return row ? eventRowToRecord(row) : undefined;
}

export function insertRetrievalLog(storage: StorageDatabase, input: InsertRetrievalLogInput): NarrativeRetrievalLogRecord {
  ensureNarrativeMemorySchema(storage);
  const parsed = InsertRetrievalLogInputSchema.parse(input);
  const createdAt = parsed.createdAt ?? new Date().toISOString();
  storage.sqlite.prepare(`
    INSERT INTO narrative_retrieval_log (
      id,
      book_id,
      chapter_number,
      purpose,
      total_tokens,
      diagnostics_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    parsed.id,
    parsed.bookId,
    parsed.chapterNumber ?? null,
    parsed.purpose,
    parsed.totalTokens,
    JSON.stringify(parsed.diagnostics),
    createdAt,
  );

  const row = storage.sqlite.prepare<NarrativeRetrievalLogRow>(`
    SELECT
      id,
      book_id AS bookId,
      chapter_number AS chapterNumber,
      purpose,
      total_tokens AS totalTokens,
      diagnostics_json AS diagnosticsJson,
      created_at AS createdAt
    FROM narrative_retrieval_log
    WHERE id = ?
  `).get(parsed.id);

  if (!row) {
    throw new Error(`Failed to read narrative retrieval log after insert: ${parsed.id}`);
  }
  return retrievalLogRowToRecord(row);
}

export function upsertNarrativeContextVector(storage: StorageDatabase, vector: NarrativeContextVector): NarrativeContextVector {
  ensureNarrativeMemorySchema(storage);
  const parsed = NarrativeContextVectorSchema.parse(vector);
  if (parsed.embeddingDim !== parsed.vector.length) {
    throw new Error(`Vector dimension mismatch for ${parsed.cardId}: metadata=${parsed.embeddingDim}, vector=${parsed.vector.length}`);
  }
  storage.sqlite.prepare(`
    INSERT INTO narrative_context_vector (
      card_id,
      book_id,
      embedding_model_id,
      embedding_dim,
      vector_json,
      vector_updated_at,
      source_card_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(card_id) DO UPDATE SET
      book_id = excluded.book_id,
      embedding_model_id = excluded.embedding_model_id,
      embedding_dim = excluded.embedding_dim,
      vector_json = excluded.vector_json,
      vector_updated_at = excluded.vector_updated_at,
      source_card_json = excluded.source_card_json
  `).run(
    parsed.cardId,
    parsed.bookId,
    parsed.embeddingModelId,
    parsed.embeddingDim,
    JSON.stringify(parsed.vector),
    parsed.vectorUpdatedAt,
    JSON.stringify(parsed.sourceCard),
  );
  return parsed;
}

export function getLatestNarrativeRetrievalLog(storage: StorageDatabase, bookId: string): NarrativeRetrievalLogRecord | undefined {
  ensureNarrativeMemorySchema(storage);
  const row = storage.sqlite.prepare<NarrativeRetrievalLogRow>(`
    SELECT
      id,
      book_id AS bookId,
      chapter_number AS chapterNumber,
      purpose,
      total_tokens AS totalTokens,
      diagnostics_json AS diagnosticsJson,
      created_at AS createdAt
    FROM narrative_retrieval_log
    WHERE book_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(bookId);
  return row ? retrievalLogRowToRecord(row) : undefined;
}

export function listPendingNarrativeEvents(storage: StorageDatabase, input: ListPendingNarrativeEventsInput): NarrativeEvent[] {
  ensureNarrativeMemorySchema(storage);
  const parsed = ListPendingNarrativeEventsInputSchema.parse(input);
  const rows = storage.sqlite.prepare<NarrativeEventRow>(`
    ${EVENT_SELECT}
    WHERE book_id = ? AND status = 'pending'
    ORDER BY chapter_number DESC, created_at DESC, id ASC
    LIMIT ?
  `).all(parsed.bookId, Math.max(1, Math.min(parsed.limit ?? 50, 200)));
  return rows.map(eventRowToRecord);
}

export function listHighRiskPendingNarrativeEvents(storage: StorageDatabase, input: ListPendingNarrativeEventsInput): NarrativeEvent[] {
  ensureNarrativeMemorySchema(storage);
  const parsed = ListPendingNarrativeEventsInputSchema.parse(input);
  const rows = storage.sqlite.prepare<NarrativeEventRow>(`
    ${EVENT_SELECT}
    WHERE book_id = ? AND status = 'pending' AND risk_level = 'high'
    ORDER BY chapter_number DESC, created_at DESC, id ASC
    LIMIT ?
  `).all(parsed.bookId, Math.max(1, Math.min(parsed.limit ?? 50, 200)));
  return rows.map(eventRowToRecord);
}

export function queryNarrativeContextVectors(storage: StorageDatabase, input: QueryNarrativeContextVectorsInput): QueryNarrativeContextVectorsResult {
  ensureNarrativeMemorySchema(storage);
  const parsed = QueryNarrativeContextVectorsInputSchema.parse(input);
  const unlimited = parsed.limit === 0;
  const limit = unlimited ? Number.POSITIVE_INFINITY : Math.max(1, Math.min(parsed.limit ?? 100, 5000));
  const rows = storage.sqlite.prepare<NarrativeContextVectorRow>(`
    SELECT
      card_id AS cardId,
      book_id AS bookId,
      embedding_model_id AS embeddingModelId,
      embedding_dim AS embeddingDim,
      vector_json AS vectorJson,
      vector_updated_at AS vectorUpdatedAt,
      source_card_json AS sourceCardJson
    FROM narrative_context_vector
    WHERE book_id = ? AND embedding_model_id = ?
    ORDER BY vector_updated_at DESC, card_id ASC
  `).all(parsed.bookId, parsed.embeddingModelId);

  const vectors: NarrativeContextVector[] = [];
  const dimensionMismatchCardIds: string[] = [];
  const requestedEntities = new Set((parsed.entities ?? []).map((item) => item.trim()).filter(Boolean));
  const requestedCategories = new Set((parsed.categories ?? []).map((item) => item.trim()).filter(Boolean));
  const visibleChapter = parsed.currentChapter === undefined ? undefined : Math.max(0, parsed.currentChapter - 1);

  for (const row of rows) {
    if (row.embeddingDim !== parsed.embeddingDim) {
      dimensionMismatchCardIds.push(row.cardId);
      continue;
    }
    const record = vectorRowToRecord(row);
    const card = record.sourceCard;
    if (visibleChapter !== undefined) {
      if (card.validFromChapter !== undefined && card.validFromChapter > visibleChapter) continue;
      if (card.validUntilChapter !== undefined && card.validUntilChapter < visibleChapter) continue;
    }
    if (requestedEntities.size > 0 && !card.entities.some((entity) => requestedEntities.has(entity))) continue;
    if (requestedCategories.size > 0 && !card.tags.some((tag) => requestedCategories.has(tag))) continue;
    vectors.push(record);
    if (vectors.length >= limit) break;
  }

  return { vectors, dimensionMismatchCardIds };
}

// ─── 角色内核（character_kernel）────────────────────────────────────────

export interface CharacterKernelRow {
  id: string;
  bookId: string;
  characterId: string;
  entryStatus: "active" | "archived";
  fieldsJson: string;
  evidenceJson: string;
  updatedChapter: number;
  updatedAt: string;
  origin: "settle" | "manual" | "import";
}

function kernelRowToRecord(row: CharacterKernelRow): CharacterKernel {
  return CharacterKernelSchema.parse({
    id: row.id,
    bookId: row.bookId,
    characterId: row.characterId,
    entryStatus: row.entryStatus,
    fields: JSON.parse(row.fieldsJson),
    evidence: JSON.parse(row.evidenceJson),
    updatedChapter: row.updatedChapter,
    updatedAt: row.updatedAt,
    origin: row.origin,
  });
}

export function upsertCharacterKernel(storage: StorageDatabase, kernel: CharacterKernel): CharacterKernel {
  ensureNarrativeMemorySchema(storage);
  const parsed = CharacterKernelSchema.parse(kernel);
  storage.sqlite.prepare(`
    INSERT INTO character_kernel (
      id, book_id, character_id, entry_status, fields_json, evidence_json, updated_chapter, updated_at, origin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id, character_id) DO UPDATE SET
      entry_status = excluded.entry_status,
      fields_json = excluded.fields_json,
      evidence_json = excluded.evidence_json,
      updated_chapter = excluded.updated_chapter,
      updated_at = excluded.updated_at,
      origin = excluded.origin
  `).run(
    parsed.id,
    parsed.bookId,
    parsed.characterId,
    parsed.entryStatus,
    JSON.stringify(parsed.fields),
    JSON.stringify(parsed.evidence),
    parsed.updatedChapter,
    parsed.updatedAt,
    parsed.origin,
  );
  return parsed;
}

export function getCharacterKernel(
  storage: StorageDatabase,
  bookId: string,
  characterId: string,
): CharacterKernel | undefined {
  ensureNarrativeMemorySchema(storage);
  const row = storage.sqlite.prepare(`
    SELECT id, book_id AS bookId, character_id AS characterId, entry_status AS entryStatus,
           fields_json AS fieldsJson, evidence_json AS evidenceJson,
           updated_chapter AS updatedChapter, updated_at AS updatedAt, origin
    FROM character_kernel WHERE book_id = ? AND character_id = ?
  `).get(bookId, characterId) as CharacterKernelRow | undefined;
  return row ? kernelRowToRecord(row) : undefined;
}

export function listCharacterKernels(
  storage: StorageDatabase,
  input: { bookId: string; characterIds?: readonly string[]; includeArchived?: boolean },
): CharacterKernel[] {
  ensureNarrativeMemorySchema(storage);
  const clauses: string[] = ["book_id = ?"];
  const params: unknown[] = [input.bookId];
  if (!input.includeArchived) clauses.push("entry_status = 'active'");
  if (input.characterIds && input.characterIds.length > 0) {
    clauses.push(`character_id IN (${input.characterIds.map(() => "?").join(",")})`);
    params.push(...input.characterIds);
  }
  const rows = storage.sqlite.prepare(`
    SELECT id, book_id AS bookId, character_id AS characterId, entry_status AS entryStatus,
           fields_json AS fieldsJson, evidence_json AS evidenceJson,
           updated_chapter AS updatedChapter, updated_at AS updatedAt, origin
    FROM character_kernel WHERE ${clauses.join(" AND ")}
    ORDER BY updated_at DESC
  `).all(...params) as CharacterKernelRow[];
  return rows.map(kernelRowToRecord);
}

export function archiveCharacterKernel(storage: StorageDatabase, bookId: string, characterId: string): boolean {
  ensureNarrativeMemorySchema(storage);
  const result = storage.sqlite.prepare(`
    UPDATE character_kernel SET entry_status = 'archived', updated_at = ? WHERE book_id = ? AND character_id = ?
  `).run(new Date().toISOString(), bookId, characterId);
  return result.changes > 0;
}

export function deleteCharacterKernel(storage: StorageDatabase, bookId: string, characterId: string): boolean {
  ensureNarrativeMemorySchema(storage);
  const result = storage.sqlite.prepare(`
    DELETE FROM character_kernel WHERE book_id = ? AND character_id = ?
  `).run(bookId, characterId);
  return result.changes > 0;
}

export function replaceChapterMentions(
  storage: StorageDatabase,
  bookId: string,
  chapterNumber: number,
  mentions: readonly ChapterMention[],
): void {
  ensureNarrativeMemorySchema(storage);
  storage.sqlite.prepare(
    `DELETE FROM narrative_chapter_mention WHERE book_id = ? AND chapter_number = ?`,
  ).run(bookId, chapterNumber);
  const insert = storage.sqlite.prepare(`
    INSERT INTO narrative_chapter_mention (book_id, chapter_number, position, entity_name, entry_id, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const mention of mentions) {
    insert.run(bookId, chapterNumber, mention.position, mention.name, mention.entryId ?? null, mention.source);
  }
}

export function queryChapterMentions(
  storage: StorageDatabase,
  bookId: string,
  chapterNumber?: number,
): ChapterMention[] {
  ensureNarrativeMemorySchema(storage);
  const rows = chapterNumber === undefined
    ? storage.sqlite.prepare<{
      entity_name: string;
      entry_id: string | null;
      position: number;
      source: ChapterMention["source"];
      chapter_number: number;
    }>(`
      SELECT entity_name, entry_id, position, source, chapter_number
      FROM narrative_chapter_mention
      WHERE book_id = ?
      ORDER BY chapter_number ASC, position ASC, entity_name ASC
    `).all(bookId)
    : storage.sqlite.prepare<{
      entity_name: string;
      entry_id: string | null;
      position: number;
      source: ChapterMention["source"];
    }>(`
      SELECT entity_name, entry_id, position, source
      FROM narrative_chapter_mention
      WHERE book_id = ? AND chapter_number = ?
      ORDER BY position ASC, entity_name ASC
    `).all(bookId, chapterNumber);
  return rows.map((row) => ({
    name: row.entity_name,
    ...(row.entry_id ? { entryId: row.entry_id } : {}),
    position: row.position,
    source: row.source,
  }));
}

export function loadMentionsByChapter(storage: StorageDatabase, bookId: string): Map<number, string[]> {
  ensureNarrativeMemorySchema(storage);
  const rows = storage.sqlite.prepare<{
    chapter_number: number;
    entity_name: string;
  }>(`
    SELECT chapter_number, entity_name
    FROM narrative_chapter_mention
    WHERE book_id = ?
    ORDER BY chapter_number ASC, position ASC, entity_name ASC
  `).all(bookId);
  const byChapter = new Map<number, string[]>();
  for (const row of rows) {
    const bucket = byChapter.get(row.chapter_number) ?? [];
    bucket.push(row.entity_name);
    byChapter.set(row.chapter_number, bucket);
  }
  return byChapter;
}

type ForeshadowMachineStatus = "planted" | "reinforced" | "triggered" | "paid_off";

const FORESHADOW_STATUS_BY_EVENT: Record<string, ForeshadowMachineStatus> = {
  hook_planted: "planted",
  hook_progressed: "reinforced",
  hook_triggered: "triggered",
  hook_resolved: "paid_off",
};

function foreshadowId(bookId: string, subject: string): string {
  return `fs:${bookId}:${encodeURIComponent(subject.trim())}`.slice(0, 200);
}

function foreshadowTriggerCondition(event: NarrativeEvent): string | null {
  const fromObject = event.object.trim().slice(0, 400);
  if (fromObject) return fromObject;
  const fromEvidence = event.evidenceText.trim().slice(0, 400);
  return fromEvidence || null;
}

/**
 * 把本章伏笔事件接到 narrative_foreshadow 状态机（CFPG：planted → triggered → paid_off）。
 * planted 新建或保持；progressed 只升格未触发态；triggered 写 trigger_chapter/condition，不覆盖已回收；
 * resolved 写 payoff。表不存在时由 ensureNarrativeMemorySchema 建好。
 */
export function applyForeshadowEvents(
  storage: StorageDatabase,
  bookId: string,
  events: readonly NarrativeEvent[],
  now = Date.now(),
): number {
  ensureNarrativeMemorySchema(storage);
  const upsert = storage.sqlite.prepare(`
    INSERT INTO narrative_foreshadow (
      id, book_id, label, entry_id, setup_chapter, setup_event_id,
      trigger_chapter, trigger_condition,
      payoff_chapter, payoff_event_id, status, evidence_text, recorded_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = CASE
        WHEN excluded.status = 'paid_off' THEN 'paid_off'
        WHEN narrative_foreshadow.status IN ('paid_off','abandoned','contradicted') THEN narrative_foreshadow.status
        WHEN excluded.status = 'triggered' AND narrative_foreshadow.status IN ('planted','reinforced','triggered','paying_off') THEN 'triggered'
        WHEN excluded.status = 'reinforced' AND narrative_foreshadow.status IN ('planted','reinforced') THEN 'reinforced'
        ELSE narrative_foreshadow.status
      END,
      setup_chapter = COALESCE(narrative_foreshadow.setup_chapter, excluded.setup_chapter),
      setup_event_id = COALESCE(narrative_foreshadow.setup_event_id, excluded.setup_event_id),
      trigger_chapter = CASE
        WHEN excluded.status = 'triggered' THEN COALESCE(narrative_foreshadow.trigger_chapter, excluded.trigger_chapter)
        ELSE narrative_foreshadow.trigger_chapter
      END,
      trigger_condition = CASE
        WHEN excluded.status = 'triggered' THEN COALESCE(narrative_foreshadow.trigger_condition, excluded.trigger_condition)
        ELSE narrative_foreshadow.trigger_condition
      END,
      payoff_chapter = CASE WHEN excluded.status = 'paid_off' THEN excluded.payoff_chapter ELSE narrative_foreshadow.payoff_chapter END,
      payoff_event_id = CASE WHEN excluded.status = 'paid_off' THEN excluded.payoff_event_id ELSE narrative_foreshadow.payoff_event_id END,
      entry_id = COALESCE(narrative_foreshadow.entry_id, excluded.entry_id),
      evidence_text = COALESCE(excluded.evidence_text, narrative_foreshadow.evidence_text),
      updated_at = excluded.updated_at
  `);
  let written = 0;
  for (const event of events) {
    const status = FORESHADOW_STATUS_BY_EVENT[event.eventType];
    if (!status) continue;
    const label = event.subject.trim();
    if (!label) continue;
    upsert.run(
      foreshadowId(bookId, label),
      bookId,
      label.slice(0, 200),
      event.subjectEntryId ?? null,
      status === "planted" ? event.chapterNumber : null,
      status === "planted" ? event.id : null,
      status === "triggered" ? event.chapterNumber : null,
      status === "triggered" ? foreshadowTriggerCondition(event) : null,
      status === "paid_off" ? event.chapterNumber : null,
      status === "paid_off" ? event.id : null,
      status,
      event.evidenceText.slice(0, 400) || null,
      now,
      now,
    );
    written += 1;
  }
  return written;
}
