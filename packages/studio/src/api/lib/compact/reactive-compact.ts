import type { CompactMessage } from "../context-compaction.js";
import { snipCompact } from "./snip-compact.js";

// 防重复标记
const attemptedSessions = new Set<string>();

/**
 * L5: 响应式压缩 — 413/prompt_too_long 后的紧急救援。
 * 先做 snipCompact（快速，不调 LLM），再做 fullCompact。
 * 每个 session 只尝试一次，防止循环。
 */
export async function reactiveCompact(
  sessionId: string,
  messages: readonly CompactMessage[],
  fullCompact: (messages: readonly CompactMessage[]) => Promise<{ compacted: boolean; messages: CompactMessage[] }>,
): Promise<{ success: boolean; messages: CompactMessage[] }> {
  // 防重复
  if (attemptedSessions.has(sessionId)) {
    return { success: false, messages: [...messages] };
  }
  attemptedSessions.add(sessionId);

  // Step 1: 先做 snipCompact（快速，纯本地操作）
  const snipped = snipCompact(messages, 5);  // 只保留最近 5 条

  // Step 2: 再做 fullCompact（调 LLM）
  try {
    const result = await fullCompact(snipped.messages);
    if (result.compacted) {
      return { success: true, messages: result.messages };
    }
    // fullCompact 没有压缩（比如消息太少），返回 snipped 结果
    return { success: true, messages: snipped.messages };
  } catch {
    // fullCompact 失败，至少返回 snipped 的结果
    return { success: snipped.snippedCount > 0, messages: snipped.messages };
  }
}

/**
 * 重置 session 的 reactive compact 状态（压缩成功后调用）。
 */
export function resetReactiveState(sessionId: string): void {
  attemptedSessions.delete(sessionId);
}

/**
 * 检查 session 是否已尝试过 reactive compact。
 */
export function hasAttemptedReactiveCompact(sessionId: string): boolean {
  return attemptedSessions.has(sessionId);
}
