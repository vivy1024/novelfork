import type { StorageDatabase } from "../../storage/db.js";
import type { ArcBeat, CharacterArc } from "./arc-types.js";
import { extractBeatsFromChapter, type CharacterInput } from "./rule-engine.js";
import { refineBeatsWithLlm } from "./llm-refiner.js";
import { detectArcInconsistency, detectStagnantArc } from "./character-arc-tracker.js";
import { createBibleCharacterRepository } from "../../bible/repositories/character-repo.js";
import { createBibleCharacterArcRepository } from "../../bible/repositories/character-arc-repo.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ArcTrackingMode = "off" | "rule" | "llm";

export interface SyncCharacterArcsParams {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly chapterContent: string;
  readonly mode: ArcTrackingMode;
  readonly storage: StorageDatabase;
}

export interface SyncCharacterArcsResult {
  readonly beats: ArcBeat[];
  readonly warnings: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAliases(aliasesJson: string): string[] {
  try {
    const parsed = JSON.parse(aliasesJson);
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === "string") : [];
  } catch {
    return [];
  }
}

function parseKeyTurningPoints(json: string): ArcBeat[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ArcBeat =>
        item && typeof item === "object" && typeof item.chapter === "number",
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Synchronize character arcs after a chapter is written.
 * 1. Load registered characters
 * 2. Run rule engine to extract beats
 * 3. Optionally refine with LLM
 * 4. Deduplicate (skip if beat already exists for this chapter+character)
 * 5. Write new beats to bible_character_arc table
 * 6. Run detection tools and collect warnings
 */
export async function syncCharacterArcs(params: SyncCharacterArcsParams): Promise<SyncCharacterArcsResult> {
  const { bookId, chapterNumber, chapterContent, mode, storage } = params;

  if (mode === "off") {
    return { beats: [], warnings: [] };
  }

  // 1. Load registered characters
  const characterRepo = createBibleCharacterRepository(storage);
  const characters = await characterRepo.listByBook(bookId);

  if (characters.length === 0) {
    return { beats: [], warnings: [] };
  }

  const characterInputs: CharacterInput[] = characters.map((c) => ({
    id: c.id,
    name: c.name,
    aliases: parseAliases(c.aliasesJson),
  }));

  // 2. Run rule engine
  let beats = extractBeatsFromChapter(chapterContent, characterInputs, chapterNumber);

  // 3. Optionally refine with LLM
  if (mode === "llm" && beats.length > 0) {
    beats = await refineBeatsWithLlm(chapterContent, characterInputs, beats);
  }

  if (beats.length === 0) {
    return { beats: [], warnings: [] };
  }

  // 4. Deduplicate & write to DB
  const arcRepo = createBibleCharacterArcRepository(storage);
  const allArcs = await arcRepo.listByBook(bookId);
  const warnings: string[] = [];

  // Build a map: characterId -> arc record
  const characterArcMap = new Map<string, typeof allArcs[number]>();
  for (const arc of allArcs) {
    characterArcMap.set(arc.characterId, arc);
  }

  const newBeats: ArcBeat[] = [];

  for (const beat of beats) {
    // Find which character this beat belongs to
    const matchedChar = characterInputs.find((c) => beat.event.startsWith(c.name));
    if (!matchedChar) continue;

    const existingArc = characterArcMap.get(matchedChar.id);
    if (!existingArc) continue;

    // Check for duplicate: same chapter + same character
    const existingBeats = parseKeyTurningPoints(existingArc.keyTurningPointsJson);
    const alreadyHasBeat = existingBeats.some(
      (b) => b.chapter === chapterNumber,
    );
    if (alreadyHasBeat) continue;

    // Append beat to existing turning points
    const updatedBeats = [...existingBeats, beat];
    const now = new Date();

    await arcRepo.update(bookId, existingArc.id, {
      keyTurningPointsJson: JSON.stringify(updatedBeats),
      updatedAt: now,
    });

    newBeats.push(beat);
  }

  // 5. Run detection tools
  const updatedArcs = await arcRepo.listByBook(bookId);
  for (const arcRecord of updatedArcs) {
    const arcBeats = parseKeyTurningPoints(arcRecord.keyTurningPointsJson);
    if (arcBeats.length === 0) continue;

    const arc: CharacterArc = {
      characterId: arcRecord.characterId,
      arcType: arcRecord.arcType as CharacterArc["arcType"],
      startPoint: arcRecord.startingState,
      endPoint: arcRecord.endingState,
      currentPhase: arcRecord.currentPosition,
      beats: arcBeats,
    };

    const inconsistency = detectArcInconsistency(arc);
    if (inconsistency) {
      warnings.push(inconsistency.message);
    }

    const stagnant = detectStagnantArc(arc, chapterNumber);
    if (stagnant) {
      warnings.push(stagnant.message);
    }
  }

  return { beats: newBeats, warnings };
}
