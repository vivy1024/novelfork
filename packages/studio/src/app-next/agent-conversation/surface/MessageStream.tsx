import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BidirectionalList, { type BidirectionalListRef } from "broad-infinite-list/react";
import { ArrowDown } from "lucide-react";
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

/** 判断是否在底部附近（距底部 < threshold px） */
function isNearBottom(ref: BidirectionalListRef<ConversationSurfaceMessage> | null, threshold = 80): boolean {
  if (!ref) return true;
  try {
    return ref.getBottomDistance() < threshold;
  } catch {
    return true;
  }
}

export function MessageStream({ messages, onOpenArtifact, onContextAction, hasPrevious = false, onLoadPrevious, codeCollapsed = false }: MessageStreamProps) {
  const listRef = useRef<BidirectionalListRef<ConversationSurfaceMessage>>(null);
  const prevLengthRef = useRef(messages.length);
  /** 用户是否手动向上滚动（打断了自动下滑） */
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  /** 是否正在执行程序化滚动（避免误判为用户操作） */
  const programmaticScrollRef = useRef(false);

  const messageIds = useMemo(() => messages.map((m) => m.id), [messages]);
  const { selectedIds, isSelected, selectionCount, toggle, clear } = useMessageSelection(messageIds);

  // 监听滚动事件，检测用户是否手动向上滚动
  useEffect(() => {
    const scrollEl = listRef.current?.scrollViewRef?.current;
    if (!scrollEl) return;

    function handleScroll() {
      if (programmaticScrollRef.current) return;
      const nearBottom = isNearBottom(listRef.current);
      if (nearBottom) {
        setUserScrolledUp(false);
      } else {
        setUserScrolledUp(true);
      }
    }

    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", handleScroll);
  }, [messages.length]); // 重新绑定当消息列表变化时

  /** 程序化滚动到底部（不触发 userScrolledUp） */
  function scrollToBottomProgrammatic(behavior: ScrollBehavior = "instant") {
    programmaticScrollRef.current = true;
    listRef.current?.scrollToBottom(behavior);
    // 短暂延迟后恢复，避免 scroll 事件误判
    setTimeout(() => { programmaticScrollRef.current = false; }, 100);
  }

  // 首次加载或切换对话时滚动到底部
  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => {
        scrollToBottomProgrammatic("instant");
      });
    }
  }, []); // 只在组件挂载时执行一次

  // 新消息到达时自动滚动到底部（除非用户打断）
  useEffect(() => {
    if (messages.length > prevLengthRef.current && !userScrolledUp) {
      scrollToBottomProgrammatic("smooth");
    }
    prevLengthRef.current = messages.length;
  }, [messages.length, userScrolledUp]);

  // 流式内容更新时持续滚动到底部（除非用户打断）
  const lastMessage = messages[messages.length - 1];
  const lastMessageContent = lastMessage?.content ?? "";
  const lastMessageStreaming = lastMessage?.isStreaming ?? false;
  const lastToolCallCount = lastMessage?.toolCalls?.length ?? 0;
  useEffect(() => {
    if (!userScrolledUp && (lastMessageStreaming || lastToolCallCount > 0)) {
      scrollToBottomProgrammatic("instant");
    }
  }, [lastMessageContent, lastMessageStreaming, lastToolCallCount, userScrolledUp]);

  /** 用户点击"滚动到底部"按钮 */
  function handleScrollToBottomClick() {
    setUserScrolledUp(false);
    scrollToBottomProgrammatic("smooth");
  }

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
    if (!onContextAction) return;
    const ids = Array.from(selectedIds);
    if (ids.length > 0) {
      onContextAction(ids[0]!, "fork");
    }
    clear();
  }, [selectedIds, onContextAction, clear]);

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

      {/* 滚动到底部按钮 */}
      {userScrolledUp && (
        <button
          onClick={handleScrollToBottomClick}
          className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg hover:bg-primary/90 transition-all animate-in fade-in slide-in-from-bottom-2 duration-200"
          title="滚动到底部"
        >
          <ArrowDown className="size-3.5" />
          最新消息
        </button>
      )}

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
