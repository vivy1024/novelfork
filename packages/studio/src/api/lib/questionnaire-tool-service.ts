import {
  createBookRepository,
  createQuestionnaireTemplateRepository,
  getStorageDatabase,
  seedQuestionnaireTemplates,
  submitQuestionnaireResponse,
  suggestQuestionnaireAnswer,
  type QuestionnaireAnswers,
  type QuestionnaireQuestion,
  type QuestionnaireResponseRecord,
  type QuestionnaireTemplateRecord,
  type StorageDatabase,
} from "@vivy1024/novelfork-core";
import type { SessionToolExecutionResult } from "../../shared/agent-native-workspace.js";

export type QuestionnaireSuggestionProviderInput = {
  readonly providerId?: string;
  readonly modelId?: string;
  readonly question: QuestionnaireQuestion;
  readonly existingAnswers: QuestionnaireAnswers;
  readonly context: {
    readonly bookId: string;
    readonly templateId: string;
    readonly premise?: string;
    readonly genre?: string;
    readonly userContext?: string;
  };
};

export type QuestionnaireSuggestionProvider = (
  input: QuestionnaireSuggestionProviderInput,
) => Promise<{ readonly answer: string; readonly reason?: string }>;

export type QuestionnaireToolServiceOptions = {
  readonly storage?: StorageDatabase;
  readonly now?: () => Date;
  readonly createResponseId?: () => string;
  readonly suggestionProvider?: QuestionnaireSuggestionProvider;
};

export type QuestionnaireToolService = {
  readonly listTemplates: (input: Record<string, unknown>) => Promise<SessionToolExecutionResult>;
  readonly start: (input: Record<string, unknown>) => Promise<SessionToolExecutionResult>;
  readonly suggestAnswer: (input: Record<string, unknown>) => Promise<SessionToolExecutionResult>;
  readonly submitResponse: (input: Record<string, unknown>) => Promise<SessionToolExecutionResult>;
};

type SerializedQuestionnaireTemplate = {
  readonly id: string;
  readonly version: string;
  readonly genreTags: readonly string[];
  readonly tier: number;
  readonly targetObject: string;
  readonly questions: readonly QuestionnaireQuestion[];
  readonly isBuiltin: boolean;
  readonly createdAt: string;
};

type GuidedQuestionCard = {
  readonly id: string;
  readonly prompt: string;
  readonly type: QuestionnaireQuestion["type"];
  readonly options?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly hint?: string;
  readonly required: boolean;
  readonly source: "questionnaire";
  readonly reason: string;
  readonly mapping: {
    readonly target: "jingwei";
    readonly fieldPath: string;
    readonly transform?: string;
  };
};

export function createQuestionnaireToolService(options: QuestionnaireToolServiceOptions = {}): QuestionnaireToolService {
  return {
    listTemplates: async (input) => {
      const storage = resolveStorage(options);
      await ensureBook(storage, stringInput(input.bookId));
      await seedQuestionnaireTemplates(storage);
      const templates = await createQuestionnaireTemplateRepository(storage).list();
      return {
        ok: true,
        renderer: "questionnaire.templates",
        summary: `已读取 ${templates.length} 个问卷模板。`,
        data: {
          status: templates.length > 0 ? "available" : "empty",
          bookId: stringInput(input.bookId),
          purpose: optionalString(input.purpose),
          templates: templates.map(serializeTemplate),
        },
      };
    },
    start: async (input) => {
      const storage = resolveStorage(options);
      const bookId = stringInput(input.bookId);
      const templateId = stringInput(input.templateId);
      await ensureBook(storage, bookId);
      await seedQuestionnaireTemplates(storage);
      const template = await getTemplateOrThrow(storage, templateId);
      const questions = parseQuestions(template).map((question) => toGuidedQuestionCard(template, question));
      return {
        ok: true,
        renderer: "questionnaire.questions",
        summary: `已启动问卷模板 ${template.id}，共 ${questions.length} 个问题。`,
        data: {
          status: questions.length > 0 ? "available" : "empty",
          bookId,
          templateId: template.id,
          goal: optionalString(input.goal),
          targetObject: template.targetObject,
          questions,
        },
      };
    },
    suggestAnswer: async (input) => {
      const storage = resolveStorage(options);
      const bookId = stringInput(input.bookId);
      const templateId = stringInput(input.templateId);
      const questionId = stringInput(input.questionId);
      const providerId = optionalString(input.providerId);
      const modelId = optionalString(input.modelId);
      await ensureBook(storage, bookId);
      await seedQuestionnaireTemplates(storage);
      const template = await getTemplateOrThrow(storage, templateId);
      const question = parseQuestions(template).find((entry) => entry.id === questionId);
      if (!question) {
        throw new Error(`Questionnaire question not found: ${questionId}`);
      }
      if (!options.suggestionProvider) {
        return {
          ok: false,
          renderer: "questionnaire.suggestion",
          error: "unsupported-model",
          summary: "问卷 AI 建议需要配置支持模型。",
          data: {
            status: "unsupported",
            reason: "需要配置支持模型后才能生成问卷建议答案。",
            bookId,
            templateId,
            questionId,
            providerId,
            modelId,
          },
        };
      }
      const existingAnswers = recordInput(input.existingAnswers);
      const userContext = optionalString(input.context);
      const suggestion = await suggestQuestionnaireAnswer({
        question,
        existingAnswers,
        context: { bookId, templateId, ...(userContext ? { premise: userContext } : {}) },
        provider: (providerInput) => options.suggestionProvider!({
          providerId,
          modelId,
          question: providerInput.question,
          existingAnswers: providerInput.existingAnswers,
          context: {
            ...providerInput.context,
            ...(userContext ? { userContext } : {}),
          },
        }),
      });
      return {
        ok: true,
        renderer: "questionnaire.suggestion",
        summary: `已生成问题 ${question.id} 的建议答案。`,
        data: {
          status: "available",
          bookId,
          templateId,
          questionId,
          providerId,
          modelId,
          suggestion,
        },
      };
    },
    submitResponse: async (input) => {
      const storage = resolveStorage(options);
      const bookId = stringInput(input.bookId);
      const templateId = stringInput(input.templateId);
      await ensureBook(storage, bookId);
      await seedQuestionnaireTemplates(storage);
      const result = await submitQuestionnaireResponse({
        storage,
        bookId,
        templateId,
        responseId: optionalString(input.responseId) ?? options.createResponseId?.() ?? crypto.randomUUID(),
        answers: recordInput(input.answers),
        answeredVia: input.answeredVia === "ai-assisted" ? "ai-assisted" : "author",
        submittedAt: options.now?.() ?? new Date(),
        status: input.status === "draft" || input.status === "skipped" ? input.status : "submitted",
      });
      return {
        ok: true,
        renderer: "jingwei.mutationPreview",
        summary: `已提交问卷回答 ${result.response.id}。`,
        data: {
          status: result.response.status,
          bookId,
          templateId,
          response: serializeResponse(result.response),
          targetObjectId: result.targetObjectId,
        },
        artifact: {
          id: `questionnaire:${bookId}:${result.response.id}`,
          kind: "tool-result",
          title: "问卷回答写入结果",
          renderer: "jingwei.mutationPreview",
          openInCanvas: true,
        },
      };
    },
  };
}

function resolveStorage(options: QuestionnaireToolServiceOptions): StorageDatabase {
  return options.storage ?? getStorageDatabase();
}

async function ensureBook(storage: StorageDatabase, bookId: string): Promise<void> {
  const book = await createBookRepository(storage).getById(bookId);
  if (!book) {
    throw new Error(`Book not found: ${bookId}`);
  }
}

async function getTemplateOrThrow(storage: StorageDatabase, templateId: string): Promise<QuestionnaireTemplateRecord> {
  const template = await createQuestionnaireTemplateRepository(storage).getById(templateId);
  if (!template) {
    throw new Error(`Questionnaire template not found: ${templateId}`);
  }
  return template;
}

function serializeTemplate(template: QuestionnaireTemplateRecord): SerializedQuestionnaireTemplate {
  return {
    id: template.id,
    version: template.version,
    genreTags: parseJson(template.genreTagsJson, [] as string[]),
    tier: template.tier,
    targetObject: template.targetObject,
    questions: parseQuestions(template),
    isBuiltin: template.isBuiltin,
    createdAt: template.createdAt.toISOString(),
  };
}

function serializeResponse(response: QuestionnaireResponseRecord): Record<string, unknown> {
  return {
    ...response,
    answers: parseJson(response.answersJson, {} as Record<string, unknown>),
    createdAt: response.createdAt.toISOString(),
    updatedAt: response.updatedAt.toISOString(),
  };
}

function parseQuestions(template: QuestionnaireTemplateRecord): QuestionnaireQuestion[] {
  return parseJson(template.questionsJson, [] as QuestionnaireQuestion[]);
}

function toGuidedQuestionCard(template: QuestionnaireTemplateRecord, question: QuestionnaireQuestion): GuidedQuestionCard {
  return {
    id: question.id,
    prompt: question.prompt,
    type: question.type,
    ...(question.options ? { options: question.options } : {}),
    ...(typeof question.min === "number" ? { min: question.min } : {}),
    ...(typeof question.max === "number" ? { max: question.max } : {}),
    ...(question.hint ? { hint: question.hint } : {}),
    required: !question.defaultSkippable,
    source: "questionnaire",
    reason: question.hint ?? `来自问卷模板 ${template.id}，用于写入 ${template.targetObject}。`,
    mapping: {
      target: "jingwei",
      fieldPath: question.mapping.fieldPath,
      ...(question.mapping.transform ? { transform: question.mapping.transform } : {}),
    },
  };
}

function stringInput(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Questionnaire tool input must include a non-empty string value.");
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function recordInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
