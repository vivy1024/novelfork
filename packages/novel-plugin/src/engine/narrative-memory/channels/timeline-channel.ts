import type { RuntimeStateSnapshot } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { SceneSpec } from "../../../handlers/scene-spec-handler.js";
import { createStoryJingweiEntryRepository } from "../../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../../jingwei/repositories/section-repo.js";
import type { StoryJingweiEntryRecord, StoryJingweiSectionRecord } from "../../jingwei/types.js";
import { estimateTokens } from "../../jingwei/context/token-budget.js";
import type { NarrativeRetrievalChannel } from "../channels.js";
import { chapterSummaryToContextCard, jingweiEntryToContextCard, runtimeStateToContextCards } from "../context-card.js";
import { NarrativeContextCardSchema, type NarrativeContextCard } from "../types.js";

export interface TimelineChannelInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly currentChapter?: number;
  readonly runtimeSnapshot?: RuntimeStateSnapshot;
  readonly previousChapterTail?: string;
  readonly sceneSpec?: SceneSpec;
  readonly sceneText?: string;
  readonly recentChapterCount?: number;
  readonly limit?: number;
}

function visibleChapterFor(currentChapter?: number): number | undefined {
  return currentChapter === undefined ? undefined : Math.max(0, currentChapter - 1);
}

function entryChapter(entry: StoryJingweiEntryRecord): number | undefined {
  if (entry.relatedChapterNumbers.length > 0) return Math.max(...entry.relatedChapterNumbers);
  const titleMatch = /第\s*(\d+)\s*章/u.exec(entry.title);
  return titleMatch?.[1] ? Number(titleMatch[1]) : undefined;
}

function isSummarySection(section?: StoryJingweiSectionRecord): boolean {
  const marker = `${section?.key ?? ""} ${section?.builtinKind ?? ""} ${section?.name ?? ""}`.toLowerCase();
  return /chapter-summary|chapter-summaries|summary|timeline|章节摘要|时间线/u.test(marker);
}

function isSummaryEntry(entry: StoryJingweiEntryRecord, section?: StoryJingweiSectionRecord): boolean {
  const category = typeof entry.customFields.category === "string" ? entry.customFields.category.toLowerCase() : "";
  return isSummarySection(section) || /chapter-summary|chapter-summaries|summary|timeline/u.test(category);
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

export function createTimelineChannel(): NarrativeRetrievalChannel<TimelineChannelInput> {
  return {
    name: "timeline",
    async run(input) {
      const limit = Math.max(1, input.limit ?? 30);
      const recentChapterCount = Math.max(1, input.recentChapterCount ?? 5);
      const cards: NarrativeContextCard[] = [];

      const tail = previousTailCard(input);
      if (tail) cards.push(tail);

      if (input.runtimeSnapshot) {
        cards.push(...runtimeStateToContextCards({
          bookId: input.bookId,
          snapshot: input.runtimeSnapshot,
          currentChapter: input.currentChapter,
        }).filter((card) => card.channel === "timeline"));
      }

      const sections = await createStoryJingweiSectionRepository(input.storage).listEnabledForAi(input.bookId);
      const sectionById = new Map(sections.map((section) => [section.id, section]));
      const entries = await createStoryJingweiEntryRepository(input.storage).listByBook(input.bookId);
      const visibleChapter = visibleChapterFor(input.currentChapter);
      const minRecentChapter = visibleChapter === undefined ? undefined : Math.max(0, visibleChapter - recentChapterCount + 1);
      const summaryEntries = entries
        .filter((entry) => entry.participatesInAi)
        .map((entry) => ({ entry, section: sectionById.get(entry.sectionId), chapter: entryChapter(entry) }))
        .filter(({ entry, section, chapter }) => isSummaryEntry(entry, section) && isVisibleChapter(chapter, input.currentChapter))
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
