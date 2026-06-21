import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

export type TabKind = "chapter" | "draft" | "candidate" | "jingwei-entry" | "file" | "tool" | "other";

/** ActivityBar 视图 —— 每个视图是独立工作区，各自维护一组 Tab */
export type TabView = "explorer" | "jingwei" | "tools";

export interface TabState {
  id: string;
  nodeId: string;
  title: string;
  dirty: boolean;
  kind: TabKind;
  view: TabView;
}

export interface UseIdeTabsReturn {
  /** 当前激活视图下的 Tab 列表 */
  tabs: TabState[];
  /** 当前激活视图下的激活 Tab id */
  activeTabId: string | null;
  openTab: (nodeId: string, title: string, kind: TabKind, view: TabView) => void;
  closeTab: (tabId: string) => void;
  closeOthers: (tabId: string) => void;
  closeAll: () => void;
  closeSaved: () => void;
  closeRight: (tabId: string) => void;
  activateTab: (tabId: string) => void;
  setDirty: (tabId: string, dirty: boolean) => void;
  hasDirtyTabs: () => boolean;
}

// --- Reducer ---

interface IdeTabsState {
  tabs: TabState[];
  /** 每个视图各自记住激活的 Tab */
  activeByView: Record<TabView, string | null>;
}

const EMPTY_ACTIVE: Record<TabView, string | null> = { explorer: null, jingwei: null, tools: null };

type IdeTabsAction =
  | { type: "LOAD"; state: IdeTabsState }
  | { type: "OPEN"; nodeId: string; title: string; kind: TabKind; view: TabView }
  | { type: "CLOSE"; tabId: string }
  | { type: "CLOSE_OTHERS"; tabId: string; view: TabView }
  | { type: "CLOSE_ALL"; view: TabView }
  | { type: "CLOSE_SAVED"; view: TabView }
  | { type: "CLOSE_RIGHT"; tabId: string; view: TabView }
  | { type: "ACTIVATE"; tabId: string; view: TabView }
  | { type: "SET_DIRTY"; tabId: string; dirty: boolean };

function viewOf(state: IdeTabsState, tabId: string): TabView | null {
  return state.tabs.find((t) => t.id === tabId)?.view ?? null;
}

/** 在某视图内关闭一个 tab 后，决定该视图新的激活 tab */
function pickActiveAfterClose(prevTabs: TabState[], nextTabs: TabState[], view: TabView, activeId: string | null, closedId: string): string | null {
  const viewTabs = nextTabs.filter((t) => t.view === view);
  if (activeId !== closedId) {
    return viewTabs.some((t) => t.id === activeId) ? activeId : (viewTabs[viewTabs.length - 1]?.id ?? null);
  }
  if (viewTabs.length === 0) return null;
  const prevViewTabs = prevTabs.filter((t) => t.view === view);
  const idx = prevViewTabs.findIndex((t) => t.id === closedId);
  return viewTabs[Math.min(idx, viewTabs.length - 1)].id;
}

function ideTabsReducer(state: IdeTabsState, action: IdeTabsAction): IdeTabsState {
  switch (action.type) {
    case "LOAD":
      return action.state;

    case "OPEN": {
      const existing = state.tabs.find((t) => t.nodeId === action.nodeId);
      if (existing) {
        return { ...state, activeByView: { ...state.activeByView, [existing.view]: existing.id } };
      }
      const newTab: TabState = { id: action.nodeId, nodeId: action.nodeId, title: action.title, dirty: false, kind: action.kind, view: action.view };
      return {
        tabs: [...state.tabs, newTab],
        activeByView: { ...state.activeByView, [action.view]: newTab.id },
      };
    }

    case "CLOSE": {
      const view = viewOf(state, action.tabId);
      if (!view) return state;
      const next = state.tabs.filter((t) => t.id !== action.tabId);
      return {
        tabs: next,
        activeByView: { ...state.activeByView, [view]: pickActiveAfterClose(state.tabs, next, view, state.activeByView[view], action.tabId) },
      };
    }

    case "CLOSE_OTHERS": {
      const next = state.tabs.filter((t) => t.view !== action.view || t.id === action.tabId);
      return { tabs: next, activeByView: { ...state.activeByView, [action.view]: action.tabId } };
    }

    case "CLOSE_ALL": {
      const next = state.tabs.filter((t) => t.view !== action.view);
      return { tabs: next, activeByView: { ...state.activeByView, [action.view]: null } };
    }

    case "CLOSE_SAVED": {
      const next = state.tabs.filter((t) => t.view !== action.view || t.dirty);
      const viewTabs = next.filter((t) => t.view === action.view);
      const activeStillThere = viewTabs.some((t) => t.id === state.activeByView[action.view]);
      return {
        tabs: next,
        activeByView: { ...state.activeByView, [action.view]: activeStillThere ? state.activeByView[action.view] : (viewTabs[0]?.id ?? null) },
      };
    }

    case "CLOSE_RIGHT": {
      const viewTabs = state.tabs.filter((t) => t.view === action.view);
      const idx = viewTabs.findIndex((t) => t.id === action.tabId);
      if (idx === -1) return state;
      const keepIds = new Set(viewTabs.slice(0, idx + 1).map((t) => t.id));
      const next = state.tabs.filter((t) => t.view !== action.view || keepIds.has(t.id));
      const activeStillThere = next.some((t) => t.id === state.activeByView[action.view]);
      return {
        tabs: next,
        activeByView: { ...state.activeByView, [action.view]: activeStillThere ? state.activeByView[action.view] : action.tabId },
      };
    }

    case "ACTIVATE":
      return { ...state, activeByView: { ...state.activeByView, [action.view]: action.tabId } };

    case "SET_DIRTY":
      return { ...state, tabs: state.tabs.map((t) => (t.id === action.tabId ? { ...t, dirty: action.dirty } : t)) };
  }
}

// --- Persistence ---

interface PersistedState {
  tabs: { id: string; nodeId: string; title: string; kind?: TabKind; view?: TabView }[];
  activeByView?: Record<TabView, string | null>;
}

function getStorageKey(bookId: string): string {
  return `nf:ide-tabs:${bookId}`;
}

function loadState(bookId: string): IdeTabsState {
  try {
    const raw = localStorage.getItem(getStorageKey(bookId));
    if (!raw) return { tabs: [], activeByView: { ...EMPTY_ACTIVE } };
    const parsed: PersistedState = JSON.parse(raw);
    // 旧格式(无 activeByView)：清空,不迁移旧 tab 避免视图混乱
    if (!parsed.activeByView) return { tabs: [], activeByView: { ...EMPTY_ACTIVE } };
    const tabs: TabState[] = (parsed.tabs || []).map((t) => ({
      id: t.id, nodeId: t.nodeId, title: t.title, dirty: false, kind: t.kind ?? "other", view: t.view ?? "explorer",
    }));
    const activeByView: Record<TabView, string | null> = { ...EMPTY_ACTIVE, ...(parsed.activeByView ?? {}) };
    // 校验每个视图的激活 tab 仍存在
    (Object.keys(activeByView) as TabView[]).forEach((v) => {
      const viewTabs = tabs.filter((t) => t.view === v);
      if (!activeByView[v] || !viewTabs.some((t) => t.id === activeByView[v])) {
        activeByView[v] = viewTabs.length > 0 ? viewTabs[0].id : null;
      }
    });
    return { tabs, activeByView };
  } catch {
    return { tabs: [], activeByView: { ...EMPTY_ACTIVE } };
  }
}

function saveState(bookId: string, state: IdeTabsState): void {
  try {
    const persisted: PersistedState = {
      tabs: state.tabs.map((t) => ({ id: t.id, nodeId: t.nodeId, title: t.title, kind: t.kind, view: t.view })),
      activeByView: state.activeByView,
    };
    localStorage.setItem(getStorageKey(bookId), JSON.stringify(persisted));
  } catch { /* ignore */ }
}

// --- Hook ---

export function useIdeTabs(bookId: string | undefined, activeView: TabView): UseIdeTabsReturn {
  const [state, dispatch] = useReducer(ideTabsReducer, { tabs: [], activeByView: { ...EMPTY_ACTIVE } });
  const isLoadingRef = useRef(false);

  useEffect(() => {
    if (!bookId) {
      dispatch({ type: "LOAD", state: { tabs: [], activeByView: { ...EMPTY_ACTIVE } } });
      return;
    }
    isLoadingRef.current = true;
    dispatch({ type: "LOAD", state: loadState(bookId) });
    requestAnimationFrame(() => { isLoadingRef.current = false; });
  }, [bookId]);

  useEffect(() => {
    if (!bookId || isLoadingRef.current) return;
    saveState(bookId, state);
  }, [bookId, state]);

  const openTab = useCallback((nodeId: string, title: string, kind: TabKind, view: TabView) => {
    dispatch({ type: "OPEN", nodeId, title, kind, view });
  }, []);
  const closeTab = useCallback((tabId: string) => dispatch({ type: "CLOSE", tabId }), []);
  const closeOthers = useCallback((tabId: string) => dispatch({ type: "CLOSE_OTHERS", tabId, view: activeView }), [activeView]);
  const closeAll = useCallback(() => dispatch({ type: "CLOSE_ALL", view: activeView }), [activeView]);
  const closeSaved = useCallback(() => dispatch({ type: "CLOSE_SAVED", view: activeView }), [activeView]);
  const closeRight = useCallback((tabId: string) => dispatch({ type: "CLOSE_RIGHT", tabId, view: activeView }), [activeView]);
  const activateTab = useCallback((tabId: string) => dispatch({ type: "ACTIVATE", tabId, view: activeView }), [activeView]);
  const setDirty = useCallback((tabId: string, dirty: boolean) => dispatch({ type: "SET_DIRTY", tabId, dirty }), []);
  const hasDirtyTabs = useCallback(() => state.tabs.some((t) => t.dirty), [state.tabs]);

  const tabs = useMemo(() => state.tabs.filter((t) => t.view === activeView), [state.tabs, activeView]);
  const activeTabId = state.activeByView[activeView];

  return {
    tabs,
    activeTabId,
    openTab,
    closeTab,
    closeOthers,
    closeAll,
    closeSaved,
    closeRight,
    activateTab,
    setDirty,
    hasDirtyTabs,
  };
}
