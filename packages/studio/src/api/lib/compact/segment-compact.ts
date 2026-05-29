/**
 * Segment compaction: compress all messages before a given seq into a single summary.
 * Triggered manually by the user via right-click menu.
 */

import { estimateTokens } from "./compact-utils.js";

export interface SegmentCompactOptions {
  /** All messages in the session */
  messages: Array<{ role: string; content: string; seq: number; id: string }>;
  /** Compress all messages with seq < beforeSeq */
  beforeSeq: number;
  /** Function to call the summary model */
  generateSummary: (prompt: string, signal?: AbortSignal) => Promise<string>;
  /** Abort signal */
  signal?: AbortSignal;
}

export interface SegmentCompactResult {
  /** The generated summary message content */
  summaryContent: string;
  /** Number of messages that were collapsed */
  collapsedCount: number;
  /** IDs of messages that should be marked as collapsed */
  collapsedMessageIds: string[];
  /** Estimated tokens saved */
  tokensSaved: number;
}

/**
 * Perform segment compaction: compress all messages before beforeSeq into one summary.
 */
export async function segmentCompact(options: SegmentCompactOptions): Promise<SegmentCompactResult> {
  const { messages, beforeSeq, generateSummary, signal } = options;

  // Split messages into "to compress" and "to keep"
  const toCompress = messages.filter((m) => m.seq < beforeSeq);

  if (toCompress.length === 0) {
    throw new Error("No messages to compress before the specified seq");
  }

  signal?.throwIfAborted();

  // Build conversation text for compression
  const conversationText = toCompress
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n\n");

  const prompt = buildSegmentCompactPrompt(conversationText, toCompress.length);
  const summaryContent = await generateSummary(prompt, signal);

  // Calculate tokens saved
  const originalTokens = estimateTokens(conversationText);
  const summaryTokens = estimateTokens(summaryContent);
  const tokensSaved = Math.max(0, originalTokens - summaryTokens);

  return {
    summaryContent,
    collapsedCount: toCompress.length,
    collapsedMessageIds: toCompress.map((m) => m.id),
    tokensSaved,
  };
}

/**
 * Build the prompt for segment compaction.
 */
function buildSegmentCompactPrompt(conversationText: string, messageCount: number): string {
  return `## 需要压缩的对话历史（共 ${messageCount} 条消息）

${conversationText}

## 任务

请将上述对话历史压缩为一份结构化摘要。摘要应保留：
1. 用户的核心意图和目标
2. 已做出的重要决策和原因
3. 已完成的关键操作及其结果
4. 重要的上下文信息（文件路径、配置、约束等）
5. 当前状态和未解决的问题

要求：
- 简洁但信息完整
- 保留具体的技术细节（文件名、函数名、配置值等）
- 确保后续对话能基于此摘要无缝继续工作
- 不要包含无关的寒暄或重复信息`;
}
