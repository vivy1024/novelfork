import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { SceneSpec } from "../../../handlers/scene-spec-handler.js";
import type { NarrativeRetrievalChannel } from "../channels.js";
import { expandFactsOneHop, factToContextCard } from "../facts.js";
import { isMachineExtractedFactSource } from "../staleness.js";
import type { NarrativeContextCard, NarrativeFact } from "../types.js";

export interface FactsChannelInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly currentChapter?: number;
  readonly sceneSpec?: SceneSpec;
  readonly sceneText?: string;
  readonly entities?: readonly string[];
  readonly maxPerEntity?: number;
  readonly limit?: number;
  /** 正文在结算后又被改过的章：这些章上结算出的机器事实照样注入，但标明可能过期、以正文为准。 */
  readonly staleChapters?: readonly number[];
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

function collectSceneEntities(sceneSpec?: SceneSpec): string[] {
  return sceneSpec?.scenes.flatMap((scene) => [
    ...scene.characters,
    scene.location,
    ...scene.hooks_used,
    ...scene.hooks_planted,
  ]) ?? [];
}

function collectSceneTextTerms(sceneText?: string): string[] {
  if (!sceneText) return [];
  const matches = sceneText.match(/[\p{L}\p{N}_]{2,}/gu) ?? [];
  return matches.filter((term) => term.length <= 12).slice(0, 20);
}

function buildReason(subject: string, object: string, queryEntities: readonly string[]): string {
  const matched = queryEntities.filter((entity) => entity === subject || entity === object);
  return matched.length > 0
    ? `facts channel 直接/一跳命中实体：${matched.join("、")}`
    : `facts channel 由相关事实一跳扩展：${subject}/${object}`;
}

/** 机器从正文抽取的事实随来源章节过期；作者手写与导入的事实不随正文改动失效。 */
function isStaleSourceFact(fact: NarrativeFact, staleChapters: ReadonlySet<number>): boolean {
  return fact.sourceChapter !== undefined && staleChapters.has(fact.sourceChapter) && isMachineExtractedFactSource(fact.sourceType);
}

function markStaleFactCard(card: NarrativeContextCard): NarrativeContextCard {
  return {
    ...card,
    content: `${card.content}\n（注意：来源章节正文在结算后被改过，这条事实可能已过期，与正文冲突时以正文为准。）`,
    tags: [...card.tags, "stale"],
    priority: card.priority - 20,
    reason: `${card.reason}；来源章节正文在结算后被改过，事实可能过期，已降低优先级并标注。`,
  };
}

export function createFactsChannel(): NarrativeRetrievalChannel<FactsChannelInput> {
  return {
    name: "facts",
    run(input) {
      const queryEntities = uniqueStrings([
        ...(input.entities ?? []),
        ...collectSceneEntities(input.sceneSpec),
        ...collectSceneTextTerms(input.sceneText),
      ]);
      if (queryEntities.length === 0) {
        return { status: "skipped", cards: [], warnings: ["facts channel 为空：缺少 sceneSpec/entities/sceneText 查询实体。"] };
      }

      const facts = expandFactsOneHop(input.storage, {
        bookId: input.bookId,
        entities: queryEntities,
        currentChapter: input.currentChapter,
        maxPerEntity: input.maxPerEntity ?? 3,
        limit: input.limit ?? 30,
      });
      const staleChapters = new Set(input.staleChapters ?? []);
      const cards: NarrativeContextCard[] = facts.map((fact) => {
        const card = factToContextCard(fact, buildReason(fact.subject, fact.object, queryEntities));
        return isStaleSourceFact(fact, staleChapters) ? markStaleFactCard(card) : card;
      });

      if (cards.length === 0) {
        return { status: "skipped", cards: [], warnings: ["facts channel 为空：未找到当前实体相关的可见 narrative facts。"] };
      }
      return { cards, warnings: [] };
    },
  };
}
