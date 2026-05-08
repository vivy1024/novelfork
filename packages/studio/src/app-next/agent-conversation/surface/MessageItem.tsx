import { useState } from "react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { ToolCallBlock } from "@/components/ToolCall/ToolCallBlock";
import type { ConversationToolCall } from "./ToolCallCard";
import { adaptConversationToolCall } from "./tool-call-adapter";

export interface ConversationThinkingBlock {
  /** 推理内容全文 */
  content: string;
  /** 可选摘要（用于折叠预览） */
  summary?: string;
}

export interface ConversationSurfaceMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ConversationToolCall[];
  /** AI 推理/思考内容块 */
  thinking?: ConversationThinkingBlock[];
}

/**
 * 推理内容折叠块 — 对标 NarraFork `🔮 推理—"摘要预览..."`
 */
function ThinkingBlock({ block, defaultExpanded = false }: { block: ConversationThinkingBlock; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const preview = block.summary || block.content.slice(0, 40).replace(/\n/g, " ");

  return (
    <div className="my-1.5">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors text-muted-foreground"
      >
        <span>🔮</span>
        <span className="font-medium">推理</span>
        <span className="flex-1 truncate italic">—"{preview}"</span>
        <span className="text-[10px]">{expanded ? "▼" : "▶"}</span>
      </button>
      {expanded && (
        <div className="ml-6 mt-1 rounded-md border border-border bg-muted/20 p-3 text-xs font-mono whitespace-pre-wrap leading-relaxed text-muted-foreground max-h-80 overflow-y-auto">
          {block.content}
        </div>
      )}
    </div>
  );
}

export function MessageItem({ message }: { message: ConversationSurfaceMessage; onOpenArtifact?: unknown }) {
  if (message.role === "system") {
    return (
      <div className="mx-auto max-w-lg py-1 text-center text-xs text-muted-foreground">
        {message.content}
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end py-2">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  // assistant or tool
  return (
    <div className="py-2">
      <div className="max-w-[90%]">
        {message.thinking?.map((block, i) => (
          <ThinkingBlock key={`thinking-${i}`} block={block} />
        ))}
        {message.content && <MarkdownRenderer content={message.content} />}
        {message.toolCalls?.map((toolCall) => (
          <ToolCallBlock key={toolCall.id} toolCall={adaptConversationToolCall(toolCall)} />
        ))}
      </div>
    </div>
  );
}
