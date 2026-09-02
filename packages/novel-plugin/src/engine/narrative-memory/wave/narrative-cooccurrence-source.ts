/**
 * 共现图的数据源：把章节事件归一成「记忆 + 标签序列」，供有向共现算法使用。
 *
 * 这是 P1 的核心改动：之前探针里用 `name.includes(k)` 土办法匹配实体，
 * 导致 61 条字典只命中 17 个节点（「薛行之（主角·权威版）」对不上「薛行之」）。
 *
 * 正确做法：复用已有的 `resolveEntity`（精确匹配 canonical + 剥括号 + 显式别名），
 * 宁可漏并不可错并——「陈默」和「陈砚秋」不会被模糊匹配合成一个。
 *
 * 一条「记忆」= 一章。标签序列按该章事件的出场次序（subject 先于 object，
 * 同一章内按事件行序），供序位势能 Φ 使用。
 */

import type { EntityDictionary } from "../entity-dictionary.js";
import { resolveEntity } from "../entity-dictionary.js";
import {
  looksLikeEntity,
  looksLikeEventPhrase,
  splitCompositeName,
} from "../../narrative-taxonomy/entity-name-heuristics.js";
import type { CooccurrenceRecord } from "./directed-cooccurrence.js";
import {
  approximateResiduals,
  buildDirectedCooccurrence,
  NOVEL_ENTITY_SEMANTIC_GAIN,
  type CooccurrenceGraph,
  type SemanticGainConfig,
} from "./directed-cooccurrence.js";

export interface CooccurrenceEventInput {
  readonly id?: string;
  readonly chapterNumber?: number;
  readonly subject?: string;
  readonly object?: string;
}

export interface BuildCooccurrenceFromEventsInput {
  readonly events: readonly CooccurrenceEventInput[];
  readonly dictionary?: EntityDictionary;
  /**
   * 本章提及清单（P2 产出）。有则优先作为标签序列，
   * 事件 subject/object 仅作回落。P2 完成前此字段为空。
   */
  readonly mentionsByChapter?: ReadonlyMap<number, readonly string[]>;
  readonly similarity?: (sourceId: string, targetId: string) => number | undefined;
  readonly gainConfig?: SemanticGainConfig;
  /** true 时用小说实体标定参数；无 similarity 时不调制。 */
  readonly useNovelGain?: boolean;
}

export interface CooccurrenceSourceReport {
  readonly graph: CooccurrenceGraph;
  readonly records: readonly CooccurrenceRecord[];
  readonly resolvedTags: number;
  readonly unresolvedTags: number;
  /** 未命中字典的提及样本，便于排查漏并。 */
  readonly unresolvedSamples: readonly string[];
  /** 有 similarity 回调时 bellGain 才真正调制；否则语义增益未生效。 */
  readonly semanticGainActive: boolean;
}

function toChapter(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * 把一个原始称呼解析成 canonical 标签。
 * 命中字典 → canonicalName；未命中但像实体 → 原文（标 unresolved）。
 * 不像实体（整句话/事件短语）→ 丢弃。
 */
export function resolveTag(
  dictionary: EntityDictionary | undefined,
  rawName: string,
): { tag: string; resolved: boolean } | null {
  const trimmed = rawName.replace(/\s+/gu, " ").trim();
  if (!trimmed) return null;
  const hit = resolveEntity(dictionary, trimmed);
  if (hit) {
    // 伏笔标题是情节，不是共现图上的人/地/物节点
    if (hit.entry.category === "foreshadowing") return null;
    return { tag: hit.entry.canonicalName, resolved: true };
  }
  // 复合主体先拆再各自解析；整段不拆时才走「像不像实体」判断
  const split = splitCompositeName(trimmed);
  if (split.composite) return null; // 调用方应对每个片段单独调
  if (!looksLikeEntity(trimmed)) return null;
  if (looksLikeEventPhrase(trimmed)) return null;
  return { tag: trimmed, resolved: false };
}

/** 从事件列表按章聚合标签序列。同一实体在一章内只保留首次出场位置。 */
export function recordsFromEvents(input: BuildCooccurrenceFromEventsInput): {
  records: CooccurrenceRecord[];
  resolvedTags: number;
  unresolvedTags: number;
  unresolvedSamples: string[];
} {
  const byChapter = new Map<number, { tags: string[]; seen: Set<string> }>();
  let resolvedTags = 0;
  let unresolvedTags = 0;
  const unresolvedSamples: string[] = [];

  const push = (chapter: number, rawName: string) => {
    const split = splitCompositeName(rawName);
    const names = split.composite ? split.names : [rawName];
    for (const name of names) {
      const result = resolveTag(input.dictionary, name);
      if (!result) continue;
      if (result.resolved) resolvedTags += 1;
      else {
        unresolvedTags += 1;
        if (unresolvedSamples.length < 16) unresolvedSamples.push(name);
      }
      const bucket = byChapter.get(chapter) ?? { tags: [], seen: new Set<string>() };
      if (!bucket.seen.has(result.tag)) {
        bucket.seen.add(result.tag);
        bucket.tags.push(result.tag);
      }
      byChapter.set(chapter, bucket);
    }
  };

  // P2 提及清单优先：它是全量出场，事件增量只作回落
  if (input.mentionsByChapter && input.mentionsByChapter.size > 0) {
    for (const [chapter, names] of input.mentionsByChapter) {
      for (const name of names) push(chapter, name);
    }
  } else {
    const ordered = [...input.events]
      .filter((event) => toChapter(event.chapterNumber) !== undefined)
      .sort((left, right) => (toChapter(left.chapterNumber)! - toChapter(right.chapterNumber)!));
    for (const event of ordered) {
      const chapter = toChapter(event.chapterNumber)!;
      if (event.subject) push(chapter, event.subject);
      if (event.object) push(chapter, event.object);
    }
  }

  const records: CooccurrenceRecord[] = [...byChapter.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([chapter, bucket]) => ({
      id: `ch:${chapter}`,
      tagIds: bucket.tags,
      chapterNumber: chapter,
    }));

  return { records, resolvedTags, unresolvedTags, unresolvedSamples };
}

/** 端到端：事件 → 归一标签 → 有向共现图。 */
export function buildCooccurrenceFromEvents(input: BuildCooccurrenceFromEventsInput): CooccurrenceSourceReport {
  const { records, resolvedTags, unresolvedTags, unresolvedSamples } = recordsFromEvents(input);
  const residuals = approximateResiduals(records);
  const graph = buildDirectedCooccurrence({
    records,
    residuals,
    ...(input.similarity ? { similarity: input.similarity } : {}),
    ...(input.similarity && (input.gainConfig || input.useNovelGain)
      ? { gainConfig: input.gainConfig ?? NOVEL_ENTITY_SEMANTIC_GAIN }
      : {}),
  });
  return {
    graph,
    records,
    resolvedTags,
    unresolvedTags,
    unresolvedSamples,
    semanticGainActive: Boolean(input.similarity),
  };
}
