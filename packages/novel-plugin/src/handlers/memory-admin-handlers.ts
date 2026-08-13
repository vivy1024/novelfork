import { getStorageDatabase } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { loadNarrativeMemoryConfig } from "../engine/narrative-memory/config.js";
import { applyNarrativeEvents } from "../engine/narrative-memory/reducer.js";
import { ensureNarrativeMemorySchema, updateNarrativeEventStatus } from "../engine/narrative-memory/storage.js";
import {
  NarrativeEventRiskLevelSchema,
  NarrativeEventTypeSchema,
  NarrativeFactLayerSchema,
  NarrativeFactSourceTypeSchema,
  type NarrativeEvent,
  type NarrativeEventRiskLevel,
  type NarrativeEventStatus,
  type NarrativeEventType,
  type NarrativeFactLayer,
  type NarrativeFactSourceType,
} from "../engine/narrative-memory/types.js";

export type MemoryEntryKind = "fact" | "event" | "log" | "vector";

type ToolSuccess = { ok: true; summary: string; data: Record<string, any> };
type ToolFailure = { ok: false; error: string; summary: string; data?: Record<string, any> };
type ToolResult = ToolSuccess | ToolFailure;

type ChapterRange = readonly [number, number] | readonly number[];

interface MemoryFilter {
  readonly status?: NarrativeEventStatus;
  readonly layer?: NarrativeFactLayer;
  readonly category?: string;
  readonly chapterRange?: ChapterRange;
  readonly query?: string;
  readonly ids?: readonly string[];
}

interface MemoryBaseInput {
  readonly bookId: string;
  /** Trusted book root injected by the Runtime when available. */
  readonly bookRoot?: string;
}

export interface MemoryListInput extends MemoryBaseInput {
  readonly kind?: MemoryEntryKind;
  readonly status?: NarrativeEventStatus;
  readonly layer?: NarrativeFactLayer;
  readonly category?: string;
  readonly chapterRange?: ChapterRange;
  readonly query?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface MemoryReadEntryInput extends MemoryBaseInput {
  readonly kind: MemoryEntryKind;
  readonly id: string;
}

export interface MemorySearchInput extends MemoryBaseInput {
  readonly query: string;
  readonly kind?: MemoryEntryKind;
  readonly status?: NarrativeEventStatus;
  readonly limit?: number;
  readonly offset?: number;
}

export interface MemoryStatsInput extends MemoryBaseInput {}

export interface MemoryExportInput extends MemoryBaseInput {
  readonly kind?: MemoryEntryKind;
  readonly format?: "json" | string;
}

export interface MemoryDedupInput extends MemoryBaseInput {
  readonly kind?: Extract<MemoryEntryKind, "fact" | "event">;
  readonly limit?: number;
}

export interface MemoryUpdateInput extends MemoryBaseInput {
  readonly kind: MemoryEntryKind;
  readonly id: string;
  readonly reason: string;
  readonly patch: Record<string, unknown>;
}

export interface MemoryDeleteInput extends MemoryBaseInput {
  readonly kind: MemoryEntryKind;
  readonly id: string;
  readonly reason: string;
}

export interface MemoryBulkApproveInput extends MemoryBaseInput {
  readonly eventIds?: readonly string[];
  readonly filter?: MemoryFilter;
  readonly reason: string;
  readonly limit?: number;
}

export interface MemoryBulkDeleteInput extends MemoryBaseInput {
  readonly kind: MemoryEntryKind;
  readonly filter?: MemoryFilter;
  readonly limit?: number;
  readonly reason: string;
}

interface FactRecord {
  id: string;
  bookId: string;
  subject: string;
  predicate: string;
  object: string;
  category: string;
  layer: NarrativeFactLayer;
  confidence: number;
  sourceType: NarrativeFactSourceType;
  sourceId?: string;
  sourceChapter?: number;
  evidenceText?: string;
  validFromChapter?: number;
  validUntilChapter?: number;
  createdAt: string;
  updatedAt: string;
}

interface EventRecord extends NarrativeEvent {}

interface RetrievalLogRecord {
  id: string;
  bookId: string;
  chapterNumber?: number;
  purpose: string;
  totalTokens: number;
  diagnostics: unknown;
  createdAt: string;
}

interface VectorRecord {
  id: string;
  cardId: string;
  bookId: string;
  embeddingModelId: string;
  embeddingDim: number;
  vectorUpdatedAt: string;
  sourceCard: any;
}

const VALID_KINDS = new Set<MemoryEntryKind>(["fact", "event", "log", "vector"]);
const WRITABLE_KINDS = new Set<MemoryEntryKind>(["fact", "event"]);

function ok(summary: string, data: Record<string, any> = {}): ToolSuccess {
  return { ok: true, summary, data };
}

function fail(error: string, summary: string, data?: Record<string, any>): ToolFailure {
  return { ok: false, error, summary, ...(data ? { data } : {}) };
}

function normalizeBookId(input: { readonly bookId?: unknown }): string | undefined {
  const bookId = String(input.bookId ?? "").trim();
  return bookId || undefined;
}

function parseKind(kind: unknown, required = true): MemoryEntryKind | undefined | ToolFailure {
  if (kind === undefined || kind === null || kind === "") {
    return required ? fail("invalid-input", "kind 必填，且必须是 fact | event | log | vector。") : undefined;
  }
  const value = String(kind) as MemoryEntryKind;
  return VALID_KINDS.has(value) ? value : fail("invalid-kind", "kind 必须是 fact | event | log | vector。");
}

function requireBookId(input: { readonly bookId?: unknown }): string | ToolFailure {
  return normalizeBookId(input) ?? fail("invalid-input", "bookId 必填。");
}

function clampLimit(limit: unknown, fallback: number, max: number): number {
  const value = Number(limit);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.trunc(value), max));
}

function clampOffset(offset: unknown): number {
  const value = Number(offset);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function chapterRangeClause(column: string, range: ChapterRange | undefined, params: unknown[]): string | undefined {
  if (!range || range.length < 2) return undefined;
  const from = Number(range[0]);
  const to = Number(range[1]);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return undefined;
  params.push(Math.min(from, to), Math.max(from, to));
  return `${column} BETWEEN ? AND ?`;
}

function likeTerm(query: string): string {
  const escaped = query.trim().replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isIntegerOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value));
}

function validatePatchValue(kind: Extract<MemoryEntryKind, "fact" | "event">, key: string, value: unknown): ToolFailure | undefined {
  if (key === "confidence" && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) {
    return fail("invalid-patch", "confidence 必须是 0 到 1 之间的数字。");
  }
  if (kind === "fact" && key === "layer" && !NarrativeFactLayerSchema.safeParse(value).success) {
    return fail("invalid-patch", "layer 必须是 canon | dynamic | reference。");
  }
  if (kind === "fact" && key === "sourceType" && !NarrativeFactSourceTypeSchema.safeParse(value).success) {
    return fail("invalid-patch", "sourceType 必须是 jingwei | runtime-state | event | manual | import。");
  }
  if (kind === "event" && key === "eventType" && !NarrativeEventTypeSchema.safeParse(value).success) {
    return fail("invalid-patch", "eventType 不合法。");
  }
  if (kind === "event" && key === "riskLevel" && !NarrativeEventRiskLevelSchema.safeParse(value).success) {
    return fail("invalid-patch", "riskLevel 必须是 low | medium | high。");
  }
  if (["sourceChapter", "validFromChapter", "validUntilChapter", "chapterNumber"].includes(key) && !isIntegerOrNull(value)) {
    return fail("invalid-patch", `${key} 必须是整数或 null。`);
  }
  if (["subject", "predicate", "object", "category", "evidenceText", "sourceId", "source"].includes(key) && value !== null && typeof value !== "string") {
    return fail("invalid-patch", `${key} 必须是字符串或 null。`);
  }
  if (["validFromChapter", "validUntilChapter", "sourceChapter", "chapterNumber"].includes(key) && !isNumberOrNull(value)) {
    return fail("invalid-patch", `${key} 必须是数字或 null。`);
  }
  return undefined;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function factFromRow(row: any): FactRecord {
  return {
    id: row.id,
    bookId: row.bookId,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    category: row.category,
    layer: row.layer,
    confidence: row.confidence,
    sourceType: row.sourceType,
    ...(row.sourceId == null ? {} : { sourceId: row.sourceId }),
    ...(row.sourceChapter == null ? {} : { sourceChapter: row.sourceChapter }),
    ...(row.evidenceText == null ? {} : { evidenceText: row.evidenceText }),
    ...(row.validFromChapter == null ? {} : { validFromChapter: row.validFromChapter }),
    ...(row.validUntilChapter == null ? {} : { validUntilChapter: row.validUntilChapter }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function eventFromRow(row: any): EventRecord {
  return {
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
    ...(row.appliedAt == null ? {} : { appliedAt: row.appliedAt }),
  };
}

function logFromRow(row: any): RetrievalLogRecord {
  return {
    id: row.id,
    bookId: row.bookId,
    ...(row.chapterNumber == null ? {} : { chapterNumber: row.chapterNumber }),
    purpose: row.purpose,
    totalTokens: row.totalTokens,
    diagnostics: safeJsonParse(row.diagnosticsJson),
    createdAt: row.createdAt,
  };
}

function vectorFromRow(row: any, includeVector = false): VectorRecord & { vector?: readonly number[] } {
  const sourceCard = safeJsonParse(row.sourceCardJson);
  return {
    id: row.cardId,
    cardId: row.cardId,
    bookId: row.bookId,
    embeddingModelId: row.embeddingModelId,
    embeddingDim: row.embeddingDim,
    vectorUpdatedAt: row.vectorUpdatedAt,
    sourceCard,
    ...(includeVector ? { vector: safeJsonParse(row.vectorJson) as readonly number[] } : {}),
  };
}

function summarizeFact(fact: FactRecord) {
  return `${fact.subject}${fact.predicate}${fact.object}`;
}

function summarizeEvent(event: EventRecord) {
  return `${event.subject}${event.predicate}${event.object}`;
}

function toEntry(kind: MemoryEntryKind, record: FactRecord | EventRecord | RetrievalLogRecord | VectorRecord, extras: Record<string, any> = {}) {
  if (kind === "fact") {
    const fact = record as FactRecord;
    return {
      kind,
      id: fact.id,
      summary: summarizeFact(fact),
      title: `${fact.subject} ${fact.predicate}`,
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      category: fact.category,
      layer: fact.layer,
      sourceChapter: fact.sourceChapter,
      createdAt: fact.createdAt,
      updatedAt: fact.updatedAt,
      ...extras,
    };
  }
  if (kind === "event") {
    const event = record as EventRecord;
    return {
      kind,
      id: event.id,
      summary: summarizeEvent(event),
      title: `${event.eventType}: ${event.subject}`,
      subject: event.subject,
      predicate: event.predicate,
      object: event.object,
      eventType: event.eventType,
      status: event.status,
      chapterNumber: event.chapterNumber,
      createdAt: event.createdAt,
      updatedAt: event.appliedAt ?? event.createdAt,
      ...extras,
    };
  }
  if (kind === "log") {
    const log = record as RetrievalLogRecord;
    return {
      kind,
      id: log.id,
      summary: `${log.purpose} / ${log.totalTokens} tokens`,
      title: `retrieval ${log.purpose}`,
      purpose: log.purpose,
      chapterNumber: log.chapterNumber,
      createdAt: log.createdAt,
      updatedAt: log.createdAt,
      ...extras,
    };
  }
  const vector = record as VectorRecord;
  return {
    kind,
    id: vector.cardId,
    summary: `${vector.embeddingModelId} (${vector.embeddingDim})`,
    title: `vector ${vector.cardId}`,
    embeddingModelId: vector.embeddingModelId,
    embeddingDim: vector.embeddingDim,
    createdAt: vector.vectorUpdatedAt,
    updatedAt: vector.vectorUpdatedAt,
    ...extras,
  };
}

function factSelect(): string {
  return `SELECT id, book_id AS bookId, subject, predicate, object, category, layer, confidence, source_type AS sourceType, source_id AS sourceId, source_chapter AS sourceChapter, evidence_text AS evidenceText, valid_from_chapter AS validFromChapter, valid_until_chapter AS validUntilChapter, created_at AS createdAt, updated_at AS updatedAt FROM narrative_fact`;
}

function eventSelect(): string {
  return `SELECT id, book_id AS bookId, chapter_number AS chapterNumber, event_type AS eventType, subject, predicate, object, evidence_text AS evidenceText, confidence, source, status, risk_level AS riskLevel, created_at AS createdAt, applied_at AS appliedAt FROM narrative_event`;
}

function logSelect(): string {
  return `SELECT id, book_id AS bookId, chapter_number AS chapterNumber, purpose, total_tokens AS totalTokens, diagnostics_json AS diagnosticsJson, created_at AS createdAt FROM narrative_retrieval_log`;
}

function vectorSelect(): string {
  return `SELECT card_id AS cardId, book_id AS bookId, embedding_model_id AS embeddingModelId, embedding_dim AS embeddingDim, vector_json AS vectorJson, vector_updated_at AS vectorUpdatedAt, source_card_json AS sourceCardJson FROM narrative_context_vector`;
}

function getFact(storage: StorageDatabase, bookId: string, id: string): FactRecord | undefined {
  const row = storage.sqlite.prepare(`${factSelect()} WHERE book_id = ? AND id = ?`).get(bookId, id);
  return row ? factFromRow(row) : undefined;
}

function getEvent(storage: StorageDatabase, bookId: string, id: string): EventRecord | undefined {
  const row = storage.sqlite.prepare(`${eventSelect()} WHERE book_id = ? AND id = ?`).get(bookId, id);
  return row ? eventFromRow(row) : undefined;
}

function getLog(storage: StorageDatabase, bookId: string, id: string): RetrievalLogRecord | undefined {
  const row = storage.sqlite.prepare(`${logSelect()} WHERE book_id = ? AND id = ?`).get(bookId, id);
  return row ? logFromRow(row) : undefined;
}

function getVector(storage: StorageDatabase, bookId: string, id: string): VectorRecord | undefined {
  const row = storage.sqlite.prepare(`${vectorSelect()} WHERE book_id = ? AND card_id = ?`).get(bookId, id);
  return row ? vectorFromRow(row) : undefined;
}

function getEntry(storage: StorageDatabase, bookId: string, kind: MemoryEntryKind, id: string): FactRecord | EventRecord | RetrievalLogRecord | VectorRecord | undefined {
  if (kind === "fact") return getFact(storage, bookId, id);
  if (kind === "event") return getEvent(storage, bookId, id);
  if (kind === "log") return getLog(storage, bookId, id);
  return getVector(storage, bookId, id);
}

function listFacts(storage: StorageDatabase, input: MemoryListInput): FactRecord[] {
  const clauses = ["book_id = ?"];
  const params: unknown[] = [input.bookId];
  if (input.layer) { clauses.push("layer = ?"); params.push(input.layer); }
  if (input.category) { clauses.push("category = ?"); params.push(input.category); }
  if (input.query) {
    const like = likeTerm(input.query);
    clauses.push("(subject LIKE ? ESCAPE '\\' OR predicate LIKE ? ESCAPE '\\' OR object LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR layer LIKE ? ESCAPE '\\' OR evidence_text LIKE ? ESCAPE '\\')");
    params.push(like, like, like, like, like, like);
  }
  const chapterClause = chapterRangeClause("source_chapter", input.chapterRange, params);
  if (chapterClause) clauses.push(chapterClause);
  const limit = clampLimit(input.limit, 50, 500);
  const offset = clampOffset(input.offset);
  const rows = storage.sqlite.prepare(`${factSelect()} WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return rows.map(factFromRow);
}

function listEvents(storage: StorageDatabase, input: MemoryListInput): EventRecord[] {
  const clauses = ["book_id = ?"];
  const params: unknown[] = [input.bookId];
  if (input.status) { clauses.push("status = ?"); params.push(input.status); }
  if (input.category) { clauses.push("event_type = ?"); params.push(input.category); }
  if (input.query) {
    const like = likeTerm(input.query);
    clauses.push("(event_type LIKE ? ESCAPE '\\' OR subject LIKE ? ESCAPE '\\' OR predicate LIKE ? ESCAPE '\\' OR object LIKE ? ESCAPE '\\' OR evidence_text LIKE ? ESCAPE '\\' OR status LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\' OR risk_level LIKE ? ESCAPE '\\')");
    params.push(like, like, like, like, like, like, like, like);
  }
  const chapterClause = chapterRangeClause("chapter_number", input.chapterRange, params);
  if (chapterClause) clauses.push(chapterClause);
  const limit = clampLimit(input.limit, 50, 500);
  const offset = clampOffset(input.offset);
  const rows = storage.sqlite.prepare(`${eventSelect()} WHERE ${clauses.join(" AND ")} ORDER BY chapter_number DESC, created_at DESC, id ASC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return rows.map(eventFromRow);
}

function listLogs(storage: StorageDatabase, input: MemoryListInput): RetrievalLogRecord[] {
  const clauses = ["book_id = ?"];
  const params: unknown[] = [input.bookId];
  if (input.query) {
    const like = likeTerm(input.query);
    clauses.push("(purpose LIKE ? ESCAPE '\\' OR diagnostics_json LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  const chapterClause = chapterRangeClause("chapter_number", input.chapterRange, params);
  if (chapterClause) clauses.push(chapterClause);
  const limit = clampLimit(input.limit, 50, 500);
  const offset = clampOffset(input.offset);
  const rows = storage.sqlite.prepare(`${logSelect()} WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return rows.map(logFromRow);
}

function listVectors(storage: StorageDatabase, input: MemoryListInput): VectorRecord[] {
  const clauses = ["book_id = ?"];
  const params: unknown[] = [input.bookId];
  if (input.query) {
    const like = likeTerm(input.query);
    clauses.push("(card_id LIKE ? ESCAPE '\\' OR embedding_model_id LIKE ? ESCAPE '\\' OR source_card_json LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  const limit = clampLimit(input.limit, 50, 500);
  const offset = clampOffset(input.offset);
  const rows = storage.sqlite.prepare(`${vectorSelect()} WHERE ${clauses.join(" AND ")} ORDER BY vector_updated_at DESC, card_id ASC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return rows.map((row: any) => vectorFromRow(row));
}

function listByKind(storage: StorageDatabase, input: MemoryListInput, kind: MemoryEntryKind) {
  if (kind === "fact") return listFacts(storage, input).map((record) => toEntry("fact", record));
  if (kind === "event") return listEvents(storage, input).map((record) => toEntry("event", record));
  if (kind === "log") return listLogs(storage, input).map((record) => toEntry("log", record));
  return listVectors(storage, input).map((record) => toEntry("vector", record));
}

function matchedFields(record: Record<string, any>, query: string, fields: readonly string[]): string[] {
  const needle = query.toLowerCase();
  return fields.filter((field) => String(record[field] ?? "").toLowerCase().includes(needle));
}

function isToolResult(value: unknown): value is ToolFailure {
  return Boolean(value && typeof value === "object" && "ok" in value && (value as any).ok === false);
}

function isWritableKind(kind: MemoryEntryKind): kind is Extract<MemoryEntryKind, "fact" | "event"> {
  return kind === "fact" || kind === "event";
}

function getStorage(storage?: StorageDatabase): StorageDatabase {
  const resolved = storage ?? getStorageDatabase();
  ensureNarrativeMemorySchema(resolved);
  return resolved;
}

export async function handleMemoryList(input: MemoryListInput, storageOverride?: StorageDatabase): Promise<ToolResult> {
  const bookId = requireBookId(input);
  if (isToolResult(bookId)) return bookId;
  const storage = getStorage(storageOverride);
  const kind = parseKind(input.kind, false);
  if (isToolResult(kind)) return kind;
  const limit = clampLimit(input.limit, 50, 500);
  const offset = clampOffset(input.offset);
  const normalized = { ...input, bookId, limit: kind ? limit : 500, offset: kind ? offset : 0 };
  const kinds: MemoryEntryKind[] = kind ? [kind] : ["fact", "event", "log", "vector"];
  const allEntries = kinds.flatMap((item) => listByKind(storage, normalized, item));
  const entries = kind
    ? allEntries
    : allEntries
      .sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")))
      .slice(offset, offset + limit);
  return ok(`已列出 ${entries.length} 条记忆条目。`, { entries, page: { limit, offset, returned: entries.length } });
}

export async function handleMemoryReadEntry(input: MemoryReadEntryInput, storageOverride?: StorageDatabase): Promise<ToolResult> {
  const bookId = requireBookId(input);
  if (isToolResult(bookId)) return bookId;
  const kind = parseKind(input.kind);
  if (isToolResult(kind) || !kind) return kind || fail("invalid-kind", "kind 必填。");
  const id = String(input.id ?? "").trim();
  if (!id) return fail("invalid-input", "id 必填。");
  const storage = getStorage(storageOverride);
  const record = getEntry(storage, bookId, kind, id);
  if (!record) return fail("not-found", `未找到 ${kind}:${id}。`);
  return ok(`已读取 ${kind}:${id}。`, { entry: { ...record, kind, id } });
}

export async function handleMemorySearch(input: MemorySearchInput, storageOverride?: StorageDatabase): Promise<ToolResult> {
  const bookId = requireBookId(input);
  if (isToolResult(bookId)) return bookId;
  const query = String(input.query ?? "").trim();
  if (!query) return fail("invalid-input", "query 必填。");
  const kind = parseKind(input.kind, false);
  if (isToolResult(kind)) return kind;
  const storage = getStorage(storageOverride);
  const limit = clampLimit(input.limit, 50, 500);
  const offset = clampOffset(input.offset);
  const kinds: MemoryEntryKind[] = kind ? [kind] : ["fact", "event", "log", "vector"];
  const entries = kinds.flatMap((item) => {
    const listInput: MemoryListInput = { bookId, kind: item, status: input.status, query, limit: limit + offset };
    const records = item === "fact" ? listFacts(storage, listInput) : item === "event" ? listEvents(storage, listInput) : item === "log" ? listLogs(storage, listInput) : listVectors(storage, listInput);
    return records.map((record: any) => {
      const fields = item === "fact" ? ["subject", "predicate", "object", "category", "layer", "evidenceText"] : item === "event" ? ["eventType", "subject", "predicate", "object", "evidenceText", "status", "source", "riskLevel"] : item === "log" ? ["purpose"] : ["cardId", "embeddingModelId"];
      const extraFields = matchedFields(record, query, fields);
      if (item === "log" && JSON.stringify((record as RetrievalLogRecord).diagnostics).includes(query)) extraFields.push("diagnostics");
      if (item === "vector" && JSON.stringify((record as VectorRecord).sourceCard).includes(query)) extraFields.push("sourceCard");
      return toEntry(item, record, { matchedFields: Array.from(new Set(extraFields)), matchReason: `匹配关键词：${query}` });
    });
  }).slice(offset, offset + limit);
  return ok(`搜索到 ${entries.length} 条记忆。`, { entries, query, page: { limit, offset, returned: entries.length } });
}

export async function handleMemoryStats(input: MemoryStatsInput, storageOverride?: StorageDatabase): Promise<ToolResult> {
  const bookId = requireBookId(input);
  if (isToolResult(bookId)) return bookId;
  const storage = getStorage(storageOverride);
  const factRows = storage.sqlite.prepare(`SELECT layer, category, updated_at AS updatedAt FROM narrative_fact WHERE book_id = ?`).all(bookId) as any[];
  const eventRows = storage.sqlite.prepare(`SELECT status, chapter_number AS chapterNumber, created_at AS createdAt, applied_at AS appliedAt FROM narrative_event WHERE book_id = ?`).all(bookId) as any[];
  const logRows = storage.sqlite.prepare(`SELECT created_at AS createdAt FROM narrative_retrieval_log WHERE book_id = ?`).all(bookId) as any[];
  const vectorRows = storage.sqlite.prepare(`SELECT vector_updated_at AS updatedAt FROM narrative_context_vector WHERE book_id = ?`).all(bookId) as any[];
  const byKind = { fact: factRows.length, event: eventRows.length, log: logRows.length, vector: vectorRows.length };
  const eventStatus = countBy(eventRows, "status");
  const factLayer = countBy(factRows, "layer");
  const factCategory = countBy(factRows, "category");
  const pendingByChapter: Record<string, number> = {};
  let latestSettledChapter: number | null = null;
  for (const row of eventRows) {
    const chapterNumber = typeof row.chapterNumber === "number" ? row.chapterNumber : null;
    if (chapterNumber != null && Number.isFinite(chapterNumber)) {
      if (row.status === "pending") {
        const key = String(chapterNumber);
        pendingByChapter[key] = (pendingByChapter[key] ?? 0) + 1;
      }
      if (row.status === "applied" && (latestSettledChapter == null || chapterNumber > latestSettledChapter)) {
        latestSettledChapter = chapterNumber;
      }
    }
  }
  const duplicateRisk = duplicateGroups(listFacts(storage, { bookId, kind: "fact", limit: 500 }), "fact").length + duplicateGroups(listEvents(storage, { bookId, kind: "event", limit: 500 }), "event").length;
  const timestamps = [...factRows.map((r) => r.updatedAt), ...eventRows.map((r) => r.appliedAt ?? r.createdAt), ...logRows.map((r) => r.createdAt), ...vectorRows.map((r) => r.updatedAt)].filter(Boolean).sort();
  const stats = {
    total: byKind.fact + byKind.event + byKind.log + byKind.vector,
    byKind,
    eventStatus,
    factLayer,
    factCategory,
    pendingEvents: eventStatus.pending ?? 0,
    pendingByChapter,
    latestSettledChapter,
    duplicateRisk,
    latestUpdatedAt: timestamps.at(-1),
  };
  return ok("已统计叙事记忆。", { stats });
}

function countBy(rows: readonly Record<string, any>[], field: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    const key = String(row[field] ?? "unknown");
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

export async function handleMemoryExport(input: MemoryExportInput): Promise<ToolResult> {
  const bookId = requireBookId(input);
  if (isToolResult(bookId)) return bookId;
  const format = input.format ?? "json";
  if (format !== "json") return fail("unsupported-format", "memory.export 目前仅支持 format=json。");
  const kind = parseKind(input.kind, false);
  if (isToolResult(kind)) return kind;
  const storage = getStorage();
  const exportData: Record<string, any> = {};
  if (!kind || kind === "fact") exportData.facts = listFacts(storage, { bookId, limit: 500 });
  if (!kind || kind === "event") exportData.events = listEvents(storage, { bookId, limit: 500 });
  if (!kind || kind === "log") exportData.retrievalLogs = listLogs(storage, { bookId, limit: 500 });
  if (!kind || kind === "vector") exportData.contextVectors = listVectors(storage, { bookId, limit: 500 }).map((vector) => ({ id: vector.id, cardId: vector.cardId, bookId: vector.bookId, embeddingModelId: vector.embeddingModelId, embeddingDim: vector.embeddingDim, vectorUpdatedAt: vector.vectorUpdatedAt, sourceCard: vector.sourceCard }));
  return ok("已导出叙事记忆。", { format, exportData });
}

function normalizedSignature(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function duplicateGroups(records: readonly (FactRecord | EventRecord)[], kind: "fact" | "event", limit = 50) {
  const groups = new Map<string, (FactRecord | EventRecord)[]>();
  for (const record of records) {
    const key = kind === "fact"
      ? normalizedSignature(`${(record as FactRecord).subject}|${(record as FactRecord).predicate}|${(record as FactRecord).object}|${(record as FactRecord).category}|${(record as FactRecord).layer}`)
      : normalizedSignature(`${(record as EventRecord).eventType}|${(record as EventRecord).subject}|${(record as EventRecord).predicate}|${(record as EventRecord).object}|${(record as EventRecord).status}`);
    const items = groups.get(key) ?? [];
    items.push(record);
    groups.set(key, items);
  }
  return Array.from(groups.entries())
    .filter(([, items]) => items.length > 1)
    .slice(0, limit)
    .map(([signature, items]) => ({ signature, ids: items.map((item) => item.id), entries: items.map((item) => toEntry(kind, item)) }));
}

export async function handleMemoryDedup(input: MemoryDedupInput): Promise<ToolResult> {
  const bookId = requireBookId(input);
  if (isToolResult(bookId)) return bookId;
  if (input.kind && input.kind !== "fact" && input.kind !== "event") return fail("invalid-kind", "memory.dedup 仅支持 fact 或 event。");
  const storage = getStorage();
  const limit = clampLimit(input.limit, 50, 200);
  const groups = [
    ...(input.kind !== "event" ? duplicateGroups(listFacts(storage, { bookId, limit: 500 }), "fact", limit) : []),
    ...(input.kind !== "fact" ? duplicateGroups(listEvents(storage, { bookId, limit: 500 }), "event", limit) : []),
  ].slice(0, limit);
  return ok(`发现 ${groups.length} 组重复候选。`, { groups });
}

const FACT_PATCH_COLUMNS: Record<string, string> = {
  subject: "subject",
  predicate: "predicate",
  object: "object",
  category: "category",
  layer: "layer",
  confidence: "confidence",
  sourceId: "source_id",
  sourceChapter: "source_chapter",
  evidenceText: "evidence_text",
  validFromChapter: "valid_from_chapter",
  validUntilChapter: "valid_until_chapter",
};

const EVENT_PATCH_COLUMNS: Record<string, string> = {
  chapterNumber: "chapter_number",
  eventType: "event_type",
  subject: "subject",
  predicate: "predicate",
  object: "object",
  evidenceText: "evidence_text",
  confidence: "confidence",
  source: "source",
  riskLevel: "risk_level",
};

export async function handleMemoryUpdate(input: MemoryUpdateInput): Promise<ToolResult> {
  const bookId = requireBookId(input);
  if (isToolResult(bookId)) return bookId;
  const kind = parseKind(input.kind);
  if (isToolResult(kind) || !kind) return kind || fail("invalid-kind", "kind 必填。");
  if (!isWritableKind(kind)) return fail("forbidden", "memory.update 仅允许修改 fact 或 event。");
  const id = String(input.id ?? "").trim();
  const reason = String(input.reason ?? "").trim();
  if (!id || !reason) return fail("invalid-input", "memory.update 需要 id 和 reason。");
  const patch = input.patch ?? {};
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return fail("invalid-input", "patch 必须是对象。");
  const storage = getStorage();
  const before = getEntry(storage, bookId, kind, id);
  if (!before) return fail("not-found", `未找到 ${kind}:${id}。`);
  const columns = kind === "fact" ? FACT_PATCH_COLUMNS : EVENT_PATCH_COLUMNS;
  const assignments: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const column = columns[key];
    if (!column) return fail("invalid-patch", `不允许更新字段：${key}。`);
    const validationError = validatePatchValue(kind, key, value);
    if (validationError) return validationError;
    assignments.push(`${column} = ?`);
    params.push(value ?? null);
  }
  if (assignments.length === 0) return fail("invalid-input", "patch 至少需要一个字段。");
  if (kind === "fact") {
    assignments.push("updated_at = ?");
    params.push(new Date().toISOString());
    storage.sqlite.prepare(`UPDATE narrative_fact SET ${assignments.join(", ")} WHERE book_id = ? AND id = ?`).run(...params, bookId, id);
  } else {
    storage.sqlite.prepare(`UPDATE narrative_event SET ${assignments.join(", ")} WHERE book_id = ? AND id = ?`).run(...params, bookId, id);
  }
  const updated = getEntry(storage, bookId, kind, id);
  return ok(`已更新 ${kind}:${id}。`, { entry: { ...updated, kind, id }, audit: { reason, before: toEntry(kind, before as any) } });
}

export async function handleMemoryDelete(input: MemoryDeleteInput): Promise<ToolResult> {
  const bookId = requireBookId(input);
  if (isToolResult(bookId)) return bookId;
  const kind = parseKind(input.kind);
  if (isToolResult(kind) || !kind) return kind || fail("invalid-kind", "kind 必填。");
  if (!isWritableKind(kind)) return fail("forbidden", "memory.delete 仅允许删除 fact 或 event。");
  const id = String(input.id ?? "").trim();
  const reason = String(input.reason ?? "").trim();
  if (!id || !reason) return fail("invalid-input", "memory.delete 需要 id 和 reason。");
  const storage = getStorage();
  const before = getEntry(storage, bookId, kind, id);
  if (!before) return fail("not-found", `未找到 ${kind}:${id}。`);
  storage.sqlite.prepare(`DELETE FROM ${kind === "fact" ? "narrative_fact" : "narrative_event"} WHERE book_id = ? AND id = ?`).run(bookId, id);
  return ok(`已删除 ${kind}:${id}。`, { deleted: { kind, id }, audit: { reason, before: toEntry(kind, before as any) } });
}

function normalizeIds(ids: readonly string[] | undefined): string[] {
  return Array.from(new Set((ids ?? []).map((id) => String(id).trim()).filter(Boolean)));
}

function hasEventFilter(filter: MemoryFilter | undefined): boolean {
  if (!filter) return false;
  return Boolean(filter.status || filter.category || filter.query || (filter.ids && filter.ids.length > 0) || (filter.chapterRange && filter.chapterRange.length >= 2));
}

function invalidFilterKeys(kind: Extract<MemoryEntryKind, "fact" | "event">, filter: MemoryFilter | undefined): string[] {
  if (!filter) return [];
  const invalid: string[] = [];
  if (kind === "fact" && filter.status) invalid.push("status");
  if (kind === "event" && filter.layer) invalid.push("layer");
  return invalid;
}

async function shouldCloseSupersededFacts(input: MemoryBaseInput): Promise<boolean> {
  if (!input.bookRoot?.trim()) return true;
  try {
    return (await loadNarrativeMemoryConfig(input.bookId, input.bookRoot)).ledger.closeSupersededFacts;
  } catch {
    // Keep lifecycle convergence enabled if the trusted config is temporarily unreadable.
    return true;
  }
}

function resolveEventIds(storage: StorageDatabase, bookId: string, input: Pick<MemoryBulkApproveInput, "eventIds" | "filter" | "limit">): string[] | ToolFailure {
  const explicitIds = normalizeIds(input.eventIds);
  if (explicitIds.length > 0) return explicitIds;
  const filter = input.filter ?? {};
  const filterIds = normalizeIds(filter.ids);
  if (filterIds.length > 0) return filterIds;
  if (!hasEventFilter(filter)) return fail("invalid-filter", "memory.bulk_approve 必须提供 eventIds 或显式 filter。", { validFilters: ["ids", "status", "category", "chapterRange", "query"] });
  if (filter.layer) return fail("invalid-filter", "memory.bulk_approve 不支持 layer 过滤；请使用 status/category/chapterRange/query/ids。", { invalidFields: ["layer"] });
  const rows = listEvents(storage, { bookId, status: filter.status ?? "pending", category: filter.category, chapterRange: filter.chapterRange, query: filter.query, limit: input.limit ?? 100 });
  return rows.map((event) => event.id);
}

export async function handleMemoryBulkApprove(input: MemoryBulkApproveInput): Promise<ToolResult> {
  const bookId = requireBookId(input);
  if (isToolResult(bookId)) return bookId;
  const reason = String(input.reason ?? "").trim();
  if (!reason) return fail("invalid-input", "memory.bulk_approve 需要 reason。");
  const storage = getStorage();
  const resolvedIds = resolveEventIds(storage, bookId, input);
  if (isToolResult(resolvedIds)) return resolvedIds;
  const ids = resolvedIds.slice(0, clampLimit(input.limit, 100, 200));
  if (ids.length === 0) return fail("invalid-input", "memory.bulk_approve 需要 eventIds 或能匹配事件的 filter。");
  const closeSupersededFacts = await shouldCloseSupersededFacts(input);
  const approved: any[] = [];
  const skipped: any[] = [];
  const failed: any[] = [];
  for (const id of ids) {
    const event = getEvent(storage, bookId, id);
    if (!event) { failed.push({ id, error: "not-found" }); continue; }
    if (event.status !== "pending") { skipped.push({ id, status: event.status, reason: "not-pending" }); continue; }
    const applied = applyNarrativeEvents(storage, bookId, [{ ...event, status: "applied" }], { closeSupersededFacts });
    if (applied.failedEvents.length > 0) {
      failed.push({ id, error: applied.failedEvents[0]?.error ?? "apply-failed" });
      continue;
    }
    updateNarrativeEventStatus(storage, { id, status: "applied" });
    approved.push({ id, applied });
  }
  return ok(`批量批准完成：${approved.length} 成功，${skipped.length} 跳过，${failed.length} 失败。`, { approved, skipped, failed, reason });
}

function hasDeleteFilter(kind: Extract<MemoryEntryKind, "fact" | "event">, filter: MemoryFilter | undefined): boolean {
  if (!filter) return false;
  if (kind === "fact") return Boolean(filter.layer || filter.category || filter.query || (filter.ids && filter.ids.length > 0) || (filter.chapterRange && filter.chapterRange.length >= 2));
  return Boolean(filter.status || filter.category || filter.query || (filter.ids && filter.ids.length > 0) || (filter.chapterRange && filter.chapterRange.length >= 2));
}

export async function handleMemoryBulkDelete(input: MemoryBulkDeleteInput): Promise<ToolResult> {
  const bookId = requireBookId(input);
  if (isToolResult(bookId)) return bookId;
  const kind = parseKind(input.kind);
  if (isToolResult(kind) || !kind) return kind || fail("invalid-kind", "kind 必填。");
  if (!isWritableKind(kind)) return fail("forbidden", "memory.bulk_delete 仅允许删除 fact 或 event。");
  const reason = String(input.reason ?? "").trim();
  if (!reason) return fail("invalid-input", "memory.bulk_delete 需要 reason。");
  const invalidKeys = invalidFilterKeys(kind, input.filter);
  if (invalidKeys.length > 0) return fail("invalid-filter", `filter 字段不适用于 ${kind}：${invalidKeys.join(", ")}。`, { invalidFields: invalidKeys });
  if (!hasDeleteFilter(kind, input.filter)) return fail("invalid-filter", "memory.bulk_delete 必须提供适用于当前 kind 的显式 filter，禁止无条件批删。", { validFilters: kind === "fact" ? ["ids", "layer", "category", "chapterRange", "query"] : ["ids", "status", "category", "chapterRange", "query"] });
  const storage = getStorage();
  const filter = input.filter ?? {};
  const limit = clampLimit(input.limit, 50, 200);
  const ids = normalizeIds(filter.ids);
  const records = ids.length > 0
    ? ids.map((id) => getEntry(storage, bookId, kind, id)).filter((record): record is FactRecord | EventRecord => Boolean(record))
    : kind === "fact"
      ? listFacts(storage, { bookId, kind, layer: filter.layer, category: filter.category, chapterRange: filter.chapterRange, query: filter.query, limit })
      : listEvents(storage, { bookId, kind, status: filter.status, category: filter.category, chapterRange: filter.chapterRange, query: filter.query, limit });
  const deleted: any[] = [];
  const failed: any[] = [];
  for (const record of records.slice(0, limit)) {
    try {
      storage.sqlite.prepare(`DELETE FROM ${kind === "fact" ? "narrative_fact" : "narrative_event"} WHERE book_id = ? AND id = ?`).run(bookId, record.id);
      deleted.push({ kind, id: record.id });
    } catch (error) {
      failed.push({ kind, id: record.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return ok(`批量删除完成：${deleted.length} 成功，${failed.length} 失败。`, { deleted, failed, skipped: [], reason });
}
