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
import {
  describeLedgerFields,
  HOOK_SCORE,
  lastRemindedBefore,
  parseForeshadowLedgerFields,
  resolveHookImportance,
  scoreHookRelevance,
  type ForeshadowLedgerFields,
  type HookRelevanceScore,
} from "../foreshadow-ledger.js";
import { describeDueForeshadow, DUE_FORESHADOW_SECTION_TITLE, type DueForeshadow } from "../foreshadow-due.js";
import { loadForeshadowStates, type ForeshadowState } from "../../narrative-taxonomy/foreshadow-states.js";
import { NarrativeContextCardSchema, type NarrativeContextCard } from "../types.js";

export interface HooksChannelInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  /** 本书经纬条目（装配时读一次传进来，免得每个通道各读一遍整本）；缺省时通道自己读。 */
  readonly jingweiEntries?: readonly StoryJingweiEntryRecord[];
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
/** 预定回收区间覆盖 / 临近本章的伏笔卡标签（卡片内容以「本章到期伏笔」开头）。 */
export const DUE_HOOK_TAG = "due-hook";
/** 伏笔相关度随卡片带到全局打分（scoring.ts 读 scoreBreakdown.hookRelevanceBoost），让写前七栏的伏笔上限也按相关度裁。 */
export const HOOK_RELEVANCE_BOOST_KEY = "hookRelevanceBoost";

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
    ...(scene.characters ?? []),
    scene.location,
    ...(scene.hooks_used ?? []),
    ...(scene.hooks_planted ?? []),
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

/** 本章场景声明要用 / 要埋的伏笔名：命中的伏笔视同触发词命中。 */
function sceneHookNames(input: HooksChannelInput): string[] {
  return uniqueStrings(input.sceneSpec?.scenes.flatMap((scene) => [...(scene.hooks_used ?? []), ...(scene.hooks_planted ?? [])]) ?? []);
}

/** 本章查询文本：章题、场景（地点 / 冲突 / 结果）、节拍、召回指示。触发词在这里出现即算本章提到。 */
function chapterQueryText(input: HooksChannelInput): string {
  const spec = input.sceneSpec;
  return [
    spec?.title,
    ...(spec?.scenes.flatMap((scene) => [scene.location, scene.conflict, scene.outcome, ...(scene.characters ?? [])]) ?? []),
    ...(spec?.beatBudget?.map((beat) => beat.summary) ?? []),
    input.sceneText,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0).join("\n");
}

/** 休眠项：每 10 章 +1，封顶 +10（与经纬伏笔同口径）。 */
function dormancyTerm(idleChapters: number): number {
  return Math.min(HOOK_SCORE.dormancyCap, Math.floor(Math.max(0, idleChapters) / HOOK_SCORE.dormancyPerChapters));
}

/**
 * Runtime 伏笔只作证据，没有结构化字段：相关度 = 文本命中 + 本章场景点名（+30）；
 * 久未推进只加封顶 10 的小项（此前是一刀切 +65，长书里会把与本章无关的旧伏笔全顶上来）。
 */
function runtimeHookScore(hook: HookRecord, input: HooksChannelInput, terms: readonly string[]): { score: number; relevance: number; reason: string } {
  const text = [hook.type, hook.expectedPayoff, hook.notes, hook.status, hook.payoffTiming ?? ""].join("\n");
  const stale = input.currentChapter === undefined ? 0 : Math.max(0, input.currentChapter - hook.lastAdvancedChapter);
  const named = sceneHookNames(input).some((name) => name.length >= 2 && text.includes(name)) ? HOOK_SCORE.keywordHit : 0;
  const relevance = textMatches(text, terms) + named + (input.sceneText && textMatches(text, [input.sceneText]) > 0 ? 5 : 0);
  let score = relevance;
  if (hook.status === "open" || hook.status === "progressing") score += 40;
  if (hook.status === "resolved") score -= 30;
  if (hook.status !== "resolved") score += dormancyTerm(stale);
  const reason = stale >= 8 && hook.status !== "resolved"
    ? `hooks channel 命中本章相关伏笔，且长期未推进（已 ${stale} 章）。`
    : "hooks channel 命中当前场景相关伏笔。";
  return { score, relevance, reason };
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

function dormantHookCard(input: HooksChannelInput, hook: DormantHookPick): NarrativeContextCard {
  const seed = hook.seedText?.replace(/\s+/gu, " ").trim();
  const content = [
    `长线伏笔「${hook.title}」埋于第 ${hook.setupChapter} 章，已 ${hook.idleChapters} 章没有推进（${hook.lastProgressChapter !== undefined && hook.lastProgressChapter > hook.setupChapter ? `最近一次推进在第 ${hook.lastProgressChapter} 章` : "埋下后没有推进记录"}）。`,
    seed ? `原文承诺：${seed}` : "",
    ...describeLedgerFields(hook.ledger),
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
    reason: `休眠长线伏笔：经纬伏笔条目未回收，按推进记录（经纬条目 + 已应用的 hook 事件，现场派生）已 ${hook.idleChapters} 章未推进，超过阈值；按「多久没被提醒」轮转挑选。`,
    estimatedTokens: Math.max(1, estimateTokens(content)),
    // 提醒卡名额本就封顶（默认 3 条），给一个固定的中等相关度，免得被写前七栏的伏笔上限挤掉；
    // 本章真正提到的伏笔（触发词 / 到期）仍会排在它前面。
    scoreBreakdown: { [HOOK_RELEVANCE_BOOST_KEY]: DORMANT_REMINDER_RELEVANCE },
  });
}

/** 提醒卡的固定相关度：约等于一次触发词命中。 */
const DORMANT_REMINDER_RELEVANCE = HOOK_SCORE.keywordHit;

export interface DormantHookPick extends DormantHook {
  readonly entryId: string;
  readonly ledger: ForeshadowLedgerFields;
}

/** 从派生阶段读模型挑休眠伏笔；读不到只跳过提醒，不影响其它伏笔卡。 */
function collectDormantHooks(
  input: HooksChannelInput,
  entryById: ReadonlyMap<string, StoryJingweiEntryRecord>,
  states: readonly ForeshadowState[],
): DormantHookPick[] {
  const limit = input.dormantLimit ?? DEFAULT_DORMANT_HOOK_LIMIT;
  if (input.currentChapter === undefined || limit <= 0) return [];
  const currentChapter = input.currentChapter;
  const ledgerById = new Map<string, ForeshadowLedgerFields>();
  const idByTitle = new Map<string, string>();
  const candidates = states.flatMap((state) => {
    const entry = entryById.get(state.entryId);
    // 只提醒参与 AI 的已确认条目（与 hooks 通道其余经纬伏笔卡同口径）
    if (!entry || !entry.participatesInAi || entry.status !== "confirmed") return [];
    if (state.phase === "paid_off" || state.phase === "abandoned") return [];
    const ledger = parseForeshadowLedgerFields(entry.fields);
    ledgerById.set(state.entryId, ledger);
    if (!idByTitle.has(state.label)) idByTitle.set(state.label, state.entryId);
    const lastReminded = lastRemindedBefore(ledger.remindedChapters, currentChapter);
    return [{
      title: state.label,
      status: state.phase,
      ...(state.setupChapter !== undefined ? { setupChapter: state.setupChapter } : {}),
      ...(state.lastProgressChapter !== undefined ? { lastProgressChapter: state.lastProgressChapter } : {}),
      // 预定回收区间的起点进入到期窗口时交给到期卡，不再重复做休眠提醒
      ...(ledger.targetRange ? { targetChapter: ledger.targetRange.from } : {}),
      ...(lastReminded !== undefined ? { lastRemindedChapter: lastReminded } : {}),
      importance: entry.importance ?? 40,
      hookImportance: resolveHookImportance(ledger, entry.importance),
      seedText: (entry.contentMd || entry.summaryMd || "").slice(0, 120),
    }];
  });
  const picked = selectDormantHooks(candidates, currentChapter, {
    thresholdChapters: input.dormantThresholdChapters ?? DEFAULT_DORMANT_HOOK_CHAPTERS,
    limit,
  });
  return picked.map((hook) => {
    const entryId = idByTitle.get(hook.title) ?? hook.title;
    return { ...hook, entryId, ledger: ledgerById.get(entryId) ?? { triggerKeywords: [], remindedChapters: [] } };
  });
}

function loadStates(input: HooksChannelInput): ForeshadowState[] {
  try {
    return input.currentChapter === undefined
      ? loadForeshadowStates(input.storage, input.bookId)
      : loadForeshadowStates(input.storage, input.bookId, { beforeChapter: input.currentChapter });
  } catch {
    return [];
  }
}

function idleChaptersFor(state: ForeshadowState | undefined, currentChapter: number | undefined): number {
  if (!state || currentChapter === undefined) return 0;
  const progress = state.lastProgressChapter ?? state.setupChapter;
  return progress === undefined ? 0 : Math.max(0, currentChapter - progress);
}

function isTerminalPhase(state: ForeshadowState | undefined): boolean {
  return state?.phase === "paid_off" || state?.phase === "abandoned";
}

/** 到期判定与「本章到期伏笔」段同口径（selectDueForeshadows）：区间内 / 已过 / 起点在 2 章内。 */
function dueOf(entryId: string, label: string, ledger: ForeshadowLedgerFields, relevance: HookRelevanceScore): DueForeshadow | undefined {
  if (!ledger.targetRange) return undefined;
  if (relevance.rangeStatus !== "approaching" && relevance.rangeStatus !== "in-range" && relevance.rangeStatus !== "overdue") return undefined;
  return {
    entryId,
    title: label,
    range: ledger.targetRange,
    status: relevance.rangeStatus,
    overdueBy: relevance.overdueBy,
    importance: relevance.importance,
    ...(ledger.triggerCondition ? { triggerCondition: ledger.triggerCondition } : {}),
    ...(ledger.payoffConstraint ? { payoffConstraint: ledger.payoffConstraint } : {}),
  };
}

export function createHooksChannel(): NarrativeRetrievalChannel<HooksChannelInput> {
  return {
    name: "hooks",
    async run(input) {
      const limit = Math.max(1, input.limit ?? 30);
      const terms = collectQueryEntities(input);
      const query = { text: chapterQueryText(input), entities: uniqueStrings([...terms, ...sceneHookNames(input)]) };
      const scored: ScoredHookCard[] = [];

      for (const hook of input.runtimeSnapshot?.hooks.hooks ?? []) {
        if (!isHookVisible(hook, input.currentChapter)) continue;
        const { score, relevance, reason } = runtimeHookScore(hook, input, terms);
        const base = hookToContextCard({ bookId: input.bookId, hook, currentChapter: input.currentChapter });
        scored.push({
          card: { ...base, reason: `${reason}${EVIDENCE_NOTE}`, scoreBreakdown: { ...(base.scoreBreakdown ?? {}), [HOOK_RELEVANCE_BOOST_KEY]: relevance } },
          score,
        });
      }

      for (const [index, hookText] of (input.pendingHooks ?? []).entries()) {
        if (!hookText.trim()) continue;
        scored.push({ card: pendingHookCard(input, hookText, index), score: 65 + textMatches(hookText, terms) });
      }

      const sections = await createStoryJingweiSectionRepository(input.storage).listEnabledForAi(input.bookId);
      const sectionById = new Map(sections.map((section) => [section.id, section]));
      const entries = input.jingweiEntries ?? await createStoryJingweiEntryRepository(input.storage).listByBook(input.bookId);
      const states = loadStates(input);
      const stateById = new Map(states.map((state) => [state.entryId, state]));
      const dueHooks: DueForeshadow[] = [];
      const relevantEntryIds = new Set<string>();
      const scoreDiagnostics: Array<{ entryId: string; score: number; keywords: readonly string[]; range: string }> = [];
      for (const entry of entries) {
        const section = sectionById.get(entry.sectionId);
        if (!entry.participatesInAi || entry.status !== "confirmed" || !entryVisible(entry, input.currentChapter) || !entryLooksLikeHook(entry, section)) continue;
        const ledger = parseForeshadowLedgerFields(entry.fields);
        const state = stateById.get(entry.id);
        const terminal = isTerminalPhase(state);
        const haystack = [entry.title, entry.contentMd, entry.summaryMd ?? "", entry.summaryL0 ?? "", ledger.triggerCondition ?? "", ...entry.tags, ...entry.aliases].join("\n");
        // 伏笔名 / 别名本身出现在本章（场景声明用到、查询文本提到）也算触发
        const nameKeywords = [entry.title, ...entry.aliases].map((name) => stripParentheticalSuffix(name).trim()).filter((name) => name.length >= 2);
        const relevance = scoreHookRelevance({
          ledger: {
            ...ledger,
            // 已回收 / 已废弃的伏笔不再算到期
            targetRange: terminal ? undefined : ledger.targetRange,
            triggerKeywords: uniqueStrings([...ledger.triggerKeywords, ...nameKeywords]),
          },
          currentChapter: input.currentChapter,
          query,
          textScore: textMatches(haystack, terms),
          idleChapters: terminal ? 0 : idleChaptersFor(state, input.currentChapter),
          entryImportance: entry.importance,
        });
        // 老口径：与本章毫无文本关联、且作者把注入重要度调到 0 的条目不注入
        if (relevance.relevance <= 0 && (entry.importance ?? 40) <= 0) continue;
        // 已回收 / 已废弃：仅作前情，与 Runtime 已解决伏笔同口径降权
        const score = relevance.score - (terminal ? 30 : 0);
        const label = state?.label ?? entry.title;
        const due = terminal ? undefined : dueOf(entry.id, label, ledger, relevance);
        if (due) dueHooks.push(due);
        if (!terminal && (due || relevance.matchedKeywords.length > 0)) relevantEntryIds.add(entry.id);
        const base = jingweiEntryToContextCard({
          entry,
          sectionKey: section?.key,
          sectionName: section?.name,
          reason: relevance.matchedKeywords.length > 0
            ? `hooks channel：本章提到伏笔触发词（${relevance.matchedKeywords.join("、")}）。`
            : "hooks channel 读取 foreshadowing/伏笔经纬条目。",
        });
        const content = [
          due ? `【${DUE_FORESHADOW_SECTION_TITLE}】${describeDueForeshadow(due)}` : "",
          base.content,
          ...describeLedgerFields(ledger),
        ].filter(Boolean).join("\n");
        scored.push({
          card: NarrativeContextCardSchema.parse({
            ...base,
            channel: "hooks",
            content,
            // 降档到摘要时到期提示也要在
            ...(due ? { brief: `【${DUE_FORESHADOW_SECTION_TITLE}】${label}：${describeDueForeshadow(due)}`.slice(0, 180), summary: undefined } : {}),
            tags: due ? [...base.tags, DUE_HOOK_TAG] : base.tags,
            estimatedTokens: Math.max(1, estimateTokens([base.title, content, base.summary ?? "", base.brief].join("\n"))),
            scoreBreakdown: { ...(base.scoreBreakdown ?? {}), [HOOK_RELEVANCE_BOOST_KEY]: terminal ? 0 : relevance.relevance },
          }),
          score,
        });
        scoreDiagnostics.push({ entryId: entry.id, score, keywords: relevance.matchedKeywords, range: relevance.rangeStatus });
      }

      // 单一权威源：经纬伏笔条目是权威，先占名额、排在前面；Runtime 状态里的伏笔、调用方给的
      // pending hook 与 hook fact 只作证据补充剩余名额。与已选经纬条目同名的证据卡视为同一条伏笔的
      // 重复表达，不再单独注入。
      const byScore = (a: ScoredHookCard, b: ScoredHookCard) => b.score - a.score || a.card.sourceId.localeCompare(b.card.sourceId);
      // 休眠长线伏笔：提醒卡替换同一条目的完整伏笔卡（同一伏笔只留一份表达），并优先占名额。
      // 本章已因触发词 / 到期点到的伏笔以完整卡在场，不再占提醒名额。
      const dormant = collectDormantHooks(
        input,
        new Map(entries.filter((entry) => !relevantEntryIds.has(entry.id)).map((entry) => [entry.id, entry])),
        states,
      );
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
          dueHooks: dueHooks.map((hook) => ({ entryId: hook.entryId, title: hook.title, status: hook.status, from: hook.range.from, to: hook.range.to })),
          topHookScores: scoreDiagnostics.sort((a, b) => b.score - a.score || a.entryId.localeCompare(b.entryId)).slice(0, 10),
        },
      };
    },
  };
}
