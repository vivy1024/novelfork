import {
  formatPGIAnswersForPrompt,
  generatePGIQuestions,
  getStorageDatabase,
  type PGIQuestion,
  type StorageDatabase,
} from "@vivy1024/novelfork-core";
import type {
  PgiMetadata,
  PgiQuestionMetadata,
  SessionToolExecutionResult,
} from "../../shared/agent-native-workspace.js";

type PGISkippedReason = Extract<PgiMetadata, { used: false }>["skippedReason"];

export type PGIToolServiceOptions = {
  readonly storage?: StorageDatabase;
};

export type PGIToolService = {
  readonly generateQuestions: (input: Record<string, unknown>) => Promise<SessionToolExecutionResult>;
  readonly recordAnswers: (input: Record<string, unknown>) => Promise<SessionToolExecutionResult>;
  readonly formatAnswersForPrompt: (input: Record<string, unknown>) => Promise<SessionToolExecutionResult>;
};

type PGIQuestionCard = PgiQuestionMetadata & {
  readonly type: PGIQuestion["type"];
  readonly options: readonly string[];
  readonly source: "pgi";
  readonly context?: Record<string, unknown>;
};

export function createPGIToolService(options: PGIToolServiceOptions = {}): PGIToolService {
  return {
    generateQuestions: async (input) => {
      const storage = resolveStorage(options);
      const bookId = stringInput(input.bookId, "bookId");
      const chapterNumber = numberInput(input.chapterNumber ?? input.chapter, "chapterNumber");
      const maxQuestions = clampMaxQuestions(optionalNumber(input.maxQuestions) ?? 5);
      const chapterIntent = optionalString(input.chapterIntent);
      const result = await generatePGIQuestions(storage, { bookId, chapter: chapterNumber });
      const cards = result.questions.slice(0, maxQuestions).map((question) => toQuestionCard(question, result.heuristicsTriggered));

      if (cards.length === 0) {
        const pgi: PgiMetadata = {
          used: false,
          skippedReason: "no-questions",
          questions: [],
          heuristicsTriggered: result.heuristicsTriggered,
        };
        return {
          ok: true,
          renderer: "pgi.questions",
          summary: "暂无需要澄清的生成前追问。",
          data: {
            status: "empty",
            bookId,
            chapterNumber,
            ...(chapterIntent ? { chapterIntent } : {}),
            questions: [],
            heuristicsTriggered: result.heuristicsTriggered,
          },
          pgi,
          metadata: { pgi },
        };
      }

      return {
        ok: true,
        renderer: "pgi.questions",
        summary: `已生成 ${cards.length} 个生成前追问。`,
        data: {
          status: "available",
          bookId,
          chapterNumber,
          ...(chapterIntent ? { chapterIntent } : {}),
          questions: cards,
          heuristicsTriggered: result.heuristicsTriggered,
        },
      };
    },
    recordAnswers: async (input) => {
      const bookId = stringInput(input.bookId, "bookId");
      const skippedReason = optionalSkippedReason(input.skippedReason);
      const questions = questionMetadataInput(input.questions);
      const heuristicsTriggered = stringArrayInput(input.heuristicsTriggered);

      if (skippedReason) {
        const pgi: PgiMetadata = {
          used: false,
          skippedReason,
          ...(questions.length > 0 ? { questions } : {}),
          ...(heuristicsTriggered.length > 0 ? { heuristicsTriggered } : {}),
        };
        return {
          ok: true,
          renderer: "pgi.answers",
          summary: `已记录 PGI 跳过状态：${skippedReason}。`,
          data: {
            status: "skipped",
            bookId,
            pgi,
            candidateMetadataPatch: { pgi },
          },
          pgi,
          metadata: { pgi },
        };
      }

      const answers = answersRecordInput(input.answers);
      const pgi: PgiMetadata = {
        used: true,
        questions,
        answers,
        heuristicsTriggered,
      };
      return {
        ok: true,
        renderer: "pgi.answers",
        summary: `已记录 ${Object.keys(answers).length} 条 PGI 回答。`,
        data: {
          status: "recorded",
          bookId,
          pgi,
          candidateMetadataPatch: { pgi },
        },
        pgi,
        metadata: { pgi },
      };
    },
    formatAnswersForPrompt: async (input) => {
      const bookId = stringInput(input.bookId, "bookId");
      const answers = answersRecordInput(input.answers);
      const instructions = formatPGIAnswersForPrompt(answers);
      return {
        ok: true,
        renderer: "pgi.promptInstructions",
        summary: instructions ? "已格式化 PGI 作者指示。" : "PGI 回答为空，无作者指示。",
        data: {
          status: instructions ? "available" : "empty",
          bookId,
          instructions,
          answers,
        },
      };
    },
  };
}

function resolveStorage(options: PGIToolServiceOptions): StorageDatabase {
  return options.storage ?? getStorageDatabase();
}

function toQuestionCard(question: PGIQuestion, heuristicsTriggered: readonly string[]): PGIQuestionCard {
  return {
    id: question.id,
    prompt: question.prompt,
    reason: reasonForQuestion(question),
    required: true,
    heuristicsTriggered: heuristicsForQuestion(question, heuristicsTriggered),
    type: question.type,
    options: question.options,
    source: "pgi",
    ...(question.context ? { context: question.context } : {}),
  };
}

function reasonForQuestion(question: PGIQuestion): string {
  if (question.id.startsWith("conflict-escalate:")) {
    return "检测到 escalating 矛盾，需要确认本章是否继续升级或推向高潮。";
  }
  if (question.id.startsWith("foreshadow-payoff:")) {
    return "检测到临近回收伏笔，需要确认本章是否兑现或延后。";
  }
  return "检测到生成前隐性判断，需要作者确认。";
}

function heuristicsForQuestion(question: PGIQuestion, heuristicsTriggered: readonly string[]): readonly string[] {
  if (question.id.startsWith("conflict-escalate:") && heuristicsTriggered.includes("conflict-escalating")) {
    return ["conflict-escalating"];
  }
  if (question.id.startsWith("foreshadow-payoff:") && heuristicsTriggered.includes("foreshadow-due")) {
    return ["foreshadow-due"];
  }
  return heuristicsTriggered;
}

function stringInput(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`PGI tool input must include a non-empty ${field}.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberInput(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`PGI tool input must include a numeric ${field}.`);
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampMaxQuestions(value: number): number {
  return Math.min(5, Math.max(2, Math.trunc(value)));
}

function optionalSkippedReason(value: unknown): PGISkippedReason | undefined {
  if (value === "user-skipped" || value === "no-questions" || value === "unsupported") {
    return value;
  }
  return undefined;
}

function questionMetadataInput(value: unknown): PgiQuestionMetadata[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.prompt !== "string") return [];
    return [{
      id: entry.id,
      prompt: entry.prompt,
      reason: typeof entry.reason === "string" ? entry.reason : "用户已回答生成前追问。",
      ...(typeof entry.required === "boolean" ? { required: entry.required } : {}),
      ...(Array.isArray(entry.heuristicsTriggered) ? { heuristicsTriggered: entry.heuristicsTriggered.filter((item): item is string => typeof item === "string") } : {}),
    } satisfies PgiQuestionMetadata];
  });
}

function answersRecordInput(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return Object.fromEntries(value.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const questionId = typeof entry.questionId === "string" ? entry.questionId : typeof entry.id === "string" ? entry.id : undefined;
      if (!questionId) return [];
      return [[questionId, entry.answer ?? entry.value ?? ""]];
    }));
  }
  if (isRecord(value)) {
    return { ...value };
  }
  return {};
}

function stringArrayInput(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
