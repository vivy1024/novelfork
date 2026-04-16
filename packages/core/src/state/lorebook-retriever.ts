/**
 * Lorebook Retriever — keyword-triggered context injection for the writing pipeline.
 *
 * Replaces full truth-file injection with precise, entity-matched world entries.
 * Inspired by SillyTavern/NovelCrafter World Info pattern.
 *
 * Flow:
 *   1. Extract terms from chapter text + planner goal + mustKeep list
 *   2. Query MemoryDB.findEntriesByKeywords() for matching world entries
 *   3. Sort by priority, deduplicate, cap token budget
 *   4. Return formatted context entries for Composer injection
 */

import type { MemoryDB, WorldEntry } from "../state/memory-db.js";

export interface LorebookRetrievalInput {
  /** Current chapter text or recent chapter content for term extraction */
  readonly chapterText: string;
  /** Planner goal / intent description */
  readonly goal: string;
  /** Explicit must-keep terms from planner */
  readonly mustKeep: ReadonlyArray<string>;
  /** Max characters of lorebook content to inject */
  readonly maxChars?: number;
}

export interface LorebookEntry {
  readonly source: string;
  readonly reason: string;
  readonly excerpt: string;
  readonly dimension: string;
  readonly priority: number;
}

export interface LorebookRetrievalResult {
  readonly entries: ReadonlyArray<LorebookEntry>;
  readonly totalMatched: number;
  readonly totalChars: number;
  readonly truncated: boolean;
}

const DEFAULT_MAX_CHARS = 8000;

/**
 * Extract meaningful terms from text for keyword matching.
 * Handles both Chinese and English text.
 */
export function extractTerms(
  chapterText: string,
  goal: string,
  mustKeep: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const raw = new Set<string>();

  // Add explicit must-keep terms
  for (const term of mustKeep) {
    const trimmed = term.trim();
    if (trimmed.length > 0) raw.add(trimmed);
  }

  // Extract Chinese names and terms (2-4 char sequences between common delimiters)
  const chinesePattern = /[\u4e00-\u9fff]{2,6}/g;
  const combined = `${goal}\n${chapterText}`;
  for (const match of combined.matchAll(chinesePattern)) {
    raw.add(match[0]);
  }

  // Extract capitalized English words (proper nouns)
  const englishPattern = /\b[A-Z][a-z]{2,}\b/g;
  for (const match of combined.matchAll(englishPattern)) {
    raw.add(match[0]);
  }

  // Filter out very common Chinese words that aren't useful for matching
  const stopWords = new Set([
    "一个", "这个", "那个", "什么", "怎么", "可以", "已经", "但是",
    "因为", "所以", "如果", "虽然", "不过", "而且", "或者", "就是",
    "他们", "我们", "自己", "没有", "不是", "这样", "那样", "知道",
  ]);

  return [...raw].filter((term) => !stopWords.has(term));
}

/**
 * Retrieve matching lorebook entries for the current writing context.
 */
export function retrieveLorebook(
  db: MemoryDB,
  input: LorebookRetrievalInput,
): LorebookRetrievalResult {
  const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
  const terms = extractTerms(input.chapterText, input.goal, input.mustKeep);

  if (terms.length === 0) {
    return { entries: [], totalMatched: 0, totalChars: 0, truncated: false };
  }

  const matched = db.findEntriesByKeywords(terms);
  const totalMatched = matched.length;

  // Sort by priority descending, then by name
  const sorted = [...matched].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.name.localeCompare(b.name);
  });

  // Deduplicate by name+dimension
  const seen = new Set<string>();
  const unique: WorldEntry[] = [];
  for (const entry of sorted) {
    const key = `${entry.dimension}:${entry.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(entry);
    }
  }

  // Cap by character budget
  let totalChars = 0;
  let truncated = false;
  const result: LorebookEntry[] = [];

  for (const entry of unique) {
    const entryChars = entry.content.length + entry.name.length + 20;
    if (totalChars + entryChars > maxChars) {
      truncated = true;
      break;
    }
    totalChars += entryChars;
    result.push({
      source: `lorebook/${entry.dimension}/${entry.name}`,
      reason: `World info entry matched by keyword (priority ${entry.priority}).`,
      excerpt: entry.content,
      dimension: entry.dimension,
      priority: entry.priority,
    });
  }

  return { entries: result, totalMatched, totalChars, truncated };
}

/**
 * Format lorebook entries into a prompt-ready string.
 * Groups entries by dimension for readability.
 */
export function formatLorebookForPrompt(
  entries: ReadonlyArray<LorebookEntry>,
): string {
  if (entries.length === 0) return "";

  const byDimension = new Map<string, LorebookEntry[]>();
  for (const entry of entries) {
    const list = byDimension.get(entry.dimension) ?? [];
    list.push(entry);
    byDimension.set(entry.dimension, list);
  }

  const sections: string[] = [];
  for (const [dimension, dimEntries] of byDimension) {
    const items = dimEntries
      .map((e) => `- **${e.source.split("/").pop()}**: ${e.excerpt}`)
      .join("\n");
    sections.push(`### ${dimension}\n${items}`);
  }

  return `## World Info (Lorebook)\n\n${sections.join("\n\n")}`;
}
