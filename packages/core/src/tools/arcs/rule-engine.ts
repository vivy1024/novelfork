import type { ArcBeat, ArcBeatDirection } from "./arc-types.js";

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

const GROWTH_KEYWORDS = [
  "觉醒", "突破", "领悟", "成长", "和解", "释然", "蜕变", "顿悟",
  "救助", "牺牲", "保护", "结盟", "胜利", "获得",
];

const REGRESSION_KEYWORDS = [
  "堕落", "崩溃", "背叛", "失控", "绝望", "沉沦", "迷失", "杀害",
  "抛弃", "逃跑", "失败", "失去", "被困",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CharacterInput {
  readonly id: string;
  readonly name: string;
  readonly aliases?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split content into paragraphs (by double newline or single newline).
 */
function splitParagraphs(content: string): string[] {
  return content.split(/\n{1,2}/).filter((p) => p.trim().length > 0);
}

/**
 * Check if a paragraph mentions a character (by name or alias).
 */
function mentionsCharacter(paragraph: string, character: CharacterInput): boolean {
  if (paragraph.includes(character.name)) return true;
  if (character.aliases) {
    for (const alias of character.aliases) {
      if (alias && paragraph.includes(alias)) return true;
    }
  }
  return false;
}

/**
 * Detect direction from a paragraph based on keyword presence.
 * Returns the direction and the matched keyword.
 */
function detectDirection(paragraph: string): { direction: ArcBeatDirection; keyword: string } | null {
  // Check growth first
  for (const kw of GROWTH_KEYWORDS) {
    if (paragraph.includes(kw)) {
      return { direction: "advance", keyword: kw };
    }
  }
  // Then regression
  for (const kw of REGRESSION_KEYWORDS) {
    if (paragraph.includes(kw)) {
      return { direction: "regression", keyword: kw };
    }
  }
  return null;
}

/**
 * Generate a summary for the beat.
 */
function buildSummary(characterName: string, keyword: string, direction: ArcBeatDirection): string {
  const dirLabel = direction === "advance" ? "正向推进" : "回退";
  return `${characterName}：${keyword}（${dirLabel}）`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Extract arc beats from chapter content using rule-based keyword matching.
 * Returns at most 1 beat per character per chapter.
 */
export function extractBeatsFromChapter(
  content: string,
  characters: CharacterInput[],
  chapterNumber: number = 1,
): ArcBeat[] {
  if (!content || characters.length === 0) return [];

  const paragraphs = splitParagraphs(content);
  const beats: ArcBeat[] = [];
  const seenCharacters = new Set<string>();

  for (const paragraph of paragraphs) {
    for (const character of characters) {
      // Skip if we already have a beat for this character
      if (seenCharacters.has(character.id)) continue;

      if (!mentionsCharacter(paragraph, character)) continue;

      const result = detectDirection(paragraph);
      if (!result) continue;

      seenCharacters.add(character.id);
      beats.push({
        chapter: chapterNumber,
        event: buildSummary(character.name, result.keyword, result.direction),
        change: result.keyword,
        direction: result.direction,
        source: "auto-rule",
        confidence: 0.6,
      });
    }

    // Early exit if all characters have beats
    if (seenCharacters.size === characters.length) break;
  }

  return beats;
}
