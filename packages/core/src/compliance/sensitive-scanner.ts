/**
 * Platform-aware sensitive word scanner.
 *
 * Loads JSON dictionaries (common + platform-specific), scans chapter text,
 * and returns hits with positions, context, and severity.
 */

import type {
  SensitiveWord,
  SensitiveHit,
  SensitiveScanResult,
  BookSensitiveScanResult,
  SupportedPlatform,
} from "./types.js";

import commonDict from "./dictionaries/common.json" with { type: "json" };
import qidianDict from "./dictionaries/qidian-extra.json" with { type: "json" };
import jjwxcDict from "./dictionaries/jjwxc-extra.json" with { type: "json" };
import fanqieDict from "./dictionaries/fanqie-extra.json" with { type: "json" };
import qimaoDict from "./dictionaries/qimao-extra.json" with { type: "json" };

const PLATFORM_DICTS: Record<string, ReadonlyArray<SensitiveWord>> = {
  qidian: qidianDict as unknown as SensitiveWord[],
  jjwxc: jjwxcDict as unknown as SensitiveWord[],
  fanqie: fanqieDict as unknown as SensitiveWord[],
  qimao: qimaoDict as unknown as SensitiveWord[],
};

// ---------------------------------------------------------------------------
// Dictionary loading
// ---------------------------------------------------------------------------

export function loadDictionary(
  platform: SupportedPlatform,
  customWords?: ReadonlyArray<SensitiveWord>,
): ReadonlyArray<SensitiveWord> {
  const base = (commonDict as unknown as SensitiveWord[]).filter(
    (w) => platform === "generic" || w.platforms.includes(platform),
  );

  const extra = platform !== "generic" ? (PLATFORM_DICTS[platform] ?? []) : [];

  const custom = customWords ?? [];

  return [...base, ...extra, ...custom];
}

// ---------------------------------------------------------------------------
// Single chapter scan
// ---------------------------------------------------------------------------

const CONTEXT_RADIUS = 30;

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractContext(content: string, offset: number, wordLen: number): string {
  const before = content.slice(Math.max(0, offset - CONTEXT_RADIUS), offset);
  const matched = content.slice(offset, offset + wordLen);
  const after = content.slice(offset + wordLen, offset + wordLen + CONTEXT_RADIUS);
  return `…${before}【${matched}】${after}…`;
}

function getParagraphNumber(content: string, offset: number): number {
  const before = content.slice(0, offset);
  return before.split(/\n\s*\n/g).length;
}

export function scanChapter(
  text: string,
  chapterNumber: number,
  chapterTitle: string,
  dictionary: ReadonlyArray<SensitiveWord>,
  platform: SupportedPlatform = "generic",
): SensitiveScanResult {
  const hitMap = new Map<string, SensitiveHit & { positions: Array<{ offset: number; paragraph: number; context: string }> }>();

  for (const entry of dictionary) {
    const regex = new RegExp(escapeRegExp(entry.word), "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const existing = hitMap.get(entry.word);
      const pos = {
        offset: match.index,
        paragraph: getParagraphNumber(text, match.index),
        context: extractContext(text, match.index, entry.word.length),
      };
      if (existing) {
        existing.positions.push(pos);
        (existing as { count: number }).count += 1;
      } else {
        hitMap.set(entry.word, {
          word: entry.word,
          category: entry.category,
          severity: entry.severity,
          chapterNumber,
          chapterTitle,
          count: 1,
          positions: [pos],
          suggestion: entry.suggestion,
        });
      }
    }
  }

  const hits = Array.from(hitMap.values()) as ReadonlyArray<SensitiveHit>;

  return {
    platform,
    chapterNumber,
    chapterTitle,
    hits,
    blockCount: hits.filter((h) => h.severity === "block").length,
    warnCount: hits.filter((h) => h.severity === "warn").length,
    suggestCount: hits.filter((h) => h.severity === "suggest").length,
  };
}

// ---------------------------------------------------------------------------
// Full book scan
// ---------------------------------------------------------------------------

export interface ChapterInput {
  readonly content: string;
  readonly chapterNumber: number;
  readonly title: string;
}

export function scanBook(
  chapters: ReadonlyArray<ChapterInput>,
  platform: SupportedPlatform,
  customWords?: ReadonlyArray<SensitiveWord>,
): BookSensitiveScanResult {
  const dictionary = loadDictionary(platform, customWords);
  const results = chapters.map((ch) => scanChapter(ch.content, ch.chapterNumber, ch.title, dictionary, platform));

  return {
    platform,
    chapters: results,
    totalBlockCount: results.reduce((s, r) => s + r.blockCount, 0),
    totalWarnCount: results.reduce((s, r) => s + r.warnCount, 0),
    totalSuggestCount: results.reduce((s, r) => s + r.suggestCount, 0),
  };
}
