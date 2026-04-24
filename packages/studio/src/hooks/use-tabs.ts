/**
 * use-tabs — IDE-style multi-tab state management.
 * Wraps the existing Route type, adding tab identity and lifecycle.
 */

import { useCallback, useReducer } from "react";
import type { AdminSection, Route, SettingsSection, WorkflowSection } from "../routes";
import { canonicalRouteId } from "../routes";

export interface Tab {
  readonly id: string;
  readonly route: Route;
  readonly label: string;
  readonly closable: boolean;
  readonly dirty: boolean;
}

export interface TabsState {
  readonly tabs: ReadonlyArray<Tab>;
  readonly activeTabId: string;
}

type TabAction =
  | { type: "open"; tab: Tab }
  | { type: "activate"; tabId: string }
  | { type: "close"; tabId: string }
  | { type: "closeOthers"; tabId: string }
  | { type: "closeRight"; tabId: string }
  | { type: "markDirty"; tabId: string }
  | { type: "markClean"; tabId: string };

const WORKFLOW_SECTION_LABELS: Record<WorkflowSection, string> = {
  project: "项目与模型",
  agents: "Agent",
  mcp: "MCP 工具",
  plugins: "插件",
  advanced: "高级 LLM",
  scheduler: "调度",
  detection: "AIGC 检测",
  hooks: "伏笔健康",
  notify: "通知",
};

const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  profile: "个人资料",
  appearance: "外观",
  editor: "编辑器",
  shortcuts: "快捷键",
  notifications: "通知",
  monitoring: "系统监控",
  data: "数据管理",
  about: "关于",
  advanced: "高级设置",
};

const ADMIN_SECTION_LABELS: Record<AdminSection, string> = {
  overview: "总览",
  providers: "供应商",
  resources: "资源监控",
  requests: "请求历史",
  sessions: "会话联动",
  daemon: "守护进程",
  logs: "日志",
  worktrees: "Worktree",
  container: "容器",
};

export function routeToTabId(route: Route): string {
  return canonicalRouteId(route);
}

export function routeToTabLabel(route: Route): string {
  switch (route.page) {
    case "dashboard":
      return "项目总览";
    case "workflow": {
      const label = route.section ? WORKFLOW_SECTION_LABELS[route.section] : undefined;
      return label ? `工作流 · ${label}` : "工作流配置";
    }
    case "sessions":
      return "会话中心";
    case "book":
      return route.bookId;
    case "book-create":
      return "新建书籍";
    case "chapter":
      return `章节 ${route.chapterNumber}`;
    case "truth":
      return "真相文件";
    case "analytics":
      return "数据分析";
    case "genres":
      return "题材模板";
    case "style":
      return "文风分析";
    case "import":
      return "导入中心";
    case "radar":
      return "剧情雷达";
    case "doctor":
      return "项目体检";
    case "search":
      return "全局检索";
    case "diff":
      return `章节对比 ${route.chapterNumber}`;
    case "backup":
      return "备份";
    case "detect":
      return "AIGC 检测";
    case "intent":
      return "意图编辑";
    case "state":
      return "状态投影";
    case "pipeline":
      return route.runId ? `Pipeline · ${route.runId}` : "Pipeline";
    case "settings": {
      const label = route.section ? SETTINGS_SECTION_LABELS[route.section] : undefined;
      return label ? `设置 · ${label}` : "设置";
    }
    case "admin": {
      const label = route.section ? ADMIN_SECTION_LABELS[route.section] : undefined;
      return label ? `管理 · ${label}` : "管理中心";
    }
    default: {
      const unreachable: never = route;
      throw new Error(`Unhandled route for tab label: ${JSON.stringify(unreachable)}`);
    }
  }
}

function routeToTab(route: Route): Tab {
  return {
    id: routeToTabId(route),
    route,
    label: routeToTabLabel(route),
    closable: route.page !== "dashboard",
    dirty: false,
  };
}

export const INITIAL_STATE: TabsState = {
  tabs: [routeToTab({ page: "dashboard" })],
  activeTabId: "dashboard",
};

function findNeighbor(tabs: ReadonlyArray<Tab>, closedId: string): string {
  const idx = tabs.findIndex((tab) => tab.id === closedId);
  const remaining = tabs.filter((tab) => tab.id !== closedId);
  if (remaining.length === 0) return "dashboard";
  const next = remaining[Math.min(idx, remaining.length - 1)];
  return next.id;
}

export function tabsReducer(state: TabsState, action: TabAction): TabsState {
  switch (action.type) {
    case "open": {
      const existing = state.tabs.find((tab) => tab.id === action.tab.id);
      if (existing) {
        return { ...state, activeTabId: existing.id };
      }
      return {
        tabs: [...state.tabs, action.tab],
        activeTabId: action.tab.id,
      };
    }
    case "activate": {
      if (!state.tabs.some((tab) => tab.id === action.tabId)) return state;
      return { ...state, activeTabId: action.tabId };
    }
    case "close": {
      const tab = state.tabs.find((candidate) => candidate.id === action.tabId);
      if (!tab || !tab.closable) return state;
      const nextActive = state.activeTabId === action.tabId
        ? findNeighbor(state.tabs, action.tabId)
        : state.activeTabId;
      return {
        tabs: state.tabs.filter((candidate) => candidate.id !== action.tabId),
        activeTabId: nextActive,
      };
    }
    case "closeOthers": {
      const keep = state.tabs.filter((tab) => tab.id === action.tabId || !tab.closable);
      return { tabs: keep, activeTabId: action.tabId };
    }
    case "closeRight": {
      const idx = state.tabs.findIndex((tab) => tab.id === action.tabId);
      const keep = state.tabs.filter((tab, index) => index <= idx || !tab.closable);
      const activeStillOpen = keep.some((tab) => tab.id === state.activeTabId);
      return {
        tabs: keep,
        activeTabId: activeStillOpen ? state.activeTabId : action.tabId,
      };
    }
    case "markDirty": {
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === action.tabId ? { ...tab, dirty: true } : tab,
        ),
      };
    }
    case "markClean": {
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === action.tabId ? { ...tab, dirty: false } : tab,
        ),
      };
    }
  }
}

export function useTabsState() {
  const [state, dispatch] = useReducer(tabsReducer, INITIAL_STATE);

  const openTab = useCallback((route: Route) => {
    dispatch({ type: "open", tab: routeToTab(route) });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    dispatch({ type: "close", tabId });
  }, []);

  const activateTab = useCallback((tabId: string) => {
    dispatch({ type: "activate", tabId });
  }, []);

  const closeOtherTabs = useCallback((tabId: string) => {
    dispatch({ type: "closeOthers", tabId });
  }, []);

  const closeTabsToRight = useCallback((tabId: string) => {
    dispatch({ type: "closeRight", tabId });
  }, []);

  const markDirty = useCallback((tabId: string) => {
    dispatch({ type: "markDirty", tabId });
  }, []);

  const markClean = useCallback((tabId: string) => {
    dispatch({ type: "markClean", tabId });
  }, []);

  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeTab: state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0],
    openTab,
    closeTab,
    activateTab,
    closeOtherTabs,
    closeTabsToRight,
    markDirty,
    markClean,
  };
}
