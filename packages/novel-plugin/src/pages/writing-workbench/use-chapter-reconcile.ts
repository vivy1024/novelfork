import { useEffect, useRef } from "react";

import { fetchJson } from "@/hooks/use-api";

/** 对账发现的一次章节变更（路径相对书籍根目录）。 */
export interface ReconciledChapter {
  readonly chapterNumber: number;
  readonly path: string;
  readonly kind: "created" | "modified";
  readonly wordCount: number;
}

interface ChapterChangeFeedRead {
  readonly epoch: string;
  readonly revision: number;
  readonly changes?: readonly ReconciledChapter[];
  readonly truncated?: boolean;
}

export interface ChapterReconcileNotice {
  /** 服务重启或流水被截断：具体变更不全，调用方应整体刷新。 */
  readonly reset: boolean;
}

export const CHAPTER_RECONCILE_INTERVAL_MS = 5_000;

/**
 * 写作台打开且页面可见时定时做章节文件对账。
 *
 * 叙述者的通用写工具、Runtime 的文件编辑器与回退、外部编辑器都会绕过写作台直接改章节文件；
 * 服务端对账补做写作日志、审计过期、字数与书籍时间戳，并把变更记进按修订号递增的流水。
 * 这里记住上次看到的修订号，只取之后的变更——对账无论由谁触发，都不会漏掉通知。
 * 页面隐藏时不轮询，重新可见时立即补一次。
 */
export function useChapterReconcile(
  bookId: string | undefined,
  onChanges: (changes: readonly ReconciledChapter[], notice: ChapterReconcileNotice) => void,
  intervalMs = CHAPTER_RECONCILE_INTERVAL_MS,
): void {
  const callbackRef = useRef(onChanges);
  callbackRef.current = onChanges;

  useEffect(() => {
    if (!bookId || typeof document === "undefined") return;
    let stopped = false;
    let running = false;
    let cursor: { epoch: string; revision: number } | null = null;

    const tick = async () => {
      if (stopped || running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const query = cursor ? `?since=${cursor.revision}` : "";
        const result = await fetchJson<ChapterChangeFeedRead>(
          `/api/books/${encodeURIComponent(bookId)}/chapters/reconcile${query}`,
          { method: "POST" },
        );
        if (stopped) return;
        const previous = cursor;
        cursor = { epoch: result.epoch, revision: result.revision };
        // 首次只取基准：此前的变更已经反映在刚加载的内容里。
        if (!previous) return;
        const reset = previous.epoch !== result.epoch || result.truncated === true;
        const changes = reset ? [] : result.changes ?? [];
        if (reset || changes.length > 0) callbackRef.current(changes, { reset });
      } catch {
        // 网络抖动或书籍暂不可用：下一轮再试，不打扰作者。
      } finally {
        running = false;
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), intervalMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [bookId, intervalMs]);
}
