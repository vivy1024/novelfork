/**
 * use-tabs — IDE-style multi-tab state management.
 * Wraps the existing Route type, adding tab identity and lifecycle.
 */

import { useReducer, useCallback } from "react";
import type { Route } from "../App";
import type { TFunction } from "./use-i18n";

export interface Tab {
  readonly id: string;
  readonly route: Route;
  readonly label: string;
  readonly closable: boolean;
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
  | { type: "closeRight"; tabId: string };

export function routeToTabId(route: Route): string {
  switch (route.page) {
    case "dashboard": return "dashboard";
    case "book": return `book:${route.bookId}`;
    case "book-create": return "book-create";
    case "chapter": return `chapter:${route.bookId}:${route.chapterNumber}`;
    case "truth": return `truth:${route.bookId}`;
    case "analytics": return `analytics:${route.bookId}`;
    case "config": return "config";
    case "daemon": return "daemon";
    case "logs": return "logs";
    case "genres": return "genres";
    case "style": return "style";
    case "import": return "import";
    case "radar": return "radar";
    case "doctor": return "doctor";
    case "search": return "search";
    case "diff": return `diff:${route.bookId}:${route.chapterNumber}`;
    case "backup": return "backup";
    case "detect": return `detect:${route.bookId}`;
    case "notify": return "notify";
    case "intent": return `intent:${route.bookId}`;
    case "agents": return "agents";
    case "scheduler-config": return "scheduler-config";
    case "detection-config": return "detection-config";
    case "hooks": return "hooks";
    case "llm-advanced": return "llm-advanced";
    case "state": return `state:${route.bookId}`;
    case "mcp": return "mcp";
    case "pipeline": return route.runId ? `pipeline:${route.runId}` : "pipeline";
    case "plugins": return "plugins";
  }
}

export function routeToTabLabel(route: Route): string {
  switch (route.page) {
    case "dashboard": return "Dashboard";
    case "book": return route.bookId;
    case "book-create": return "New Book";
    case "chapter": return `Ch.${route.chapterNumber}`;
    case "truth": return "Truth Files";
    case "analytics": return "Analytics";
    case "config": return "Config";
    case "daemon": return "Daemon";
    case "logs": return "Logs";
    case "genres": return "Genres";
    case "style": return "Style";
    case "import": return "Import";
    case "radar": return "Radar";
    case "doctor": return "Doctor";
    case "search": return "Search";
    case "diff": return `Diff Ch.${route.chapterNumber}`;
    case "backup": return "Backup";
    case "detect": return "Detect";
    case "notify": return "Notify";
    case "intent": return "Intent";
    case "agents": return "Agents";
    case "scheduler-config": return "Scheduler";
    case "detection-config": return "Detection";
    case "hooks": return "Hooks";
    case "llm-advanced": return "LLM";
    case "state": return "State";
    case "mcp": return "MCP";
    case "pipeline": return "Pipeline";
    case "plugins": return "Plugins";
  }
}

function routeToTab(route: Route): Tab {
  return {
    id: routeToTabId(route),
    route,
    label: routeToTabLabel(route),
    closable: route.page !== "dashboard",
  };
}

export const INITIAL_STATE: TabsState = {
  tabs: [routeToTab({ page: "dashboard" })],
  activeTabId: "dashboard",
};

function findNeighbor(tabs: ReadonlyArray<Tab>, closedId: string): string {
  const idx = tabs.findIndex((t) => t.id === closedId);
  const remaining = tabs.filter((t) => t.id !== closedId);
  if (remaining.length === 0) return "dashboard";
  // prefer right neighbor, then left
  const next = remaining[Math.min(idx, remaining.length - 1)];
  return next.id;
}

export function tabsReducer(state: TabsState, action: TabAction): TabsState {
  switch (action.type) {
    case "open": {
      const existing = state.tabs.find((t) => t.id === action.tab.id);
      if (existing) {
        return { ...state, activeTabId: existing.id };
      }
      return {
        tabs: [...state.tabs, action.tab],
        activeTabId: action.tab.id,
      };
    }
    case "activate": {
      if (!state.tabs.some((t) => t.id === action.tabId)) return state;
      return { ...state, activeTabId: action.tabId };
    }
    case "close": {
      const tab = state.tabs.find((t) => t.id === action.tabId);
      if (!tab || !tab.closable) return state;
      const nextActive = state.activeTabId === action.tabId
        ? findNeighbor(state.tabs, action.tabId)
        : state.activeTabId;
      return {
        tabs: state.tabs.filter((t) => t.id !== action.tabId),
        activeTabId: nextActive,
      };
    }
    case "closeOthers": {
      const keep = state.tabs.filter((t) => t.id === action.tabId || !t.closable);
      return { tabs: keep, activeTabId: action.tabId };
    }
    case "closeRight": {
      const idx = state.tabs.findIndex((t) => t.id === action.tabId);
      const keep = state.tabs.filter((t, i) => i <= idx || !t.closable);
      const activeStillOpen = keep.some((t) => t.id === state.activeTabId);
      return {
        tabs: keep,
        activeTabId: activeStillOpen ? state.activeTabId : action.tabId,
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

  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeTab: state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0],
    openTab,
    closeTab,
    activateTab,
    closeOtherTabs,
    closeTabsToRight,
  };
}
