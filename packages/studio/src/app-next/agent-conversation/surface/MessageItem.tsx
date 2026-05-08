import { useCallback, useState } from "react";
import { AnimatedMarkdown } from "flowtoken";
import "flowtoken/dist/styles.css";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { ToolCallBlock } from "@/components/ToolCall/ToolCallBlock";
import type { ConversationToolCall } from "./ToolCallCard";
import { adaptConversationToolCall } from "./tool-call-adapter";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

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
  /** 是否正在流式传输中（用于打字机动画） */
  isStreaming?: boolean;
}

export interface MessageContextAction {
  id: "rollback" | "fork" | "compact-before" | "edit-regenerate" | "delete";
  label: string;
  destructive?: boolean;
}

const MESSAGE_CONTEXT_ACTIONS: MessageContextAction[] = [
  { id: "rollback", label: "回退到此处" },
  { id: "fork", label: "从此处分叉" },
  { id: "compact-before", label: "压缩到此消息前" },
  { id: "edit-regenerate", label: "编辑并重新生成" },
  { id: "delete", label: "删除", destructive: true },
];

export interface MessageItemProps {
  message: ConversationSurfaceMessage;
  onOpenArtifact?: unknown;
  onContextAction?: (messageId: string, action: MessageContextAction["id"]) => void;
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

export function MessageItem({ message, onContextAction }: MessageItemProps) {
  const handleAction = useCallback((action: MessageContextAction["id"]) => {
    onContextAction?.(message.id, action);
  }, [onContextAction, message.id]);

  if (message.role === "system") {
    return (
      <div className="mx-auto max-w-lg py-1 text-center text-xs text-muted-foreground">
        {message.content}
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <ContextMenu>
        <ContextMenuTrigger className="flex justify-end py-2">
          <div className="max-w-[80%] rounded-lg border border-border bg-muted/50 px-4 py-2.5 text-sm">
            {message.content}
          </div>
        </ContextMenuTrigger>
        <MessageContextMenuContent onAction={handleAction} />
      </ContextMenu>
    );
  }

  // assistant or tool
  return (
    <ContextMenu>
      <ContextMenuTrigger className="py-2 block">
        <div className="max-w-[90%]">
          {message.thinking?.map((block, i) => (
            <ThinkingBlock key={`thinking-${i}`} block={block} />
          ))}
          {message.content && (
            message.isStreaming ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <AnimatedMarkdown content={message.content} sep="word" animationDuration="0.3s" />
              </div>
            ) : (
              <MarkdownRenderer content={message.content} />
            )
          )}
          {message.toolCalls?.map((toolCall) => (
            <ToolCallBlock key={toolCall.id} toolCall={adaptConversationToolCall(toolCall)} />
          ))}
        </div>
      </ContextMenuTrigger>
      <MessageContextMenuContent onAction={handleAction} />
    </ContextMenu>
  );
}

// ---------------------------------------------------------------------------
// MessageContextMenuContent — shadcn ContextMenu 内容
// ---------------------------------------------------------------------------

function MessageContextMenuContent({ onAction }: { onAction: (action: MessageContextAction["id"]) => void }) {
  const nonDestructive = MESSAGE_CONTEXT_ACTIONS.filter((a) => !a.destructive);
  const destructive = MESSAGE_CONTEXT_ACTIONS.filter((a) => a.destructive);

  return (
    <ContextMenuContent>
      {nonDestructive.map((action) => (
        <ContextMenuItem key={action.id} onClick={() => onAction(action.id)}>
          {action.label}
        </ContextMenuItem>
      ))}
      {destructive.length > 0 && <ContextMenuSeparator />}
      {destructive.map((action) => (
        <ContextMenuItem key={action.id} variant="destructive" onClick={() => onAction(action.id)}>
          {action.label}
        </ContextMenuItem>
      ))}
    </ContextMenuContent>
  );
}
