/** NovelFork 全局应用状态 Store — 最小 pub/sub 实现（35 行） */

export interface AppState {
  /** 当前 Workspace 中选中的书籍 ID */
  activeBookId: string | null;
  /** 当前 Workspace 中选中的章节号 */
  activeChapterNumber: number | null;
}

type Listener = () => void;

export type AppStore = {
  getState: () => AppState;
  setState: (updater: (prev: AppState) => AppState) => void;
  subscribe: (listener: Listener) => () => void;
};

export function createAppStore(initial: AppState): AppStore {
  let state = initial;
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    setState(updater) {
      const next = updater(state);
      if (Object.is(next, state)) return;
      state = next;
      for (const fn of listeners) fn();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const appStore = createAppStore({ activeBookId: null, activeChapterNumber: null });
