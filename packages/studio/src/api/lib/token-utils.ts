/**
 * 统一 Token 估算模块（唯一来源）
 *
 * 设计原则：
 * - 本地估算只用 length / 4（Claude CLI / Codex / LegnaCLI 一致做法）
 * - 不区分 CJK（API usage 才是 ground truth，本地估算只用于增量）
 * - 所有模块必须从这里 import，禁止各自实现
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 本地消息类型约束 — 兼容 CompactMessage / NarratorSessionChatMessage */
interface MessageLike {
  readonly content?: string;
  readonly extraTokens?: number;
  readonly toolCalls?: readonly {
    readonly summary?: string;
    readonly input?: unknown;
    readonly result?: unknown;
  }[];
}

/** API usage 数据（用于 tokenCountWithEstimation） */
export interface LastApiUsage {
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
}

// ---------------------------------------------------------------------------
// 核心估算函数
// ---------------------------------------------------------------------------

/**
 * 唯一本地 token 估算函数。
 * ceil(length / 4) — 与 Claude CLI、Codex、LegnaCLI 一致。
 * 不区分中英文、不做 JSON 特判、不加保守系数。
 * API usage 才是精确来源，此函数只用于增量估算。
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * 估算单条消息的全部 token（content + toolCalls）。
 * 兼容 CompactMessage（extraTokens 已含 tool 开销）和原始 NarratorSessionChatMessage。
 */
export function estimateMessageTokens(message: MessageLike): number {
  // extraTokens 已存在（CompactMessage 预计算），直接用
  if (message.extraTokens != null) {
    return estimateTokenCount(message.content ?? "") + message.extraTokens;
  }
  // 原始消息：手动累加 toolCalls
  let chars = (message.content ?? "").length;
  if (message.toolCalls) {
    for (const tc of message.toolCalls) {
      if (tc.summary) chars += tc.summary.length;
      if (tc.input != null) chars += (JSON.stringify(tc.input) ?? "").length;
      if (tc.result != null) chars += (JSON.stringify(tc.result) ?? "").length;
    }
  }
  return Math.ceil(chars / 4);
}

/**
 * 权威上下文大小估算。
 *
 * 如果提供 lastApiUsage，返回：精确 API 值 + 本地估算后续新增消息。
 * 否则全部用本地估算。
 *
 * 参考 Claude CLI tokenCountWithEstimation + LegnaCLI 同名函数。
 */
export function tokenCountWithEstimation(
  messages: readonly MessageLike[],
  lastApiUsage?: LastApiUsage,
): number {
  // 全量估算
  const localEstimate = messages.reduce(
    (sum, msg) => sum + estimateMessageTokens(msg),
    0,
  );

  // 无 API usage 时返回全量估算
  if (!lastApiUsage) return localEstimate;

  // API 精确值（不含 output，设计修正）
  const apiTotal = lastApiUsage.inputTokens + lastApiUsage.cacheReadTokens;

  // API 值已经包含所有历史消息，本地估算只覆盖增量
  // 取 max 避免低估导致 prompt_too_long
  return Math.max(apiTotal, localEstimate);
}
