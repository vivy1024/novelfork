import type { AgentTurnItem } from "../agent-turn-runtime.js";

/**
 * 可折叠的工具名称前缀/全名。
 * 参考 Claude Code microCompact — 只折叠已知的、输出量大的工具结果。
 */
const COMPACTABLE_TOOL_PREFIXES = [
  "cockpit.get_snapshot",
  "pgi.generate_questions",
  "questionnaire.",
  "narrative.",
  "guided.",
  "candidate.",
] as const;

function isCompactable(toolName: string): boolean {
  return COMPACTABLE_TOOL_PREFIXES.some(
    (prefix) => toolName === prefix || toolName.startsWith(prefix),
  );
}

function summarize(content: string, maxLen = 50): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}...`;
}

/**
 * MicroCompact: 将旧的工具结果内容替换为摘要占位符。
 * 保留最近 N 条工具结果不折叠。
 *
 * 参考 Claude Code 的 microCompact.ts
 */
export function microCompact(
  messages: readonly AgentTurnItem[],
  options?: {
    /** 保留最近多少条工具结果不折叠（默认 3） */
    keepRecentResults?: number;
  },
): AgentTurnItem[] {
  const keepRecent = options?.keepRecentResults ?? 3;

  // 收集所有可折叠的 tool_result 索引（按出现顺序）
  const compactableIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.type === "tool_result" && isCompactable(msg.name)) {
      compactableIndices.push(i);
    }
  }

  // 从后往前保留 keepRecent 条
  const foldCount = Math.max(0, compactableIndices.length - keepRecent);
  const foldSet = new Set(compactableIndices.slice(0, foldCount));

  // 构建新数组
  return messages.map((msg, idx) => {
    if (!foldSet.has(idx)) return { ...msg };
    // 此处 msg 一定是 tool_result
    const tr = msg as Extract<AgentTurnItem, { type: "tool_result" }>;
    return {
      type: tr.type,
      toolCallId: tr.toolCallId,
      name: tr.name,
      content: `[旧工具结果已折叠: ${tr.name} — ${summarize(tr.content)}]`,
      ...(tr.metadata !== undefined ? { metadata: tr.metadata } : {}),
    } satisfies AgentTurnItem;
  });
}
