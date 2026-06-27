import type { HookRecord, RuntimeStateSnapshot } from "@vivy1024/novelfork-core";

import type { SceneSpec } from "../../handlers/scene-spec-handler.js";
import type { JingweiPriorityTier, JingweiReadableItem, StoryJingweiEntryRecord } from "../jingwei/types.js";
import { estimateTokens } from "../jingwei/context/token-budget.js";
import { NarrativeContextCardSchema, type NarrativeContextCard, type NarrativeContextChannel, type NarrativeContextSourceType } from "./types.js";

const DEFAULT_IMPORTANCE = 40;

export interface SceneSpecToContextCardsInput {
  readonly bookId: string;
  readonly sceneSpec: SceneSpec;
}

export interface JingweiReadableItemToContextCardInput {
  readonly bookId: string;
  readonly item: JingweiReadableItem;
}

export interface JingweiEntryToContextCardInput {
  readonly entry: StoryJingweiEntryRecord;
  readonly sectionKey?: string;
  readonly sectionName?: string;
  readonly reason?: string;
}

export interface RuntimeStateToContextCardsInput {
  readonly bookId: string;
  readonly snapshot: RuntimeStateSnapshot;
  readonly currentChapter?: number;
}

export interface HookToContextCardInput {
  readonly bookId: string;
  readonly hook: HookRecord;
  readonly currentChapter?: number;
}

export interface ChapterSummaryToContextCardInput {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly title?: string;
  readonly summary: string;
  readonly characters?: readonly string[];
  readonly currentChapter?: number;
}

export interface StyleTextToContextCardInput {
  readonly bookId: string;
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly tags?: readonly string[];
  readonly reason?: string;
}

export interface LegacyJingweiContextToContextCardInput {
  readonly bookId: string;
  readonly jingweiContext: string;
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

function firstNonEmpty(...values: readonly (string | undefined | null)[]): string {
  return values.find((value) => value && value.trim().length > 0)?.trim() ?? "未命名上下文";
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function estimateCardTokens(...parts: readonly string[]): number {
  const joined = parts.filter((part) => part.trim().length > 0).join("\n");
  return Math.max(1, estimateTokens(joined));
}

function priorityFromTier(tier?: JingweiPriorityTier): number {
  switch (tier) {
    case "core":
      return 95;
    case "relevant":
      return 70;
    case "reference":
      return 35;
    case "auto":
    default:
      return 50;
  }
}

function channelForJingwei(params: { readonly layer?: string; readonly category?: string; readonly sectionKey?: string; readonly priorityTier?: JingweiPriorityTier }): NarrativeContextChannel {
  if (params.layer === "canon" || params.priorityTier === "core") return "hard";
  const marker = `${params.category ?? ""} ${params.sectionKey ?? ""}`.toLowerCase();
  if (/chapter|summary|timeline|前情|章节/u.test(marker)) return "timeline";
  if (/hook|foreshadow|伏笔/u.test(marker)) return "hooks";
  if (/style|preset|beat|文风|节拍/u.test(marker)) return "style";
  return "state";
}

function visibleChapterFor(currentChapter?: number): number | undefined {
  return currentChapter === undefined ? undefined : Math.max(0, currentChapter - 1);
}

function isFactVisibleAtChapter(fact: { readonly validFromChapter: number; readonly validUntilChapter: number | null; readonly sourceChapter: number }, currentChapter?: number): boolean {
  const visibleChapter = visibleChapterFor(currentChapter);
  if (visibleChapter === undefined) return true;
  return fact.sourceChapter <= visibleChapter
    && fact.validFromChapter <= visibleChapter
    && (fact.validUntilChapter === null || fact.validUntilChapter >= visibleChapter);
}

function isChapterVisible(chapter: number, currentChapter?: number): boolean {
  const visibleChapter = visibleChapterFor(currentChapter);
  return visibleChapter === undefined || chapter <= visibleChapter;
}

function buildCard(input: {
  readonly id: string;
  readonly bookId: string;
  readonly sourceType: NarrativeContextSourceType;
  readonly sourceId: string;
  readonly channel: NarrativeContextChannel;
  readonly title: string;
  readonly content: string;
  readonly normal?: string;
  readonly summary?: string;
  readonly brief?: string;
  readonly tags?: readonly string[];
  readonly entities?: readonly string[];
  readonly priority?: number;
  readonly importance?: number;
  readonly accessCount?: number;
  readonly lastAccessedAt?: string;
  readonly validFromChapter?: number;
  readonly validUntilChapter?: number;
  readonly reason: string;
  readonly estimatedTokens?: number;
  readonly score?: number;
  readonly scoreBreakdown?: Readonly<Record<string, number>>;
}): NarrativeContextCard {
  const brief = firstNonEmpty(input.brief, input.summary, input.content, input.title);
  return NarrativeContextCardSchema.parse({
    id: input.id,
    bookId: input.bookId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    channel: input.channel,
    title: input.title,
    content: input.content,
    normal: input.normal,
    summary: input.summary,
    brief: truncate(brief, 180),
    tags: uniqueStrings(input.tags ?? []),
    entities: uniqueStrings(input.entities ?? []),
    priority: input.priority ?? 50,
    importance: input.importance ?? DEFAULT_IMPORTANCE,
    accessCount: input.accessCount ?? 0,
    lastAccessedAt: input.lastAccessedAt,
    validFromChapter: input.validFromChapter,
    validUntilChapter: input.validUntilChapter,
    reason: input.reason,
    estimatedTokens: input.estimatedTokens ?? estimateCardTokens(input.title, input.content, input.summary ?? "", brief),
    score: input.score,
    scoreBreakdown: input.scoreBreakdown,
  });
}

function formatSceneSpec(sceneSpec: SceneSpec): string {
  const scenes = sceneSpec.scenes.map((scene, index) => [
    `场景 ${index + 1}`,
    `角色：${scene.characters.join("、")}`,
    `地点：${scene.location}`,
    `冲突：${scene.conflict}`,
    `情绪：${scene.mood}`,
    `结果：${scene.outcome}`,
    scene.hooks_used.length > 0 ? `回收伏笔：${scene.hooks_used.join("、")}` : "",
    scene.hooks_planted.length > 0 ? `埋设伏笔：${scene.hooks_planted.join("、")}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");

  return [`第 ${sceneSpec.chapter} 章《${sceneSpec.title}》`, `目标字数：${sceneSpec.wordTarget}`, scenes].join("\n");
}

export function sceneSpecToContextCards(input: SceneSpecToContextCardsInput): NarrativeContextCard[] {
  const entities = uniqueStrings(input.sceneSpec.scenes.flatMap((scene) => [
    ...scene.characters,
    scene.location,
    ...scene.hooks_used,
    ...scene.hooks_planted,
  ]));

  const cards: NarrativeContextCard[] = [];
  if (input.sceneSpec.constraints.length > 0) {
    const constraints = input.sceneSpec.constraints.map((constraint) => `- ${constraint}`).join("\n");
    cards.push(buildCard({
      id: `scene-spec:${input.bookId}:${input.sceneSpec.chapter}:constraints`,
      bookId: input.bookId,
      sourceType: "scene-spec",
      sourceId: `scene-spec:${input.sceneSpec.chapter}`,
      channel: "hard",
      title: `第${input.sceneSpec.chapter}章硬约束`,
      content: constraints,
      brief: input.sceneSpec.constraints[0],
      tags: ["scene-spec", "constraints"],
      entities,
      priority: 100,
      importance: 100,
      validFromChapter: input.sceneSpec.chapter,
      validUntilChapter: input.sceneSpec.chapter,
      reason: "当前 SceneSpec 明确给出的写作硬约束，必须优先注入。",
    }));
  }

  cards.push(buildCard({
    id: `scene-spec:${input.bookId}:${input.sceneSpec.chapter}:plan`,
    bookId: input.bookId,
    sourceType: "scene-spec",
    sourceId: `scene-spec:${input.sceneSpec.chapter}`,
    channel: "state",
    title: `第${input.sceneSpec.chapter}章：${input.sceneSpec.title}`,
    content: formatSceneSpec(input.sceneSpec),
    summary: input.sceneSpec.scenes.map((scene) => `${scene.location}：${scene.conflict} → ${scene.outcome}`).join("；"),
    brief: `${input.sceneSpec.title}：${input.sceneSpec.scenes[0]?.outcome ?? "按 SceneSpec 推进"}`,
    tags: ["scene-spec", "chapter-plan"],
    entities,
    priority: 98,
    importance: 95,
    validFromChapter: input.sceneSpec.chapter,
    validUntilChapter: input.sceneSpec.chapter,
    reason: "当前章节 SceneSpec 是本章写作目标和场景推进蓝图。",
  }));

  return cards;
}

export function jingweiReadableItemToContextCard(input: JingweiReadableItemToContextCardInput): NarrativeContextCard {
  const channel = channelForJingwei({ category: input.item.category, sectionKey: input.item.sectionKey, priorityTier: input.item.priorityTier });
  return buildCard({
    id: `jingwei:${input.item.entryId}`,
    bookId: input.bookId,
    sourceType: input.item.category === "chapter-summaries" ? "chapter-summary" : "jingwei",
    sourceId: input.item.entryId,
    channel,
    title: input.item.title,
    content: input.item.contentMd,
    summary: input.item.summaryMd,
    brief: input.item.summaryMd,
    tags: [input.item.category, input.item.sectionKey, ...input.item.tags],
    entities: [input.item.title, ...input.item.aliases],
    priority: input.item.priority,
    importance: input.item.priority,
    lastAccessedAt: input.item.updatedAtMs > 0 ? new Date(input.item.updatedAtMs).toISOString() : undefined,
    reason: input.item.matchReason ?? `经纬 ${input.item.sectionName} 条目被读取模型召回。`,
    estimatedTokens: Math.max(1, input.item.estimatedTokens),
    score: input.item.score,
  });
}

export function jingweiEntryToContextCard(input: JingweiEntryToContextCardInput): NarrativeContextCard {
  const category = typeof input.entry.customFields.category === "string" ? input.entry.customFields.category : input.sectionKey;
  const channel = channelForJingwei({ layer: input.entry.layer, category, sectionKey: input.sectionKey, priorityTier: input.entry.priorityTier });
  const relatedChapters = input.entry.relatedChapterNumbers.filter((chapter) => Number.isInteger(chapter) && chapter >= 0);
  return buildCard({
    id: `jingwei:${input.entry.id}`,
    bookId: input.entry.bookId,
    sourceType: category === "chapter-summaries" ? "chapter-summary" : "jingwei",
    sourceId: input.entry.id,
    channel,
    title: input.entry.title,
    content: input.entry.contentMd,
    summary: input.entry.summaryMd ?? undefined,
    brief: input.entry.summaryL0 ?? input.entry.summaryMd ?? input.entry.contentMd,
    tags: [input.sectionKey, input.sectionName, category, ...input.entry.tags].filter((tag): tag is string => Boolean(tag)),
    entities: [input.entry.title, ...input.entry.aliases],
    priority: priorityFromTier(input.entry.priorityTier),
    importance: input.entry.importance ?? DEFAULT_IMPORTANCE,
    lastAccessedAt: input.entry.updatedAt.toISOString(),
    validFromChapter: relatedChapters.length > 0 ? Math.min(...relatedChapters) : undefined,
    validUntilChapter: relatedChapters.length > 0 ? Math.max(...relatedChapters) : undefined,
    reason: input.reason ?? `${input.sectionName ?? "经纬"}条目转为 NarrativeContextCard。`,
  });
}

export function hookToContextCard(input: HookToContextCardInput): NarrativeContextCard {
  const content = [
    `类型：${input.hook.type}`,
    `状态：${input.hook.status}`,
    input.hook.expectedPayoff ? `预期兑现：${input.hook.expectedPayoff}` : "",
    input.hook.payoffTiming ? `兑现节奏：${input.hook.payoffTiming}` : "",
    input.hook.notes ? `备注：${input.hook.notes}` : "",
    `最近推进章节：${input.hook.lastAdvancedChapter}`,
  ].filter(Boolean).join("\n");
  const staleBoost = input.currentChapter !== undefined ? Math.max(0, input.currentChapter - input.hook.lastAdvancedChapter) : 0;

  return buildCard({
    id: `hook:${input.hook.hookId}`,
    bookId: input.bookId,
    sourceType: "hook",
    sourceId: input.hook.hookId,
    channel: "hooks",
    title: input.hook.expectedPayoff || input.hook.type,
    content,
    brief: input.hook.expectedPayoff || input.hook.notes || input.hook.type,
    tags: ["hook", input.hook.type, input.hook.status, input.hook.payoffTiming].filter((tag): tag is string => Boolean(tag)),
    entities: [input.hook.expectedPayoff, input.hook.notes],
    priority: input.hook.status === "resolved" ? 20 : Math.min(95, 60 + staleBoost),
    importance: input.hook.status === "resolved" ? 25 : 70,
    validFromChapter: input.hook.startChapter,
    validUntilChapter: input.hook.status === "resolved" ? input.hook.lastAdvancedChapter : undefined,
    reason: input.hook.status === "resolved" ? "已解决伏笔，仅作为历史上下文。" : "未解决或推进中的伏笔需要保持连续性。",
  });
}

export function chapterSummaryToContextCard(input: ChapterSummaryToContextCardInput): NarrativeContextCard {
  return buildCard({
    id: `chapter-summary:${input.bookId}:${input.chapterNumber}`,
    bookId: input.bookId,
    sourceType: "chapter-summary",
    sourceId: `chapter:${input.chapterNumber}`,
    channel: "timeline",
    title: input.title ? `第${input.chapterNumber}章：${input.title}` : `第${input.chapterNumber}章摘要`,
    content: input.summary,
    brief: input.summary,
    tags: ["chapter-summary", "timeline"],
    entities: input.characters ?? [],
    priority: input.currentChapter !== undefined ? Math.max(10, 80 - Math.max(0, input.currentChapter - input.chapterNumber) * 8) : 60,
    importance: 60,
    validFromChapter: input.chapterNumber,
    validUntilChapter: input.chapterNumber,
    reason: "历史章节摘要用于保持前情、时间线和状态连续。",
  });
}

export function runtimeStateToContextCards(input: RuntimeStateToContextCardsInput): NarrativeContextCard[] {
  const cards: NarrativeContextCard[] = [];
  const facts = input.snapshot.currentState.facts.filter((fact) => isFactVisibleAtChapter(fact, input.currentChapter));
  if (facts.length > 0) {
    const content = facts.map((fact) => `- ${fact.subject} ${fact.predicate} ${fact.object}（${fact.validFromChapter}${fact.validUntilChapter ? `-${fact.validUntilChapter}` : "起"}，来源第${fact.sourceChapter}章）`).join("\n");
    cards.push(buildCard({
      id: `runtime-state:${input.bookId}:current-state`,
      bookId: input.bookId,
      sourceType: "runtime-state",
      sourceId: `runtime-state:${input.snapshot.currentState.chapter}`,
      channel: "state",
      title: "当前状态事实",
      content,
      brief: facts[0] ? `${facts[0].subject} ${facts[0].predicate} ${facts[0].object}` : "当前状态事实",
      tags: ["runtime-state", "current-state"],
      entities: facts.flatMap((fact) => [fact.subject, fact.object]),
      priority: 85,
      importance: 80,
      validFromChapter: Math.min(...facts.map((fact) => fact.validFromChapter)),
      validUntilChapter: input.currentChapter !== undefined ? input.currentChapter - 1 : input.snapshot.currentState.chapter,
      reason: "RuntimeState 当前状态是写作连续性的结构化事实来源。",
    }));
  }

  for (const hook of input.snapshot.hooks.hooks.filter((hook) => isChapterVisible(hook.startChapter, input.currentChapter))) {
    cards.push(hookToContextCard({ bookId: input.bookId, hook, currentChapter: input.currentChapter }));
  }

  for (const row of input.snapshot.chapterSummaries.rows.filter((row) => isChapterVisible(row.chapter, input.currentChapter))) {
    cards.push(chapterSummaryToContextCard({
      bookId: input.bookId,
      chapterNumber: row.chapter,
      title: row.title,
      summary: [row.events, row.stateChanges, row.hookActivity, row.mood].filter(Boolean).join("\n"),
      characters: row.characters.split(/[、,，\s]+/u).filter(Boolean),
      currentChapter: input.currentChapter,
    }));
  }

  const timelineEntries = input.snapshot.timeline.entries.filter((entry) => isChapterVisible(entry.chapter, input.currentChapter));
  if (timelineEntries.length > 0) {
    const entries = timelineEntries;
    cards.push(buildCard({
      id: `runtime-state:${input.bookId}:timeline`,
      bookId: input.bookId,
      sourceType: "runtime-state",
      sourceId: "runtime-timeline",
      channel: "timeline",
      title: "Runtime 时间线",
      content: entries.map((entry) => `- 第${entry.chapter}章 ${entry.storyTime}：${entry.label}${entry.durationFromPrev ? `（距上次：${entry.durationFromPrev}）` : ""}`).join("\n"),
      brief: entries.at(-1)?.label ?? "Runtime 时间线",
      tags: ["runtime-state", "timeline"],
      priority: 65,
      importance: 65,
      validFromChapter: Math.min(...entries.map((entry) => entry.chapter)),
      validUntilChapter: Math.max(...entries.map((entry) => entry.chapter)),
      reason: "Runtime 时间线用于避免故事时间倒流和前后矛盾。",
    }));
  }

  return cards;
}

export function styleTextToContextCard(input: StyleTextToContextCardInput): NarrativeContextCard {
  return buildCard({
    id: `style:${input.id}`,
    bookId: input.bookId,
    sourceType: "style",
    sourceId: input.id,
    channel: "style",
    title: input.title,
    content: input.text,
    brief: input.text,
    tags: ["style", ...(input.tags ?? [])],
    priority: 45,
    importance: 50,
    reason: input.reason ?? "写作预设/文风规则用于约束输出风格。",
  });
}

export function legacyJingweiContextToContextCard(input: LegacyJingweiContextToContextCardInput): NarrativeContextCard {
  return buildCard({
    id: `legacy-jingwei-context:${input.bookId}`,
    bookId: input.bookId,
    sourceType: "jingwei",
    sourceId: "legacy-jingwei-context",
    channel: "state",
    title: "旧版经纬上下文",
    content: input.jingweiContext,
    brief: input.jingweiContext,
    tags: ["jingwei", "legacy-context"],
    priority: 55,
    importance: 50,
    reason: "兼容旧 jingweiContext 字符串路径，包装为结构化 ContextCard。",
  });
}
