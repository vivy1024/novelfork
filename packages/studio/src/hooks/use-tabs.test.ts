import { describe, it, expect } from "vitest";
import {
  routeToTabId,
  routeToTabLabel,
  tabsReducer,
  INITIAL_STATE,
} from "./use-tabs";
import type { Tab, TabsState } from "./use-tabs";
import type { Route } from "../routes";

function makeTab(route: Route, overrides?: Partial<Tab>): Tab {
  return {
    id: routeToTabId(route),
    route,
    label: routeToTabLabel(route),
    closable: route.page !== "dashboard",
    dirty: false,
    ...overrides,
  };
}

describe("routeToTabId", () => {
  it('dashboard → "dashboard"', () => {
    expect(routeToTabId({ page: "dashboard" })).toBe("dashboard");
  });

  it('book with id "abc" → "book:abc"', () => {
    expect(routeToTabId({ page: "book", bookId: "abc" })).toBe("book:abc");
  });

  it('chapter bookId "abc" chapterNumber 5 → "chapter:abc:5"', () => {
    expect(routeToTabId({ page: "chapter", bookId: "abc", chapterNumber: 5 })).toBe("chapter:abc:5");
  });

  it('workflow agents → "workflow:agents"', () => {
    expect(routeToTabId({ page: "workflow", section: "agents" })).toBe("workflow:agents");
  });

  it('admin daemon → "admin:daemon"', () => {
    expect(routeToTabId({ page: "admin", section: "daemon" })).toBe("admin:daemon");
  });

  it('admin terminal → "admin:terminal"', () => {
    expect(routeToTabId({ page: "admin", section: "terminal" })).toBe("admin:terminal");
  });

  it('admin container → "admin:container"', () => {
    expect(routeToTabId({ page: "admin", section: "container" })).toBe("admin:container");
  });

  it('settings appearance → "settings:appearance"', () => {
    expect(routeToTabId({ page: "settings", section: "appearance" })).toBe("settings:appearance");
  });

  it('sessions defaults to "sessions"', () => {
    expect(routeToTabId({ page: "sessions" })).toBe("sessions");
  });
});

describe("routeToTabLabel", () => {
  it('dashboard → "项目总览"', () => {
    expect(routeToTabLabel({ page: "dashboard" })).toBe("项目总览");
  });

  it("book → bookId", () => {
    expect(routeToTabLabel({ page: "book", bookId: "my-novel" })).toBe("my-novel");
  });

  it('book-create → "新建书籍"', () => {
    expect(routeToTabLabel({ page: "book-create" })).toBe("新建书籍");
  });

  it('chapter → "章节 {n}"', () => {
    expect(routeToTabLabel({ page: "chapter", bookId: "x", chapterNumber: 12 })).toBe("章节 12");
  });

  it('workflow agents → "工作流 · Agent"', () => {
    expect(routeToTabLabel({ page: "workflow", section: "agents" })).toBe("工作流 · Agent");
  });

  it('admin daemon → "管理 · 守护进程"', () => {
    expect(routeToTabLabel({ page: "admin", section: "daemon" })).toBe("管理 · 守护进程");
  });

  it('admin terminal → "管理 · 终端"', () => {
    expect(routeToTabLabel({ page: "admin", section: "terminal" })).toBe("管理 · 终端");
  });

  it('admin container → "管理 · 容器"', () => {
    expect(routeToTabLabel({ page: "admin", section: "container" })).toBe("管理 · 容器");
  });

  it('settings appearance → "设置 · 外观"', () => {
    expect(routeToTabLabel({ page: "settings", section: "appearance" })).toBe("设置 · 外观");
  });
});

describe("tabsReducer", () => {
  const dashboardTab = makeTab({ page: "dashboard" });
  const bookTab = makeTab({ page: "book", bookId: "abc" });
  const chapterTab = makeTab({ page: "chapter", bookId: "abc", chapterNumber: 3 });
  const workflowTab = makeTab({ page: "workflow", section: "agents" });

  describe("INITIAL_STATE", () => {
    it("has only the dashboard tab", () => {
      expect(INITIAL_STATE.tabs).toHaveLength(1);
      expect(INITIAL_STATE.tabs[0].id).toBe("dashboard");
    });

    it('activeTabId is "dashboard"', () => {
      expect(INITIAL_STATE.activeTabId).toBe("dashboard");
    });
  });

  describe("open", () => {
    it("adds a new tab and activates it", () => {
      const next = tabsReducer(INITIAL_STATE, { type: "open", tab: bookTab });
      expect(next.tabs).toHaveLength(2);
      expect(next.activeTabId).toBe("book:abc");
    });

    it("does not duplicate an existing tab, only activates it", () => {
      const withBook: TabsState = {
        tabs: [dashboardTab, bookTab],
        activeTabId: "dashboard",
      };
      const next = tabsReducer(withBook, { type: "open", tab: bookTab });
      expect(next.tabs).toHaveLength(2);
      expect(next.activeTabId).toBe("book:abc");
    });
  });

  describe("activate", () => {
    it("switches to an existing tab", () => {
      const state: TabsState = {
        tabs: [dashboardTab, bookTab],
        activeTabId: "dashboard",
      };
      const next = tabsReducer(state, { type: "activate", tabId: "book:abc" });
      expect(next.activeTabId).toBe("book:abc");
    });

    it("does nothing when tabId does not exist", () => {
      const next = tabsReducer(INITIAL_STATE, {
        type: "activate",
        tabId: "nonexistent",
      });
      expect(next).toBe(INITIAL_STATE);
    });
  });

  describe("close", () => {
    it("removes a closable tab", () => {
      const state: TabsState = {
        tabs: [dashboardTab, bookTab, chapterTab],
        activeTabId: "book:abc",
      };
      const next = tabsReducer(state, { type: "close", tabId: "chapter:abc:3" });
      expect(next.tabs).toHaveLength(2);
      expect(next.tabs.find((t) => t.id === "chapter:abc:3")).toBeUndefined();
    });

    it("does not close dashboard (closable=false)", () => {
      const state: TabsState = {
        tabs: [dashboardTab, bookTab],
        activeTabId: "dashboard",
      };
      const next = tabsReducer(state, { type: "close", tabId: "dashboard" });
      expect(next).toBe(state);
    });

    it("activates right neighbor when closing the active tab", () => {
      const state: TabsState = {
        tabs: [dashboardTab, bookTab, chapterTab],
        activeTabId: "book:abc",
      };
      const next = tabsReducer(state, { type: "close", tabId: "book:abc" });
      expect(next.activeTabId).toBe("chapter:abc:3");
      expect(next.tabs).toHaveLength(2);
    });

    it("activates left neighbor when closing the rightmost active tab", () => {
      const state: TabsState = {
        tabs: [dashboardTab, bookTab, chapterTab],
        activeTabId: "chapter:abc:3",
      };
      const next = tabsReducer(state, { type: "close", tabId: "chapter:abc:3" });
      expect(next.activeTabId).toBe("book:abc");
    });

    it("keeps activeTabId unchanged when closing a non-active tab", () => {
      const state: TabsState = {
        tabs: [dashboardTab, bookTab, chapterTab],
        activeTabId: "dashboard",
      };
      const next = tabsReducer(state, { type: "close", tabId: "book:abc" });
      expect(next.activeTabId).toBe("dashboard");
      expect(next.tabs).toHaveLength(2);
    });
  });

  describe("closeOthers", () => {
    it("keeps the requested tab and all non-closable tabs", () => {
      const state: TabsState = {
        tabs: [dashboardTab, bookTab, chapterTab, workflowTab],
        activeTabId: "book:abc",
      };
      const next = tabsReducer(state, { type: "closeOthers", tabId: workflowTab.id });
      expect(next.tabs.map((t) => t.id)).toEqual(["dashboard", workflowTab.id]);
      expect(next.activeTabId).toBe(workflowTab.id);
    });
  });

  describe("closeRight", () => {
    it("closes tabs to the right but preserves non-closable tabs", () => {
      const state: TabsState = {
        tabs: [dashboardTab, bookTab, chapterTab, workflowTab],
        activeTabId: workflowTab.id,
      };
      const next = tabsReducer(state, { type: "closeRight", tabId: "book:abc" });
      expect(next.tabs.map((t) => t.id)).toEqual(["dashboard", "book:abc"]);
      expect(next.activeTabId).toBe("book:abc");
    });
  });

  describe("markDirty / markClean", () => {
    it("marks a tab dirty and then clean again", () => {
      const state: TabsState = {
        tabs: [dashboardTab, bookTab],
        activeTabId: "dashboard",
      };
      const dirty = tabsReducer(state, { type: "markDirty", tabId: "book:abc" });
      expect(dirty.tabs.find((t) => t.id === "book:abc")?.dirty).toBe(true);

      const clean = tabsReducer(dirty, { type: "markClean", tabId: "book:abc" });
      expect(clean.tabs.find((t) => t.id === "book:abc")?.dirty).toBe(false);
    });
  });
});
