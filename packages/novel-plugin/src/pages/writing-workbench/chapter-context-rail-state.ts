/**
 * 「本章上下文」栏（章节编辑器右侧的到期伏笔、出场角色内核、欠账清单）的开合与宽度。
 *
 * 它嵌在中间编辑区里，不归外层三栏（侧栏 / 编辑区 / 对话）的 Allotment 管，所以单独记：
 * 按书存进 localStorage，作者收起或拖过宽度后，下次打开章节照旧。
 * 没存过时由 defaultChapterContextRailOpen 按编辑区宽度决定：放不下稿面再加这条栏，就先让稿面。
 */

export interface ChapterContextRailState {
  readonly open: boolean;
  readonly width: number;
}

export interface ChapterContextRailStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

export const CHAPTER_CONTEXT_RAIL_MIN_WIDTH = 220;
export const CHAPTER_CONTEXT_RAIL_MAX_WIDTH = 480;
export const CHAPTER_CONTEXT_RAIL_DEFAULT_WIDTH = 280;

/**
 * 稿面至少要留的宽度：DESIGN.md 要求每行约 36 字。
 * 36 字 × 16px（--prose-size 默认）+ 左右内边距 20px × 2 = 616px。
 */
export const MANUSCRIPT_COMFORTABLE_WIDTH = 616;

const STORAGE_PREFIX = "nf:chapter-context-rail:v1:";

function browserStorage(): ChapterContextRailStorage | undefined {
  return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
}

export function clampChapterContextRailWidth(value: number): number {
  if (!Number.isFinite(value)) return CHAPTER_CONTEXT_RAIL_DEFAULT_WIDTH;
  return Math.min(CHAPTER_CONTEXT_RAIL_MAX_WIDTH, Math.max(CHAPTER_CONTEXT_RAIL_MIN_WIDTH, Math.round(value)));
}

/** 没存过偏好时的默认开合：编辑区放得下「舒适稿面 + 默认宽度的栏」才展开。量不到宽度时保持展开。 */
export function defaultChapterContextRailOpen(canvasWidth: number): boolean {
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) return true;
  return canvasWidth >= MANUSCRIPT_COMFORTABLE_WIDTH + CHAPTER_CONTEXT_RAIL_DEFAULT_WIDTH;
}

export function loadChapterContextRailState(
  bookId: string,
  storage: ChapterContextRailStorage | undefined = browserStorage(),
): ChapterContextRailState | null {
  try {
    const raw = storage?.getItem(`${STORAGE_PREFIX}${bookId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { open?: unknown; width?: unknown };
    if (typeof parsed?.open !== "boolean" || typeof parsed.width !== "number") return null;
    return { open: parsed.open, width: clampChapterContextRailWidth(parsed.width) };
  } catch {
    return null;
  }
}

export function saveChapterContextRailState(
  bookId: string,
  state: ChapterContextRailState,
  storage: ChapterContextRailStorage | undefined = browserStorage(),
): void {
  try {
    storage?.setItem(`${STORAGE_PREFIX}${bookId}`, JSON.stringify({ open: state.open, width: clampChapterContextRailWidth(state.width) }));
  } catch {
    // 布局偏好尽力而为，存不下不影响写作。
  }
}
