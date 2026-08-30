export interface IdeLayoutSizes {
  readonly sidebar: number;
  readonly editor: number;
  readonly chat: number;
}

export interface IdeLayoutStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

const STORAGE_PREFIX = "nf:ide-layout:v1:";
const MIN_SIZES: IdeLayoutSizes = { sidebar: 150, editor: 220, chat: 200 };
const FALLBACK_SIZES: IdeLayoutSizes = { sidebar: 220, editor: 800, chat: 320 };

/** 工作台容器宽度：三栏都能摊开。 */
export const IDE_COMFORTABLE_MIN_WIDTH = 1100;
/** 工作台容器宽度：只留侧栏+编辑器，对话栏先收起。 */
export const IDE_COMPACT_MIN_WIDTH = 780;

export type IdeLayoutMode = "comfortable" | "compact" | "narrow";

export interface IdePaneVisibility {
  readonly sidebar: boolean;
  readonly chat: boolean;
}

/**
 * 按工作台容器宽度（不含 Studio 壳层侧栏）决定三栏模式。
 * 窄屏不改 Allotment 结构，只折叠 pane：ActivityBar 仍在，点图标可再打开。
 */
export function ideLayoutModeFromWidth(width: number): IdeLayoutMode {
  if (!Number.isFinite(width) || width <= 0) return "comfortable";
  if (width < IDE_COMPACT_MIN_WIDTH) return "narrow";
  if (width < IDE_COMFORTABLE_MIN_WIDTH) return "compact";
  return "comfortable";
}

export function defaultIdePaneVisibility(mode: IdeLayoutMode): IdePaneVisibility {
  switch (mode) {
    case "narrow":
      return { sidebar: false, chat: false };
    case "compact":
      return { sidebar: true, chat: false };
    case "comfortable":
      return { sidebar: true, chat: true };
  }
}

/** 手机/极窄窗：侧栏和对话改成盖在编辑器上，不挤 Allotment。 */
export function idePanesUseOverlay(mode: IdeLayoutMode): boolean {
  return mode === "narrow";
}

/** 首屏估算：md 以上壳层侧栏约 250px，避免三栏先闪再折。 */
export function initialIdeLayoutMode(viewportWidth = typeof window === "undefined" ? IDE_COMFORTABLE_MIN_WIDTH : window.innerWidth): IdeLayoutMode {
  const shellRail = viewportWidth >= 768 ? 250 : 0;
  return ideLayoutModeFromWidth(viewportWidth - shellRail);
}

function storageKey(bookId: string): string {
  return `${STORAGE_PREFIX}${bookId}`;
}

function browserStorage(): IdeLayoutStorage | undefined {
  return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function clampSize(value: unknown, minimum: number, fallback: number): number {
  const parsed = finitePositive(value) ?? fallback;
  return Math.max(minimum, Math.round(parsed));
}

export function normalizeIdeLayoutSizes(value: unknown, fallback: IdeLayoutSizes = FALLBACK_SIZES): IdeLayoutSizes {
  if (!Array.isArray(value) || value.length < 3) return fallback;
  return {
    sidebar: clampSize(value[0], MIN_SIZES.sidebar, fallback.sidebar),
    editor: clampSize(value[1], MIN_SIZES.editor, fallback.editor),
    chat: clampSize(value[2], MIN_SIZES.chat, fallback.chat),
  };
}

export function ideLayoutSizesToArray(sizes: IdeLayoutSizes): number[] {
  return [sizes.sidebar, sizes.editor, sizes.chat];
}

/**
 * Allotment reports a hidden pane as zero in some visibility transitions.
 * Preserve the last valid width instead of persisting that transient zero.
 */
export function mergeIdeLayoutSizes(
  next: readonly number[],
  previous: IdeLayoutSizes,
): IdeLayoutSizes {
  return normalizeIdeLayoutSizes(
    [
      next[0] > 0 ? next[0] : previous.sidebar,
      next[1] > 0 ? next[1] : previous.editor,
      next[2] > 0 ? next[2] : previous.chat,
    ],
    previous,
  );
}

export function loadIdeLayoutSizes(
  bookId: string,
  fallback: IdeLayoutSizes = FALLBACK_SIZES,
  storage: IdeLayoutStorage | undefined = browserStorage(),
): IdeLayoutSizes {
  try {
    if (!storage) return fallback;
    const raw = storage.getItem(storageKey(bookId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { sizes?: unknown };
    return normalizeIdeLayoutSizes(parsed?.sizes, fallback);
  } catch {
    return fallback;
  }
}

export function saveIdeLayoutSizes(
  bookId: string,
  sizes: IdeLayoutSizes,
  storage: IdeLayoutStorage | undefined = browserStorage(),
): void {
  try {
    if (!storage) return;
    storage.setItem(storageKey(bookId), JSON.stringify({ version: 1, sizes: ideLayoutSizesToArray(sizes) }));
  } catch {
    // Layout persistence is best effort and must never block the workbench.
  }
}

export const IDE_LAYOUT_FALLBACK_SIZES = FALLBACK_SIZES;
