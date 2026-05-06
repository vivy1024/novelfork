/**
 * StorylineTree — 叙事线书籍资源树
 *
 * 原型来自旧三栏 WorkspaceLeftRail；当前作为 Agent Shell Sidebar
 * 叙事线区域的独立组件。
 */

import type { ReactNode } from "react";

export interface BookListItem {
  readonly id: string;
  readonly title: string;
}

export interface StorylineTreeProps {
  /** 当前选中的书籍 ID */
  readonly activeBookId: string | null;
  /** 书籍列表 */
  readonly books: readonly BookListItem[];
  /** 书籍切换回调 */
  readonly onBookChange: (bookId: string) => void;
  /** 书籍节点点击回调（展开写书方式） */
  readonly onBookClick?: (bookId: string) => void;
  /** 资源树内容（由父组件传入，保持灵活性） */
  readonly children?: ReactNode;
}

export function StorylineTree({
  activeBookId,
  books,
  onBookChange,
  onBookClick,
  children,
}: StorylineTreeProps) {
  return (
    <div className="space-y-2">
      {books.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">暂无叙事线，创建一本书开始写作。</p>
      ) : (
        <div className="space-y-0.5">
          {books.map((book) => (
            <button
              key={book.id}
              type="button"
              aria-current={activeBookId === book.id ? "page" : undefined}
              className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition ${
                activeBookId === book.id
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              onClick={() => {
                onBookChange(book.id);
                onBookClick?.(book.id);
              }}
            >
              <span className="truncate">{book.title}</span>
            </button>
          ))}
        </div>
      )}
      {activeBookId && children}
    </div>
  );
}
