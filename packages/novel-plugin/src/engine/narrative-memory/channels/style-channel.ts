import type { SceneSpec } from "../../../handlers/scene-spec-handler.js";
import { estimateTokens } from "../../jingwei/context/token-budget.js";
import type { StylePreset } from "../../writing-layers/style-preset.js";
import type { NarrativeRetrievalChannel } from "../channels.js";
import { styleTextToContextCard } from "../context-card.js";
import type { NarrativeScene } from "../scene-store.js";
import {
  formatStyleExplanation,
  resolveStyleSceneTypes,
  selectStyleSamples,
  type SelectedStyleSample,
} from "../style-samples.js";
import type { NarrativeContextCard } from "../types.js";

export interface StyleSnippet {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly tags?: readonly string[];
}

export interface StyleChannelInput {
  readonly bookId: string;
  readonly styleGuideText?: string;
  readonly complianceRules?: readonly string[];
  readonly bookDesignText?: string;
  /** 本书文风预设（story/style_preset.json）；范文从这里按场景类型检索。 */
  readonly stylePreset?: StylePreset | null;
  readonly chapterNumber?: number;
  /** 本章 narrative_scene，场景类型的第一来源。 */
  readonly chapterScenes?: readonly NarrativeScene[];
  readonly sceneSpec?: SceneSpec;
  /** 章节规划文字，场景类型的最后来源。 */
  readonly planText?: string;
  /** 文风通道的 token 预算；缺省不限（仍受 4 段上限约束）。 */
  readonly budgetTokens?: number;
  /**
   * 角色声线约束的接缝：由调用方传入已成文的约束文本，本通道只负责注入与计入预算，
   * 不做任何声线推断。
   */
  readonly voiceConstraints?: string;
}

function nonEmpty(value?: string): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function lowPriority(card: NarrativeContextCard): NarrativeContextCard {
  return {
    ...card,
    priority: Math.min(card.priority, 45),
    importance: Math.min(card.importance, 55),
  };
}

/**
 * 范文整段注入或整段不注入：截断的范文会示范出残句。
 * 因此各档位内容都等于全文，预算打包器降档省不出 token，只会整张裁掉；
 * priority 比文风指南低、且按排名递减，全局超预算时排名靠后的先被裁。
 */
function sampleCard(bookId: string, sample: SelectedStyleSample): NarrativeContextCard {
  const base = styleTextToContextCard({
    bookId,
    id: `sample:${sample.key}`,
    title: sample.title,
    text: sample.text,
    tags: ["style-sample", `scene-type:${sample.sceneType}`, `transfer:${sample.transfer}`],
    reason: sample.reason,
  });
  return {
    ...base,
    normal: sample.text,
    summary: sample.text,
    brief: sample.text,
    priority: 44 - sample.rank,
    importance: Math.max(0, 50 - sample.rank),
    estimatedTokens: sample.estimatedTokens,
  };
}

export function createStyleChannel(): NarrativeRetrievalChannel<StyleChannelInput> {
  return {
    name: "style",
    run(input) {
      const cards: NarrativeContextCard[] = [];
      const warnings: string[] = [];
      const styleGuide = nonEmpty(input.styleGuideText);
      if (styleGuide) {
        cards.push(lowPriority(styleTextToContextCard({
          bookId: input.bookId,
          id: "style-guide",
          title: "文风指南",
          text: styleGuide,
          tags: ["style-guide"],
          reason: "style channel 注入本书已采纳的文风指南，不迁移来源作品的专属设定。",
        })));
      }

      const voice = nonEmpty(input.voiceConstraints);
      if (voice) {
        cards.push(lowPriority(styleTextToContextCard({
          bookId: input.bookId,
          id: "voice-constraints",
          title: "角色声线",
          text: voice,
          tags: ["voice"],
          reason: "style channel 注入调用方提供的角色声线约束，保证出场角色说话各有其声。",
        })));
      }

      // Writing Skills 不从这里注入：启用即物化到作品 .novelfork/skills/，
      // 由 Runtime 的 Skill 机制交给正在调用工具的 agent，写前另有确认硬门。
      if (input.complianceRules && input.complianceRules.length > 0) {
        cards.push(lowPriority(styleTextToContextCard({
          bookId: input.bookId,
          id: "style-compliance-rules",
          title: "合规/发布风格约束",
          text: input.complianceRules.map((rule) => `- ${rule}`).join("\n"),
          tags: ["compliance", "style"],
          reason: "style channel 注入合规/发布风格提示，作为低预算写作约束参考。",
        })));
      }

      let bookDesignCard: NarrativeContextCard | undefined;
      const bookDesign = nonEmpty(input.bookDesignText);
      if (bookDesign) {
        bookDesignCard = lowPriority(styleTextToContextCard({
          bookId: input.bookId,
          id: "book-design",
          title: "本书设计",
          text: bookDesign,
          tags: ["book-design"],
          reason: "style channel 注入本书立项/大纲/当前聚焦。",
        }));
      }

      // 预算次序：指南、声线、合规全文先占位；本书设计可降档，只按最简档占位；余下给范文。
      const reservedTokens = cards.reduce((sum, card) => sum + card.estimatedTokens, 0)
        + (bookDesignCard ? Math.max(1, estimateTokens(bookDesignCard.brief)) : 0);
      const availableTokens = input.budgetTokens === undefined ? undefined : Math.max(0, input.budgetTokens - reservedTokens);
      const sceneTypes = resolveStyleSceneTypes({
        chapterNumber: input.chapterNumber,
        chapterScenes: input.chapterScenes,
        sceneSpec: input.sceneSpec,
        planText: input.planText,
      });
      const selection = selectStyleSamples({ preset: input.stylePreset, sceneTypes, availableTokens });
      cards.push(...selection.selected.map((sample) => sampleCard(input.bookId, sample)));
      if (bookDesignCard) cards.push(bookDesignCard);
      warnings.push(...selection.explanations.map((item) => `文风范文：${formatStyleExplanation(item)}`));

      const diagnostics = {
        styleSamples: {
          ...selection.diagnostics,
          budget: {
            ...selection.diagnostics.budget,
            channelBudgetTokens: input.budgetTokens ?? null,
            reservedTokens,
          },
          voiceConstraintsProvided: Boolean(voice),
          explanations: selection.explanations,
        },
      };

      if (cards.length === 0) {
        return {
          status: "skipped",
          cards: [],
          warnings: ["style channel 为空：未提供 style guide 或合规提示。", ...warnings],
          diagnostics,
        };
      }
      return { cards, warnings, diagnostics };
    },
  };
}
