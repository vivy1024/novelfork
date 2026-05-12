/**
 * conversation-blocks.ts — 块级对话历史模型
 *
 * 替代扁平的 RuntimeChatMessage，支持保存 provider 原始 block：
 * - DeepSeek reasoning_content
 * - Claude thinking / redacted_thinking
 * - OpenAI Responses reasoning item
 * - tool_use / tool_result
 *
 * 向后兼容：upgradeMessage / downgradeItem 实现新旧格式互转。
 */

// ---------------------------------------------------------------------------
// Block types
// ---------------------------------------------------------------------------

export type ConversationBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean }
  | { type: "reasoning"; content: string; provider: "deepseek" | "openai" }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "summary"; text: string };

// ---------------------------------------------------------------------------
// ConversationItem
// ---------------------------------------------------------------------------

export interface ConversationItem {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  blocks: ConversationBlock[];
}

// ---------------------------------------------------------------------------
// Accessors (extract from blocks)
// ---------------------------------------------------------------------------

/** Extract concatenated text content from blocks */
export function extractTextContent(item: ConversationItem): string {
  return item.blocks
    .filter((b): b is Extract<ConversationBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Extract tool calls from blocks */
export function extractToolCalls(item: ConversationItem): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  return item.blocks
    .filter((b): b is Extract<ConversationBlock, { type: "tool_use" }> => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
}

/** Extract reasoning content (DeepSeek/OpenAI) */
export function extractReasoningContent(item: ConversationItem): string | undefined {
  const block = item.blocks.find((b): b is Extract<ConversationBlock, { type: "reasoning" }> => b.type === "reasoning");
  return block?.content;
}

/** Extract thinking blocks (Claude) */
export function extractThinkingBlocks(item: ConversationItem): Array<Extract<ConversationBlock, { type: "thinking" | "redacted_thinking" }>> {
  return item.blocks.filter(
    (b): b is Extract<ConversationBlock, { type: "thinking" }> | Extract<ConversationBlock, { type: "redacted_thinking" }> =>
      b.type === "thinking" || b.type === "redacted_thinking",
  );
}

// ---------------------------------------------------------------------------
// Upgrade: RuntimeChatMessage → ConversationItem
// ---------------------------------------------------------------------------

interface LegacyToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface LegacyMessage {
  role: "system" | "user" | "assistant";
  content: string;
  toolCalls?: readonly LegacyToolUse[];
  /** DeepSeek reasoning_content (if previously saved) */
  reasoning_content?: string;
}

interface LegacyToolMessage {
  role: "tool";
  toolCallId: string;
  name?: string;
  content: string;
}

export type LegacyRuntimeChatMessage = LegacyMessage | LegacyToolMessage;

let idCounter = 0;
function generateBlockId(): string {
  return `blk_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

export function upgradeMessage(msg: LegacyRuntimeChatMessage): ConversationItem {
  if (msg.role === "tool") {
    return {
      id: generateBlockId(),
      role: "tool",
      blocks: [{ type: "tool_result", toolUseId: msg.toolCallId, content: msg.content }],
    };
  }

  const blocks: ConversationBlock[] = [];

  // Reasoning content (DeepSeek)
  if ("reasoning_content" in msg && msg.reasoning_content) {
    blocks.push({ type: "reasoning", content: msg.reasoning_content, provider: "deepseek" });
  }

  // Text content
  if (msg.content) {
    blocks.push({ type: "text", text: msg.content });
  }

  // Tool calls
  if (msg.toolCalls?.length) {
    for (const tc of msg.toolCalls) {
      blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
    }
  }

  return { id: generateBlockId(), role: msg.role, blocks };
}

// ---------------------------------------------------------------------------
// Downgrade: ConversationItem → RuntimeChatMessage (for consumers that need old format)
// ---------------------------------------------------------------------------

export function downgradeItem(item: ConversationItem): LegacyRuntimeChatMessage {
  if (item.role === "tool") {
    const result = item.blocks.find((b): b is Extract<ConversationBlock, { type: "tool_result" }> => b.type === "tool_result");
    return { role: "tool", toolCallId: result?.toolUseId ?? "", content: result?.content ?? "" };
  }

  const content = extractTextContent(item);
  const toolCalls = extractToolCalls(item);
  const reasoning = extractReasoningContent(item);

  const msg: LegacyMessage = { role: item.role as "system" | "user" | "assistant", content };
  if (toolCalls.length) (msg as LegacyMessage & { toolCalls: LegacyToolUse[] }).toolCalls = toolCalls;
  if (reasoning) msg.reasoning_content = reasoning;

  return msg;
}

// ---------------------------------------------------------------------------
// Batch upgrade/downgrade
// ---------------------------------------------------------------------------

export function upgradeMessages(messages: readonly LegacyRuntimeChatMessage[]): ConversationItem[] {
  return messages.map(upgradeMessage);
}

export function downgradeItems(items: readonly ConversationItem[]): LegacyRuntimeChatMessage[] {
  return items.map(downgradeItem);
}
