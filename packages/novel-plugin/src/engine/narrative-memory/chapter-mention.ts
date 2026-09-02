/**
 * 本章提及清单：共现图要的是「谁在这一章出现过」，不是增量事件。
 *
 * 来源并集（去重保序）：
 *   1. 字典扫描正文（确定性，零 LLM）
 *   2. 本章事件的 subject/object（增量抽取的副产品）
 *   3. LLM 额外列出的 mentionedEntities（补字典漏网）
 *
 * 伏笔标题、事件短语不进清单。宁可漏并不可错并。
 */

import { resolveEntity, type EntityDictionary } from "./entity-dictionary.js";
import { looksLikeEntity, looksLikeEventPhrase, splitCompositeName } from "../narrative-taxonomy/narrative-graph.js";

export type ChapterMentionSource = "dictionary" | "event" | "llm";

export interface ChapterMention {
  readonly name: string;
  readonly entryId?: string;
  readonly position: number;
  readonly source: ChapterMentionSource;
}

const LLM_POSITION_BASE = 2_000_000;
const EVENT_POSITION_BASE = 1_000_000;

function isForeshadow(dictionary: EntityDictionary | undefined, name: string): boolean {
  const hit = resolveEntity(dictionary, name);
  return hit?.entry.category === "foreshadowing";
}

function canonicalMention(
  dictionary: EntityDictionary | undefined,
  rawName: string,
): { name: string; entryId?: string } | null {
  const trimmed = rawName.replace(/\s+/gu, " ").trim();
  if (!trimmed) return null;
  const hit = resolveEntity(dictionary, trimmed);
  if (hit) {
    if (hit.entry.category === "foreshadowing") return null;
    return { name: hit.entry.canonicalName, entryId: hit.entry.entryId };
  }
  const split = splitCompositeName(trimmed);
  if (split.composite) return null;
  if (!looksLikeEntity(trimmed) || looksLikeEventPhrase(trimmed)) return null;
  return { name: trimmed };
}

/** 用实体字典扫正文，按首次出现位置排序。长 key 优先，避免短别名抢匹配。 */
export function scanDictionaryMentions(
  content: string,
  dictionary: EntityDictionary | undefined,
): ChapterMention[] {
  if (!dictionary || dictionary.entries.length === 0 || !content) return [];
  const candidates = dictionary.entries
    .filter((entry) => entry.category !== "foreshadowing")
    .flatMap((entry) =>
      entry.lookupKeys
        .filter((key) => key.trim().length >= 2)
        .map((key) => ({ key: key.trim(), entry })),
    )
    .sort((left, right) => right.key.length - left.key.length || left.key.localeCompare(right.key, "zh"));

  const hits = new Map<string, ChapterMention>();
  for (const { key, entry } of candidates) {
    if (hits.has(entry.canonicalName)) continue;
    const position = content.indexOf(key);
    if (position < 0) continue;
    hits.set(entry.canonicalName, {
      name: entry.canonicalName,
      entryId: entry.entryId,
      position,
      source: "dictionary",
    });
  }
  return [...hits.values()].sort((left, right) => left.position - right.position || left.name.localeCompare(right.name, "zh"));
}

export function mentionsFromNames(
  names: readonly string[],
  dictionary: EntityDictionary | undefined,
  source: ChapterMentionSource,
  content?: string,
  positionBase = 0,
): ChapterMention[] {
  const out: ChapterMention[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of names.entries()) {
    const split = splitCompositeName(raw);
    const parts = split.composite ? split.names : [raw];
    for (const part of parts) {
      const resolved = canonicalMention(dictionary, part);
      if (!resolved || seen.has(resolved.name) || isForeshadow(dictionary, resolved.name)) continue;
      seen.add(resolved.name);
      const inText = content ? content.indexOf(resolved.name) : -1;
      out.push({
        name: resolved.name,
        ...(resolved.entryId ? { entryId: resolved.entryId } : {}),
        position: inText >= 0 ? inText : positionBase + index,
        source,
      });
    }
  }
  return out;
}

/** 多来源合并：同名保留更早的位置；补上缺失的 entryId。 */
export function mergeChapterMentions(parts: readonly (readonly ChapterMention[])[]): ChapterMention[] {
  const byName = new Map<string, ChapterMention>();
  for (const list of parts) {
    for (const mention of list) {
      const existing = byName.get(mention.name);
      if (!existing) {
        byName.set(mention.name, mention);
        continue;
      }
      const earlier = mention.position < existing.position
        ? mention
        : existing;
      const later = earlier === mention ? existing : mention;
      byName.set(mention.name, {
        ...earlier,
        ...(earlier.entryId ? {} : later.entryId ? { entryId: later.entryId } : {}),
      });
    }
  }
  return [...byName.values()].sort((left, right) => left.position - right.position || left.name.localeCompare(right.name, "zh"));
}

export function collectChapterMentions(input: {
  readonly content: string;
  readonly dictionary?: EntityDictionary;
  readonly eventNames?: readonly string[];
  readonly llmNames?: readonly string[];
}): ChapterMention[] {
  return mergeChapterMentions([
    scanDictionaryMentions(input.content, input.dictionary),
    mentionsFromNames(input.eventNames ?? [], input.dictionary, "event", input.content, EVENT_POSITION_BASE),
    mentionsFromNames(input.llmNames ?? [], input.dictionary, "llm", input.content, LLM_POSITION_BASE),
  ]);
}

export function parseMentionedEntityNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = typeof item === "string" ? item.trim() : "";
    if (!text || seen.has(text)) continue;
    seen.add(text);
    names.push(text);
  }
  return names;
}
