/**
 * Editor State Cache — Tab 切换时保持编辑器状态（类似 VS Code）
 *
 * 配合多实例条件渲染使用：所有打开的 Tab 保持 mount（display:none 隐藏），
 * 本缓存作为兜底机制，保存/恢复滚动位置和选区。
 *
 * 内含 LRU 淘汰（MAX_ENTRIES=50），防止内存泄漏。
 */

export interface EditorState {
  scrollTop: number;
  scrollLeft: number;
  selectionStart?: number;
  selectionEnd?: number;
  /** TipTap/ProseMirror 选区位置（from/to in document） */
  tiptapSelection?: { from: number; to: number };
  /** 内层编辑器（如 TipTap editorRef 容器）的滚动位置 */
  innerScrollTop?: number;
  /** 最后访问时间，用于 LRU 淘汰 */
  accessedAt: number;
}

const MAX_ENTRIES = 50;
const stateCache = new Map<string, EditorState>();

/** LRU 淘汰：移除最早访问的条目 */
function evictLRU(): void {
  if (stateCache.size < MAX_ENTRIES) return;
  let oldestKey: string | undefined;
  let oldestTime = Infinity;
  for (const [key, state] of stateCache) {
    if (state.accessedAt < oldestTime) {
      oldestTime = state.accessedAt;
      oldestKey = key;
    }
  }
  if (oldestKey) stateCache.delete(oldestKey);
}

/**
 * 保存编辑器状态到缓存（Tab 失活前调用）
 */
export function saveEditorState(tabId: string, state: Omit<EditorState, "accessedAt">): void {
  if (!stateCache.has(tabId)) evictLRU();
  stateCache.set(tabId, { ...state, accessedAt: Date.now() });
}

/**
 * 获取缓存的编辑器状态（Tab 激活后用于恢复）
 */
export function getEditorState(tabId: string): EditorState | undefined {
  const state = stateCache.get(tabId);
  if (state) state.accessedAt = Date.now();
  return state;
}

/**
 * 清除指定 Tab 的缓存状态（Tab 关闭时调用）
 */
export function clearEditorState(tabId: string): void {
  stateCache.delete(tabId);
}

/**
 * 清除所有缓存状态（切换书籍时调用）
 */
export function clearAllEditorStates(): void {
  stateCache.clear();
}

/**
 * 从 DOM 元素读取当前编辑器状态并保存
 */
export function captureEditorStateFromDOM(
  tabId: string,
  container: HTMLElement,
  innerContainer?: HTMLElement | null,
): void {
  saveEditorState(tabId, {
    scrollTop: container.scrollTop,
    scrollLeft: container.scrollLeft,
    innerScrollTop: innerContainer?.scrollTop,
  });
}

/**
 * 将缓存的状态恢复到 DOM 元素
 */
export function restoreEditorStateToDOM(
  tabId: string,
  container: HTMLElement,
  innerContainer?: HTMLElement | null,
): boolean {
  const state = getEditorState(tabId);
  if (!state) return false;
  container.scrollTop = state.scrollTop;
  container.scrollLeft = state.scrollLeft;
  if (innerContainer && typeof state.innerScrollTop === "number") {
    innerContainer.scrollTop = state.innerScrollTop;
  }
  return true;
}
