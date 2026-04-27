import type { BibleConflictRecord } from "../../bible/types.js";
import type {
  ConflictDialecticExtension,
  ConflictResolutionState,
  ConflictTransformation,
} from "./conflict-types.js";

export interface ConflictMapEntry {
  readonly id: string;
  readonly name: string;
  readonly state: ConflictResolutionState | string;
  readonly dialectic: ConflictDialecticExtension | null;
  readonly lastAdvancedChapter: number | null;
}

export interface MainConflictDrift {
  readonly conflictId: string;
  readonly conflictName: string;
  readonly stalledChapters: number;
  readonly lastAdvancedChapter: number;
  readonly currentChapter: number;
}

interface EvolutionNode {
  chapter?: number;
}

function parseEvolutionPath(raw: string): EvolutionNode[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((n): n is EvolutionNode => typeof n === "object" && n !== null)
      : [];
  } catch {
    return [];
  }
}

function parseDialectic(record: BibleConflictRecord): ConflictDialecticExtension | null {
  const sides: [string, string] = (() => {
    try {
      const p = JSON.parse(record.protagonistSideJson) as unknown;
      const a = JSON.parse(record.antagonistSideJson) as unknown;
      return [
        typeof p === "string" ? p : Array.isArray(p) ? (p[0] as string) ?? "" : "",
        typeof a === "string" ? a : Array.isArray(a) ? (a[0] as string) ?? "" : "",
      ];
    } catch {
      return ["", ""];
    }
  })();

  if (!sides[0] && !sides[1]) return null;

  const path = parseEvolutionPath(record.evolutionPathJson);
  const transformations: ConflictTransformation[] = [];
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    if (curr?.chapter !== undefined) {
      transformations.push({
        chapter: curr.chapter,
        fromState: (prev as Record<string, unknown>)?.state as string ?? "unknown",
        toState: (curr as Record<string, unknown>)?.state as string ?? "unknown",
        trigger: (curr as Record<string, unknown>)?.trigger as string ?? "",
      });
    }
  }

  return {
    rank: record.priority <= 1 ? "primary" : "secondary",
    nature: "antagonistic",
    sides,
    transformations,
  };
}

function getLastAdvancedChapter(record: BibleConflictRecord): number | null {
  const path = parseEvolutionPath(record.evolutionPathJson);
  const chapters = path
    .map((n) => n.chapter)
    .filter((c): c is number => typeof c === "number" && Number.isFinite(c));
  return chapters.length > 0 ? chapters[chapters.length - 1]! : null;
}

export function buildConflictMap(conflicts: readonly BibleConflictRecord[]): ConflictMapEntry[] {
  return conflicts.map((c) => ({
    id: c.id,
    name: c.name,
    state: c.resolutionState as ConflictResolutionState,
    dialectic: parseDialectic(c),
    lastAdvancedChapter: getLastAdvancedChapter(c),
  }));
}

/**
 * Detect if the main (primary) conflict has drifted — i.e. not advanced for `threshold` chapters.
 * Default threshold = 5 chapters.
 */
export function detectMainConflictDrift(
  conflicts: readonly BibleConflictRecord[],
  currentChapter: number,
  threshold = 5,
): MainConflictDrift | null {
  const active = conflicts.filter(
    (c) => c.resolutionState !== "resolved" && c.deletedAt === null,
  );

  // Find the primary conflict (lowest priority number)
  const sorted = [...active].sort((a, b) => a.priority - b.priority);
  const primary = sorted[0];
  if (!primary) return null;

  const lastAdvanced = getLastAdvancedChapter(primary);
  if (lastAdvanced === null) return null;

  const stalledChapters = currentChapter - lastAdvanced;
  if (stalledChapters < threshold) return null;

  return {
    conflictId: primary.id,
    conflictName: primary.name,
    stalledChapters,
    lastAdvancedChapter: lastAdvanced,
    currentChapter,
  };
}
