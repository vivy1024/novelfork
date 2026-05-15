import type { QuestionnaireQuestion } from "../types.js";
import type { QuestionnaireAnswers } from "./apply-mapping.js";

export interface SuggestQuestionnaireAnswerInput {
  question: QuestionnaireQuestion;
  existingAnswers: QuestionnaireAnswers;
  context: {
    bookId: string;
    templateId: string;
    premise?: string;
    genre?: string;
  };
  provider?: (input: Omit<SuggestQuestionnaireAnswerInput, "provider">) => Promise<{ answer: string; reason?: string }>;
}

export interface SuggestQuestionnaireAnswerResult {
  answer: string;
  reason: string;
  degraded: boolean;
}

const degradedSuggestion: SuggestQuestionnaireAnswerResult = {
  answer: "",
  reason: "AI 建议暂不可用，请先手动填写或跳过。",
  degraded: true,
};

export async function suggestQuestionnaireAnswer(input: SuggestQuestionnaireAnswerInput): Promise<SuggestQuestionnaireAnswerResult> {
  if (!input.provider) return degradedSuggestion;
  try {
    const suggestion = await input.provider({
      question: input.question,
      existingAnswers: input.existingAnswers,
      context: input.context,
    });
    return {
      answer: suggestion.answer,
      reason: suggestion.reason ?? "基于已填问卷与当前书籍上下文生成。",
      degraded: false,
    };
  } catch {
    return degradedSuggestion;
  }
}
