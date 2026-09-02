import { useEffect, useRef } from "react";

import { WRITING_PROGRESS_EVENT, writingProgressBookId } from "./writing-progress-event";

/** 写章/结算后只重拉数据；bookId 不匹配时忽略。 */
export function useWritingProgressRefresh(bookId: string | undefined, onProgress: () => void): void {
  const callbackRef = useRef(onProgress);
  callbackRef.current = onProgress;

  useEffect(() => {
    if (!bookId) return;
    const handler = (event: Event) => {
      const eventBookId = writingProgressBookId(event);
      if (eventBookId && eventBookId !== bookId) return;
      callbackRef.current();
    };
    window.addEventListener(WRITING_PROGRESS_EVENT, handler);
    return () => window.removeEventListener(WRITING_PROGRESS_EVENT, handler);
  }, [bookId]);
}
