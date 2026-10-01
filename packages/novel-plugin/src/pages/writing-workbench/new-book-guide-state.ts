/**
 * 建书十一问（NewBookGuide）的完成状态。
 *
 * 作品总览画布据此决定显示十一问还是作品仪表盘，写作侧栏据此决定引导作者
 * 「先回答建书十一问」还是「补全本章焦点」。两处必须读同一个判据，否则侧栏说
 * 去答十一问、点过去却看不到十一问。
 *
 * 判据沿用十一问上线时的约定：书里已有章节，或本机记过「已完成」。
 */

import { useEffect, useState } from "react";

import type { WorkbenchResourceNode } from "./useWorkbenchResources";

/** 十一问完成后派发，写作侧栏据此刷新引导卡。detail: { bookId } */
export const NEW_BOOK_GUIDE_COMPLETED_EVENT = "novelfork:new-book-guide-completed";

export function newBookGuideStorageKey(bookId: string): string {
  return `novelfork:guide-completed:${bookId}`;
}

export function readNewBookGuideCompleted(bookId: string | undefined): boolean {
  if (!bookId) return false;
  try {
    return localStorage.getItem(newBookGuideStorageKey(bookId)) === "true";
  } catch {
    return false;
  }
}

export function markNewBookGuideCompleted(bookId: string): void {
  try {
    localStorage.setItem(newBookGuideStorageKey(bookId), "true");
  } catch {
    /* 存储不可用时只影响本机记忆，不阻断流程 */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(NEW_BOOK_GUIDE_COMPLETED_EVENT, { detail: { bookId } }));
  }
}

/** 资源树里是否已有章节节点；有章节的书不再显示十一问。 */
export function containsChapterNode(nodes: readonly WorkbenchResourceNode[] | undefined): boolean {
  return nodes?.some((node) => node.kind === "chapter" || containsChapterNode(node.children)) ?? false;
}

/** 当前书是否已答过十一问（本机记录），并在十一问完成时自动更新。 */
export function useNewBookGuideCompleted(bookId: string | undefined): boolean {
  const [completed, setCompleted] = useState(() => readNewBookGuideCompleted(bookId));

  useEffect(() => {
    setCompleted(readNewBookGuideCompleted(bookId));
    if (!bookId || typeof window === "undefined") return;
    // 事件本身就代表「这本书答完了」：本机存储不可用时也要在本次会话里生效。
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ bookId?: string }>).detail;
      if (detail?.bookId === bookId) setCompleted(true);
    };
    window.addEventListener(NEW_BOOK_GUIDE_COMPLETED_EVENT, handler);
    return () => window.removeEventListener(NEW_BOOK_GUIDE_COMPLETED_EVENT, handler);
  }, [bookId]);

  return completed;
}
