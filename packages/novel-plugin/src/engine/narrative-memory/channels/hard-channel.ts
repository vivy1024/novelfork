import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { SceneSpec } from "../../../handlers/scene-spec-handler.js";
import { createStoryJingweiEntryRepository } from "../../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../../jingwei/repositories/section-repo.js";
import { classifyCanonScope } from "../canon-scope.js";
import type { NarrativeRetrievalChannel } from "../channels.js";
import { jingweiEntryToContextCard, sceneSpecToContextCards } from "../context-card.js";
import { NarrativeContextCardSchema, type NarrativeContextCard } from "../types.js";
import { estimateTokens } from "../../jingwei/context/token-budget.js";

export interface HardChannelInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly sceneSpec?: SceneSpec;
  readonly bookRulesText?: string;
  readonly complianceRules?: readonly string[];
}

function createHardTextCard(input: {
  readonly id: string;
  readonly bookId: string;
  readonly sourceId: string;
  readonly title: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly reason: string;
}): NarrativeContextCard {
  return NarrativeContextCardSchema.parse({
    id: input.id,
    bookId: input.bookId,
    sourceType: "style",
    sourceId: input.sourceId,
    channel: "hard",
    title: input.title,
    content: input.content,
    brief: input.content.slice(0, 180),
    tags: ["hard", ...input.tags],
    entities: [],
    priority: 100,
    importance: 100,
    accessCount: 0,
    reason: input.reason,
    estimatedTokens: Math.max(1, estimateTokens(input.content)),
  });
}

export function createHardChannel(): NarrativeRetrievalChannel<HardChannelInput> {
  return {
    name: "hard",
    async run(input) {
      const cards: NarrativeContextCard[] = [];
      const warnings: string[] = [];
      const diagnostics: Record<string, unknown> = {};

      if (input.sceneSpec) {
        cards.push(...sceneSpecToContextCards({ bookId: input.bookId, sceneSpec: input.sceneSpec }).filter((card) => card.channel === "hard"));
      }

      const sections = await createStoryJingweiSectionRepository(input.storage).listEnabledForAi(input.bookId);
      const sectionById = new Map(sections.map((section) => [section.id, section]));
      const entries = await createStoryJingweiEntryRepository(input.storage).listByBook(input.bookId);
      // 只有「全书硬规则」（故事基线 / 世界模型 / 能力体系 / 写作规则）全量进 hard；
      // 实体型 canon（角色 / 势力 / 地点 / 道具）交给 state 通道按本章出场相关性召回（可降档），
      // 否则长篇几百条人设会把不可丢弃的 hard 撑爆，触发超预算拒写。分类只看经纬分类表态。
      let entityCanonDeferred = 0;
      const deferredByCategory: Record<string, number> = {};
      for (const entry of entries) {
        if (!entry.participatesInAi || entry.status !== "confirmed") continue;
        if (entry.lifecycle && entry.lifecycle !== "active") continue;
        const section = sectionById.get(entry.sectionId);
        const scope = classifyCanonScope(entry, section);
        if (scope === "entity") {
          entityCanonDeferred += 1;
          deferredByCategory[entry.category] = (deferredByCategory[entry.category] ?? 0) + 1;
          continue;
        }
        if (scope !== "book-rule") continue;
        const card = jingweiEntryToContextCard({
          entry,
          sectionKey: section?.key,
          sectionName: section?.name,
          reason: "hard channel 读取全书硬规则（故事基线 / 世界模型 / 能力体系 / 写作规则），作为不可直接丢弃约束。",
        });
        cards.push({ ...card, channel: "hard", priority: Math.max(card.priority, 95), importance: Math.max(card.importance, 90) });
      }
      diagnostics.entityCanonDeferred = entityCanonDeferred;
      diagnostics.entityCanonDeferredByCategory = deferredByCategory;
      diagnostics.note = "实体型 canon（角色/势力/地点/道具）不进 hard，由 state 通道按本章出场相关性召回；见 state 通道的 entityCanon 诊断。";

      if (input.bookRulesText?.trim()) {
        cards.push(createHardTextCard({
          id: `hard:book-rules:${input.bookId}`,
          bookId: input.bookId,
          sourceId: "book_rules.md",
          title: "书籍硬规则",
          content: input.bookRulesText.trim(),
          tags: ["book-rules"],
          reason: "book_rules.md/调用方提供的书籍规则属于写作硬约束。",
        }));
      }

      if (input.complianceRules && input.complianceRules.length > 0) {
        cards.push(createHardTextCard({
          id: `hard:compliance:${input.bookId}`,
          bookId: input.bookId,
          sourceId: "compliance-rules",
          title: "平台/合规硬规则",
          content: input.complianceRules.map((rule) => `- ${rule}`).join("\n"),
          tags: ["compliance"],
          reason: "平台/合规规则必须优先注入，避免生成不可发布内容。",
        }));
      }

      if (cards.length === 0) {
        warnings.push("hard channel 为空：未找到全书硬规则经纬、书籍规则、SceneSpec constraints 或合规硬规则。");
      }

      return { cards, warnings, diagnostics };
    },
  };
}
