/**
 * 层级前情落盘记录（迁移 0042 narrative_arc_summary）：模型据章摘要归纳的卷摘要与全书梗概。
 *
 * 定位：派生记录，不是权威源。权威仍是经纬 chapter-summaries（章摘要）与卷纲；
 * 这里只缓存「模型把一卷几十章摘要压成一段话」的结果，因为这一步不能现场确定性算出。
 *   - 每行记来源章号（source_chapters_json）与输入指纹（来源章摘要的哈希）；
 *     章摘要改了 → 指纹对不上 → 读取时判为过期，召回不用、回填会重算。
 *   - 结算写章摘要时把覆盖该章的行顺手标成 stale，便于列表与回填快速找到；
 *     但过期的最终判定始终以指纹现算为准（作者在经纬里直接改章摘要也能识别）。
 *   - 机器产物一律 needs-review；作者确认后为 confirmed。召回可以用待确认的版本，但卡片要标注。
 *
 * 全书梗概按「截至某卷」存（segment_id = through:<卷 id>）：写第 N 章时只取当时已折叠的那几卷，
 * 不会把后面的卷混进来；最新一行就是全书梗概。
 */

import { createHash } from "node:crypto";

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { ChapterSummaryRow } from "./chapter-summary-source.js";

export type ArcSummaryKind = "volume" | "synopsis";
export type ArcSummaryStatus = "needs-review" | "confirmed" | "stale";

export interface ArcSummaryContent {
  /** 主体摘要（卷摘要 300–450 字；全书梗概 ≤1000 字）。 */
  readonly text: string;
  /** 一句话版本（≤120 字），预算紧时用。 */
  readonly gist: string;
  /** 模型标出的关键章（必须是来源章号的子集），供作者回查原章。 */
  readonly keyChapters: readonly number[];
  /** 全书梗概覆盖的卷 id（按先后）。 */
  readonly volumeIds?: readonly string[];
}

export interface ArcSummaryRecord {
  readonly id: string;
  readonly bookId: string;
  readonly kind: ArcSummaryKind;
  readonly segmentId: string;
  readonly segmentTitle: string;
  readonly chapterFrom: number;
  readonly chapterTo: number;
  readonly sourceChapters: readonly number[];
  readonly inputFingerprint: string;
  readonly content: ArcSummaryContent;
  readonly status: ArcSummaryStatus;
  readonly model?: string;
  readonly generatedAt: number;
  readonly confirmedAt?: number;
}

interface RawArcSummaryRow {
  id: string;
  book_id: string;
  kind: string;
  segment_id: string;
  segment_title: string;
  chapter_from: number;
  chapter_to: number;
  source_chapters_json: string;
  input_fingerprint: string;
  content_json: string;
  status: string;
  model: string | null;
  generated_at: number;
  confirmed_at: number | null;
}

export function synopsisSegmentId(lastVolumeId: string): string {
  return `through:${lastVolumeId}`;
}

export function arcSummaryId(bookId: string, kind: ArcSummaryKind, segmentId: string): string {
  return `arc:${bookId}:${kind}:${segmentId}`;
}

/**
 * 输入指纹：区间内章摘要按章号排序后的（章号 + 摘要正文）哈希。
 * 摘要文字、章的增删都会改变指纹；与条目 updated_at 无关（只改张力分不算过期）。
 */
export function chapterSummaryFingerprint(rows: readonly Pick<ChapterSummaryRow, "chapter" | "summary">[]): string {
  const normalized = [...rows]
    .sort((a, b) => a.chapter - b.chapter)
    .map((row) => `${row.chapter}\u0001${row.summary.replace(/\s+/gu, " ").trim()}`)
    .join("\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 32);
}

export function arcSummaryTableExists(storage: StorageDatabase): boolean {
  return Boolean(
    storage.sqlite.prepare(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'narrative_arc_summary'`).get(),
  );
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try {
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function toRecord(raw: RawArcSummaryRow): ArcSummaryRecord {
  const content = parseJson<Partial<ArcSummaryContent>>(raw.content_json, {});
  const status: ArcSummaryStatus = raw.status === "confirmed" || raw.status === "stale" ? raw.status : "needs-review";
  return {
    id: raw.id,
    bookId: raw.book_id,
    kind: raw.kind === "synopsis" ? "synopsis" : "volume",
    segmentId: raw.segment_id,
    segmentTitle: raw.segment_title,
    chapterFrom: raw.chapter_from,
    chapterTo: raw.chapter_to,
    sourceChapters: parseJson<number[]>(raw.source_chapters_json, []).filter((value) => Number.isInteger(value)),
    inputFingerprint: raw.input_fingerprint,
    content: {
      text: typeof content.text === "string" ? content.text : "",
      gist: typeof content.gist === "string" ? content.gist : "",
      keyChapters: Array.isArray(content.keyChapters) ? content.keyChapters.filter((value) => Number.isInteger(value)) : [],
      ...(Array.isArray(content.volumeIds) ? { volumeIds: content.volumeIds.filter((value) => typeof value === "string") } : {}),
    },
    status,
    ...(raw.model ? { model: raw.model } : {}),
    generatedAt: raw.generated_at,
    ...(raw.confirmed_at !== null && raw.confirmed_at !== undefined ? { confirmedAt: raw.confirmed_at } : {}),
  };
}

const SELECT_COLUMNS = `id, book_id, kind, segment_id, segment_title, chapter_from, chapter_to, source_chapters_json,
  input_fingerprint, content_json, status, model, generated_at, confirmed_at`;

export function listArcSummaries(storage: StorageDatabase, bookId: string, kind?: ArcSummaryKind): ArcSummaryRecord[] {
  if (!arcSummaryTableExists(storage)) return [];
  const rows = kind
    ? storage.sqlite.prepare<RawArcSummaryRow>(`SELECT ${SELECT_COLUMNS} FROM narrative_arc_summary WHERE book_id = ? AND kind = ? ORDER BY chapter_from ASC, chapter_to ASC, id ASC`).all(bookId, kind)
    : storage.sqlite.prepare<RawArcSummaryRow>(`SELECT ${SELECT_COLUMNS} FROM narrative_arc_summary WHERE book_id = ? ORDER BY kind DESC, chapter_from ASC, chapter_to ASC, id ASC`).all(bookId);
  return rows.map(toRecord);
}

export function getArcSummary(storage: StorageDatabase, bookId: string, kind: ArcSummaryKind, segmentId: string): ArcSummaryRecord | undefined {
  if (!arcSummaryTableExists(storage)) return undefined;
  const raw = storage.sqlite.prepare<RawArcSummaryRow>(`SELECT ${SELECT_COLUMNS} FROM narrative_arc_summary WHERE book_id = ? AND kind = ? AND segment_id = ?`).get(bookId, kind, segmentId);
  return raw ? toRecord(raw) : undefined;
}

export interface UpsertArcSummaryInput {
  readonly bookId: string;
  readonly kind: ArcSummaryKind;
  readonly segmentId: string;
  readonly segmentTitle: string;
  readonly chapterFrom: number;
  readonly chapterTo: number;
  readonly sourceChapters: readonly number[];
  readonly inputFingerprint: string;
  readonly content: ArcSummaryContent;
  readonly model?: string;
  readonly generatedAt: number;
}

/** 写入/覆盖一条：重新生成的内容一律回到 needs-review，作者此前的确认不沿用到新内容上。 */
export function upsertArcSummary(storage: StorageDatabase, input: UpsertArcSummaryInput): ArcSummaryRecord {
  const id = arcSummaryId(input.bookId, input.kind, input.segmentId);
  storage.sqlite.prepare(`
    INSERT INTO narrative_arc_summary (
      id, book_id, kind, segment_id, segment_title, chapter_from, chapter_to, source_chapters_json,
      input_fingerprint, content_json, status, model, generated_at, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'needs-review', ?, ?, NULL)
    ON CONFLICT(book_id, kind, segment_id) DO UPDATE SET
      segment_title = excluded.segment_title,
      chapter_from = excluded.chapter_from,
      chapter_to = excluded.chapter_to,
      source_chapters_json = excluded.source_chapters_json,
      input_fingerprint = excluded.input_fingerprint,
      content_json = excluded.content_json,
      status = 'needs-review',
      model = excluded.model,
      generated_at = excluded.generated_at,
      confirmed_at = NULL
  `).run(
    id,
    input.bookId,
    input.kind,
    input.segmentId,
    input.segmentTitle,
    input.chapterFrom,
    input.chapterTo,
    JSON.stringify([...input.sourceChapters]),
    input.inputFingerprint,
    JSON.stringify(input.content),
    input.model ?? null,
    input.generatedAt,
  );
  return getArcSummary(storage, input.bookId, input.kind, input.segmentId)!;
}

/**
 * 作者确认一条。只有 needs-review 的能确认；已标过期的（stale）要先重新生成，返回的记录 status 仍是 stale。
 * 调用方还应先用 isArcSummaryFresh 现算一次指纹，避免确认一条章摘要已改过的旧摘要。
 */
export function confirmArcSummary(storage: StorageDatabase, bookId: string, id: string, now = Date.now()): ArcSummaryRecord | undefined {
  if (!arcSummaryTableExists(storage)) return undefined;
  storage.sqlite.prepare(`
    UPDATE narrative_arc_summary SET status = 'confirmed', confirmed_at = ?
    WHERE book_id = ? AND id = ? AND status = 'needs-review'
  `).run(now, bookId, id);
  const raw = storage.sqlite.prepare<RawArcSummaryRow>(`SELECT ${SELECT_COLUMNS} FROM narrative_arc_summary WHERE book_id = ? AND id = ?`).get(bookId, id);
  return raw ? toRecord(raw) : undefined;
}

/**
 * 某章章摘要变了：覆盖它的卷摘要、以及区间跨过它的全书梗概标成 stale。返回标记行数。
 * 只是加速索引；召回与回填仍以指纹现算为准。confirmed_at 保留，指纹仍一致时可恢复（reviveArcSummary）。
 */
export function markArcSummariesStaleForChapter(storage: StorageDatabase, bookId: string, chapterNumber: number): number {
  if (!arcSummaryTableExists(storage)) return 0;
  return storage.sqlite.prepare(`
    UPDATE narrative_arc_summary SET status = 'stale'
    WHERE book_id = ? AND chapter_from <= ? AND chapter_to >= ? AND status <> 'stale'
  `).run(bookId, chapterNumber, chapterNumber).changes;
}

/**
 * 被标过期、但指纹现算仍一致（章摘要改回原样或只改了张力分）的行恢复原状态：
 * 作者确认过的回到 confirmed，否则回到 needs-review。返回恢复行数。
 */
export function reviveArcSummary(storage: StorageDatabase, bookId: string, id: string): number {
  if (!arcSummaryTableExists(storage)) return 0;
  return storage.sqlite.prepare(`
    UPDATE narrative_arc_summary
    SET status = CASE WHEN confirmed_at IS NOT NULL THEN 'confirmed' ELSE 'needs-review' END
    WHERE book_id = ? AND id = ? AND status = 'stale'
  `).run(bookId, id).changes;
}

/** 区间 [from, to] 内的章摘要（rows 需按章号升序或任意顺序均可）。 */
export function rowsInRange<T extends Pick<ChapterSummaryRow, "chapter">>(rows: readonly T[], from: number, to: number): T[] {
  return rows.filter((row) => row.chapter >= from && row.chapter <= to);
}

/**
 * 一条记录对当前章摘要是否仍有效：区间一致、来源章一致、指纹一致。
 * rows 为该书当前全部可用章摘要（至少覆盖记录区间）。
 */
export function isArcSummaryFresh(
  record: ArcSummaryRecord,
  rows: readonly Pick<ChapterSummaryRow, "chapter" | "summary">[],
  expected: { readonly from: number; readonly to: number },
): boolean {
  if (record.chapterFrom !== expected.from || record.chapterTo !== expected.to) return false;
  if (!record.content.text.trim()) return false;
  const inRange = rowsInRange(rows, expected.from, expected.to);
  if (inRange.length === 0) return false;
  return chapterSummaryFingerprint(inRange) === record.inputFingerprint;
}
