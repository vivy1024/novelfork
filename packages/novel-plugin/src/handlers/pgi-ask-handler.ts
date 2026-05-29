/**
 * pgi.ask handler — PGI 追问工具（三合一）。
 *
 * 合并 generate_questions + record_answers + format_answers_for_prompt：
 * - 生成追问问题
 * - 将问题格式化为 AskUserQuestion 工具可用的格式
 * - formattedDirectives 在用户回答后由后续流程填充
 */

import {
  getStorageDatabase,
  type StorageDatabase,
} from "@vivy1024/novelfork-core";
import {
  generatePGIQuestions,
  type PGIQuestion,
} from "../engine/jingwei/index.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PgiAskInput {
  bookId: string;
  chapterNumber?: number;
  chapterIntent?: string;
  maxQuestions?: number;
}

export interface PgiAskQuestionItem {
  id: string;
  prompt: string;
  type: PGIQuestion["type"];
  options: string[];
  reason: string;
  context?: Record<string, unknown>;
}

export interface AskUserQuestionInputItem {
  id: string;
  question: string;
  options: string[];
  multiSelect: boolean;
  header: string;
}

export interface PgiAskSuccessData {
  questions: PgiAskQuestionItem[];
  askUserQuestionInput: AskUserQuestionInputItem[];
  formattedDirectives?: string;
}

export interface PgiAskEmptyData {
  questions: [];
  askUserQuestionInput: null;
  skippedReason: "no-questions";
}

export interface PgiAskSuccess {
  ok: true;
  summary: string;
  data: PgiAskSuccessData | PgiAskEmptyData;
}

export interface PgiAskFailure {
  ok: false;
  error: string;
  summary: string;
}

export type PgiAskResult = PgiAskSuccess | PgiAskFailure;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveStorage(): StorageDatabase {
  return getStorageDatabase();
}

function clampMaxQuestions(value: number): number {
  return Math.min(5, Math.max(2, Math.trunc(value)));
}

function reasonForQuestion(question: PGIQuestion): string {
  if (question.id.startsWith("conflict-escalate:")) {
    return "检测到 escalating 矛盾，需要确认本章是否继续升级或推向高潮。";
  }
  if (question.id.startsWith("foreshadow-payoff:")) {
    return "检测到临近回收伏笔，需要确认本章是否兑现或延后。";
  }
  if (question.id.startsWith("arc-stalled:")) {
    return "检测到角色弧线停滞，需要确认是否推进角色成长。";
  }
  if (question.id === "outline-deviation") {
    return "检测到大纲偏离，需要确认是否调整大纲。";
  }
  return "检测到生成前隐性判断，需要作者确认。";
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * PGI 追问工具（三合一）：生成追问问题 + 返回 AskUserQuestion 格式 + 格式化用户回答为写作指示。
 */
export async function handlePgiAsk(input: PgiAskInput): Promise<PgiAskResult> {
  const { bookId, chapterNumber, chapterIntent, maxQuestions } = input;

  if (!bookId || typeof bookId !== "string" || bookId.trim().length === 0) {
    return {
      ok: false,
      error: "missing-book-id",
      summary: "缺少必填字段 bookId。",
    };
  }

  const storage = resolveStorage();
  const chapter = chapterNumber ?? 0;
  const limit = clampMaxQuestions(maxQuestions ?? 5);

  const result = await generatePGIQuestions(storage, { bookId: bookId.trim(), chapter });

  const questions = result.questions.slice(0, limit);

  // PGI 无问题生成
  if (questions.length === 0) {
    return {
      ok: true,
      summary: "PGI 无追问",
      data: {
        questions: [],
        askUserQuestionInput: null,
        skippedReason: "no-questions",
      },
    };
  }

  // 格式化问题列表
  const questionItems: PgiAskQuestionItem[] = questions.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    type: q.type,
    options: q.options,
    reason: reasonForQuestion(q),
    ...(q.context ? { context: q.context } : {}),
  }));

  // 格式化为 AskUserQuestion 工具可用的格式
  const askUserQuestionInput: AskUserQuestionInputItem[] = questions.map((q) => ({
    id: q.id,
    question: q.prompt,
    options: q.options,
    multiSelect: false,
    header: reasonForQuestion(q).slice(0, 12),
  }));

  return {
    ok: true,
    summary: `已生成 ${questionItems.length} 个 PGI 追问。请将 askUserQuestionInput 传给 AskUserQuestion 工具展示给用户。`,
    data: {
      questions: questionItems,
      askUserQuestionInput,
      formattedDirectives: undefined,
    },
  };
}
