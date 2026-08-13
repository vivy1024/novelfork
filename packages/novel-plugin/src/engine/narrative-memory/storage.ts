import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { z } from "zod";

import {
  NarrativeEventSchema,
  NarrativeEventStatusSchema,
  NarrativeContextVectorSchema,
  NarrativeFactSchema,
  NarrativeRetrievalDiagnosticsSchema,
  NarrativeRetrievalPurposeSchema,
  type NarrativeContextVector,
  type NarrativeEvent,
  type NarrativeEventStatus,
  type NarrativeFact,
  type NarrativeRetrievalDiagnostics,
  type NarrativeRetrievalPurpose,
} from "./types.js";

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
  createdAt: string;
  appliedAt: string | null;
}

const nonEmptyString = z.string().trim().min(1);
const positiveInteger = z.number().int().min(1);
const nonNegativeInteger = z.number().int().min(0);

export const QueryNarrativeFactsInputSchema = z.object({
  bookId: nonEmptyString,
  entities: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  predicates: z.array(z.string()).optional(),
  layer: NarrativeFactSchema.shape.layer.optional(),
  currentChapter: positiveInteger.optional(),
  limit: positiveInteger.max(500).optional(),
});
export type QueryNarrativeFactsInput = Readonly<{
  bookId: string;
  entities?: readonly string[];
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
  limit: positiveInteger.max(500).optional(),
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function eventRowToRecord(row: NarrativeEventRow): NarrativeEvent {
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
      created_at TEXT NOT NULL,
      applied_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_narrative_event_book_chapter ON narrative_event(book_id, chapter_number);
    CREATE INDEX IF NOT EXISTS idx_narrative_event_book_status ON narrative_event(book_id, status);

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
  `);
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
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  const limit = Math.max(1, Math.min(parsed.limit ?? 100, 500));
  const rows = storage.sqlite.prepare<NarrativeFactRow>(`
    ${FACT_SELECT}
    WHERE ${clauses.join(" AND ")}
    ORDER BY confidence DESC, updated_at DESC, id ASC
    LIMIT ?
  `).all(...params, limit);
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
      created_at,
      applied_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  const limit = Math.max(1, Math.min(parsed.limit ?? 100, 500));
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
    LIMIT 500
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
