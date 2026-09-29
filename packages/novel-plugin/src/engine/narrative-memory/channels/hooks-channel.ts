import type { HookRecord, RuntimeStateSnapshot } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { SceneSpec } from "../../../handlers/scene-spec-handler.js";
import { createStoryJingweiEntryRepository } from "../../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../../jingwei/repositories/section-repo.js";
import type { StoryJingweiEntryRecord, StoryJingweiSectionRecord } from "../../jingwei/types.js";
import { estimateTokens } from "../../jingwei/context/token-budget.js";
import type { NarrativeRetrievalChannel } from "../channels.js";
import { hookToContextCard, jingweiEntryToContextCard } from "../context-card.js";
import { stripParentheticalSuffix } from "../entity-dictionary.js";
import { NarrativeContextCardSchema, type NarrativeContextCard } from "../types.js";

export interface HooksChannelInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly currentChapter?: number;
  readonly runtimeSnapshot?: RuntimeStateSnapshot;
  readonly pendingHooks?: readonly string[];
  readonly sceneSpec?: SceneSpec;
  readonly sceneText?: string;
  readonly entities?: readonly string[];
  readonly limit?: number;
}

interface ScoredHookCard {
  readonly card: NarrativeContextCard;
  readonly score: number;
}

function visibleChapterFor(currentChapter?: number): number | undefined {
  return currentChapter === undefined ? undefined : Math.max(0, currentChapter - 1);
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

function collectQueryEntities(input: HooksChannelInput): string[] {
  const sceneEntities = input.sceneSpec?.scenes.flatMap((scene) => [
    ...scene.characters,
    scene.location,
    ...scene.hooks_used,
    ...scene.hooks_planted,
  ]) ?? [];
  return uniqueStrings([...(input.entities ?? []), ...sceneEntities]);
}

function isHookVisible(hook: HookRecord, currentChapter?: number): boolean {
  const visibleChapter = visibleChapterFor(currentChapter);
  return visibleChapter === undefined || hook.startChapter <= visibleChapter;
}

function textMatches(text: string, terms: readonly string[]): number {
  return terms.reduce((score, term) => score + (term && text.includes(term) ? 8 : 0), 0);
}

function runtimeHookScore(hook: HookRecord, input: HooksChannelInput, terms: readonly string[]): { score: number; reason: string } {
  const text = [hook.type, hook.expectedPayoff, hook.notes, hook.status, hook.payoffTiming ?? ""].join("\n");
  const stale = input.currentChapter === undefined ? 0 : Math.max(0, input.currentChapter - hook.lastAdvancedChapter);
  let score = textMatches(text, terms);
  if (hook.status === "open" || hook.status === "progressing") score += 40;
  if (hook.status === "resolved") score -= 30;
  if (stale >= 8 && hook.status !== "resolved") score += 65;
  else score += Math.min(20, stale);
  if (input.sceneText && textMatches(text, [input.sceneText]) > 0) score += 5;
  const reason = stale >= 8 && hook.status !== "resolved"
    ? `hooks channel 命中长期未推进伏笔，已 ${stale} 章未推进。`
    : "hooks channel 命中当前场景相关伏笔。";
  return { score, reason };
}

function sectionLooksLikeHook(section?: StoryJingweiSectionRecord): boolean {
  const marker = `${section?.key ?? ""} ${section?.builtinKind ?? ""} ${section?.name ?? ""}`.toLowerCase();
  return /foreshadow|hook|clue|pending|伏笔|线索/u.test(marker);
}

function entryLooksLikeHook(entry: StoryJingweiEntryRecord, section?: StoryJingweiSectionRecord): boolean {
  const category = typeof entry.customFields.category === "string" ? entry.customFields.category.toLowerCase() : "";
  return sectionLooksLikeHook(section)
    || /foreshadow|hook|clue|pending/u.test(category)
    || entry.tags.some((tag) => /伏笔|hook|foreshadow|线索|clue/u.test(tag));
}

function entryVisible(entry: StoryJingweiEntryRecord, currentChapter?: number): boolean {
  const visibleChapter = visibleChapterFor(currentChapter);
  if (visibleChapter === undefined || entry.relatedChapterNumbers.length === 0) return true;
  return entry.relatedChapterNumbers.some((chapter) => chapter <= visibleChapter);
}

const EVIDENCE_NOTE = "（Runtime 状态，只作证据；与经纬伏笔条目冲突时以经纬为准）";

/** 伏笔卡的可比名：标题、别名与 Runtime hookId，归一化后用于合并同一条伏笔的重复表达。 */
function cardNames(card: NarrativeContextCard): string[] {
  const names = [card.title, card.sourceType === "hook" ? card.sourceId : "", ...(card.sourceType === "jingwei" ? card.entities : [])];
  return uniqueStrings(names.map((name) => stripParentheticalSuffix(name?.trim() ?? "").replace(/\s+/gu, "").toLowerCase()));
}

function pendingHookCard(input: HooksChannelInput, hookText: string, index: number): NarrativeContextCard {
  return NarrativeContextCardSchema.parse({
    id: `pending-hook:${input.bookId}:${index}`,
    bookId: input.bookId,
    sourceType: "hook",
    sourceId: `pending-hook:${index}`,
    channel: "hooks",
    title: `待处理伏笔 ${index + 1}`,
    content: hookText,
    brief: hookText,
    tags: ["pending-hook"],
    entities: collectQueryEntities(input),
    priority: 75,
    importance: 75,
    accessCount: 0,
    reason: `调用方提供的 pending hook，需要在本章写作中保持连续性。${EVIDENCE_NOTE}`,
    estimatedTokens: Math.max(1, estimateTokens(hookText)),
  });
}

export function createHooksChannel(): NarrativeRetrievalChannel<HooksChannelInput> {
  return {
    name: "hooks",
    async run(input) {
      const limit = Math.max(1, input.limit ?? 30);
      const terms = collectQueryEntities(input);
      const scored: ScoredHookCard[] = [];

      for (const hook of input.runtimeSnapshot?.hooks.hooks ?? []) {
        if (!isHookVisible(hook, input.currentChapter)) continue;
        const { score, reason } = runtimeHookScore(hook, input, terms);
        const base = hookToContextCard({ bookId: input.bookId, hook, currentChapter: input.currentChapter });
        scored.push({ card: { ...base, reason: `${reason}${EVIDENCE_NOTE}` }, score });
      }

      for (const [index, hookText] of (input.pendingHooks ?? []).entries()) {
        if (!hookText.trim()) continue;
        scored.push({ card: pendingHookCard(input, hookText, index), score: 65 + textMatches(hookText, terms) });
      }

      const sections = await createStoryJingweiSectionRepository(input.storage).listEnabledForAi(input.bookId);
      const sectionById = new Map(sections.map((section) => [section.id, section]));
      const entries = await createStoryJingweiEntryRepository(input.storage).listByBook(input.bookId);
      for (const entry of entries) {
        const section = sectionById.get(entry.sectionId);
        if (!entry.participatesInAi || entry.status !== "confirmed" || !entryVisible(entry, input.currentChapter) || !entryLooksLikeHook(entry, section)) continue;
        const haystack = [entry.title, entry.contentMd, entry.summaryMd ?? "", entry.summaryL0 ?? "", ...entry.tags, ...entry.aliases].join("\n");
        const score = 45 + textMatches(haystack, terms) + (entry.importance ?? 40) / 2;
        if (score <= 45) continue;
        scored.push({
          card: { ...jingweiEntryToContextCard({
            entry,
            sectionKey: section?.key,
            sectionName: section?.name,
            reason: "hooks channel 读取 foreshadowing/伏笔经纬条目。",
          }), channel: "hooks" },
          score,
        });
      }

      // 单一权威源：经纬伏笔条目是权威，先占名额、排在前面；Runtime 状态里的伏笔、调用方给的
      // pending hook 与 hook fact 只作证据补充剩余名额。与已选经纬条目同名的证据卡视为同一条伏笔的
      // 重复表达，不再单独注入。
      const byScore = (a: ScoredHookCard, b: ScoredHookCard) => b.score - a.score || a.card.sourceId.localeCompare(b.card.sourceId);
      const authoritative = scored.filter((item) => item.card.sourceType === "jingwei").sort(byScore).map((item) => item.card).slice(0, limit);
      const authoritativeNames = new Set(authoritative.flatMap((card) => cardNames(card)));
      const evidence = scored
        .filter((item) => item.card.sourceType !== "jingwei")
        .sort(byScore)
        .map((item) => item.card)
        .filter((card) => !cardNames(card).some((name) => authoritativeNames.has(name)));
      const cards = [...authoritative, ...evidence.slice(0, Math.max(0, limit - authoritative.length))];

      if (cards.length === 0) {
        return { status: "skipped", cards: [], warnings: ["hooks channel 为空：未找到 runtime hooks、pending hooks 或伏笔经纬条目。"] };
      }
      return { cards, warnings: [] };
    },
  };
}
