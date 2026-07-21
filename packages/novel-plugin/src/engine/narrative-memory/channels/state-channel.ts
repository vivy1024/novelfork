import type { RuntimeStateSnapshot } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { SceneSpec } from "../../../handlers/scene-spec-handler.js";
import { createStoryJingweiEntryRepository } from "../../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../../jingwei/repositories/section-repo.js";
import type { StoryJingweiEntryRecord, StoryJingweiSectionRecord } from "../../jingwei/types.js";
import type { NarrativeRetrievalChannel } from "../channels.js";
import { jingweiEntryToContextCard, runtimeStateToContextCards } from "../context-card.js";
import { factToContextCard, searchFactsByEntities } from "../facts.js";
import type { NarrativeContextCard } from "../types.js";

export interface StateChannelInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly currentChapter?: number;
  readonly sceneSpec?: SceneSpec;
  readonly sceneText?: string;
  readonly entities?: readonly string[];
  readonly runtimeSnapshot?: RuntimeStateSnapshot;
  readonly limit?: number;
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

function collectQueryEntities(input: StateChannelInput): string[] {
  const sceneEntities = input.sceneSpec?.scenes.flatMap((scene) => [
    ...scene.characters,
    scene.location,
    ...scene.hooks_used,
    ...scene.hooks_planted,
  ]) ?? [];
  return uniqueStrings([...(input.entities ?? []), ...sceneEntities]);
}

function entryCategory(entry: StoryJingweiEntryRecord, section?: StoryJingweiSectionRecord): string {
  const custom = typeof entry.customFields.category === "string" ? entry.customFields.category : "";
  return `${custom} ${section?.key ?? ""} ${section?.builtinKind ?? ""}`.toLowerCase();
}

function isStateCategory(category: string): boolean {
  return /people|character|characters|relationship|relationships|faction|factions|location|locations|prop|props|resource|state|current|人物|关系|地点|势力|道具/u.test(category);
}

function isVisibleEntry(entry: StoryJingweiEntryRecord, currentChapter?: number): boolean {
  const visibleChapter = visibleChapterFor(currentChapter);
  if (visibleChapter === undefined || entry.relatedChapterNumbers.length === 0) return true;
  return entry.relatedChapterNumbers.some((chapter) => chapter <= visibleChapter);
}

function matchScore(entry: StoryJingweiEntryRecord, section: StoryJingweiSectionRecord | undefined, input: StateChannelInput, queryEntities: readonly string[]): number {
  const haystack = [
    entry.title,
    entry.contentMd,
    entry.summaryMd ?? "",
    entry.summaryL0 ?? "",
    ...entry.tags,
    ...entry.aliases,
    section?.name ?? "",
    section?.key ?? "",
  ].join("\n");
  let score = 0;
  for (const entity of queryEntities) {
    if (haystack.includes(entity)) score += 10;
  }
  if (input.sceneText && haystack.split(/\s+/u).some((part) => part && input.sceneText?.includes(part))) score += 2;
  if (entry.priorityTier === "relevant") score += 3;
  if (entry.priorityTier === "core") score += 4;
  score += (entry.importance ?? 40) / 100;
  return score;
}

function asStateCard(card: NarrativeContextCard, reason?: string): NarrativeContextCard {
  return {
    ...card,
    channel: "state",
    reason: reason ?? card.reason,
  };
}

export function createStateChannel(): NarrativeRetrievalChannel<StateChannelInput> {
  return {
    name: "state",
    async run(input) {
      const limit = Math.max(1, input.limit ?? 30);
      const warnings: string[] = [];
      const cards: NarrativeContextCard[] = [];
      const queryEntities = collectQueryEntities(input);

      const sections = await createStoryJingweiSectionRepository(input.storage).listEnabledForAi(input.bookId);
      const sectionById = new Map(sections.map((section) => [section.id, section]));
      const entries = await createStoryJingweiEntryRepository(input.storage).listByBook(input.bookId);
      const scoredEntries = entries
        .filter((entry) => entry.participatesInAi && isVisibleEntry(entry, input.currentChapter))
        .map((entry) => ({ entry, section: sectionById.get(entry.sectionId), category: entryCategory(entry, sectionById.get(entry.sectionId)) }))
        .filter(({ entry, category }) => entry.layer !== "canon" && isStateCategory(category))
        .map((item) => ({ ...item, score: matchScore(item.entry, item.section, input, queryEntities) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || (b.entry.importance ?? 40) - (a.entry.importance ?? 40) || a.entry.id.localeCompare(b.entry.id));

      for (const item of scoredEntries.slice(0, limit)) {
        cards.push(asStateCard(jingweiEntryToContextCard({
          entry: item.entry,
          sectionKey: item.section?.key,
          sectionName: item.section?.name,
          reason: `state channel 命中当前场景实体/文本，相关度 ${item.score.toFixed(1)}。`,
        })));
      }

      if (input.runtimeSnapshot) {
        cards.push(...runtimeStateToContextCards({
          bookId: input.bookId,
          snapshot: input.runtimeSnapshot,
          currentChapter: input.currentChapter,
        }).filter((card) => card.channel === "state").map((card) => asStateCard(card, "state channel 注入 RuntimeState 当前状态。")));
      }

      if (queryEntities.length > 0) {
        const facts = searchFactsByEntities(input.storage, {
          bookId: input.bookId,
          entities: queryEntities,
          currentChapter: input.currentChapter,
          limit,
        });
        cards.push(...facts.map((fact) => asStateCard(factToContextCard(fact, `state channel 命中当前实体事实：${fact.subject}/${fact.object}`))));
      }

      // 通道内保留相关度顺序；limit 截断时优先保住 fact / runtime-state，经纬作兜底。
      const deduped = new Map<string, NarrativeContextCard>();
      for (const card of cards) {
        const key = `${card.sourceType}:${card.sourceId}:${card.channel}`;
        if (!deduped.has(key)) deduped.set(key, card);
      }
      const ordered = [...deduped.values()];
      const authoritative = ordered.filter((card) => card.sourceType === "fact" || card.sourceType === "runtime-state");
      const fallback = ordered.filter((card) => card.sourceType !== "fact" && card.sourceType !== "runtime-state");
      const reserved = authoritative.slice(0, limit);
      const remainingSlots = Math.max(0, limit - reserved.length);
      const chosenIds = new Set([...reserved, ...fallback.slice(0, remainingSlots)].map((card) => card.id));
      const result = ordered.filter((card) => chosenIds.has(card.id)).slice(0, limit);

      if (result.length === 0) {
        warnings.push("state channel 为空：未找到当前场景相关 dynamic 经纬、RuntimeState 或可见 narrative facts。");
        return { status: "skipped", cards: [], warnings };
      }

      return { cards: result, warnings };
    },
  };
}
