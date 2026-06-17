/**
 * Tool Output Pruner — truncate oversized tool results before sending to LLM.
 *
 * Strategy: if a tool result exceeds MAX_TOOL_OUTPUT_CHARS, keep head + tail
 * with an omission notice in between. This preserves the most useful information
 * (beginning context + recent/ending data) while saving context space.
 *
 * Reference: legnacode-cli/src/services/compact/toolOutputPruner.ts
 */

const MAX_TOOL_OUTPUT_CHARS = 8_000;
const HEAD_CHARS = 3_000;
const TAIL_CHARS = 2_000;

/**
 * Prune a tool result string if it exceeds the threshold.
 * Returns the original string if within limits.
 */
export function pruneToolOutput(toolName: string, output: string): string {
  if (output.length <= MAX_TOOL_OUTPUT_CHARS) return output;
  const head = output.slice(0, HEAD_CHARS);
  const tail = output.slice(-TAIL_CHARS);
  const omitted = output.length - HEAD_CHARS - TAIL_CHARS;
  return `${head}\n\n[... ${omitted} 字符已省略以节约上下文空间（工具: ${toolName}） ...]\n\n${tail}`;
}
