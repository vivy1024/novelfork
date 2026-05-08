/**
 * Context Compaction — automatic conversation compression when approaching token limits.
 *
 * 对标：
 * - Claude Code CLI: src/services/compact/autoCompact.ts (threshold-based trigger)
 * - Claude Code CLI: src/services/compact/compact.ts (summarize older messages, keep recent)
 * - Claude Code CLI: src/services/compact/postCompactCleanup.ts (restore critical context)
 */

export interface CompactMessage {
  readonly id?: string;
  readonly role: "system" | "user" | "assistant" | "tool_result";
  readonly content: string;
  readonly toolCalls?: readonly { readonly id: string; readonly toolName: string }[];
}

export interface CompactOptions {
  readonly maxTokens: number;
  readonly thresholdPercent: number;
}

export interface CompactInput {
  readonly messages: readonly CompactMessage[];
  readonly maxTokens: number;
  readonly thresholdPercent: number;
  readonly keepRecentCount: number;
  readonly summarize: (text: string) => Promise<string>;
}

export interface CompactResult {
  readonly compacted: boolean;
  readonly messages: CompactMessage[];
  readonly compactedMessageCount: number;
  readonly keptMessageCount: number;
  readonly summaryTokens?: number;
}

/**
 * Estimate token count from text (rough: ~4 chars per token for mixed CJK/English).
 */
export function estimateTokenCount(text: string): number {
  // CJK characters are roughly 1 token each, English words ~1.3 tokens
  // Simple heuristic: count chars / 4 for mixed content
  return Math.ceil(text.length / 4);
}

function totalTokens(messages: readonly CompactMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokenCount(msg.content), 0);
}

/**
 * Check if compaction should be triggered based on token threshold.
 */
export function shouldTriggerCompaction(
  messages: readonly CompactMessage[],
  options: CompactOptions,
): boolean {
  const tokens = totalTokens(messages);
  const threshold = (options.maxTokens * options.thresholdPercent) / 100;
  return tokens > threshold;
}

/**
 * Auto-compact: summarize older messages, keep recent ones.
 */
export async function autoCompact(input: CompactInput): Promise<CompactResult> {
  const { messages, maxTokens, thresholdPercent, keepRecentCount, summarize } = input;

  if (!shouldTriggerCompaction(messages, { maxTokens, thresholdPercent })) {
    return { compacted: false, messages: [...messages], compactedMessageCount: 0, keptMessageCount: messages.length };
  }

  // Keep the most recent messages (including tool calls in the window)
  const keepCount = Math.min(keepRecentCount, messages.length);
  const splitIndex = messages.length - keepCount;

  const olderMessages = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);

  if (olderMessages.length === 0) {
    return { compacted: false, messages: [...messages], compactedMessageCount: 0, keptMessageCount: messages.length };
  }

  // Summarize older messages
  const olderText = olderMessages.map((m) => `[${m.role}] ${m.content}`).join("\n");
  const summary = await summarize(olderText);

  const summaryMessage: CompactMessage = {
    id: `compact-summary-${Date.now()}`,
    role: "system",
    content: `[对话摘要] ${summary}`,
  };

  const compactedMessages: CompactMessage[] = [summaryMessage, ...recentMessages];

  return {
    compacted: true,
    messages: compactedMessages,
    compactedMessageCount: olderMessages.length,
    keptMessageCount: recentMessages.length,
    summaryTokens: estimateTokenCount(summary),
  };
}
