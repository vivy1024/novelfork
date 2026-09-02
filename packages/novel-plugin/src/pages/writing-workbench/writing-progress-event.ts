/**
 * 写作进度事件：章节保存 / 管线写章 / 章后结算完成后派发。
 * 侧栏、角色卡、写作视图监听后只重拉数据，不卸载工作台。
 */
export const WRITING_PROGRESS_EVENT = "novelfork:writing-progress";

export interface WritingProgressDetail {
  readonly reason: string;
  readonly bookId?: string;
}

export function dispatchWritingProgress(detail: WritingProgressDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WRITING_PROGRESS_EVENT, { detail }));
}

export function writingProgressBookId(event: Event): string | undefined {
  const detail = (event as CustomEvent<WritingProgressDetail>).detail;
  const bookId = detail?.bookId;
  return typeof bookId === "string" && bookId.trim() ? bookId.trim() : undefined;
}
