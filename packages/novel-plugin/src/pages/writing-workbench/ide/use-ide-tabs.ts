import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { ViewId } from "./use-panel-manager";

export type TabKind = "chapter" | "jingwei-entry" | "memory-entry" | "file" | "story-map" | "tool" | "other";

/** ActivityBar 视图 —— 每个视图是独立工作区，各自维护一组 Tab。 */
/**
 * 写作视图和没有编辑器内容的侧栏也作为合法归属值参与切换。
 * TabView 只允许当前 ActivityBar 的七个 ViewId；旧名称仅在读取旧持久化数据时处理。
 */
export type TabView = ViewId;

const TAB_VIEWS: readonly TabView[] = [
  "write",
  "explorer",
  "characters-lore",
  "storyline",
  "skills-style",
  "tools",
  "search",
];

function isLegacyPersistedView(value: unknown): value is "jingwei" | "narrative-memory" {
  return value === "jingwei" || value === "narrative-memory";
}

/** 只在 localStorage 迁移边界把旧数据归一为当前 ViewId；运行时不会产生旧 ViewId。 */
export function normalizePersistedTabView(value: unknown): TabView {
  if (value === "jingwei") return "characters-lore";
  if (value === "narrative-memory") return "storyline";
  if (typeof value !== "string") return "explorer";
  return TAB_VIEWS.includes(value as TabView) ? (value as TabView) : "explorer";
}

const LEGACY_JINGWEI_PANEL_PREFIX = "jingwei-panel-entry";

/** 旧版条目标签页 `jingwei-panel-entry:<id>` 还原为当前 `jingwei-entry:<id>`。 */
function migrateLegacyTabId(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.startsWith(LEGACY_JINGWEI_PANEL_PREFIX) ? value.replace(LEGACY_JINGWEI_PANEL_PREFIX, "jingwei-entry") : value;
}

export interface TabState {
  id: string;
  nodeId: string;
  title: string;
  dirty: boolean;
  pinned?: boolean;
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
  togglePin: (tabId: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  hasDirtyTabs: () => boolean;
}

// --- Reducer ---

interface IdeTabsState {
  tabs: TabState[];
  /** 每个视图各自记住激活的 Tab */
  activeByView: Record<TabView, string | null>;
}

const EMPTY_ACTIVE: Record<TabView, string | null> = {
  write: null,
  explorer: null,
  "characters-lore": null,
  storyline: null,
  "skills-style": null,
  tools: null,
  search: null,
};

type IdeTabsAction =
  | { type: "LOAD"; state: IdeTabsState }
  | { type: "OPEN"; nodeId: string; title: string; kind: TabKind; view: TabView }
  | { type: "CLOSE"; tabId: string }
  | { type: "CLOSE_OTHERS"; tabId: string; view: TabView }
  | { type: "CLOSE_ALL"; view: TabView }
  | { type: "CLOSE_SAVED"; view: TabView }
  | { type: "CLOSE_RIGHT"; tabId: string; view: TabView }
  | { type: "ACTIVATE"; tabId: string; view: TabView }
  | { type: "SET_DIRTY"; tabId: string; dirty: boolean }
  | { type: "TOGGLE_PIN"; tabId: string }
  | { type: "REORDER"; fromIndex: number; toIndex: number; view: TabView };

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
        // 单例 tab（如全景图谱 narrative-memory-graph）会以同一 nodeId 但不同标题重复打开：
        // 只激活不同步标题会让 tab 停留在第一次打开的标题，故这里顺手校正。
        const tabs = existing.title === action.title
          ? state.tabs
          : state.tabs.map((t) => (t.id === existing.id ? { ...t, title: action.title } : t));
        return { ...state, tabs, activeByView: { ...state.activeByView, [existing.view]: existing.id } };
      }
      const newTab: TabState = { id: action.nodeId, nodeId: action.nodeId, title: action.title, dirty: false, pinned: false, kind: action.kind, view: action.view };
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
      const next = state.tabs.filter((t) => t.view !== action.view || t.id === action.tabId || t.pinned);
      return { tabs: next, activeByView: { ...state.activeByView, [action.view]: action.tabId } };
    }

    case "CLOSE_ALL": {
      const next = state.tabs.filter((t) => t.view !== action.view || t.pinned);
      const remainingViewTabs = next.filter((t) => t.view === action.view);
      return { tabs: next, activeByView: { ...state.activeByView, [action.view]: remainingViewTabs[0]?.id ?? null } };
    }

    case "CLOSE_SAVED": {
      const next = state.tabs.filter((t) => t.view !== action.view || t.dirty || t.pinned);
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
      const next = state.tabs.filter((t) => t.view !== action.view || keepIds.has(t.id) || t.pinned);
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

    case "TOGGLE_PIN":
      return { ...state, tabs: state.tabs.map((t) => (t.id === action.tabId ? { ...t, pinned: !t.pinned } : t)) };

    case "REORDER": {
      const { fromIndex, toIndex, view } = action;
      // 提取目标视图的 tab 及其在全局数组中的索引
      const viewTabsWithGlobalIdx: { tab: TabState; globalIdx: number }[] = [];
      state.tabs.forEach((t, i) => {
        if (t.view === view) viewTabsWithGlobalIdx.push({ tab: t, globalIdx: i });
      });
      if (fromIndex < 0 || fromIndex >= viewTabsWithGlobalIdx.length) return state;
      if (toIndex < 0 || toIndex >= viewTabsWithGlobalIdx.length) return state;
      if (fromIndex === toIndex) return state;

      // 在视图局部数组中移动元素
      const moved = viewTabsWithGlobalIdx[fromIndex];
      const newViewTabs = [...viewTabsWithGlobalIdx];
      newViewTabs.splice(fromIndex, 1);
      newViewTabs.splice(toIndex, 0, moved);

      // 重建全局 tabs 数组：非当前视图保持原序，当前视图用新序
      const next: TabState[] = [];
      let viewIdx = 0;
      for (let i = 0; i < state.tabs.length; i++) {
        if (state.tabs[i].view === view) {
          next.push(newViewTabs[viewIdx].tab);
          viewIdx++;
        } else {
          next.push(state.tabs[i]);
        }
      }
      return { ...state, tabs: next };
    }
  }
}

// --- Persistence ---

interface PersistedState {
  /** view 用 string：落盘数据可能来自旧版本，含已废弃的视图名。 */
  tabs: { id: string; nodeId: string; title: string; kind?: TabKind; view?: string; pinned?: boolean }[];
  activeByView?: Record<string, string | null>;
}

function getStorageKey(bookId: string): string {
  return `nf:ide-tabs:${bookId}`;
}

/** 落盘数据里是否含已废弃的视图名（含则需要在加载后立即回写一次）。 */
function hasLegacyPersistedView(bookId: string): boolean {
  try {
    const raw = localStorage.getItem(getStorageKey(bookId));
    if (!raw) return false;
    const parsed = JSON.parse(raw) as PersistedState;
    return (parsed.tabs ?? []).some((t) =>
      isLegacyPersistedView(t.view)
      || t.id.startsWith(LEGACY_JINGWEI_PANEL_PREFIX)
      || t.nodeId.startsWith(LEGACY_JINGWEI_PANEL_PREFIX)
    ) || Object.keys(parsed.activeByView ?? {}).some((view) => isLegacyPersistedView(view));
  } catch {
    return false;
  }
}

/** 导出仅为测试持久化迁移；正常使用请走 useIdeTabs。 */
export function loadState(bookId: string): IdeTabsState {
  try {
    const raw = localStorage.getItem(getStorageKey(bookId));
    if (!raw) return { tabs: [], activeByView: { ...EMPTY_ACTIVE } };
    const parsed: PersistedState = JSON.parse(raw);
    // 旧格式(无 activeByView)：清空,不迁移旧 tab 避免视图混乱
    if (!parsed.activeByView) return { tabs: [], activeByView: { ...EMPTY_ACTIVE } };
    const tabs: TabState[] = [];
    for (const tab of parsed.tabs || []) {
      const migratedId = migrateLegacyTabId(tab.id) ?? tab.id;
      if (tabs.some((candidate) => candidate.id === migratedId)) continue;
      tabs.push({
        id: migratedId,
        nodeId: migrateLegacyTabId(tab.nodeId) ?? tab.nodeId,
        title: tab.title,
        dirty: false,
        pinned: tab.pinned === true,
        kind: tab.kind ?? "other",
        view: normalizePersistedTabView(tab.view),
      });
    }
    // 旧视图键先折叠到现视图，再按现视图校验激活项
    const persistedActive = parsed.activeByView ?? {};
    const migratedActive: Record<string, string | null> = {};
    for (const [view, tabId] of Object.entries(persistedActive)) {
      const target = normalizePersistedTabView(view);
      if (!migratedActive[target]) migratedActive[target] = migrateLegacyTabId(tabId);
    }
    const activeByView: Record<TabView, string | null> = { ...EMPTY_ACTIVE, ...migratedActive };
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

/** 导出仅为测试持久化迁移；正常使用请走 useIdeTabs。 */
export function saveState(bookId: string, state: IdeTabsState): void {
  try {
    const persisted: PersistedState = {
      tabs: state.tabs.map((t) => ({ id: t.id, nodeId: t.nodeId, title: t.title, kind: t.kind, view: t.view, pinned: t.pinned })),
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
    // 迁移过旧视图名时必须立刻回写，否则内存里迁移了、磁盘上仍是废弃视图，
    // 旧键会一直残留（isLoadingRef 本来会抑制 LOAD 后的首次保存）。
    const needsRewrite = hasLegacyPersistedView(bookId);
    const loaded = loadState(bookId);
    isLoadingRef.current = !needsRewrite;
    dispatch({ type: "LOAD", state: loaded });
    if (needsRewrite) saveState(bookId, loaded);
    else requestAnimationFrame(() => { isLoadingRef.current = false; });
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
  const togglePin = useCallback((tabId: string) => dispatch({ type: "TOGGLE_PIN", tabId }), []);
  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => dispatch({ type: "REORDER", fromIndex, toIndex, view: activeView }), [activeView]);
  const hasDirtyTabs = useCallback(() => state.tabs.some((t) => t.dirty), [state.tabs]);

  const tabs = useMemo(() => state.tabs.filter((t) => t.view === activeView).sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true)), [state.tabs, activeView]);
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
    togglePin,
    reorderTabs,
    hasDirtyTabs,
  };
}
