/**
 * 全书叙事结构聚合读模型（Narrative Structure Aggregate Read Model）。
 *
 * 任务书 2 核心产物：一次请求返回全书叙事结构的完整快照。
 * 卷、章、场景、剧情线、挂载关系、伏笔债务、核心实体全部在此层收拢装配。
 * 所有判定口径（如 stalled 停滞判定、伏笔逾期阈值）只定一处，前端面板仅负责纯展示。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import {
  type NarrativeScene,
  type NarrativeStoryline,
  type SceneStorylineMount,
  listMounts,
  listScenes,
  listStorylines,
} from "../narrative-memory/scene-store.js";
import {
  type ForeshadowDebt,
  type ForeshadowJingweiEntryLike,
  buildForeshadowDebts,
} from "./foreshadow-debts.js";

export interface NarrativeVolumeInfo {
  readonly id: string;
  readonly title: string;
  readonly chapterRange: { readonly from: number; readonly to: number };
  readonly status: string;
  readonly goal: string;
  readonly mainlineBeats?: readonly string[];
}

export interface NarrativeChapterInfo {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly tensionScore?: number;
}

export interface NarrativeEntityInfo {
  readonly id: string;
  readonly canonicalName: string;
  readonly entityType: string;
  readonly firstChapter?: number;
  readonly lastChapter?: number;
}

export interface NarrativeStructurePayload {
  readonly ok: true;
  readonly bookId: string;
  readonly currentChapter: number;
  readonly volumes: readonly NarrativeVolumeInfo[];
  readonly chapters: readonly NarrativeChapterInfo[];
  readonly scenes: readonly NarrativeScene[];
  readonly storylines: readonly NarrativeStoryline[];
  readonly mounts: readonly SceneStorylineMount[];
  readonly foreshadows: readonly ForeshadowDebt[];
  readonly entities: readonly NarrativeEntityInfo[];
}

function safeJsonParse<T>(raw: string | null | undefined): T | null {
  if (!raw?.trim()) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * 提取卷大纲信息。
 * 权威源来自经纬 outline 条目的 fields_json.volumes。
 */
function extractVolumes(storage: StorageDatabase, bookId: string): NarrativeVolumeInfo[] {
  try {
    const row = storage.sqlite
      .prepare<{ fields_json: string | null }>(`
        SELECT fields_json FROM story_jingwei_entry
        WHERE book_id = ? AND category IN ('outline', 'outline-volume') AND deleted_at IS NULL
        ORDER BY CASE WHEN title = '卷纲' THEN 0 ELSE 1 END, updated_at DESC
        LIMIT 1
      `)
      .get(bookId);

    if (!row?.fields_json) return [];
    const fields = safeJsonParse<{ volumes?: unknown[] }>(row.fields_json);
    if (!Array.isArray(fields?.volumes)) return [];

    const result: NarrativeVolumeInfo[] = [];
    for (const v of fields.volumes) {
      if (typeof v !== "object" || v === null) continue;
      const rec = v as Record<string, unknown>;
      const id = String(rec.id ?? "");
      const title = String(rec.title ?? "未命名卷");
      const range = (rec.chapterRange && typeof rec.chapterRange === "object")
        ? (rec.chapterRange as { from?: unknown; to?: unknown })
        : null;
      const from = Number(range?.from ?? 1);
      const to = Number(range?.to ?? from);

      const mainlineBeats: string[] = [];
      if (Array.isArray(rec.mainlineBeats)) {
        for (const b of rec.mainlineBeats) {
          if (typeof b === "string" && b.trim()) mainlineBeats.push(b.trim());
          else if (typeof b === "object" && b !== null && "title" in b) {
            mainlineBeats.push(String((b as { title?: unknown }).title ?? ""));
          }
        }
      }

      result.push({
        id: id || `vol-${result.length + 1}`,
        title,
        chapterRange: { from, to },
        status: String(rec.status ?? "planned"),
        goal: String(rec.goal ?? ""),
        ...(mainlineBeats.length > 0 ? { mainlineBeats } : {}),
      });
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * 提取已采纳章节列表及其张力评分。
 */
function extractChapters(storage: StorageDatabase, bookId: string): NarrativeChapterInfo[] {
  try {
    const rows = storage.sqlite
      .prepare<{
        chapter_number: number;
        title: string;
        status: string;
        word_count: number;
      }>(`
        SELECT chapter_number, title, status, length(content) AS word_count
        FROM writing_resource
        WHERE book_id = ? AND type = 'chapter' AND status = 'accepted'
        ORDER BY chapter_number ASC
      `)
      .all(bookId);

    // 尝试联合张力评分
    const tensionScores = new Map<number, number>();
    try {
      const scoreRows = storage.sqlite
        .prepare<{ chapter_number: number; numeric_value: number | null }>(`
          SELECT chapter_number, numeric_value
          FROM narrative_structure_score
          WHERE book_id = ? AND dimension = 'tension' AND chapter_number IS NOT NULL
        `)
        .all(bookId);
      for (const r of scoreRows) {
        if (r.numeric_value !== null && !Number.isNaN(r.numeric_value)) {
          tensionScores.set(r.chapter_number, r.numeric_value);
        }
      }
    } catch {
      // 容错：旧库可能尚未建立 narrative_structure_score 表
    }

    return rows.map((r) => ({
      number: r.chapter_number,
      title: r.title || `第 ${r.chapter_number} 章`,
      status: r.status,
      wordCount: r.word_count,
      ...(tensionScores.has(r.chapter_number) ? { tensionScore: tensionScores.get(r.chapter_number) } : {}),
    }));
  } catch {
    return [];
  }
}

/**
 * 提取伏笔债务。
 */
function extractForeshadows(storage: StorageDatabase, bookId: string, currentChapter: number): ForeshadowDebt[] {
  try {
    const rows = storage.sqlite
      .prepare<{
        id: string;
        title: string;
        fields_json: string | null;
        status: string;
      }>(`
        SELECT id, title, fields_json, status
        FROM story_jingwei_entry
        WHERE book_id = ? AND category IN ('foreshadowing', 'foreshadow') AND deleted_at IS NULL
      `)
      .all(bookId);

    const entries: ForeshadowJingweiEntryLike[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      fields: safeJsonParse<Record<string, unknown>>(r.fields_json),
    }));

    return buildForeshadowDebts(entries, currentChapter);
  } catch {
    return [];
  }
}

/**
 * 提取实体。
 */
function extractEntities(storage: StorageDatabase, bookId: string): NarrativeEntityInfo[] {
  try {
    const rows = storage.sqlite
      .prepare<{
        id: string;
        canonical_name: string;
        entity_type: string;
        first_chapter: number | null;
        last_chapter: number | null;
      }>(`
        SELECT id, canonical_name, entity_type, first_chapter, last_chapter
        FROM narrative_entity
        WHERE book_id = ?
        ORDER BY first_chapter ASC, canonical_name ASC
      `)
      .all(bookId);

    return rows.map((r) => ({
      id: r.id,
      canonicalName: r.canonical_name,
      entityType: r.entity_type,
      ...(r.first_chapter !== null ? { firstChapter: r.first_chapter } : {}),
      ...(r.last_chapter !== null ? { lastChapter: r.last_chapter } : {}),
    }));
  } catch {
    return [];
  }
}

/**
 * 装配全书叙事结构。
 */
export function buildNarrativeStructure(
  storage: StorageDatabase,
  bookId: string,
): NarrativeStructurePayload {
  const chapters = extractChapters(storage, bookId);
  const currentChapter = chapters.length > 0
    ? Math.max(...chapters.map((c) => c.number))
    : 0;

  const volumes = extractVolumes(storage, bookId);
  const scenes = listScenes(storage, bookId);
  const storylines = listStorylines(storage, bookId);
  const mounts = listMounts(storage, bookId);
  const foreshadows = extractForeshadows(storage, bookId, currentChapter);
  const entities = extractEntities(storage, bookId);

  return {
    ok: true,
    bookId,
    currentChapter,
    volumes,
    chapters,
    scenes,
    storylines,
    mounts,
    foreshadows,
    entities,
  };
}
