/**
 * Context Compaction — 对标 Claude Code + NarraFork 双档压缩策略
 *
 * 核心机制：
 * 1. 双档阈值：标准窗口（≤600k）和大窗口（>600k）各有独立的裁剪/压缩阈值
 * 2. 渐进式裁剪（truncate）：达到裁剪阈值时丢弃最旧消息，不调用 LLM
 * 3. 结构化压缩（compact）：达到压缩阈值时调用摘要模型生成 9 段结构化摘要
 * 4. 压缩后恢复：恢复最近操作的关键文件上下文
 *
 * 对标：
 * - Claude Code: src/services/compact/compact.ts (结构化 9 段摘要 + <analysis>/<summary>)
 * - Claude Code: src/services/compact/prompt.ts (NO_TOOLS_PREAMBLE + BASE_COMPACT_PROMPT)
 * - NarraFork: 双档阈值（标准/大窗口）+ 渐进式裁剪 + compressionKeepTurns
 */

import { cascadeCompact } from "./compact/cascade-compact.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 当消息 tokens 超过摘要模型窗口的此比例时，使用 cascade compact */
const CASCADE_COMPACT_THRESHOLD = 0.8;

export const POST_COMPACT_MAX_FILES_TO_RESTORE = 5;
export const POST_COMPACT_TOKEN_BUDGET = 50_000;
export const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000;

/** 大窗口阈值：超过此 token 数使用大窗口档位配置 */
const LARGE_WINDOW_THRESHOLD = 600_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompactMessage {
  readonly id?: string;
  readonly role: "system" | "user" | "assistant" | "tool_result";
  readonly content: string;
  readonly toolCalls?: readonly { readonly id: string; readonly toolName: string }[];
}

export interface CompactionThresholds {
  /** 开始裁剪的上下文占用百分比 */
  readonly truncatePercent: number;
  /** 开始压缩的上下文占用百分比 */
  readonly compressPercent: number;
  /** 已裁剪消息比例达到此值时强制压缩 */
  readonly maxTruncateRatio: number;
  /** 压缩后保留的最近对话轮数（每轮 = 1 user + 1 assistant） */
  readonly keepTurns: number;
}

export interface CompactInput {
  readonly messages: readonly CompactMessage[];
  readonly maxContextTokens: number;
  readonly thresholds: CompactionThresholds;
  /** Session ID，用于 circuit breaker 按 session 隔离失败计数 */
  readonly sessionId?: string;
  /** 调用摘要模型生成结构化摘要（传入完整消息列表作为 context） */
  readonly summarize: (messages: readonly CompactMessage[], customInstructions?: string) => Promise<string>;
  /** 压缩后恢复的关键文件路径 */
  readonly recentFilePaths?: readonly string[];
  /** 读取文件内容的回调 */
  readonly readFile?: (path: string) => Promise<string | null>;
  /** 用户自定义压缩指令 */
  readonly customInstructions?: string;
  /** 摘要模型的上下文窗口大小（tokens），用于判断是否需要 cascade compact */
  readonly summaryModelContextWindow?: number;
  /** 调用摘要模型的原始函数（cascade compact 需要） */
  readonly generateSummary?: (prompt: string) => Promise<string>;
  /** Abort signal for cancellation */
  readonly signal?: AbortSignal;
  /** Progress callback for cascade compact (0-100) */
  readonly onProgress?: (progress: number) => void;
}

export interface CompactResult {
  readonly compacted: boolean;
  readonly truncated: boolean;
  readonly messages: CompactMessage[];
  readonly compactedMessageCount: number;
  readonly keptMessageCount: number;
  readonly summaryTokens?: number;
  readonly restoredFileCount?: number;
  readonly preCompactTokens?: number;
  readonly postCompactTokens?: number;
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Token 估算：CJK ~1.5 tokens/char, English ~0.25 tokens/char
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;

  // 检测 JSON 内容（token 更密集）
  const isJson = text.length > 2 && (text[0] === "{" || text[0] === "[");

  let cjkChars = 0;
  for (const char of text) {
    if (char.charCodeAt(0) > 0x2E80) cjkChars++;
  }
  const nonCjk = text.length - cjkChars;

  let estimate: number;
  if (isJson) {
    // JSON 内容：每 2 字符约 1 token（密集）
    estimate = Math.ceil(text.length / 2);
  } else {
    // CJK ×1.5，非 CJK ÷4
    estimate = Math.ceil(cjkChars * 1.5 + nonCjk / 4);
  }

  // 保守系数 ×4/3（参考 Claude Code，避免低估导致 prompt_too_long）
  return Math.ceil(estimate * 4 / 3);
}

function totalTokens(messages: readonly CompactMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokenCount(msg.content), 0);
}

// ---------------------------------------------------------------------------
// Threshold selection
// ---------------------------------------------------------------------------

/**
 * 根据模型上下文窗口大小选择对应档位的阈值。
 * 对齐 NarraFork 的双档策略：标准（≤600k）和大窗口（>600k）。
 */
export function selectThresholds(
  maxContextTokens: number,
  config: {
    contextCompressionThresholdPercent: number;
    contextTruncateTargetPercent: number;
    largeWindowCompressionThresholdPercent: number;
    largeWindowTruncateTargetPercent: number;
    compressionKeepTurns: number;
    maxTruncateRatio: number;
  },
): CompactionThresholds {
  const isLargeWindow = maxContextTokens > LARGE_WINDOW_THRESHOLD;
  return {
    truncatePercent: isLargeWindow
      ? config.largeWindowTruncateTargetPercent
      : config.contextTruncateTargetPercent,
    compressPercent: isLargeWindow
      ? config.largeWindowCompressionThresholdPercent
      : config.contextCompressionThresholdPercent,
    maxTruncateRatio: config.maxTruncateRatio,
    keepTurns: config.compressionKeepTurns,
  };
}

// ---------------------------------------------------------------------------
// Trigger detection
// ---------------------------------------------------------------------------

export type CompactionAction = "none" | "truncate" | "compress";

/**
 * 判断当前应该执行什么操作：无操作 / 渐进式裁剪 / 结构化压缩
 */
export function detectCompactionAction(
  messages: readonly CompactMessage[],
  maxContextTokens: number,
  thresholds: CompactionThresholds,
): CompactionAction {
  const tokens = totalTokens(messages);
  const usagePercent = (tokens / maxContextTokens) * 100;

  if (usagePercent >= thresholds.compressPercent) {
    return "compress";
  }
  if (usagePercent >= thresholds.truncatePercent) {
    return "truncate";
  }
  return "none";
}

/**
 * 兼容旧接口：简单的阈值检查
 */
export function shouldTriggerCompaction(
  messages: readonly CompactMessage[],
  options: { maxTokens: number; thresholdPercent: number },
): boolean {
  const tokens = totalTokens(messages);
  const threshold = (options.maxTokens * options.thresholdPercent) / 100;
  return tokens > threshold;
}

// ---------------------------------------------------------------------------
// Truncation (渐进式裁剪)
// ---------------------------------------------------------------------------

/**
 * 渐进式裁剪：丢弃最旧的消息直到低于裁剪阈值。
 * 不调用 LLM，纯本地操作。保留最近 keepTurns 轮对话。
 */
function truncateMessages(
  messages: readonly CompactMessage[],
  maxContextTokens: number,
  thresholds: CompactionThresholds,
): { messages: CompactMessage[]; truncatedCount: number } {
  const targetTokens = (maxContextTokens * thresholds.truncatePercent) / 100 * 0.9; // 裁剪到阈值的 90%
  const keepMessageCount = thresholds.keepTurns * 2; // 每轮 = user + assistant

  // 至少保留 keepTurns 轮
  const minKeep = Math.min(keepMessageCount, messages.length);
  let dropCount = 0;

  for (let i = 0; i < messages.length - minKeep; i++) {
    const remaining = messages.slice(i + 1);
    if (totalTokens(remaining) <= targetTokens) {
      dropCount = i + 1;
      break;
    }
    dropCount = i + 1;
  }

  if (dropCount === 0) {
    return { messages: [...messages], truncatedCount: 0 };
  }

  const kept = messages.slice(dropCount);
  return { messages: [...kept], truncatedCount: dropCount };
}

// ---------------------------------------------------------------------------
// Compact prompt (对标 Claude Code)
// ---------------------------------------------------------------------------

const COMPACT_SYSTEM_PROMPT = "You are a helpful AI assistant tasked with summarizing conversations. Respond with TEXT ONLY. Do NOT call any tools.";

function buildCompactPrompt(customInstructions?: string): string {
  let prompt = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts. In your analysis:
1. Chronologically analyze each message. For each section identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details (file names, code snippets, function signatures, file edits)
   - Errors encountered and how they were fixed
   - User feedback, especially corrections or different approaches requested
2. Double-check for technical accuracy and completeness.

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Include full code snippets where applicable and a summary of why each file is important
4. Errors and Fixes: List all errors encountered and how they were fixed. Include user feedback
5. Problem Solving: Document problems solved and ongoing troubleshooting
6. All User Messages: List ALL user messages that are not tool results — critical for understanding feedback and changing intent
7. Pending Tasks: Outline any pending tasks explicitly asked to work on
8. Current Work: Describe precisely what was being worked on immediately before this summary, with file names and code snippets
9. Optional Next Step: The next step directly in line with the user's most recent request. Include direct quotes from the most recent conversation

Output format:
<analysis>
[Your thought process]
</analysis>

<summary>
1. Primary Request and Intent:
   [...]
2. Key Technical Concepts:
   [...]
3. Files and Code Sections:
   [...]
4. Errors and Fixes:
   [...]
5. Problem Solving:
   [...]
6. All User Messages:
   [...]
7. Pending Tasks:
   [...]
8. Current Work:
   [...]
9. Optional Next Step:
   [...]
</summary>`;

  if (customInstructions?.trim()) {
    prompt += `\n\nAdditional Summarization Instructions:\n${customInstructions}`;
  }

  return prompt;
}

/**
 * 从摘要响应中提取 <summary> 内容，去掉 <analysis> 部分。
 * 对标 Claude Code: formatCompactSummary()
 */
export function formatCompactSummary(raw: string): string {
  // Strip analysis section
  let result = raw.replace(/<analysis>[\s\S]*?<\/analysis>/i, "").trim();

  // Extract summary content
  const summaryMatch = result.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (summaryMatch?.[1]) {
    result = summaryMatch[1].trim();
  }

  // Clean up extra whitespace
  result = result.replace(/\n{3,}/g, "\n\n");

  return result;
}

// ---------------------------------------------------------------------------
// Main compact function
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Circuit breaker — 连续失败 3 次后停止重试，防止无限消耗资源
//
// Per-session 状态：用 Map 按 sessionId 隔离，避免模块级全局在多 session/
// 多 narrator 并发时互相污染（一个 session 失败不应熔断所有 session 的压缩）。
// ---------------------------------------------------------------------------

const MAX_COMPACT_FAILURES = 3;
const compactFailuresBySession = new Map<string, number>();

/** 默认 key——未提供 sessionId 时回退到单一全局桶 */
const DEFAULT_COMPACT_KEY = "__default__";

function getCompactFailures(sessionId?: string): number {
  return compactFailuresBySession.get(sessionId ?? DEFAULT_COMPACT_KEY) ?? 0;
}

function incrementCompactFailures(sessionId?: string): void {
  const key = sessionId ?? DEFAULT_COMPACT_KEY;
  compactFailuresBySession.set(key, (compactFailuresBySession.get(key) ?? 0) + 1);
}

/** 外部可调用重置（如 session 切换后）。不传 sessionId 时清空全部。 */
export function resetCompactCircuitBreaker(sessionId?: string): void {
  if (sessionId) {
    compactFailuresBySession.delete(sessionId);
  } else {
    compactFailuresBySession.clear();
  }
}

/**
 * 自动压缩：根据双档阈值决定裁剪或压缩。
 *
 * 流程：
 * 1. 检测当前 action（none / truncate / compress）
 * 2. truncate：渐进式丢弃最旧消息
 * 3. compress：调用摘要模型生成结构化摘要 + 恢复文件上下文
 */
export async function autoCompact(input: CompactInput): Promise<CompactResult> {
  // Circuit breaker: 连续失败过多时跳过（按 session 隔离）
  const failures = getCompactFailures(input.sessionId);
  if (failures >= MAX_COMPACT_FAILURES) {
    console.warn(`[autoCompact] Circuit breaker open for session=${input.sessionId ?? "default"} (${failures} consecutive failures), skipping compact`);
    return { compacted: false, truncated: false, messages: [...input.messages], compactedMessageCount: 0, keptMessageCount: input.messages.length };
  }

  const { messages, maxContextTokens, thresholds, summarize, recentFilePaths, readFile, customInstructions, summaryModelContextWindow, generateSummary, signal, onProgress } = input;

  const action = detectCompactionAction(messages, maxContextTokens, thresholds);

  if (action === "none") {
    return { compacted: false, truncated: false, messages: [...messages], compactedMessageCount: 0, keptMessageCount: messages.length };
  }

  const preCompactTokens = totalTokens(messages);

  // --- Truncate path ---
  if (action === "truncate") {
    const { messages: truncated, truncatedCount } = truncateMessages(messages, maxContextTokens, thresholds);

    // 检查裁剪比例是否超过 maxTruncateRatio → 强制压缩
    const truncateRatio = (truncatedCount / messages.length) * 100;
    if (truncateRatio < thresholds.maxTruncateRatio) {
      return {
        compacted: false,
        truncated: true,
        messages: truncated,
        compactedMessageCount: truncatedCount,
        keptMessageCount: truncated.length,
        preCompactTokens,
        postCompactTokens: totalTokens(truncated),
      };
    }
    // 裁剪比例过高，fall through 到压缩
  }

  // --- Compress path ---
  const keepMessageCount = thresholds.keepTurns * 2;
  const keepCount = Math.min(keepMessageCount, messages.length);
  const splitIndex = messages.length - keepCount;

  const olderMessages = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);

  if (olderMessages.length === 0) {
    return { compacted: false, truncated: false, messages: [...messages], compactedMessageCount: 0, keptMessageCount: messages.length };
  }

  // --- Cascade compact delegation ---
  // If older messages exceed 80% of the summary model's context window,
  // a single summarize call won't fit. Delegate to cascade compact.
  if (summaryModelContextWindow && generateSummary) {
    const olderTokens = totalTokens(olderMessages);
    if (olderTokens > summaryModelContextWindow * CASCADE_COMPACT_THRESHOLD) {
      const cascadeResult = await cascadeCompact({
        messages: olderMessages.map((m) => ({ role: m.role, content: m.content })),
        summaryModelContextWindow,
        generateSummary,
        signal,
        onProgress,
      });

      const cascadeSummaryMsg: CompactMessage = {
        id: `compact-cascade-summary-${Date.now()}`,
        role: "system",
        content: cascadeResult.compressedMessages[0]?.content ?? "[对话摘要]\n\n(cascade compact 未生成摘要)",
      };

      const compactedMessages: CompactMessage[] = [cascadeSummaryMsg, ...recentMessages];

      return {
        compacted: true,
        truncated: false,
        messages: compactedMessages,
        compactedMessageCount: olderMessages.length,
        keptMessageCount: recentMessages.length,
        summaryTokens: estimateTokenCount(cascadeSummaryMsg.content),
        preCompactTokens,
        postCompactTokens: totalTokens(compactedMessages),
      };
    }
  }

  // 调用摘要模型：传入完整旧消息列表（不是截断文本）
  let rawSummary: string;
  try {
    rawSummary = await summarize(olderMessages, customInstructions);
  } catch (err) {
    incrementCompactFailures(input.sessionId);
    throw err;
  }
  // #7: 摘要为空/纯空白也算失败（模型返回空串但不抛异常的情况）
  if (!rawSummary || rawSummary.trim().length === 0) {
    incrementCompactFailures(input.sessionId);
    throw new Error("Compact summary is empty");
  }
  const formattedSummary = formatCompactSummary(rawSummary);

  const summaryMessage: CompactMessage = {
    id: `compact-summary-${Date.now()}`,
    role: "system",
    content: `[对话摘要]\n\n${formattedSummary}`,
  };

  const compactedMessages: CompactMessage[] = [summaryMessage];

  // 恢复最近操作的关键文件上下文
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

  // Compact 成功，重置 circuit breaker（按 session）
  resetCompactCircuitBreaker(input.sessionId);

  return {
    compacted: true,
    truncated: false,
    messages: compactedMessages,
    compactedMessageCount: olderMessages.length,
    keptMessageCount: recentMessages.length,
    summaryTokens: estimateTokenCount(formattedSummary),
    restoredFileCount,
    preCompactTokens,
    postCompactTokens: totalTokens(compactedMessages),
  };
}

// ---------------------------------------------------------------------------
// Exports for session-chat-service
// ---------------------------------------------------------------------------

export { COMPACT_SYSTEM_PROMPT, buildCompactPrompt };
