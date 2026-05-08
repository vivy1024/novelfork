/**
 * /novel:write-next Handler — real workflow execution for generating the next chapter candidate.
 *
 * 对标 Design 7.1:
 * load policy → read context → PGI → Guided Plan → approve → Writer candidate → canvas artifact
 *
 * 当前实现: context → plan (model call) → candidate (model call)
 * 任一步失败时停止后续写入并保留已完成调查结果。
 */

export interface WriteNextContext {
  readonly ok: boolean;
  readonly bookId: string;
  readonly chapters?: readonly { readonly id: string; readonly title: string; readonly wordCount: number }[];
  readonly currentChapter?: number;
  readonly totalPlanned?: number;
  readonly error?: string;
}

export interface WriteNextGenerateInput {
  readonly systemPrompt: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
}

export interface WriteNextGenerateResult {
  readonly success: boolean;
  readonly type: "message" | "tool_use";
  readonly content?: string;
}

export interface WriteNextWorkflowInput {
  readonly bookId: string;
  readonly sessionId: string;
  readonly generate: (input: { messages: readonly { role: string; content: string }[] }) => Promise<WriteNextGenerateResult>;
  readonly readContext: (bookId: string) => Promise<WriteNextContext>;
  readonly modelId?: string;
  readonly providerId?: string;
}

export interface WriteNextWorkflowResult {
  readonly ok: boolean;
  readonly steps: readonly string[];
  readonly candidateContent?: string;
  readonly candidateWordCount?: number;
  readonly error?: string;
  readonly preservedContext?: WriteNextContext;
}

const PLAN_SYSTEM_PROMPT = `你是一个小说规划代理。基于当前书籍上下文，为下一章生成简短的写作计划（1-3句话描述章节主要事件和目标）。`;

const WRITE_SYSTEM_PROMPT = `你是一个小说写作代理。基于写作计划，生成完整的章节正文。要求：
- 保持与前文的连续性
- 字数在 2000-5000 字之间
- 不要写章节标题以外的元信息`;

export async function executeWriteNextWorkflow(input: WriteNextWorkflowInput): Promise<WriteNextWorkflowResult> {
  const { bookId, generate, readContext } = input;
  const steps: string[] = [];

  // Step 1: Read context
  const context = await readContext(bookId);
  if (!context.ok) {
    return { ok: false, steps, error: context.error ?? "Context read failed: Book not found" };
  }
  steps.push("context");

  // Step 2: Generate plan
  const nextChapterNum = (context.currentChapter ?? 0) + 1;
  const contextSummary = context.chapters?.length
    ? `当前进度：${context.chapters.length} 章已完成，计划 ${context.totalPlanned} 章。最近章节：${context.chapters.slice(-3).map((c) => c.title).join("、")}。`
    : `新书，尚无章节。计划 ${context.totalPlanned ?? "未定"} 章。`;

  let plan: string;
  try {
    const planResult = await generate({
      messages: [
        { role: "system", content: PLAN_SYSTEM_PROMPT },
        { role: "user", content: `书籍 ID: ${bookId}\n${contextSummary}\n\n请为第 ${nextChapterNum} 章生成写作计划。` },
      ],
    });
    if (!planResult.success || !planResult.content) {
      return { ok: false, steps, error: "Plan generation failed", preservedContext: context };
    }
    plan = planResult.content;
    steps.push("plan");
  } catch (error) {
    return { ok: false, steps, error: `Model unavailable: ${error instanceof Error ? error.message : String(error)}`, preservedContext: context };
  }

  // Step 3: Generate candidate chapter
  try {
    const candidateResult = await generate({
      messages: [
        { role: "system", content: WRITE_SYSTEM_PROMPT },
        { role: "user", content: `写作计划：${plan}\n\n${contextSummary}\n\n请生成第 ${nextChapterNum} 章完整正文。` },
      ],
    });
    if (!candidateResult.success || !candidateResult.content) {
      return { ok: false, steps, error: "Candidate generation failed", preservedContext: context };
    }
    steps.push("candidate");

    const candidateContent = candidateResult.content;
    const candidateWordCount = candidateContent.length; // CJK: 1 char ≈ 1 word

    return {
      ok: true,
      steps,
      candidateContent,
      candidateWordCount,
    };
  } catch (error) {
    return { ok: false, steps, error: `Candidate generation failed: ${error instanceof Error ? error.message : String(error)}`, preservedContext: context };
  }
}
