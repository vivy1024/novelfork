/**
 * 知情边界通道（T4.3）——给本章出场角色注入「现状」与「写作禁忌」：防止角色提前知道他还不该知道的秘密。
 *
 * 数据来源（机器派生物，不假装是作者设定）：
 *   narrative_state_change —— 「现状」：每方面取该章前最后一条状态流水值（实体索引由已确认事实回放）
 *   narrative_knowledge    —— 「写作禁忌」：截至该章已发生、他不在场的关键事实（知情账的反推）
 *
 * 出场名单沿用写作管线的现有来源（scene.spec 点名实体 + 用户点选实体），
 * 在这里按实体索引的别名摊平表归并到实体 id；归并不到经纬实体（没有身份）的角色不出卡。
 *
 * 预算与裁剪（通道内自裁后，卡片再参与全局 token 打包）：
 *   maxEntities    出场实体上限（默认 6，按出场名单顺序取前几个）
 *   statePerEntity 每实体「现状」条数上限（默认 4）
 *   unawarePerEntity 每实体「写作禁忌」条数上限（默认 3）
 *
 * 可见章与 state 通道同规则：写第 N 章时只能看到第 N-1 章及之前的记忆。
 * 只给 character 类型实体出卡；实体既无现状也无禁忌时不出卡。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import {
  queryEntityKnowledge,
  resolveKnowledgeEntitiesByNames,
  type EntityKnowledgeAnswer,
  type KnowledgeEntity,
} from "../../narrative-entity/knowledge-index.js";
import { estimateTokens } from "../../jingwei/context/token-budget.js";
import type { NarrativeRetrievalChannel } from "../channels.js";
import { NarrativeContextCardSchema, type NarrativeContextCard } from "../types.js";

export const KNOWLEDGE_MAX_ENTITIES = 6;
export const KNOWLEDGE_STATE_PER_ENTITY = 4;
export const KNOWLEDGE_UNAWARE_PER_ENTITY = 3;

export interface KnowledgeChannelInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly currentChapter?: number;
  /** 本章出场名单（scene.spec 点名实体 + 用户点选实体），按实体索引归并。 */
  readonly entities?: readonly string[];
  readonly maxEntities?: number;
  readonly statePerEntity?: number;
  readonly unawarePerEntity?: number;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function formatChapter(chapter: number): string {
  return `第 ${chapter} 章`;
}

function knowledgeCardContent(answer: EntityKnowledgeAnswer, visibleChapter: number | undefined): { content: string; brief: string; summary: string } {
  const anchor = visibleChapter !== undefined ? `截至 ${formatChapter(visibleChapter)}` : "至今";
  const lines: string[] = [];
  if (answer.state.length > 0) {
    lines.push(`现状（${anchor}，由状态流水回放）：`);
    for (const item of answer.state) {
      lines.push(`- ${item.fluent}：${item.value}（${formatChapter(item.chapter)}记）`);
    }
  }
  if (answer.unaware.length > 0) {
    lines.push(`写作禁忌（${anchor}他尚不知道、与剧情有关的事；不要让他主动提及或据此行动）：`);
    for (const item of answer.unaware) {
      lines.push(`- ${formatChapter(item.chapter)}：${item.subject} · ${item.predicate} → ${item.object}`);
    }
  }
  const content = lines.join("\n");
  const briefParts: string[] = [];
  if (answer.state.length > 0) briefParts.push(`现状 ${answer.state.length} 条`);
  if (answer.unaware.length > 0) briefParts.push(`禁忌 ${answer.unaware.length} 条`);
  const brief = `知情边界（${anchor}）：${briefParts.join("，")}`;
  return { content, brief, summary: content.split("\n").slice(0, 3).join("\n") || brief };
}

export function createKnowledgeChannel(): NarrativeRetrievalChannel<KnowledgeChannelInput> {
  return {
    name: "knowledge",
    async run(input) {
      const requested = uniqueStrings(input.entities ?? []);
      if (requested.length === 0) {
        return { status: "skipped", cards: [], warnings: ["knowledge channel 为空：本章没有点名出场实体，无人需要知情边界。"] };
      }
      const maxEntities = Math.max(1, input.maxEntities ?? KNOWLEDGE_MAX_ENTITIES);
      const statePerEntity = Math.max(1, input.statePerEntity ?? KNOWLEDGE_STATE_PER_ENTITY);
      const unawarePerEntity = Math.max(1, input.unawarePerEntity ?? KNOWLEDGE_UNAWARE_PER_ENTITY);
      // 与 state 通道同规则：写第 N 章时只能看到第 N-1 章及之前的记忆
      const visibleChapter = input.currentChapter === undefined ? undefined : Math.max(1, input.currentChapter - 1);

      let resolved: KnowledgeEntity[];
      try {
        resolved = resolveKnowledgeEntitiesByNames(input.storage, input.bookId, requested)
          .filter((entity) => entity.type === "character");
      } catch (error) {
        return {
          status: "skipped",
          cards: [],
          warnings: [`knowledge channel 跳过：实体索引不可读（${error instanceof Error ? error.message : String(error)}）。`],
        };
      }
      const picked = resolved.slice(0, maxEntities);
      const droppedEntityNames = resolved.slice(maxEntities).map((entity) => entity.name);

      const cards: NarrativeContextCard[] = [];
      const perEntity: Array<{ entityId: string; name: string; stateCount: number; unawareCount: number; cardId: string }> = [];
      for (const entity of picked) {
        const answer = queryEntityKnowledge(input.storage, input.bookId, {
          entityId: entity.id,
          ...(visibleChapter !== undefined ? { chapter: visibleChapter } : {}),
          unawareLimit: unawarePerEntity,
          stateLimit: statePerEntity,
        });
        if (!answer.schemaMissing && answer.entity && (answer.state.length > 0 || answer.unaware.length > 0)) {
          const { content, brief, summary } = knowledgeCardContent(answer, visibleChapter);
          const cardId = `knowledge:${input.bookId}:${entity.id}:${visibleChapter ?? "latest"}`;
          cards.push(NarrativeContextCardSchema.parse({
            id: cardId,
            bookId: input.bookId,
            sourceType: "fact",
            sourceId: entity.id,
            channel: "knowledge",
            title: `知情边界：${entity.name}`,
            content,
            summary,
            brief,
            tags: ["knowledge-boundary", "derived"],
            entities: [entity.name],
            priority: 60,
            importance: 65,
            accessCount: 0,
            ...(visibleChapter !== undefined ? { validFromChapter: visibleChapter } : {}),
            reason: "知情边界：现状由状态流水（narrative_state_change）回放、禁忌由已确认事实的知情账（narrative_knowledge）按实体派生，不是作者手填设定。",
            estimatedTokens: Math.max(1, estimateTokens(content)),
          }));
          perEntity.push({ entityId: entity.id, name: entity.name, stateCount: answer.state.length, unawareCount: answer.unaware.length, cardId });
        }
      }

      if (cards.length === 0) {
        const reason = resolved.length === 0
          ? "knowledge channel 为空：出场角色都还没归并到实体索引（先在经纬建条目并结算/重建索引）。"
          : "knowledge channel 为空：出场角色既无状态流水也无未知的剧情事实。";
        return { status: "skipped", cards: [], warnings: [reason] };
      }

      const warnings: string[] = [];
      if (droppedEntityNames.length > 0) {
        warnings.push(`知情边界：超出实体上限 ${maxEntities}，${droppedEntityNames.join("、")} 未注入。`);
      }
      return {
        cards,
        warnings,
        diagnostics: {
          requestedEntities: requested,
          resolvedEntities: resolved.map((entity) => entity.id),
          injectedEntities: perEntity,
          droppedForEntityCap: droppedEntityNames,
          visibleChapter: visibleChapter ?? null,
          caps: { maxEntities, statePerEntity, unawarePerEntity },
          sourceNote: "内容由 narrative_knowledge / narrative_state_change 按实体 id 派生；表数据来自已确认记忆事实的整本重建。",
        },
      };
    },
  };
}
