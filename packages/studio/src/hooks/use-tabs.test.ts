import { describe, it, expect } from "vitest";
import {
  routeToTabId,
  routeToTabLabel,
  tabsReducer,
  INITIAL_STATE,
} from "./use-tabs";
import type { Tab, TabsState } from "./use-tabs";
import type { Route } from "../App";

/* ------------------------------------------------------------------ */
/*  helpers                                                           */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  routeToTabId                                                      */
/* ------------------------------------------------------------------ */

describe("routeToTabId", () => {
  it('dashboard → "dashboard"', () => {
    expect(routeToTabId({ page: "dashboard" })).toBe("dashboard");
  });

  it('book with id "abc" → "book:abc"', () => {
    expect(routeToTabId({ page: "book", bookId: "abc" })).toBe("book:abc");
  });

  it('chapter bookId "abc" chapterNumber 5 → "chapter:abc:5"', () => {
    expect(
      routeToTabId({ page: "chapter", bookId: "abc", chapterNumber: 5 }),
    ).toBe("chapter:abc:5");
  });

  it('book-create → "book-create"', () => {
    expect(routeToTabId({ page: "book-create" })).toBe("book-create");
  });

  it('truth → "truth:{bookId}"', () => {
    expect(routeToTabId({ page: "truth", bookId: "b1" })).toBe("truth:b1");
  });

  it('analytics → "analytics:{bookId}"', () => {
    expect(routeToTabId({ page: "analytics", bookId: "b2" })).toBe("analytics:b2");
  });

  it('config → "config"', () => {
    expect(routeToTabId({ page: "config" })).toBe("config");
  });

  it('daemon → "daemon"', () => {
    expect(routeToTabId({ page: "daemon" })).toBe("daemon");
  });

  it('logs → "logs"', () => {
    expect(routeToTabId({ page: "logs" })).toBe("logs");
  });

  it('genres → "genres"', () => {
    expect(routeToTabId({ page: "genres" })).toBe("genres");
  });

  it('style → "style"', () => {
    expect(routeToTabId({ page: "style" })).toBe("style");
  });

  it('import → "import"', () => {
    expect(routeToTabId({ page: "import" })).toBe("import");
  });

  it('radar → "radar"', () => {
    expect(routeToTabId({ page: "radar" })).toBe("radar");
  });

  it('doctor → "doctor"', () => {
    expect(routeToTabId({ page: "doctor" })).toBe("doctor");
  });
});

/* ------------------------------------------------------------------ */
/*  routeToTabLabel                                                   */
/* ------------------------------------------------------------------ */

describe("routeToTabLabel", () => {
  it('dashboard → "Dashboard"', () => {
    expect(routeToTabLabel({ page: "dashboard" })).toBe("Dashboard");
  });

  it("book → bookId", () => {
    expect(routeToTabLabel({ page: "book", bookId: "my-novel" })).toBe("my-novel");
  });

  it('book-create → "New Book"', () => {
    expect(routeToTabLabel({ page: "book-create" })).toBe("New Book");
  });

  it('chapter → "Ch.{n}"', () => {
    expect(
      routeToTabLabel({ page: "chapter", bookId: "x", chapterNumber: 12 }),
    ).toBe("Ch.12");
  });

  it('truth → "Truth Files"', () => {
    expect(routeToTabLabel({ page: "truth", bookId: "x" })).toBe("Truth Files");
  });

  it('analytics → "Analytics"', () => {
    expect(routeToTabLabel({ page: "analytics", bookId: "x" })).toBe("Analytics");
  });

  it('config → "Config"', () => {
    expect(routeToTabLabel({ page: "config" })).toBe("Config");
  });

  it('daemon → "Daemon"', () => {
    expect(routeToTabLabel({ page: "daemon" })).toBe("Daemon");
  });

  it('logs → "Logs"', () => {
    expect(routeToTabLabel({ page: "logs" })).toBe("Logs");
  });

  it('genres → "Genres"', () => {
    expect(routeToTabLabel({ page: "genres" })).toBe("Genres");
  });

  it('style → "Style"', () => {
    expect(routeToTabLabel({ page: "style" })).toBe("Style");
  });

  it('import → "Import"', () => {
    expect(routeToTabLabel({ page: "import" })).toBe("Import");
  });

  it('radar → "Radar"', () => {
    expect(routeToTabLabel({ page: "radar" })).toBe("Radar");
  });

  it('doctor → "Doctor"', () => {
    expect(routeToTabLabel({ page: "doctor" })).toBe("Doctor");
  });
});

/* ------------------------------------------------------------------ */
/*  tabsReducer                                                       */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/*  tabsReducer                                                       */
/* ------------------------------------------------------------------ */

describe("tabsReducer", () => {
  const dashboardTab = makeTab({ page: "dashboard" });
  const bookTab = makeTab({ page: "book", bookId: "abc" });
  const chapterTab = makeTab({ page: "chapter", bookId: "abc", chapterNumber: 3 });
  const configTab = makeTab({ page: "config" });

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
    it("keeps only the target tab and unclosable tabs", () => {
      const state: TabsState = {
        tabs: [dashboardTab, bookTab, chapterTab, configTab],
        activeTabId: "book:abc",
      };
      const next = tabsReducer(state, { type: "closeOthers", tabId: "book:abc" });
      expect(next.tabs.map((t) => t.id)).toEqual(["dashboard", "book:abc"]);
      expect(next.activeTabId).toBe("book:abc");
    });
  });

  describe("closeRight", () => {
    it("closes all closable tabs to the right of the target", () => {
      const state: TabsState = {
        tabs: [dashboardTab, bookTab, chapterTab, configTab],
        activeTabId: "dashboard",
      };
      const next = tabsReducer(state, { type: "closeRight", tabId: "book:abc" });
      expect(next.tabs.map((t) => t.id)).toEqual(["dashboard", "book:abc"]);
      expect(next.activeTabId).toBe("dashboard");
    });

    it("switches activeTabId to target when active tab is closed", () => {
      const state: TabsState = {
        tabs: [dashboardTab, bookTab, chapterTab, configTab],
        activeTabId: "config",
      };
      const next = tabsReducer(state, { type: "closeRight", tabId: "book:abc" });
      expect(next.activeTabId).toBe("book:abc");
    });

    it("preserves unclosable tabs even if they are to the right", () => {
      const dashRight: TabsState = {
        tabs: [bookTab, dashboardTab, chapterTab],
        activeTabId: "book:abc",
      };
      const next = tabsReducer(dashRight, { type: "closeRight", tabId: "book:abc" });
      expect(next.tabs.map((t) => t.id)).toEqual(["book:abc", "dashboard"]);
    });
  });
});
