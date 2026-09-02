/**
 * StoryScope 结构打分子集（从已落库事件/伏笔派生，不跑 304 维论文全量）。
 *
 * 特征 id 对齐 0032 注释口径（EVT_CAU / PLT_MOR），但只算现在能诚实算出的：
 * 因果覆盖、伏笔悬置、触发未回收、时间线是否推进。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { parseCausedBy } from "./causal-resolve.js";
import { ensureNarrativeMemorySchema } from "./storage.js";

export const STRUCTURE_SCORE_MODEL = "storyscope-subset-v1";

export interface StructureScoreRow {
  readonly id: string;
  readonly bookId: string;
  readonly chapterNumber: number | null;
  readonly featureId: string;
  readonly dimension: string;
  readonly value: string;
  readonly numericValue: number;
  readonly deviation: number | null;
  readonly model: string;
  readonly recordedAt: number;
}

export interface StructureScoreInputEvent {
  readonly id: string;
  readonly chapterNumber: number;
  readonly eventType: string;
  readonly causedBy?: readonly string[];
}

export interface StructureScoreInputHook {
  readonly status: string;
  readonly setupChapter?: number | null;
}

export function scoreNarrativeStructure(input: {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly events: readonly StructureScoreInputEvent[];
  readonly foreshadows?: readonly StructureScoreInputHook[];
  readonly now?: number;
}): readonly StructureScoreRow[] {
  const now = input.now ?? Date.now();
  const chapterEvents = input.events.filter((event) => event.chapterNumber === input.chapterNumber);
  const withCause = chapterEvents.filter((event) => (event.causedBy?.length ?? 0) > 0);
  const causalCoverage = chapterEvents.length === 0 ? 0 : withCause.length / chapterEvents.length;

  const hooks = input.foreshadows ?? [];
  const openHooks = hooks.filter((hook) => !["paid_off", "abandoned", "contradicted", "resolved"].includes(hook.status));
  const triggeredOpen = openHooks.filter((hook) => hook.status === "triggered" || hook.status === "paying_off");
  const dangling = openHooks.filter((hook) => {
    const setup = hook.setupChapter;
    return typeof setup === "number" && setup > 0 && input.chapterNumber - setup >= 12;
  });
  const danglingRatio = openHooks.length === 0 ? 0 : dangling.length / openHooks.length;
  const triggeredOpenRatio = openHooks.length === 0 ? 0 : triggeredOpen.length / openHooks.length;
  const timelineAdvanced = chapterEvents.some((event) => event.eventType === "timeline_advanced") ? 1 : 0;

  const rows: StructureScoreRow[] = [
    row(input, "EVT_CAU_002", "event", "causal_coverage", causalCoverage, now, clampDeviation(0.35 - causalCoverage)),
    row(input, "PLT_MOR_002", "plot", "dangling_hook_ratio", danglingRatio, now, clampDeviation(danglingRatio - 0.2)),
    row(input, "PLT_TRG_001", "plot", "triggered_unpaid_ratio", triggeredOpenRatio, now, clampDeviation(triggeredOpenRatio - 0.15)),
    row(input, "EVT_TML_001", "event", "timeline_advanced", timelineAdvanced, now, null),
  ];
  return rows;
}

function clampDeviation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, Number(value.toFixed(4))));
}

function row(
  input: { readonly bookId: string; readonly chapterNumber: number },
  featureId: string,
  dimension: string,
  value: string,
  numericValue: number,
  recordedAt: number,
  deviation: number | null,
): StructureScoreRow {
  return {
    id: `ss:${input.bookId}:${input.chapterNumber}:${featureId}`,
    bookId: input.bookId,
    chapterNumber: input.chapterNumber,
    featureId,
    dimension,
    value,
    numericValue: Number(numericValue.toFixed(4)),
    deviation,
    model: STRUCTURE_SCORE_MODEL,
    recordedAt,
  };
}

interface EventScanRow {
  id: string;
  chapterNumber: number;
  eventType: string;
  causedByJson: string | null;
}

interface HookScanRow {
  status: string;
  setupChapter: number | null;
}

export function loadStructureScoreInputs(storage: StorageDatabase, bookId: string, chapterNumber: number): {
  readonly events: StructureScoreInputEvent[];
  readonly foreshadows: StructureScoreInputHook[];
} {
  ensureNarrativeMemorySchema(storage);
  const eventRows = storage.sqlite.prepare<EventScanRow>(`
    SELECT id, chapter_number AS chapterNumber, event_type AS eventType, caused_by_json AS causedByJson
    FROM narrative_event
    WHERE book_id = ? AND chapter_number = ?
    ORDER BY created_at ASC, id ASC
  `).all(bookId, chapterNumber);
  const hookRows = storage.sqlite.prepare<HookScanRow>(`
    SELECT status, setup_chapter AS setupChapter
    FROM narrative_foreshadow
    WHERE book_id = ?
  `).all(bookId);
  return {
    events: eventRows.map((row) => {
      const causedBy = parseCausedBy(row.causedByJson);
      return {
        id: row.id,
        chapterNumber: row.chapterNumber,
        eventType: row.eventType,
        ...(causedBy.length > 0 ? { causedBy } : {}),
      };
    }),
    foreshadows: hookRows.map((row) => ({
      status: row.status,
      setupChapter: row.setupChapter,
    })),
  };
}

export function persistStructureScores(storage: StorageDatabase, rows: readonly StructureScoreRow[]): number {
  ensureNarrativeMemorySchema(storage);
  const upsert = storage.sqlite.prepare(`
    INSERT INTO narrative_structure_score (
      id, book_id, chapter_number, feature_id, dimension, value, numeric_value, deviation, model, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id, chapter_number, feature_id) DO UPDATE SET
      id = excluded.id,
      dimension = excluded.dimension,
      value = excluded.value,
      numeric_value = excluded.numeric_value,
      deviation = excluded.deviation,
      model = excluded.model,
      recorded_at = excluded.recorded_at
  `);
  const write = storage.sqlite.transaction(() => {
    for (const row of rows) {
      upsert.run(
        row.id,
        row.bookId,
        row.chapterNumber,
        row.featureId,
        row.dimension,
        row.value,
        row.numericValue,
        row.deviation,
        row.model,
        row.recordedAt,
      );
    }
  });
  write();
  return rows.length;
}

export function scoreAndPersistNarrativeStructure(
  storage: StorageDatabase,
  bookId: string,
  chapterNumber: number,
  now = Date.now(),
): readonly StructureScoreRow[] {
  const inputs = loadStructureScoreInputs(storage, bookId, chapterNumber);
  const rows = scoreNarrativeStructure({
    bookId,
    chapterNumber,
    events: inputs.events,
    foreshadows: inputs.foreshadows,
    now,
  });
  persistStructureScores(storage, rows);
  return rows;
}

export function listStructureScores(
  storage: StorageDatabase,
  bookId: string,
  chapterNumber?: number,
): readonly StructureScoreRow[] {
  ensureNarrativeMemorySchema(storage);
  const rows = chapterNumber === undefined
    ? storage.sqlite.prepare<{
      id: string;
      bookId: string;
      chapterNumber: number | null;
      featureId: string;
      dimension: string;
      value: string;
      numericValue: number | null;
      deviation: number | null;
      model: string | null;
      recordedAt: number;
    }>(`
      SELECT id, book_id AS bookId, chapter_number AS chapterNumber, feature_id AS featureId,
             dimension, value, numeric_value AS numericValue, deviation, model, recorded_at AS recordedAt
      FROM narrative_structure_score
      WHERE book_id = ?
      ORDER BY chapter_number ASC, feature_id ASC
    `).all(bookId)
    : storage.sqlite.prepare<{
      id: string;
      bookId: string;
      chapterNumber: number | null;
      featureId: string;
      dimension: string;
      value: string;
      numericValue: number | null;
      deviation: number | null;
      model: string | null;
      recordedAt: number;
    }>(`
      SELECT id, book_id AS bookId, chapter_number AS chapterNumber, feature_id AS featureId,
             dimension, value, numeric_value AS numericValue, deviation, model, recorded_at AS recordedAt
      FROM narrative_structure_score
      WHERE book_id = ? AND chapter_number = ?
      ORDER BY feature_id ASC
    `).all(bookId, chapterNumber);
  return rows.map((row) => ({
    id: row.id,
    bookId: row.bookId,
    chapterNumber: row.chapterNumber,
    featureId: row.featureId,
    dimension: row.dimension,
    value: row.value,
    numericValue: row.numericValue ?? 0,
    deviation: row.deviation,
    model: row.model ?? STRUCTURE_SCORE_MODEL,
    recordedAt: row.recordedAt,
  }));
}
