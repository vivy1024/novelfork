import { memo, useCallback, useState } from "react";
import { AnimatedMarkdown } from "flowtoken";
import "flowtoken/dist/styles.css";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { ToolCallCard, type ConversationToolCall } from "./ToolCallCard";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";

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
  /** 消息元数据（如压缩摘要信息） */
  metadata?: Record<string, unknown>;
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
  codeCollapsed?: boolean;
}

/**
 * 推理内容折叠块 — 对标 NarraFork `🔮 推理—"摘要预览..."`
 */
function ThinkingBlock({ block, defaultExpanded = false }: { block: ConversationThinkingBlock; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const preview = block.summary || block.content.slice(0, 40).replace(/\n/g, " ");

  return (
    <div className="my-1.5">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 justify-start rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors text-muted-foreground"
      >
        <span>🔮</span>
        <span className="font-medium">推理</span>
        <span className="flex-1 truncate italic">—"{preview}"</span>
        <span className="text-[10px]">{expanded ? "▼" : "▶"}</span>
      </Button>
      {expanded && (
        <div className="ml-6 mt-1 rounded-md border border-border bg-muted/20 p-3 text-xs font-mono whitespace-pre-wrap leading-relaxed text-muted-foreground max-h-80 overflow-y-auto">
          {block.content}
        </div>
      )}
    </div>
  );
}

export const MessageItem = memo(function MessageItem({ message, onContextAction, codeCollapsed = false }: MessageItemProps) {
  const handleAction = useCallback((action: MessageContextAction["id"]) => {
    onContextAction?.(message.id, action);
  }, [onContextAction, message.id]);

  if (message.role === "system") {
    const isCompactSummary = message.metadata?.kind === "session-compact-summary";
    if (isCompactSummary) {
      const meta = message.metadata as Record<string, unknown>;
      const compactedCount = typeof meta.compactedMessageCount === "number" ? meta.compactedMessageCount : 0;
      const budget = meta.budget as { estimatedTokensBefore?: number; estimatedTokensAfter?: number } | undefined;
      const sessionId = typeof meta.sessionId === "string" ? meta.sessionId : "";
      return (
        <div className="mx-auto max-w-lg py-2" data-testid="compact-summary-card">
          <details className="rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-orange-700 dark:text-orange-300 flex items-center gap-1.5">
              <span>✦ 上下文已压缩</span>
              <span className="text-[10px] text-orange-500">（{compactedCount} 条消息{budget?.estimatedTokensBefore ? `，${Math.round((budget.estimatedTokensBefore - (budget.estimatedTokensAfter ?? 0)) / 1000)}k tokens 释放` : ""}）</span>
            </summary>
            <div className="mt-2 text-[11px] text-muted-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">
              {message.content}
            </div>
            {sessionId && (
              <div className="mt-2 flex gap-2 border-t border-orange-200 dark:border-orange-800 pt-2">
                <button
                  type="button"
                  className="text-[10px] text-orange-600 hover:text-orange-800 dark:text-orange-400"
                  onClick={() => {
                    void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/compact/undo`, { method: "POST" })
                      .then(() => window.location.reload());
                  }}
                >
                  撤回压缩
                </button>
                <button
                  type="button"
                  className="text-[10px] text-orange-600 hover:text-orange-800 dark:text-orange-400"
                  onClick={() => {
                    const newSummary = prompt("编辑压缩摘要：", message.content);
                    if (newSummary !== null) {
                      void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/compact/edit-summary`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ summary: newSummary }),
                      }).then(() => window.location.reload());
                    }
                  }}
                >
                  编辑摘要
                </button>
              </div>
            )}
          </details>
        </div>
      );
    }
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
        <div className={`max-w-[90%] ${codeCollapsed ? "[&_pre]:hidden [&_.code-block]:hidden" : ""}`}>
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
            <ToolCallCard key={toolCall.id} toolCall={toolCall} />
          ))}
        </div>
      </ContextMenuTrigger>
      <MessageContextMenuContent onAction={handleAction} />
    </ContextMenu>
  );
});

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
