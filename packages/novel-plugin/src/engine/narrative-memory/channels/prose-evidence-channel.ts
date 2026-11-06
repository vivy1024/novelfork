/**
 * 原文证据通道：按本章要出场的实体与蓝图/章纲里的关键词，从「近章窗口之前」的章节正文里
 * 捞出少量原文段落（默认最多 3 段、合计 ≤1200 字），补摘要与经纬都没记下的细节。
 *
 * - 只读章节文件（唯一权威源），索引见 chapter-passage-index.ts；索引过期时在时间预算内增量补建。
 * - 命中必须是字面命中：点名实体原样出现，或与蓝图文本共享 ≥3 字的连续片段；全书到处都是的词
 *   （主角名、常用语）不单独算证据，避免每次都捞出主角随便出场的一段。
 * - 与事实去重：段落里已经包含某条同章事实的证据原文时，这段不再重复注入。
 * - 卡片挂在自己的 prose-evidence 通道，预算由 budget.ts 统一分配，可降档（片段越截越短）、可丢弃。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { SceneSpec } from "../../../handlers/scene-spec-handler.js";
import { estimateTokens } from "../../jingwei/context/token-budget.js";
import type { NarrativeRetrievalChannel } from "../channels.js";
import {
  buildPassageSnippet,
  ensureBookPassageIndexFresh,
  passageBigramPhrases,
  passageContains,
  passageQueryTerms,
  readPassageTexts,
  searchPassageCandidates,
  sharedCjkPhrases,
  type PassageText,
} from "../chapter-passage-index.js";
import { NarrativeContextCardSchema, type NarrativeContextCard } from "../types.js";

export const DEFAULT_PROSE_EVIDENCE_MAX_PASSAGES = 3;
export const DEFAULT_PROSE_EVIDENCE_MAX_CHARS = 1200;
/** 近章窗口：这几章由近章摘要、前章末尾覆盖，不再从原文里捞。 */
export const DEFAULT_PROSE_EVIDENCE_RECENT_WINDOW = 5;

export interface ProseEvidenceChannelInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  /** 没有书根目录（读不到章节文件）时通道跳过。 */
  readonly bookRoot?: string;
  readonly currentChapter?: number;
  readonly sceneSpec?: SceneSpec;
  readonly sceneText?: string;
  readonly entities?: readonly string[];
  readonly maxPassages?: number;
  readonly maxChars?: number;
  readonly recentWindow?: number;
  /** 本通道的 token 预算（budget.ts 现算）；字数上限取它与 maxChars 的较小者。 */
  readonly budgetTokens?: number;
  /** 本次补建索引的时间预算（毫秒），缺省 800。 */
  readonly indexBudgetMs?: number;
}

function uniqueStrings(values: readonly (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function sceneSpecText(sceneSpec?: SceneSpec): string {
  if (!sceneSpec) return "";
  return [
    sceneSpec.title,
    ...sceneSpec.scenes.flatMap((scene) => [scene.location, scene.conflict, scene.outcome, ...(scene.hooks_used ?? []), ...(scene.hooks_planted ?? [])]),
    ...(sceneSpec.constraints ?? []),
  ].filter(Boolean).join("\n");
}

function sceneEntities(sceneSpec?: SceneSpec): string[] {
  return sceneSpec?.scenes.flatMap((scene) => [...(scene.characters ?? []), scene.location, ...(scene.hooks_used ?? []), ...(scene.hooks_planted ?? [])]) ?? [];
}

/** 同章事实的证据原文：段落已包含它，说明这段信息已经以事实形式注入。 */
function loadFactEvidence(storage: StorageDatabase, bookId: string, chapters: readonly number[]): Map<number, string[]> {
  const result = new Map<number, string[]>();
  if (chapters.length === 0) return result;
  try {
    const rows = storage.sqlite.prepare(`
      SELECT source_chapter AS chapter, evidence_text AS evidence
      FROM narrative_fact
      WHERE book_id = ? AND source_chapter IN (${chapters.map(() => "?").join(",")})
        AND evidence_text IS NOT NULL AND length(evidence_text) >= 6
    `).all(bookId, ...chapters) as Array<{ chapter: number; evidence: string }>;
    for (const row of rows) {
      const list = result.get(row.chapter) ?? [];
      list.push(row.evidence.trim());
      result.set(row.chapter, list);
    }
  } catch {
    // 事实表还没建：没有可去重的事实。
  }
  return result;
}

interface ScoredPassage {
  readonly passage: PassageText;
  readonly hits: readonly string[];
  readonly score: number;
}

/** 片段里给命中词加的【】与首尾省略号也占字数：先估出这部分再截正文。 */
function markupOverhead(text: string, hits: readonly string[]): number {
  const occurrences = hits.reduce((sum, term) => sum + Math.min(6, text.split(term).length - 1), 0);
  return Math.min(24, occurrences * 2) + 2;
}

function cardFor(input: ProseEvidenceChannelInput, scored: ScoredPassage, perCardChars: number): NarrativeContextCard {
  const { passage, hits } = scored;
  const bodyChars = Math.max(20, perCardChars - markupOverhead(passage.text, hits));
  const full = buildPassageSnippet(passage.text, passage.startOffset, hits, bodyChars);
  const normal = buildPassageSnippet(passage.text, passage.startOffset, hits, Math.max(80, Math.floor(perCardChars / 2)));
  const summary = buildPassageSnippet(passage.text, passage.startOffset, hits, 80);
  const brief = buildPassageSnippet(passage.text, passage.startOffset, hits, 40);
  const label = `原文证据·第${passage.chapterNumber}章`;
  const pointer = `（第${passage.chapterNumber}章原文，chapter.read offset=${full.offset} limit=${full.length}）`;
  const content = `${full.snippet}\n${pointer}`;
  return NarrativeContextCardSchema.parse({
    id: `chapter-text:${input.bookId}:${passage.chapterNumber}:${passage.startOffset}`,
    bookId: input.bookId,
    sourceType: "chapter-text",
    sourceId: `${passage.chapterNumber}:${passage.startOffset}-${passage.endOffset}`,
    channel: "prose-evidence",
    title: label,
    content,
    normal: `${normal.snippet}\n${pointer}`,
    summary: `${summary.snippet}${pointer}`,
    brief: `第${passage.chapterNumber}章：${brief.snippet}`,
    tags: ["prose-evidence", "chapter-text"],
    entities: [...hits],
    priority: 45,
    importance: 40,
    accessCount: 0,
    validFromChapter: passage.chapterNumber,
    validUntilChapter: passage.chapterNumber,
    reason: `原文命中「${hits.join("、")}」：摘要与设定里没有记下的旧章细节，供写作核对，与其它记忆冲突时以作者设定为准。`,
    estimatedTokens: estimateTokens(content),
    scoreBreakdown: { ftsBoost: Math.min(30, scored.score) },
  });
}

export function createProseEvidenceChannel(): NarrativeRetrievalChannel<ProseEvidenceChannelInput> {
  return {
    name: "prose-evidence",
    async run(input) {
      if (!input.bookRoot) return { status: "skipped", cards: [], warnings: ["原文证据：没有书籍目录，跳过。"] };
      const current = input.currentChapter;
      if (current === undefined) return { status: "skipped", cards: [], warnings: ["原文证据：没有本章章号，跳过。"] };
      const recentWindow = Math.max(0, input.recentWindow ?? DEFAULT_PROSE_EVIDENCE_RECENT_WINDOW);
      const toChapter = current - 1 - recentWindow;
      if (toChapter < 1) return { status: "skipped", cards: [], diagnostics: { reason: "近章窗口之前还没有章节" } };
      const maxPassages = Math.max(0, input.maxPassages ?? DEFAULT_PROSE_EVIDENCE_MAX_PASSAGES);
      const budgetChars = input.budgetTokens === undefined ? Number.POSITIVE_INFINITY : Math.max(0, input.budgetTokens);
      const maxChars = Math.floor(Math.min(input.maxChars ?? DEFAULT_PROSE_EVIDENCE_MAX_CHARS, budgetChars));
      if (maxPassages === 0 || maxChars < 40) return { status: "skipped", cards: [], diagnostics: { reason: "原文证据预算为 0" } };

      const entities = uniqueStrings([...(input.entities ?? []), ...sceneEntities(input.sceneSpec)]).filter((item) => Array.from(item).length >= 2);
      const freeText = [sceneSpecText(input.sceneSpec), input.sceneText ?? ""].filter(Boolean).join("\n");
      if (entities.length === 0 && !freeText.trim()) {
        return { status: "skipped", cards: [], warnings: ["原文证据：缺少本章实体与蓝图文本，跳过。"] };
      }

      const index = await ensureBookPassageIndexFresh(input.storage, input.bookId, input.bookRoot, { budgetMs: input.indexBudgetMs ?? 800 });
      const totalPassages = (input.storage.sqlite
        .prepare(`SELECT COUNT(*) AS count FROM narrative_chapter_passage WHERE book_id = ? AND chapter_number <= ?`)
        .get(input.bookId, toChapter) as { count: number }).count;
      if (totalPassages === 0) {
        return { status: "skipped", cards: [], diagnostics: { reason: "近章窗口之前没有已索引的正文", pending: index.pending.length } };
      }

      // 文档频率：一个词在旧章里出现的段落数；太常见的词（主角名、常用语）不单独算证据。
      const commonThreshold = Math.max(6, Math.floor(totalPassages * 0.12));
      const dfCache = new Map<string, number>();
      const documentFrequency = (term: string): number => {
        const cached = dfCache.get(term);
        if (cached !== undefined) return cached;
        const { terms } = passageQueryTerms([term]);
        const count = terms.length === 0
          ? 0
          : searchPassageCandidates(input.storage, { bookId: input.bookId, phrases: [terms[0]!.phrase], mode: "all", toChapter, limit: commonThreshold + 1 }).length;
        dfCache.set(term, count);
        return count;
      };

      const entityTerms = entities.filter((term) => {
        const df = documentFrequency(term);
        return df > 0 && df <= commonThreshold;
      });
      const entityPhrases = passageQueryTerms(entityTerms).terms.map((item) => item.phrase);
      const textPhrases = passageBigramPhrases(freeText);
      const candidates = searchPassageCandidates(input.storage, {
        bookId: input.bookId,
        phrases: [...entityPhrases, ...textPhrases],
        mode: "any",
        toChapter,
        limit: 60,
      });
      if (candidates.length === 0) {
        return { status: "skipped", cards: [], diagnostics: { reason: "旧章原文没有命中", entityTerms, pending: index.pending.length } };
      }

      const { passages, staleChapters } = await readPassageTexts(input.storage, input.bookId, input.bookRoot, candidates, index.files);
      const factEvidence = loadFactEvidence(input.storage, input.bookId, [...new Set(passages.map((item) => item.chapterNumber))]);
      const scored: ScoredPassage[] = [];
      let dedupedByFacts = 0;
      for (const passage of passages) {
        const literalEntities = entityTerms.filter((term) => passageContains(passage.text, term));
        const phrases = freeText
          ? sharedCjkPhrases(freeText, passage.text).filter((phrase) => !literalEntities.some((entity) => entity.includes(phrase)))
          : [];
        const qualifying = [...literalEntities, ...phrases.filter((phrase) => {
          const df = documentFrequency(phrase);
          return df > 0 && df <= commonThreshold;
        })];
        if (qualifying.length === 0) continue;
        if ((factEvidence.get(passage.chapterNumber) ?? []).some((evidence) => passage.text.includes(evidence))) {
          dedupedByFacts += 1;
          continue;
        }
        const score = qualifying.reduce((sum, term) => {
          const df = Math.max(1, documentFrequency(term));
          return sum + Array.from(term).length * Math.log(1 + totalPassages / df);
        }, 0) + Math.max(0, passage.score);
        scored.push({ passage, hits: qualifying, score });
      }

      // 每章最多一段，按分数取前几段。
      scored.sort((a, b) => b.score - a.score || a.passage.chapterNumber - b.passage.chapterNumber);
      const picked: ScoredPassage[] = [];
      const seenChapters = new Set<number>();
      for (const item of scored) {
        if (picked.length >= maxPassages) break;
        if (seenChapters.has(item.passage.chapterNumber)) continue;
        seenChapters.add(item.passage.chapterNumber);
        picked.push(item);
      }
      if (picked.length === 0) {
        return { status: "skipped", cards: [], diagnostics: { reason: "命中段落都太泛或已被事实覆盖", dedupedByFacts, staleChapters } };
      }
      // 每段配额里扣掉指针行（约 45 字）、省略号与高亮括号，保证整个通道不超过 maxChars。
      const perCardChars = Math.max(30, Math.floor(maxChars / picked.length) - 45);
      const cards = picked.map((item) => cardFor(input, item, perCardChars));
      return {
        cards,
        warnings: index.pending.length > 0 ? [`原文证据：还有 ${index.pending.length} 章正文没来得及建索引，下次召回会接着补。`] : [],
        diagnostics: {
          entityTerms,
          candidateCount: candidates.length,
          dedupedByFacts,
          staleChapters,
          reindexed: index.reindexed.length,
          pending: index.pending.length,
          picked: picked.map((item) => ({ chapter: item.passage.chapterNumber, hits: item.hits })),
        },
      };
    },
  };
}
