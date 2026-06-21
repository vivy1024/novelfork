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
  readonly cacheCreationTokens?: number;
  readonly outputTokens?: number;
}

/** 原始 API usage 字段（对应各 provider 返回结构） */
export interface RawTokenUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

/**
 * 上下文占用的【单一权威定义】——四字段全算。
 *
 * input + cache_creation + cache_read + output。
 * 对齐 Claude-Code getTokenCountFromUsage / Codex total_tokens / LegnaCLI getTokenCountFromUsage。
 *
 * 所有"上下文已用了多少 token"的判断（压缩触发、runtime 折叠、budget pressure、ring 显示）
 * 都必须以此为基准，禁止只取 input 或 input+cache_read（会严重低估导致该压缩时不压缩 / 撞 413）。
 *
 * 为什么含 output：上一轮的 output 会成为下一轮 input 的一部分，预判下一轮占用必须计入（三大参考项目一致）。
 */
export function getContextTokensFromUsage(usage: RawTokenUsage | undefined): number {
  if (!usage) return 0;
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.output_tokens ?? 0)
  );
}

/**
 * 有效上下文窗口的【单一权威定义】——全窗口扣除输出预留。
 *
 * 对齐 Claude-Code getEffectiveContextWindowSize（window - min(maxOutput, 20k)）
 * / Codex（window × 95%）。触发压缩 / 折叠 / 阈值判断的分母都应该用它，
 * 而非全窗口（否则会触发偏晚撞 413）。
 *
 * @param contextWindow 模型上下文窗口（来自 provider 配置）
 * @param maxOutputReserve 输出预留 token（默认 32768，与 adapters max_tokens 硬编码一致）
 */
export function getEffectiveContextWindow(contextWindow: number, maxOutputReserve = 32768): number {
  if (!contextWindow || contextWindow <= 0) return 0;
  return Math.max(0, contextWindow - Math.min(maxOutputReserve, contextWindow));
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
  // 每条消息有 role/formatting 结构开销，对齐 Claude CLI 估算（+4 token/消息）
  if (message.extraTokens != null) {
    return estimateTokenCount(message.content ?? "") + message.extraTokens + 4;
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
  // 每条消息有 role/formatting 结构开销，对齐 Claude CLI 估算（+4 token/消息）
  return Math.ceil(chars / 4) + 4;
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

  // API 精确值（四字段全算，对齐 getContextTokensFromUsage）
  const apiTotal =
    lastApiUsage.inputTokens +
    lastApiUsage.cacheReadTokens +
    (lastApiUsage.cacheCreationTokens ?? 0) +
    (lastApiUsage.outputTokens ?? 0);

  // API 值已经包含所有历史消息，本地估算只覆盖增量
  // 取 max 避免低估导致 prompt_too_long
  return Math.max(apiTotal, localEstimate);
}
