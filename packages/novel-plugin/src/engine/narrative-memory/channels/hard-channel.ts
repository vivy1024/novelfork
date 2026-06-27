import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { SceneSpec } from "../../../handlers/scene-spec-handler.js";
import { createStoryJingweiEntryRepository } from "../../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../../jingwei/repositories/section-repo.js";
import type { StoryJingweiSectionRecord } from "../../jingwei/types.js";
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

function isHardEntryCategory(section?: StoryJingweiSectionRecord): boolean {
  const marker = `${section?.key ?? ""} ${section?.builtinKind ?? ""} ${section?.name ?? ""}`.toLowerCase();
  return /rule|rules|canon|premise|world|book_rules|硬规则|规则|基线|世界/u.test(marker);
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

      if (input.sceneSpec) {
        cards.push(...sceneSpecToContextCards({ bookId: input.bookId, sceneSpec: input.sceneSpec }).filter((card) => card.channel === "hard"));
      }

      const sections = await createStoryJingweiSectionRepository(input.storage).listEnabledForAi(input.bookId);
      const sectionById = new Map(sections.map((section) => [section.id, section]));
      const entries = await createStoryJingweiEntryRepository(input.storage).listByBook(input.bookId);
      for (const entry of entries) {
        const section = sectionById.get(entry.sectionId);
        const category = typeof entry.customFields.category === "string" ? entry.customFields.category.toLowerCase() : "";
        const isCanon = entry.layer === "canon" || entry.priorityTier === "core";
        const isRule = isHardEntryCategory(section) || /rule|rules|canon|book_rules|premise|world/u.test(category) || entry.tags.some((tag) => /rule|canon|book_rules|硬规则|规则/u.test(tag));
        if (!entry.participatesInAi || (!isCanon && !isRule)) continue;
        const card = jingweiEntryToContextCard({
          entry,
          sectionKey: section?.key,
          sectionName: section?.name,
          reason: "hard channel 读取 canon/core 经纬或书籍硬规则，作为不可直接丢弃约束。",
        });
        cards.push({ ...card, channel: "hard", priority: Math.max(card.priority, 95), importance: Math.max(card.importance, 90) });
      }

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
        warnings.push("hard channel 为空：未找到 canon 经纬、书籍规则、SceneSpec constraints 或合规硬规则。");
      }

      return { cards, warnings };
    },
  };
}
