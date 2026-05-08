/**
 * Context Compaction — automatic conversation compression when approaching token limits.
 *
 * 对标：
 * - Claude Code CLI: src/services/compact/autoCompact.ts (threshold-based trigger)
 *   - 有效窗口 = 模型上下文窗口 - max(模型最大输出, 20000)
 *   - 自动压缩阈值 = 有效窗口 - 13000 buffer
 * - Claude Code CLI: src/services/compact/compact.ts (summarize older messages, keep recent)
 * - Claude Code CLI: src/services/compact/postCompactCleanup.ts (restore critical context)
 *   - POST_COMPACT_MAX_FILES_TO_RESTORE = 5
 *   - POST_COMPACT_TOKEN_BUDGET = 50_000
 *   - POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000
 */

// 对标 Claude: AUTOCOMPACT_BUFFER_TOKENS = 13_000
const AUTOCOMPACT_BUFFER_TOKENS = 13_000;
// 对标 Claude: POST_COMPACT_MAX_FILES_TO_RESTORE = 5
const POST_COMPACT_MAX_FILES_TO_RESTORE = 5;
// 对标 Claude: POST_COMPACT_TOKEN_BUDGET = 50_000
const POST_COMPACT_TOKEN_BUDGET = 50_000;
// 对标 Claude: POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000
const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000;

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
  /** 对标 Claude postCompactCleanup: 压缩后恢复的关键文件路径 */
  readonly recentFilePaths?: readonly string[];
  /** 对标 Claude postCompactCleanup: 读取文件内容的回调 */
  readonly readFile?: (path: string) => Promise<string | null>;
}

export interface CompactResult {
  readonly compacted: boolean;
  readonly messages: CompactMessage[];
  readonly compactedMessageCount: number;
  readonly keptMessageCount: number;
  readonly summaryTokens?: number;
  /** 对标 Claude: post-compact 恢复的文件数 */
  readonly restoredFileCount?: number;
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
 * Auto-compact: summarize older messages, keep recent ones, restore critical file context.
 * 对标 Claude: compactConversation() + postCompactCleanup()
 */
export async function autoCompact(input: CompactInput): Promise<CompactResult> {
  const { messages, maxTokens, thresholdPercent, keepRecentCount, summarize, recentFilePaths, readFile } = input;

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

  const compactedMessages: CompactMessage[] = [summaryMessage];

  // 对标 Claude postCompactCleanup: 恢复最近操作的关键文件上下文
  let restoredFileCount = 0;
  if (recentFilePaths && readFile) {
    let tokenBudget = POST_COMPACT_TOKEN_BUDGET;
    const filesToRestore = recentFilePaths.slice(0, POST_COMPACT_MAX_FILES_TO_RESTORE);

    for (const filePath of filesToRestore) {
      if (tokenBudget <= 0) break;
      try {
        const content = await readFile(filePath);
        if (!content) continue;
        const fileTokens = estimateTokenCount(content);
        const truncatedContent = fileTokens > POST_COMPACT_MAX_TOKENS_PER_FILE
          ? content.slice(0, POST_COMPACT_MAX_TOKENS_PER_FILE * 4) + "\n... (truncated)"
          : content;
        const actualTokens = Math.min(fileTokens, POST_COMPACT_MAX_TOKENS_PER_FILE);

        compactedMessages.push({
          id: `compact-file-${filePath}`,
          role: "system",
          content: `[文件上下文恢复: ${filePath}]\n${truncatedContent}`,
        });
        tokenBudget -= actualTokens;
        restoredFileCount++;
      } catch {
        // Skip files that can't be read
      }
    }
  }

  compactedMessages.push(...recentMessages);

  return {
    compacted: true,
    messages: compactedMessages,
    compactedMessageCount: olderMessages.length,
    keptMessageCount: recentMessages.length,
    summaryTokens: estimateTokenCount(summary),
    restoredFileCount,
  };
}
