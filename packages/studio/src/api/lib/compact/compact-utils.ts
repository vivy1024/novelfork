/**
 * Shared utilities for context compaction (cascade and segment).
 */

/**
 * Estimate token count for a string.
 * CJK characters ~1.5 tokens/char, English ~0.25 tokens/char (4 chars per token).
 */
export function estimateTokens(text: string): number {
  let cjkChars = 0;
  let otherChars = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    // CJK Unified Ideographs, CJK Extension A/B, Hangul, Kana
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x20000 && code <= 0x2a6df) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x3040 && code <= 0x30ff)
    ) {
      cjkChars++;
    } else {
      otherChars++;
    }
  }
  return Math.ceil(cjkChars * 1.5 + otherChars * 0.25);
}

/**
 * Estimate tokens for a message (role + content + metadata overhead).
 */
export function estimateMessageTokens(message: { role: string; content: string }): number {
  // ~4 tokens overhead per message for role/formatting
  return 4 + estimateTokens(message.content);
}

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
