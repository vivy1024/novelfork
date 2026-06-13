import type { AgentTurnItem } from "../agent-turn-runtime.js";

/**
 * 可折叠的工具名称前缀/全名。
 * 覆盖所有 I/O 工具（参考 Claude Code microCompact）。
 */
const COMPACTABLE_TOOL_PREFIXES = [
  // 通用 I/O 工具（输出量最大的来源）
  "Read",
  "Bash",
  "Grep",
  "Glob",
  "WebFetch",
  "WebSearch",
  "Edit",
  "Write",
  "Terminal",
  "Browser",
  // 注意：不折叠 "Agent" — subagent 返回的是高度提炼的研究结论，
  // 折叠成摘要等于丢失关键信息。
  // 小说领域工具
  "cockpit.",
  "pgi.",
  "jingwei.",
  "chapter.",
  "scene.",
  "pipeline.",
  "resource.",
  "health.",
  "hooks.",
  "beat.",
  "presets.",
  "style.",
  "questionnaire.",
  "narrative.",
  "guided.",
  "candidate.",
  "outline.",
  "rewrite.",
] as const;

function isCompactable(toolName: string): boolean {
  return COMPACTABLE_TOOL_PREFIXES.some(
    (prefix) => toolName === prefix || toolName.startsWith(prefix),
  );
}

function summarize(content: string, maxLen = 80): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}...`;
}

/**
 * MicroCompact: 将旧的工具结果内容替换为摘要占位符。
 * 保留最近 N 条工具结果不折叠。
 *
 * 优化点（vs 原版）：
 * - 白名单覆盖所有 I/O 工具
 * - 保留数从 3 改为 5（写作场景依赖更多上下文）
 * - 时间触发：cache 过期后更激进折叠
 * - 折叠格式包含原始长度信息
 */
export function microCompact(
  messages: readonly AgentTurnItem[],
  options?: {
    /** 保留最近多少条工具结果不折叠（默认 5） */
    keepRecentResults?: number;
    /** 上次 assistant 消息的时间戳（用于时间触发） */
    lastAssistantTimestamp?: number;
  },
): AgentTurnItem[] {
  const now = Date.now();
  const elapsed = options?.lastAssistantTimestamp
    ? now - options.lastAssistantTimestamp
    : 0;
  // Cache 过期（>60 分钟）时更激进——只保留最近 2 条
  const cacheExpired = elapsed > 60 * 60 * 1000;
  const keepRecent = cacheExpired ? 2 : (options?.keepRecentResults ?? 5);

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
    const originalLen = tr.content.length;
    return {
      type: tr.type,
      toolCallId: tr.toolCallId,
      name: tr.name,
      content: `[旧工具结果已折叠: ${tr.name} — ${summarize(tr.content)} (${originalLen}字符)]`,
      ...(tr.metadata !== undefined ? { metadata: tr.metadata } : {}),
    } satisfies AgentTurnItem;
  });
}
