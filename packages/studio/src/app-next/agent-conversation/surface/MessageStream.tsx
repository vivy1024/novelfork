import { useCallback, useEffect, useRef } from "react";
import BidirectionalList, { type BidirectionalListRef } from "broad-infinite-list/react";
import type { ToolResultArtifact } from "../../tool-results";
import { MessageItem, type ConversationSurfaceMessage, type MessageContextAction } from "./MessageItem";

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

  const renderItem = useCallback(
    (message: ConversationSurfaceMessage) => (
      <MessageItem message={message} onOpenArtifact={onOpenArtifact} onContextAction={onContextAction} codeCollapsed={codeCollapsed} />
    ),
    [onOpenArtifact, onContextAction, codeCollapsed],
  );

  const itemKey = useCallback((message: ConversationSurfaceMessage) => message.id, []);

  // 如果消息为空，不渲染列表
  if (messages.length === 0) {
    return null;
  }

  return (
    <section data-testid="message-stream" className="min-h-0 flex-1">
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
    </section>
  );
}

export type { ConversationSurfaceMessage };
