import { useCallback, useEffect, useMemo, useRef } from "react";
import BidirectionalList, { type BidirectionalListRef } from "broad-infinite-list/react";
import type { ToolResultArtifact } from "../../tool-results";
import { MessageItem, type ConversationSurfaceMessage, type MessageContextAction } from "./MessageItem";
import { useMessageSelection } from "./useMessageSelection";
import { SelectionActionBar } from "./SelectionActionBar";

export interface MessageStreamProps {
  messages: readonly ConversationSurfaceMessage[];
  onOpenArtifact?: (artifact: ToolResultArtifact) => void;
  onContextAction?: (messageId: string, action: MessageContextAction["id"]) => void;
  /** 是否有更早的消息可加载 */
  hasPrevious?: boolean;
  /** 加载更早消息的回调 */
  onLoadPrevious?: () => Promise<ConversationSurfaceMessage[]>;
  /** 折叠代码块 */
  codeCollapsed?: boolean;
}

export function MessageStream({ messages, onOpenArtifact, onContextAction, hasPrevious = false, onLoadPrevious, codeCollapsed = false }: MessageStreamProps) {
  const listRef = useRef<BidirectionalListRef<ConversationSurfaceMessage>>(null);
  const prevLengthRef = useRef(messages.length);

  const messageIds = useMemo(() => messages.map((m) => m.id), [messages]);
  const { selectedIds, isSelected, selectionCount, toggle, clear } = useMessageSelection(messageIds);

  // 首次加载或切换对话时滚动到底部
  useEffect(() => {
    if (messages.length > 0) {
      // 使用 requestAnimationFrame 确保 DOM 已渲染
      requestAnimationFrame(() => {
        listRef.current?.scrollToBottom("instant");
      });
    }
  }, []); // 只在组件挂载时执行一次

  // 新消息到达时自动滚动到底部
  useEffect(() => {
    if (messages.length > prevLengthRef.current) {
      // 只在新消息追加到末尾时滚动（不是加载历史消息）
      const isAppend = messages.length > 0 && prevLengthRef.current > 0;
      if (isAppend) {
        listRef.current?.scrollToBottom("smooth");
      }
    }
    prevLengthRef.current = messages.length;
  }, [messages.length]);

  const handleLoadMore = useCallback(
    async (direction: "up" | "down") => {
      if (direction === "up" && onLoadPrevious) {
        return await onLoadPrevious();
      }
      return [];
    },
    [onLoadPrevious],
  );

  const handleSelect = useCallback(
    (id: string, event: React.MouseEvent) => {
      toggle(id, { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey });
    },
    [toggle],
  );

  // Batch actions
  const handleCopy = useCallback(() => {
    const selected = messages.filter((m) => selectedIds.has(m.id));
    const markdown = selected
      .map((m) => {
        const prefix = m.role === "user" ? "**用户**" : m.role === "assistant" ? "**助手**" : `**${m.role}**`;
        return `${prefix}\n\n${m.content}`;
      })
      .join("\n\n---\n\n");
    void navigator.clipboard.writeText(markdown);
    clear();
  }, [messages, selectedIds, clear]);

  const handleDelete = useCallback(() => {
    if (!onContextAction) return;
    for (const id of selectedIds) {
      onContextAction(id, "delete");
    }
    clear();
  }, [selectedIds, onContextAction, clear]);

  const handleFork = useCallback(() => {
    const ids = Array.from(selectedIds);
    console.log("[MessageStream] Fork requested for messages:", ids);
    // TODO: Implement fork from selected messages
    clear();
  }, [selectedIds, clear]);

  const renderItem = useCallback(
    (message: ConversationSurfaceMessage) => (
      <MessageItem
        message={message}
        onOpenArtifact={onOpenArtifact}
        onContextAction={onContextAction}
        codeCollapsed={codeCollapsed}
        isSelected={isSelected(message.id)}
        onSelect={handleSelect}
      />
    ),
    [onOpenArtifact, onContextAction, codeCollapsed, isSelected, handleSelect],
  );

  const itemKey = useCallback((message: ConversationSurfaceMessage) => message.id, []);

  // 如果消息为空，不渲染列表
  if (messages.length === 0) {
    return null;
  }

  return (
    <section data-testid="message-stream" className="relative min-h-0 flex-1">
      <BidirectionalList<ConversationSurfaceMessage>
        ref={listRef}
        items={messages as ConversationSurfaceMessage[]}
        itemKey={itemKey}
        renderItem={renderItem}
        onLoadMore={handleLoadMore}
        hasPrevious={hasPrevious}
        hasNext={false}
        className="message-stream h-full"
        listClassName="space-y-1"
        threshold={200}
        spinnerRow={
          <div className="flex justify-center py-2">
            <span className="text-xs text-muted-foreground">加载中...</span>
          </div>
        }
      />
      <SelectionActionBar
        count={selectionCount}
        onCopy={handleCopy}
        onDelete={handleDelete}
        onFork={handleFork}
        onClear={clear}
      />
    </section>
  );
}

export type { ConversationSurfaceMessage };
