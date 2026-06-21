/**
 * Shared utilities for context compaction (cascade and segment).
 */

import { estimateTokenCount, estimateMessageTokens as _estimateMessageTokens } from "../token-utils.js";

/** Re-export with original names for backward compatibility */
export const estimateTokens = estimateTokenCount;
export const estimateMessageTokens = _estimateMessageTokens;

/**
 * Split messages into chunks where each chunk's total tokens <= tokenBudget.
 * Messages are kept in order; splits happen at message boundaries.
 */
export function splitMessagesByTokenBudget(
  messages: ReadonlyArray<{ role: string; content: string; seq?: number }>,
  tokenBudget: number,
): Array<Array<{ role: string; content: string; seq?: number }>> {
  if (messages.length === 0) return [];
  if (tokenBudget <= 0) return [Array.from(messages)];

  const chunks: Array<Array<{ role: string; content: string; seq?: number }>> = [];
  let currentChunk: Array<{ role: string; content: string; seq?: number }> = [];
  let currentTokens = 0;

  for (const message of messages) {
    const msgTokens = estimateMessageTokens(message);

    // If a single message exceeds budget, put it in its own chunk
    if (msgTokens > tokenBudget) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentTokens = 0;
      }
      chunks.push([message]);
      continue;
    }

    if (currentTokens + msgTokens > tokenBudget) {
      chunks.push(currentChunk);
      currentChunk = [message];
      currentTokens = msgTokens;
    } else {
      currentChunk.push(message);
      currentTokens += msgTokens;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Build a summary message from compressed text.
 */
export function buildSummaryMessage(summary: string, originalCount: number): { role: string; content: string } {
  return {
    role: "system",
    content: `[上下文摘要 — 以下是之前 ${originalCount} 条消息的压缩摘要]\n\n${summary}`,
  };
}
