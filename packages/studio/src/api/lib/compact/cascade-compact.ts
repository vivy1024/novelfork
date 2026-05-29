/**
 * Cascade compaction: for conversations that exceed the summary model's context window.
 * Splits history into chunks and compresses them sequentially, with each chunk's summary
 * serving as context for the next chunk.
 */

import { splitMessagesByTokenBudget, estimateTokens, buildSummaryMessage } from "./compact-utils.js";

export interface CascadeCompactOptions {
  messages: Array<{ role: string; content: string; seq?: number }>;
  /** The summary model's context window in tokens */
  summaryModelContextWindow: number;
  /** Function to call the summary model */
  generateSummary: (prompt: string, signal?: AbortSignal) => Promise<string>;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Progress callback (0-100) */
  onProgress?: (progress: number) => void;
}

export interface CascadeCompactResult {
  /** The compressed message history (summaries + recent uncompressed messages) */
  compressedMessages: Array<{ role: string; content: string }>;
  /** Number of original messages that were compressed */
  originalMessageCount: number;
  /** Estimated tokens of the compressed result */
  compressedTokenEstimate: number;
  /** Number of chunks that were compressed */
  chunksCompressed: number;
}

/**
 * Perform cascade compaction on a message history.
 *
 * Algorithm:
 * 1. Split messages into chunks (each <= 60% of summary model window)
 * 2. Keep the last chunk uncompressed (recent messages)
 * 3. Compress chunks sequentially, passing previous summary as context
 * 4. Return combined summaries + uncompressed recent messages
 */
export async function cascadeCompact(options: CascadeCompactOptions): Promise<CascadeCompactResult> {
  const { messages, summaryModelContextWindow, generateSummary, signal, onProgress } = options;

  const chunkTokenLimit = Math.floor(summaryModelContextWindow * 0.6);
  const chunks = splitMessagesByTokenBudget(messages, chunkTokenLimit);

  if (chunks.length <= 1) {
    // Nothing to cascade — single chunk fits in window
    return {
      compressedMessages: messages.map((m) => ({ role: m.role, content: m.content })),
      originalMessageCount: messages.length,
      compressedTokenEstimate: estimateTokens(messages.map((m) => m.content).join("\n")),
      chunksCompressed: 0,
    };
  }

  // Keep last chunk uncompressed
  const chunksToCompress = chunks.slice(0, -1);
  const recentChunk = chunks.at(-1)!;

  let previousSummary = "";
  const summaries: string[] = [];

  for (let i = 0; i < chunksToCompress.length; i++) {
    signal?.throwIfAborted();

    const chunk = chunksToCompress[i];
    const summary = await compressChunk(chunk, previousSummary, generateSummary, signal);
    summaries.push(summary);
    previousSummary = summary;

    onProgress?.(Math.round(((i + 1) / chunksToCompress.length) * 100));
  }

  // Build final compressed history
  const combinedSummary = summaries.join("\n\n---\n\n");
  const summaryMessage = buildSummaryMessage(combinedSummary, messages.length - recentChunk.length);

  const compressedMessages = [
    summaryMessage,
    ...recentChunk.map((m) => ({ role: m.role, content: m.content })),
  ];

  return {
    compressedMessages,
    originalMessageCount: messages.length,
    compressedTokenEstimate: estimateTokens(compressedMessages.map((m) => m.content).join("\n")),
    chunksCompressed: chunksToCompress.length,
  };
}

/**
 * Compress a single chunk of messages into a summary.
 */
async function compressChunk(
  chunk: Array<{ role: string; content: string }>,
  previousSummary: string,
  generateSummary: (prompt: string, signal?: AbortSignal) => Promise<string>,
  signal?: AbortSignal,
): Promise<string> {
  const conversationText = chunk
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n\n");

  const prompt = buildCascadePrompt(conversationText, previousSummary);
  return generateSummary(prompt, signal);
}

/**
 * Build the prompt for compressing a chunk.
 */
function buildCascadePrompt(conversationText: string, previousSummary: string): string {
  const contextSection = previousSummary
    ? `## 之前的上下文摘要\n\n${previousSummary}\n\n`
    : "";

  return `${contextSection}## 需要压缩的对话内容

${conversationText}

## 任务

请将上述对话内容压缩为一份结构化摘要，保留以下关键信息：
1. 用户的核心意图和目标
2. 已做出的重要决策
3. 已完成的关键操作和结果
4. 当前进展状态
5. 未解决的问题或待办事项

摘要应简洁但信息完整，确保后续对话能基于此摘要继续工作。`;
}
