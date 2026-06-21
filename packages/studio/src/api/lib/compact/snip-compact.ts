/**
 * SnipCompact — L3 轻量裁剪旧消息（不调 LLM）
 *
 * 策略：保留最近 keepRecent 条完整消息，旧消息替换为一条摘要占位。
 * 不拆分 tool_use/tool_result 调用链。
 * 消息数 < keepRecent × 2 时不触发。
 *
 * 对标 LegnaCLI snipCompact。
 */

import type { CompactMessage } from "../context-compaction.js";
import { estimateTokenCount } from "../token-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnipCompactResult {
  readonly messages: CompactMessage[];
  readonly snippedCount: number;
  readonly freedTokens: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 估算单条 CompactMessage 的 token 数（content + extraTokens） */
function estimateCompactTokens(m: CompactMessage): number {
  return estimateTokenCount(m.content) + (m.extraTokens ?? 0);
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * L3: 轻量裁剪旧消息。
 *
 * - 保留最近 keepRecent 条完整消息，旧消息替换为一条系统摘要。
 * - 不拆分 tool_use/tool_result 对：如果保留区首条是 tool_result，
 *   向前扫描找到最近的非 tool_result 消息，把中间部分也纳入保留。
 * - 消息数 < keepRecent × 2 时不触发。
 */
export function snipCompact(
  messages: readonly CompactMessage[],
  keepRecent: number = 10,
): SnipCompactResult {
  // 1. 消息数不足 → 不触发
  if (messages.length < keepRecent * 2) {
    return { messages: [...messages], snippedCount: 0, freedTokens: 0 };
  }

  // 2. 初始分割点
  let cutoff = messages.length - keepRecent;

  // 3. 确保不拆分 tool 调用链
  // 如果保留区的第一条消息是 tool_result，向前扫描找到最近的非 tool_result 消息，
  // 将切割点前移，使整条 tool 调用链留在保留区。
  while (cutoff > 0 && messages[cutoff]?.role === "tool_result") {
    cutoff--;
  }

  // 所有消息都是 tool_result → 不裁剪（极端情况）
  if (cutoff === 0) {
    return { messages: [...messages], snippedCount: 0, freedTokens: 0 };
  }

  const oldMessages = messages.slice(0, cutoff);
  const keepMessages = messages.slice(cutoff);

  // 4. 计算释放的 token
  const oldTokens = oldMessages.reduce(
    (sum, m) => sum + estimateCompactTokens(m),
    0,
  );

  // 5. 构造摘要消息
  const summaryMsg: CompactMessage = {
    id: `snip-compact-${Date.now()}`,
    role: "system",
    content: `[${oldMessages.length} 条消息已裁剪，约 ${oldTokens} tokens]`,
  };

  return {
    messages: [summaryMsg, ...keepMessages],
    snippedCount: oldMessages.length,
    freedTokens: oldTokens,
  };
}
