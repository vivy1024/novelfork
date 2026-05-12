import type { NarratorSessionChatMessage, NarratorSessionChatRole, ToolCall, ToolCallStatus } from "./session-types";

// ---------------------------------------------------------------------------
// Block types
// ---------------------------------------------------------------------------

export interface TextBlock {
  readonly type: "text";
  readonly content: string;
}

export interface ToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly toolName: string;
  readonly input: unknown;
}

export interface ToolResultBlock {
  readonly type: "tool_result";
  readonly id: string;
  readonly toolName: string;
  readonly status: ToolCallStatus;
  readonly summary?: string;
  readonly input?: unknown;
  readonly output?: string;
  readonly duration?: number;
  readonly result?: unknown;
  readonly renderer?: string;
  readonly artifact?: unknown;
  readonly confirmation?: unknown;
  readonly error?: string;
}

export interface ReasoningBlock {
  readonly type: "reasoning";
  readonly content: string;
}

export interface ThinkingBlock {
  readonly type: "thinking";
  readonly content: string;
}

export interface RedactedThinkingBlock {
  readonly type: "redacted_thinking";
}

export interface SummaryBlock {
  readonly type: "summary";
  readonly content: string;
  readonly originalMessageCount?: number;
}

export type ConversationBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ReasoningBlock
  | ThinkingBlock
  | RedactedThinkingBlock
  | SummaryBlock;

// ---------------------------------------------------------------------------
// ConversationItem — block-based message
// ---------------------------------------------------------------------------

export interface ConversationItem {
  readonly id: string;
  readonly role: NarratorSessionChatRole;
  readonly blocks: readonly ConversationBlock[];
  readonly timestamp: number;
  readonly seq?: number;
  readonly runtime?: unknown;
  readonly metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Upgrade: NarratorSessionChatMessage → ConversationItem
// ---------------------------------------------------------------------------

export function upgradeMessage(message: NarratorSessionChatMessage): ConversationItem {
  const blocks: ConversationBlock[] = [];

  // 1. Reasoning/thinking content → ReasoningBlock
  if (message.reasoning_content) {
    blocks.push({ type: "reasoning", content: message.reasoning_content });
  }

  // 2. Tool calls → ToolUseBlock or ToolResultBlock
  if (message.toolCalls?.length) {
    for (const toolCall of message.toolCalls) {
      if (toolCall.status === "success" || toolCall.status === "error" || toolCall.result) {
        // This is a tool result (has been executed)
        blocks.push({
          type: "tool_result",
          id: toolCall.id ?? "",
          toolName: toolCall.toolName,
          status: toolCall.status ?? "success",
          summary: toolCall.summary,
          input: toolCall.input,
          output: toolCall.output,
          duration: toolCall.duration,
          result: toolCall.result,
          renderer: toolCall.renderer,
          artifact: toolCall.artifact,
          confirmation: toolCall.confirmation,
          error: toolCall.error,
        });
      } else {
        // This is a pending/running tool use
        blocks.push({
          type: "tool_use",
          id: toolCall.id ?? "",
          toolName: toolCall.toolName,
          input: toolCall.input,
        });
      }
    }
  }

  // 3. Text content → TextBlock
  // 只丢弃自动生成的工具调用模板文本（"请求调用工具..."），保留其他有意义的文本
  const textContent = message.content.trim();
  const isToolCallTemplate = !!(message.toolCalls?.length) && textContent.startsWith("请求调用工具");
  if (textContent && !isToolCallTemplate) {
    blocks.push({ type: "text", content: textContent });
  }

  // 4. If no blocks at all, create an empty text block to preserve the message
  if (blocks.length === 0 && message.content) {
    blocks.push({ type: "text", content: message.content });
  }

  return {
    id: message.id,
    role: message.role,
    blocks,
    timestamp: message.timestamp,
    seq: message.seq,
    runtime: message.runtime,
    metadata: message.metadata,
  };
}

// ---------------------------------------------------------------------------
// Downgrade: ConversationItem → NarratorSessionChatMessage
// ---------------------------------------------------------------------------

export function downgradeItem(item: ConversationItem): NarratorSessionChatMessage {
  let content = "";
  let reasoning_content: string | undefined;
  const toolCalls: ToolCall[] = [];

  for (const block of item.blocks) {
    switch (block.type) {
      case "text":
        content = content ? `${content}\n${block.content}` : block.content;
        break;
      case "reasoning":
      case "thinking":
        reasoning_content = reasoning_content ? `${reasoning_content}\n${block.content}` : block.content;
        break;
      case "tool_use":
        toolCalls.push({
          id: block.id,
          toolName: block.toolName,
          input: block.input,
          status: "pending",
        });
        break;
      case "tool_result":
        toolCalls.push({
          id: block.id,
          toolName: block.toolName,
          status: block.status,
          summary: block.summary,
          input: block.input,
          output: block.output,
          duration: block.duration,
          result: block.result as ToolCall["result"],
          renderer: block.renderer,
          artifact: block.artifact as ToolCall["artifact"],
          confirmation: block.confirmation as ToolCall["confirmation"],
          error: block.error,
        });
        break;
      case "summary":
        content = content ? `${content}\n${block.content}` : block.content;
        break;
      case "redacted_thinking":
        // No content to preserve
        break;
    }
  }

  return {
    id: item.id,
    role: item.role,
    content,
    ...(reasoning_content ? { reasoning_content } : {}),
    timestamp: item.timestamp,
    ...(item.seq !== undefined ? { seq: item.seq } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(item.runtime ? { runtime: item.runtime as NarratorSessionChatMessage["runtime"] } : {}),
    ...(item.metadata ? { metadata: item.metadata as NarratorSessionChatMessage["metadata"] } : {}),
  };
}

// ---------------------------------------------------------------------------
// Utility extractors
// ---------------------------------------------------------------------------

export function extractTextContent(item: ConversationItem): string {
  return item.blocks
    .filter((block): block is TextBlock | SummaryBlock => block.type === "text" || block.type === "summary")
    .map((block) => block.content)
    .join("\n");
}

export function extractToolCalls(item: ConversationItem): readonly (ToolUseBlock | ToolResultBlock)[] {
  return item.blocks.filter(
    (block): block is ToolUseBlock | ToolResultBlock => block.type === "tool_use" || block.type === "tool_result",
  );
}

export function extractReasoningContent(item: ConversationItem): string | undefined {
  const reasoning = item.blocks
    .filter((block): block is ReasoningBlock | ThinkingBlock => block.type === "reasoning" || block.type === "thinking")
    .map((block) => block.content)
    .join("\n");
  return reasoning || undefined;
}

export function hasToolBlocks(item: ConversationItem): boolean {
  return item.blocks.some((block) => block.type === "tool_use" || block.type === "tool_result");
}
