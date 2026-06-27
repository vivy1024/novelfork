import type { NarrativeRetrievalChannel } from "../channels.js";
import { styleTextToContextCard } from "../context-card.js";
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
  readonly presets?: readonly StyleSnippet[];
  readonly beats?: readonly StyleSnippet[];
  readonly complianceRules?: readonly string[];
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

export function createStyleChannel(): NarrativeRetrievalChannel<StyleChannelInput> {
  return {
    name: "style",
    run(input) {
      const cards: NarrativeContextCard[] = [];
      const styleGuide = nonEmpty(input.styleGuideText);
      if (styleGuide) {
        cards.push(lowPriority(styleTextToContextCard({
          bookId: input.bookId,
          id: "style-guide",
          title: "文风指南",
          text: styleGuide,
          tags: ["style-guide"],
          reason: "style channel 注入文风指南，用于保持叙述口吻与句式偏好。",
        })));
      }

      for (const preset of input.presets ?? []) {
        const text = nonEmpty(preset.text);
        if (!text) continue;
        cards.push(lowPriority(styleTextToContextCard({
          bookId: input.bookId,
          id: `preset:${preset.id}`,
          title: preset.title,
          text,
          tags: ["preset", ...(preset.tags ?? [])],
          reason: "style channel 注入启用写作预设，但不得覆盖 hard/state 优先级。",
        })));
      }

      for (const beat of input.beats ?? []) {
        const text = nonEmpty(beat.text);
        if (!text) continue;
        cards.push(lowPriority(styleTextToContextCard({
          bookId: input.bookId,
          id: `beat:${beat.id}`,
          title: beat.title,
          text,
          tags: ["beat", ...(beat.tags ?? [])],
          reason: "style channel 注入节拍模板提示，用于控制章节节奏。",
        })));
      }

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

      if (cards.length === 0) {
        return { status: "skipped", cards: [], warnings: ["style channel 为空：未提供 style guide、preset、beat 或合规提示。"] };
      }
      return { cards, warnings: [] };
    },
  };
}
