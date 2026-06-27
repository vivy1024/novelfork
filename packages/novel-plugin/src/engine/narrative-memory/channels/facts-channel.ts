import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { SceneSpec } from "../../../handlers/scene-spec-handler.js";
import type { NarrativeRetrievalChannel } from "../channels.js";
import { expandFactsOneHop, factToContextCard } from "../facts.js";
import type { NarrativeContextCard } from "../types.js";

export interface FactsChannelInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly currentChapter?: number;
  readonly sceneSpec?: SceneSpec;
  readonly sceneText?: string;
  readonly entities?: readonly string[];
  readonly maxPerEntity?: number;
  readonly limit?: number;
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
      const cards: NarrativeContextCard[] = facts.map((fact) => factToContextCard(fact, buildReason(fact.subject, fact.object, queryEntities)));

      if (cards.length === 0) {
        return { status: "skipped", cards: [], warnings: ["facts channel 为空：未找到当前实体相关的可见 narrative facts。"] };
      }
      return { cards, warnings: [] };
    },
  };
}
