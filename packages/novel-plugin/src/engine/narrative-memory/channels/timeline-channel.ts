import type { RuntimeStateSnapshot } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { SceneSpec } from "../../../handlers/scene-spec-handler.js";
import { createStoryJingweiEntryRepository } from "../../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../../jingwei/repositories/section-repo.js";
import { resolveJingweiReadCategory } from "../../jingwei/read-model/category-map.js";
import type { StoryJingweiEntryRecord, StoryJingweiSectionRecord } from "../../jingwei/types.js";
import { estimateTokens } from "../../jingwei/context/token-budget.js";
import type { NarrativeRetrievalChannel } from "../channels.js";
import { chapterSummaryToContextCard, jingweiEntryToContextCard, runtimeStateToContextCards } from "../context-card.js";
import { NarrativeContextCardSchema, type NarrativeContextCard } from "../types.js";
import { readStoryTimeline, type StoryTimelineSnapshot, type StoryTimePromise } from "../story-time.js";

export interface TimelineChannelInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  /** 本书经纬条目（装配时读一次传进来，免得每个通道各读一遍整本）；缺省时通道自己读。 */
  readonly jingweiEntries?: readonly StoryJingweiEntryRecord[];
  readonly currentChapter?: number;
  readonly runtimeSnapshot?: RuntimeStateSnapshot;
  readonly previousChapterTail?: string;
  readonly sceneSpec?: SceneSpec;
  readonly sceneText?: string;
  readonly recentChapterCount?: number;
  readonly limit?: number;
  /** 故事时间卡列几条近期时间锚（默认 5）。 */
  readonly storyTimeRecentAnchors?: number;
}

function visibleChapterFor(currentChapter?: number): number | undefined {
  return currentChapter === undefined ? undefined : Math.max(0, currentChapter - 1);
}

function entryChapter(entry: StoryJingweiEntryRecord): number | undefined {
  if (entry.relatedChapterNumbers.length > 0) return Math.max(...entry.relatedChapterNumbers);
  const titleMatch = /第\s*(\d+)\s*章/u.exec(entry.title);
  return titleMatch?.[1] ? Number(titleMatch[1]) : undefined;
}

/**
 * 时间线通道只收经纬「时间线」分类的条目。
 * 章摘要（chapter-summaries）由 recent-summary 通道（近章）与 story-arc 层级前情（卷/全书）负责：
 * 此前这里也按「summary」正则把章摘要再注入一份，同一章出现两张卡、预算重复计算；按单一权威源
 * 「发现重复表达时删掉弱的一方」，章摘要不再从这里进。分类按经纬读模型解析，不靠正则猜。
 */
function isTimelineEntry(entry: StoryJingweiEntryRecord, section?: StoryJingweiSectionRecord): boolean {
  return resolveJingweiReadCategory(entry, section) === "timeline";
}

function isVisibleChapter(chapter: number | undefined, currentChapter?: number): boolean {
  const visibleChapter = visibleChapterFor(currentChapter);
  return chapter === undefined || visibleChapter === undefined || chapter <= visibleChapter;
}

function previousTailCard(input: TimelineChannelInput): NarrativeContextCard | undefined {
  const content = input.previousChapterTail?.trim();
  if (!content) return undefined;
  const chapter = visibleChapterFor(input.currentChapter);
  return NarrativeContextCardSchema.parse({
    id: `previous-chapter-tail:${input.bookId}:${input.currentChapter ?? "unknown"}`,
    bookId: input.bookId,
    sourceType: "chapter-summary",
    sourceId: "previous-chapter-tail",
    channel: "timeline",
    title: "前章尾部",
    content,
    brief: content.slice(0, 180),
    tags: ["previous-chapter-tail", "timeline"],
    entities: [],
    priority: 88,
    importance: 80,
    accessCount: 0,
    validFromChapter: chapter,
    validUntilChapter: chapter,
    reason: "previousChapterTail compatibility card，用于衔接上一章尾部与当前章开头。",
    estimatedTokens: Math.max(1, estimateTokens(content)),
  });
}

/** 约定临近窗口：还有这么多天以内的约定都列出（与本章无关也列，避免写过头）。 */
const PROMISE_SOON_DAYS = 7;
/** 已过期的约定在这么多天内仍提醒（可能还没兑现）。 */
const PROMISE_OVERDUE_DAYS = 30;

function promiseRelevantText(input: TimelineChannelInput): string {
  const scenes = input.sceneSpec?.scenes.map((scene) => [scene.conflict, scene.outcome, scene.location, ...scene.characters].join(" ")) ?? [];
  return [input.sceneText ?? "", input.sceneSpec?.title ?? "", ...scenes].join("\n");
}

/** 与本章相关的未来约定：临近（≤7 日）、刚过期（≤30 日），或约定的事在本章蓝图 / 场景里被提到。 */
export function selectRelevantPromises(snapshot: StoryTimelineSnapshot, relevantText: string, limit = 4): StoryTimePromise[] {
  const text = relevantText.replace(/\s+/gu, "");
  const scored = snapshot.promises
    .map((promise) => {
      const mentioned = promise.event.length >= 2 && text.includes(promise.event.replace(/\s+/gu, ""));
      const soon = promise.daysLeft >= 0 && promise.daysLeft <= PROMISE_SOON_DAYS;
      const overdue = promise.daysLeft < 0 && promise.daysLeft >= -PROMISE_OVERDUE_DAYS;
      const future = promise.daysLeft > PROMISE_SOON_DAYS;
      const score = (mentioned ? 100 : 0) + (soon ? 50 - promise.daysLeft : 0) + (overdue ? 20 + promise.daysLeft / 10 : 0) + (future && mentioned ? 5 : 0);
      return { promise, score, keep: mentioned || soon || overdue };
    })
    .filter((item) => item.keep)
    .sort((a, b) => b.score - a.score || a.promise.dueDay - b.promise.dueDay);
  return scored.slice(0, limit).map((item) => item.promise);
}

function promiseLine(promise: StoryTimePromise): string {
  const when = promise.daysLeft > 0 ? `还有 ${promise.daysLeft} 日` : promise.daysLeft === 0 ? "就是今天" : `已过 ${-promise.daysLeft} 日`;
  return `- 「${promise.event}」：第${promise.chapterNumber}章约定（${promise.expression}），${when}。原文：${promise.evidenceText}`;
}

/** 故事时间卡：当前故事时间 + 近期时间锚 + 与本章相关的约定；只用本章之前的章。 */
function storyTimeCard(input: TimelineChannelInput): NarrativeContextCard | undefined {
  const through = visibleChapterFor(input.currentChapter);
  const snapshot = readStoryTimeline(input.storage, input.bookId, through);
  if (snapshot.currentDay === undefined && snapshot.promises.length === 0) return undefined;
  const recent = snapshot.points.slice(-Math.max(1, input.storyTimeRecentAnchors ?? 5));
  const promises = selectRelevantPromises(snapshot, promiseRelevantText(input));
  const lines: string[] = [];
  if (snapshot.currentLabel) lines.push(`当前故事时间：${snapshot.currentLabel}（截至第${snapshot.currentChapter}章）。`);
  if (recent.length > 0) {
    lines.push("近期时间线：");
    for (const point of recent) lines.push(`- 第${point.chapterNumber}章「${point.expression}」→ ${point.calendarLabel ?? `故事第 ${point.storyDay + 1} 日`}`);
  }
  if (promises.length > 0) {
    lines.push("相关的约定时间（写本章时注意别写过头或忘了兑现）：");
    lines.push(...promises.map(promiseLine));
  }
  const openConflicts = snapshot.conflicts.filter((conflict) => through === undefined || conflict.chapterNumber >= through - 20);
  if (openConflicts.length > 0) lines.push(`近期时间线有 ${openConflicts.length} 处可能的矛盾待作者确认，本章不要沿着矛盾继续推算。`);
  const content = lines.join("\n");
  return NarrativeContextCardSchema.parse({
    id: `story-time:${input.bookId}:${input.currentChapter ?? "unknown"}`,
    bookId: input.bookId,
    sourceType: "fact",
    sourceId: "story-timeline",
    channel: "timeline",
    title: "故事时间",
    content,
    brief: (snapshot.currentLabel ? `当前故事时间：${snapshot.currentLabel}` : content).slice(0, 180),
    tags: ["story-time", "timeline", ...(promises.length > 0 ? ["story-time-promise"] : [])],
    entities: [],
    priority: 90,
    importance: 80,
    accessCount: 0,
    ...(through !== undefined ? { validFromChapter: snapshot.currentChapter ?? through, validUntilChapter: through } : {}),
    reason: "故事时间轴：由各章时间说法推算的当前时间、近期时间锚与临近的约定，防止时间倒流或约定被遗忘。",
    estimatedTokens: Math.max(1, estimateTokens(content)),
  });
}

export function createTimelineChannel(): NarrativeRetrievalChannel<TimelineChannelInput> {
  return {
    name: "timeline",
    async run(input) {
      const limit = Math.max(1, input.limit ?? 30);
      const recentChapterCount = Math.max(1, input.recentChapterCount ?? 5);
      const cards: NarrativeContextCard[] = [];

      const tail = previousTailCard(input);
      if (tail) cards.push(tail);

      const storyTime = storyTimeCard(input);
      if (storyTime) cards.push(storyTime);

      if (input.runtimeSnapshot) {
        cards.push(...runtimeStateToContextCards({
          bookId: input.bookId,
          snapshot: input.runtimeSnapshot,
          currentChapter: input.currentChapter,
        }).filter((card) => card.channel === "timeline"));
      }

      const sections = await createStoryJingweiSectionRepository(input.storage).listEnabledForAi(input.bookId);
      const sectionById = new Map(sections.map((section) => [section.id, section]));
      const entries = input.jingweiEntries ?? await createStoryJingweiEntryRepository(input.storage).listByBook(input.bookId);
      const visibleChapter = visibleChapterFor(input.currentChapter);
      const minRecentChapter = visibleChapter === undefined ? undefined : Math.max(0, visibleChapter - recentChapterCount + 1);
      const summaryEntries = entries
        .filter((entry) => entry.participatesInAi && entry.status === "confirmed")
        .map((entry) => ({ entry, section: sectionById.get(entry.sectionId), chapter: entryChapter(entry) }))
        .filter(({ entry, section, chapter }) => isTimelineEntry(entry, section) && isVisibleChapter(chapter, input.currentChapter))
        .filter(({ chapter }) => minRecentChapter === undefined || chapter === undefined || chapter >= minRecentChapter)
        .sort((a, b) => (b.chapter ?? 0) - (a.chapter ?? 0) || b.entry.updatedAt.getTime() - a.entry.updatedAt.getTime());

      for (const item of summaryEntries.slice(0, recentChapterCount)) {
        cards.push({
          ...jingweiEntryToContextCard({
            entry: item.entry,
            sectionKey: item.section?.key,
            sectionName: item.section?.name,
            reason: "timeline channel 注入最近章节摘要，保持前情连续。",
          }),
          channel: "timeline",
        });
      }

      // Runtime chapter summaries may not exist in SQLite; ensure recent rows are represented even if runtimeStateToContextCards format changes.
      const runtimeRows = input.runtimeSnapshot?.chapterSummaries.rows
        .filter((row) => isVisibleChapter(row.chapter, input.currentChapter))
        .filter((row) => minRecentChapter === undefined || row.chapter >= minRecentChapter)
        .sort((a, b) => b.chapter - a.chapter) ?? [];
      for (const row of runtimeRows.slice(0, recentChapterCount)) {
        const id = `chapter-summary:${input.bookId}:${row.chapter}`;
        if (cards.some((card) => card.id === id)) continue;
        cards.push(chapterSummaryToContextCard({
          bookId: input.bookId,
          chapterNumber: row.chapter,
          title: row.title,
          summary: [row.events, row.stateChanges, row.hookActivity, row.mood].filter(Boolean).join("\n"),
          characters: row.characters.split(/[、,，\s]+/u).filter(Boolean),
          currentChapter: input.currentChapter,
        }));
      }

      const deduped = new Map<string, NarrativeContextCard>();
      for (const card of cards) {
        const key = `${card.sourceType}:${card.sourceId}:${card.id}`;
        if (!deduped.has(key)) deduped.set(key, card);
      }
      const result = [...deduped.values()].slice(0, limit);
      if (result.length === 0) {
        return { status: "skipped", cards: [], warnings: ["timeline channel 为空：未找到最近章节摘要、Runtime 时间线或前章尾部。"] };
      }
      return { cards: result, warnings: [] };
    },
  };
}
