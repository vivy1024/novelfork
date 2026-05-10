import type { StorageDatabase } from "../../storage/db.js";
import type { CoreShiftRecord } from "../types.js";

export interface AnalyzeCoreShiftImpactInput {
  bookId: string;
  targetType: CoreShiftRecord["targetType"];
  targetId: string;
  snapshot?: Record<string, unknown>;
}

export interface CoreShiftImpactAnalysis {
  affectedChapters: number[];
  reasons: Array<{ chapter: number; reason: string }>;
}

function parseJsonArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const object = parsed as Record<string, unknown>;
      return Object.values(object).flatMap((value) => Array.isArray(value) ? value : [value]);
    }
    return [];
  } catch {
    return [];
  }
}

function snapshotTerms(input: AnalyzeCoreShiftImpactInput): string[] {
  const values = Object.values(input.snapshot ?? {}).filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return [input.targetId, ...values];
}

export async function analyzeCoreShiftImpact(storage: StorageDatabase, input: AnalyzeCoreShiftImpactInput): Promise<CoreShiftImpactAnalysis> {
  const affected = new Map<number, string>();
  const terms = snapshotTerms(input);
  const summaries = storage.sqlite.prepare(`
    SELECT "chapter_number", "summary", "key_events_json", "appearing_character_ids_json", "metadata_json"
    FROM "bible_chapter_summary"
    WHERE "book_id" = ? AND "deleted_at" IS NULL
  `).all(input.bookId) as Array<{ chapter_number: number; summary: string; key_events_json: string; appearing_character_ids_json: string; metadata_json: string }>;

  for (const summary of summaries) {
    const refs = [
      ...parseJsonArray(summary.key_events_json),
      ...parseJsonArray(summary.appearing_character_ids_json),
      ...parseJsonArray(summary.metadata_json),
      summary.summary,
    ].map(String);
    if (terms.some((term) => refs.some((ref) => ref.includes(term)))) {
      affected.set(summary.chapter_number, "chapter-summary references target or new snapshot term");
    }
  }

  const conflicts = storage.sqlite.prepare(`
    SELECT "evolution_path_json"
    FROM "bible_conflict"
    WHERE "book_id" = ? AND "deleted_at" IS NULL
  `).all(input.bookId) as Array<{ evolution_path_json: string }>;
  for (const conflict of conflicts) {
    for (const step of parseJsonArray(conflict.evolution_path_json) as Array<{ chapter?: unknown; summary?: unknown }>) {
      if (typeof step.chapter !== "number") continue;
      if (terms.some((term) => String(step.summary ?? "").includes(term))) {
        affected.set(step.chapter, "conflict evolution references target or new snapshot term");
      }
    }
  }

  const arcs = storage.sqlite.prepare(`
    SELECT "key_turning_points_json"
    FROM "bible_character_arc"
    WHERE "book_id" = ? AND "deleted_at" IS NULL
  `).all(input.bookId) as Array<{ key_turning_points_json: string }>;
  for (const arc of arcs) {
    for (const point of parseJsonArray(arc.key_turning_points_json) as Array<{ chapter?: unknown; summary?: unknown }>) {
      if (typeof point.chapter !== "number") continue;
      if (terms.some((term) => String(point.summary ?? "").includes(term))) {
        affected.set(point.chapter, "character arc turning point references target or new snapshot term");
      }
    }
  }

  const affectedChapters = [...affected.keys()].sort((a, b) => a - b);
  return {
    affectedChapters,
    reasons: affectedChapters.map((chapter) => ({ chapter, reason: affected.get(chapter) ?? "affected" })),
  };
}
