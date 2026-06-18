/**
 * Context Collapse — selectively fold stale conversation segments.
 *
 * Unlike full compact (which summarizes everything), context collapse
 * identifies "stale segments" — blocks of conversation that are no longer
 * relevant — and replaces them with one-line summaries while keeping
 * recent/relevant segments intact.
 *
 * A segment is "stale" when:
 * 1. It's older than the last N assistant messages (configurable)
 * 2. Its tool results have already been acted upon (info consumed)
 * 3. It doesn't contain user decisions/instructions still in effect
 *
 * This preserves more useful context than full compact while still
 * freeing space when needed.
 */

import type { AgentTurnItem } from "../agent-turn-runtime.js";

export interface CollapseConfig {
  /** Messages newer than this count are never collapsed */
  keepRecentMessages: number;
  /** Only collapse segments where ALL tool results are consumed */
  requireConsumedResults: boolean;
  /** Minimum segment size (messages) to be worth collapsing */
  minSegmentSize: number;
}

export const DEFAULT_COLLAPSE_CONFIG: CollapseConfig = {
  keepRecentMessages: 20,
  requireConsumedResults: true,
  minSegmentSize: 4,
};

export interface CollapseResult {
  items: AgentTurnItem[];
  collapsedSegments: number;
  freedMessages: number;
}

/**
 * Identify and collapse stale segments in the message history.
 * Returns the collapsed message array.
 */
export function collapseStaleSegments(
  messages: AgentTurnItem[],
  config: CollapseConfig = DEFAULT_COLLAPSE_CONFIG,
): CollapseResult {
  if (messages.length <= config.keepRecentMessages + config.minSegmentSize) {
    return { items: messages, collapsedSegments: 0, freedMessages: 0 };
  }

  // Split into "old" (candidates for collapse) and "recent" (never touch)
  const recentStart = messages.length - config.keepRecentMessages;
  const oldMessages = messages.slice(0, recentStart);
  const recentMessages = messages.slice(recentStart);

  // Segment the old messages by "turn" (user message → assistant response → tool results)
  const segments = segmentByTurns(oldMessages, config.minSegmentSize);

  // Collapse each segment into a summary line
  const collapsedItems: AgentTurnItem[] = [];
  let collapsedCount = 0;
  let freedCount = 0;

  for (const segment of segments) {
    if (segment.length < config.minSegmentSize) {
      // Too small to collapse — keep as-is
      collapsedItems.push(...segment);
      continue;
    }

    // Check if segment contains active user decisions (keep those)
    if (hasActiveUserDecisions(segment)) {
      collapsedItems.push(...segment);
      continue;
    }

    // Collapse this segment into a one-line summary
    const summary = buildSegmentSummary(segment);
    collapsedItems.push({
      type: "message",
      role: "system",
      content: summary,
    });
    collapsedCount++;
    freedCount += segment.length - 1; // -1 for the summary we added
  }

  return {
    items: [...collapsedItems, ...recentMessages],
    collapsedSegments: collapsedCount,
    freedMessages: freedCount,
  };
}

/**
 * Split messages into segments by user-initiated turns.
 * Each segment starts with a user message and contains all following
 * assistant/tool messages until the next user message.
 */
function segmentByTurns(messages: AgentTurnItem[], minSize: number): AgentTurnItem[][] {
  const segments: AgentTurnItem[][] = [];
  let current: AgentTurnItem[] = [];

  for (const msg of messages) {
    if (msg.type === "message" && msg.role === "user" && current.length >= minSize) {
      segments.push(current);
      current = [msg];
    } else {
      current.push(msg);
    }
  }
  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

/**
 * Check if a segment contains user decisions that are still "active"
 * (e.g., "use this approach", "keep doing X", explicit instructions).
 */
function hasActiveUserDecisions(segment: AgentTurnItem[]): boolean {
  for (const msg of segment) {
    if (msg.type === "message" && msg.role === "user") {
      const content = msg.content.toLowerCase();
      // Decision indicators that should be preserved
      if (content.includes("用这个") || content.includes("就这样") ||
          content.includes("继续") || content.includes("保持") ||
          content.includes("remember") || content.includes("always") ||
          content.includes("从现在开始") || content.includes("规则")) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Build a concise one-line summary of a collapsed segment.
 */
function buildSegmentSummary(segment: AgentTurnItem[]): string {
  const userMessages = segment.filter(
    (m): m is Extract<AgentTurnItem, { type: "message" }> => m.type === "message" && m.role === "user",
  );
  const toolCalls = segment.filter(
    (m): m is Extract<AgentTurnItem, { type: "tool_call" }> => m.type === "tool_call",
  );
  const toolResults = segment.filter(m => m.type === "tool_result");

  const firstUserContent = userMessages.length > 0 ? userMessages[0].content : "";
  const userPreview = firstUserContent.slice(0, 60);
  const ellipsis = firstUserContent.length > 60 ? "…" : "";

  const toolNames = [...new Set(toolCalls.map(t => t.name))].slice(0, 4);

  return `[已折叠段落: ${segment.length} 条消息] 用户: "${userPreview}${ellipsis}" → 工具: ${toolNames.join(", ") || "无"} (${toolResults.length} 个结果)`;
}
