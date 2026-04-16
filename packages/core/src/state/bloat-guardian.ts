/**
 * bloat-guardian.ts — Detect unused/stale world entries by scanning recent chapters.
 *
 * "设定膨胀 = 质量崩坏" — flags entries whose keywords never appear in recent text.
 */

import { MemoryDB, type WorldEntry } from "./memory-db.js";

export interface BloatEntry {
  readonly id: number;
  readonly dimension: string;
  readonly name: string;
  readonly keywords: string;
  readonly lastSeenChapter: number | null;
  readonly severity: "stale" | "unused";
}

export interface BloatReport {
  readonly totalEntries: number;
  readonly staleEntries: ReadonlyArray<BloatEntry>;
  readonly unusedEntries: ReadonlyArray<BloatEntry>;
  readonly healthScore: number; // 0-100, higher = healthier
  readonly analyzedChapters: number;
}

export interface BloatGuardianInput {
  readonly db: MemoryDB;
  readonly chapterTexts: ReadonlyArray<{ chapter: number; text: string }>;
  readonly staleThreshold?: number; // chapters since last seen to be "stale" (default 20)
}

/**
 * Analyze all world entries against recent chapter texts.
 * Entries whose keywords never appear → "unused".
 * Entries last seen > staleThreshold chapters ago → "stale".
 */
export function analyzeBloat(input: BloatGuardianInput): BloatReport {
  const { db, chapterTexts, staleThreshold = 20 } = input;
  const allEntries = db.getAllEntriesUnfiltered();
  if (allEntries.length === 0) {
    return { totalEntries: 0, staleEntries: [], unusedEntries: [], healthScore: 100, analyzedChapters: chapterTexts.length };
  }

  const sorted = [...chapterTexts].sort((a, b) => a.chapter - b.chapter);
  const latestChapter = sorted.at(-1)?.chapter ?? 0;
  const combined = sorted.map((c) => c.text.toLowerCase()).join("\n");

  const stale: BloatEntry[] = [];
  const unused: BloatEntry[] = [];

  for (const entry of allEntries) {
    const tokens = extractMatchTokens(entry);
    if (tokens.length === 0) {
      unused.push(toBloatEntry(entry, null, "unused"));
      continue;
    }

    const lastSeen = findLastSeenChapter(tokens, sorted);
    if (lastSeen === null) {
      // Check if any token appears anywhere in combined text
      const anyMatch = tokens.some((t) => combined.includes(t));
      if (!anyMatch) {
        unused.push(toBloatEntry(entry, null, "unused"));
      } else {
        // appeared somewhere but findLastSeen missed (shouldn't happen, but safe)
        stale.push(toBloatEntry(entry, null, "stale"));
      }
    } else if (latestChapter - lastSeen >= staleThreshold) {
      stale.push(toBloatEntry(entry, lastSeen, "stale"));
    }
  }

  const problemCount = stale.length + unused.length;
  const healthScore = Math.round(
    Math.max(0, 100 - (problemCount / allEntries.length) * 100),
  );

  return {
    totalEntries: allEntries.length,
    staleEntries: stale,
    unusedEntries: unused,
    healthScore,
    analyzedChapters: chapterTexts.length,
  };
}

function extractMatchTokens(entry: WorldEntry): string[] {
  const tokens: string[] = [];
  if (entry.name.trim()) tokens.push(entry.name.trim().toLowerCase());
  for (const kw of entry.keywords.split(",")) {
    const t = kw.trim().toLowerCase();
    if (t.length > 0) tokens.push(t);
  }
  return [...new Set(tokens)];
}

function findLastSeenChapter(
  tokens: string[],
  chapters: ReadonlyArray<{ chapter: number; text: string }>,
): number | null {
  for (let i = chapters.length - 1; i >= 0; i--) {
    const lower = chapters[i]!.text.toLowerCase();
    if (tokens.some((t) => lower.includes(t))) {
      return chapters[i]!.chapter;
    }
  }
  return null;
}

function toBloatEntry(
  entry: WorldEntry,
  lastSeen: number | null,
  severity: "stale" | "unused",
): BloatEntry {
  return {
    id: entry.id ?? 0,
    dimension: entry.dimension,
    name: entry.name,
    keywords: entry.keywords,
    lastSeenChapter: lastSeen,
    severity,
  };
}
