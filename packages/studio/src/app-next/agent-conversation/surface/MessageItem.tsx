import { useCallback, useRef, useState } from "react";
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!onContextAction || message.role === "system") return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [onContextAction, message.role]);

  const handleAction = useCallback((action: MessageContextAction["id"]) => {
    setContextMenu(null);
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
      <div className="flex justify-end py-2" ref={containerRef} onContextMenu={handleContextMenu}>
        <div className="max-w-[80%] rounded-lg border border-border bg-muted/50 px-4 py-2.5 text-sm">
          {message.content}
        </div>
        {contextMenu && <MessageContextMenu position={contextMenu} onAction={handleAction} onClose={() => setContextMenu(null)} />}
      </div>
    );
  }

  // assistant or tool
  return (
    <div className="py-2" ref={containerRef} onContextMenu={handleContextMenu}>
      <div className="max-w-[90%]">
        {message.thinking?.map((block, i) => (
          <ThinkingBlock key={`thinking-${i}`} block={block} />
        ))}
        {message.content && <MarkdownRenderer content={message.content} />}
        {message.toolCalls?.map((toolCall) => (
          <ToolCallBlock key={toolCall.id} toolCall={adaptConversationToolCall(toolCall)} />
        ))}
      </div>
      {contextMenu && <MessageContextMenu position={contextMenu} onAction={handleAction} onClose={() => setContextMenu(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageContextMenu — 右键上下文菜单
// ---------------------------------------------------------------------------

function MessageContextMenu({
  position,
  onAction,
  onClose,
}: {
  position: { x: number; y: number };
  onAction: (action: MessageContextAction["id"]) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      {/* Menu */}
      <div
        className="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-md"
        style={{ top: position.y, left: position.x }}
      >
        {MESSAGE_CONTEXT_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            className={`flex w-full items-center rounded px-2 py-1.5 text-xs hover:bg-muted ${action.destructive ? "text-destructive" : ""}`}
            onClick={() => onAction(action.id)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </>
  );
}
