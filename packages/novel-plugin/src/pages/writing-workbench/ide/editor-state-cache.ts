/**
 * Editor State Cache — Tab 切换时保持编辑器状态
 *
 * 配合多实例条件渲染使用：所有打开的 Tab 保持 mount（display:none 隐藏），
 * 本缓存作为兜底机制，保存/恢复滚动位置和选区。
 */

export interface EditorState {
  scrollTop: number;
  scrollLeft: number;
  selectionStart?: number;
  selectionEnd?: number;
}

const stateCache = new Map<string, EditorState>();

/**
 * 保存编辑器状态到缓存（Tab 失活前调用）
 */
export function saveEditorState(tabId: string, state: EditorState): void {
  stateCache.set(tabId, state);
}

/**
 * 获取缓存的编辑器状态（Tab 激活后用于恢复）
 */
export function getEditorState(tabId: string): EditorState | undefined {
  return stateCache.get(tabId);
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
export function captureEditorStateFromDOM(tabId: string, container: HTMLElement): void {
  saveEditorState(tabId, {
    scrollTop: container.scrollTop,
    scrollLeft: container.scrollLeft,
  });
}

/**
 * 将缓存的状态恢复到 DOM 元素
 */
export function restoreEditorStateToDOM(tabId: string, container: HTMLElement): boolean {
  const state = getEditorState(tabId);
  if (!state) return false;
  container.scrollTop = state.scrollTop;
  container.scrollLeft = state.scrollLeft;
  return true;
}
