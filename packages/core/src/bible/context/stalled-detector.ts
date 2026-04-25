import type { BibleConflictRecord } from "../types.js";
import { createBibleConflictRepository } from "../repositories/conflict-repo.js";
import type { StorageDatabase } from "../../storage/db.js";

export interface StalledConflictWarning {
  conflictId: string;
  name: string;
  lastAdvancedChapter: number;
  currentChapter: number;
  stalledByChapters: number;
  reason: "stalled-conflict";
}

interface ConflictEvolutionNode {
  chapter?: number;
}

function parseEvolutionPath(raw: string): ConflictEvolutionNode[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is ConflictEvolutionNode => typeof item === "object" && item !== null)
      : [];
  } catch {
    return [];
  }
}

export function detectStalledConflict(conflict: BibleConflictRecord, currentChapter: number, threshold = 10): StalledConflictWarning | null {
  if (conflict.resolutionState !== "escalating") return null;
  const path = parseEvolutionPath(conflict.evolutionPathJson);
  const lastAdvancedChapter = path
    .map((node) => node.chapter)
    .filter((chapter): chapter is number => typeof chapter === "number" && Number.isFinite(chapter))
    .at(-1);
  if (lastAdvancedChapter === undefined) return null;
  const stalledByChapters = currentChapter - lastAdvancedChapter;
  if (stalledByChapters <= threshold) return null;
  return {
    conflictId: conflict.id,
    name: conflict.name,
    lastAdvancedChapter,
    currentChapter,
    stalledByChapters,
    reason: "stalled-conflict",
  };
}

export function detectStalledConflicts(conflicts: readonly BibleConflictRecord[], currentChapter: number, threshold = 10): StalledConflictWarning[] {
  return conflicts
    .map((conflict) => detectStalledConflict(conflict, currentChapter, threshold))
    .filter((warning): warning is StalledConflictWarning => warning !== null);
}

export async function getStalledConflicts(storage: StorageDatabase, bookId: string, currentChapter: number, threshold = 10): Promise<StalledConflictWarning[]> {
  const conflicts = await createBibleConflictRepository(storage).listByBook(bookId);
  return detectStalledConflicts(conflicts, currentChapter, threshold);
}
