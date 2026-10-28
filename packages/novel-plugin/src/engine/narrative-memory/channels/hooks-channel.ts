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
import { DEFAULT_DORMANT_HOOK_CHAPTERS, DEFAULT_DORMANT_HOOK_LIMIT, selectDormantHooks, type DormantHook } from "../foreshadow-phase.js";
import { loadForeshadowStates, type ForeshadowState } from "../../narrative-taxonomy/foreshadow-states.js";
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
  /** 休眠长线伏笔阈值（章）：超过这么多章没推进的未回收伏笔出提醒卡。默认 30。 */
  readonly dormantThresholdChapters?: number;
  /** 休眠提醒最多几条，默认 3；0 = 关闭。 */
  readonly dormantLimit?: number;
}

/** 休眠长线伏笔提醒卡的标签。 */
export const DORMANT_HOOK_TAG = "dormant-hook";

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

function positiveChapter(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/u.test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * 修旧章时不注入「未来」才埋下的伏笔：埋设章（fields.plantedChapter）在可见章之后的不可见；
 * 没记埋设章时退回 relatedChapterNumbers 里任一章可见即可（老口径）。
 */
function entryVisible(entry: StoryJingweiEntryRecord, currentChapter?: number): boolean {
  const visibleChapter = visibleChapterFor(currentChapter);
  if (visibleChapter === undefined) return true;
  const planted = positiveChapter(entry.fields.plantedChapter);
  if (planted !== undefined) return planted <= visibleChapter;
  if (entry.relatedChapterNumbers.length === 0) return true;
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

function dormantHookCard(input: HooksChannelInput, hook: DormantHook & { readonly entryId: string }): NarrativeContextCard {
  const seed = hook.seedText?.replace(/\s+/gu, " ").trim();
  const content = [
    `长线伏笔「${hook.title}」埋于第 ${hook.setupChapter} 章，已 ${hook.idleChapters} 章没有推进（${hook.lastProgressChapter !== undefined && hook.lastProgressChapter > hook.setupChapter ? `最近一次推进在第 ${hook.lastProgressChapter} 章` : "埋下后没有推进记录"}）。`,
    seed ? `原文承诺：${seed}` : "",
    "提醒：不必本章回收，但别让读者忘了它——可以安排一次轻提及或推进。",
  ].filter(Boolean).join("\n");
  return NarrativeContextCardSchema.parse({
    id: `dormant-hook:${input.bookId}:${hook.entryId}`,
    bookId: input.bookId,
    sourceType: "jingwei",
    sourceId: hook.entryId,
    channel: "hooks",
    title: `长线伏笔提醒：${hook.title}`,
    content,
    brief: `长线伏笔「${hook.title}」已 ${hook.idleChapters} 章未推进`,
    tags: ["hook", DORMANT_HOOK_TAG],
    entities: [hook.title],
    priority: 80,
    importance: Math.max(70, hook.importance ?? 40),
    accessCount: 0,
    reason: `休眠长线伏笔：经纬伏笔条目未回收，按推进记录（经纬条目 + 已应用的 hook 事件，现场派生）已 ${hook.idleChapters} 章未推进，超过阈值。`,
    estimatedTokens: Math.max(1, estimateTokens(content)),
  });
}

/** 从派生阶段读模型挑休眠伏笔；读不到只跳过提醒，不影响其它伏笔卡。 */
function collectDormantHooks(
  input: HooksChannelInput,
  entryById: ReadonlyMap<string, StoryJingweiEntryRecord>,
): Array<DormantHook & { readonly entryId: string }> {
  const limit = input.dormantLimit ?? DEFAULT_DORMANT_HOOK_LIMIT;
  if (input.currentChapter === undefined || limit <= 0) return [];
  let states: ForeshadowState[];
  try {
    states = loadForeshadowStates(input.storage, input.bookId, { beforeChapter: input.currentChapter });
  } catch {
    return [];
  }
  const candidates = states.flatMap((state) => {
    const entry = entryById.get(state.entryId);
    // 只提醒参与 AI 的已确认条目（与 hooks 通道其余经纬伏笔卡同口径）
    if (!entry || !entry.participatesInAi || entry.status !== "confirmed") return [];
    if (state.phase === "paid_off" || state.phase === "abandoned") return [];
    const target = entry.fields.targetChapter;
    return [{
      entryId: state.entryId,
      title: state.label,
      status: state.phase,
      ...(state.setupChapter !== undefined ? { setupChapter: state.setupChapter } : {}),
      ...(state.lastProgressChapter !== undefined ? { lastProgressChapter: state.lastProgressChapter } : {}),
      ...(typeof target === "number" ? { targetChapter: target } : {}),
      importance: entry.importance ?? 40,
      seedText: (entry.contentMd || entry.summaryMd || "").slice(0, 120),
    }];
  });
  const picked = selectDormantHooks(candidates, input.currentChapter, {
    thresholdChapters: input.dormantThresholdChapters ?? DEFAULT_DORMANT_HOOK_CHAPTERS,
    limit,
  });
  const idByTitle = new Map(candidates.map((candidate) => [candidate.title, candidate.entryId]));
  return picked.map((hook) => ({ ...hook, entryId: idByTitle.get(hook.title) ?? hook.title }));
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
      // 休眠长线伏笔：提醒卡替换同一条目的完整伏笔卡（同一伏笔只留一份表达），并优先占名额。
      const dormant = collectDormantHooks(input, new Map(entries.map((entry) => [entry.id, entry])));
      const dormantEntryIds = new Set(dormant.map((hook) => hook.entryId));
      const dormantCards = dormant.map((hook) => dormantHookCard(input, hook));
      const authoritative = [
        ...dormantCards,
        ...scored
          .filter((item) => item.card.sourceType === "jingwei" && !dormantEntryIds.has(item.card.sourceId))
          .sort(byScore)
          .map((item) => item.card),
      ].slice(0, limit);
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
      return {
        cards,
        warnings: [],
        diagnostics: {
          dormantHooks: dormant.map((hook) => ({ entryId: hook.entryId, title: hook.title, setupChapter: hook.setupChapter, idleChapters: hook.idleChapters })),
          dormantThresholdChapters: input.dormantThresholdChapters ?? DEFAULT_DORMANT_HOOK_CHAPTERS,
        },
      };
    },
  };
}
