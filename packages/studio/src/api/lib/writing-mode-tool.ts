/**
 * Writing Mode Tool — real model-backed writing mode execution.
 *
 * Modes: continue (续写), rewrite (重写), expand (扩写), polish (润色)
 * Each mode calls the model with appropriate prompts and returns generated text.
 */

export type WritingMode = "continue" | "rewrite" | "expand" | "polish";

export interface WritingModeInput {
  readonly mode: WritingMode;
  readonly context: string;
  readonly selection?: string;
  readonly bookId: string;
  readonly chapterId: string;
  readonly generate: (input: { messages: readonly { role: string; content: string }[] }) => Promise<{ success: boolean; content?: string }>;
  readonly wordTarget?: number;
}

export interface WritingModeResult {
  readonly ok: boolean;
  readonly data?: {
    readonly mode: WritingMode;
    readonly generatedText: string;
    readonly wordCount: number;
  };
  readonly error?: string;
  readonly summary: string;
}

const MODE_PROMPTS: Record<WritingMode, (input: WritingModeInput) => string> = {
  continue: (input) => `基于以下上下文，续写下一段内容（200-500字）：\n\n${input.context}`,
  rewrite: (input) => `重写以下段落，使其更生动有力：\n\n原文：${input.selection}\n\n上下文：${input.context}`,
  expand: (input) => `扩写以下段落，增加细节和描写（扩展到原文2-3倍长度）：\n\n原文：${input.selection}\n\n上下文：${input.context}`,
  polish: (input) => `润色以下段落，优化文笔但保持原意：\n\n原文：${input.selection}\n\n上下文：${input.context}`,
};

export async function executeWritingModeTool(input: WritingModeInput): Promise<WritingModeResult> {
  const prompt = MODE_PROMPTS[input.mode](input);

  try {
    const result = await input.generate({
      messages: [
        { role: "system", content: "你是一个专业的中文网文写作助手。直接输出正文内容，不要加任何解释或元信息。" },
        { role: "user", content: prompt },
      ],
    });

    if (!result.success || !result.content) {
      return { ok: false, error: "Generation failed", summary: "写作模式生成失败" };
    }

    return {
      ok: true,
      data: {
        mode: input.mode,
        generatedText: result.content,
        wordCount: result.content.length,
      },
      summary: `${input.mode} 模式生成了 ${result.content.length} 字`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      summary: `写作模式执行失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
