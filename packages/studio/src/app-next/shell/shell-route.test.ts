import { describe, expect, it } from "vitest";

import { getShellNavItems, isShellNavItemActive, parseShellRoute, toShellPath } from "./shell-route";

describe("Agent Shell route parsing", () => {
  it("parses supported /next routes with params", () => {
    expect(parseShellRoute("/next")).toEqual({ kind: "home" });
    expect(parseShellRoute("/next/narrators/s-1")).toEqual({ kind: "narrator", sessionId: "s-1" });
    expect(parseShellRoute("/next/books/book-1")).toEqual({ kind: "book", bookId: "book-1" });
    expect(parseShellRoute("/next/sessions")).toEqual({ kind: "sessions" });
    expect(parseShellRoute("/next/sessions/new")).toEqual({ kind: "sessions", create: true });
    expect(parseShellRoute("/next/search")).toEqual({ kind: "search" });
    expect(parseShellRoute("/next/routines")).toEqual({ kind: "routines" });
    expect(parseShellRoute("/next/knowledge")).toEqual({ kind: "knowledge" });
    expect(parseShellRoute("/next/scheduled-tasks")).toEqual({ kind: "scheduled-tasks" });
    expect(parseShellRoute("/next/settings")).toEqual({ kind: "settings" });
    expect(parseShellRoute("/next/learn")).toEqual({ kind: "learn" });
    expect(parseShellRoute("/next/market")).toEqual({ kind: "market" });
  });

  it("normalizes slashes, query strings, hashes, and encoded ids", () => {
    expect(parseShellRoute("next/narrators/session%201/?tab=chat#top")).toEqual({ kind: "narrator", sessionId: "session 1" });
    expect(parseShellRoute("/next/books/book%2Fpart")).toEqual({ kind: "book", bookId: "book/part" });
  });

  it("嵌入的 Runtime 原页保留入口内的子路径与查询串，原样来回", () => {
    expect(parseShellRoute("/next/knowledge/entry-1?tab=links#v2")).toEqual({ kind: "knowledge", path: "/knowledge/entry-1?tab=links#v2" });
    expect(parseShellRoute("/next/search?type=all&sort=time")).toEqual({ kind: "search", path: "/search?type=all&sort=time" });
    expect(parseShellRoute("/next/scheduled-tasks/task%201")).toEqual({ kind: "scheduled-tasks", path: "/scheduled-tasks/task%201" });
    expect(parseShellRoute("/next/learn/")).toEqual({ kind: "learn" });
    for (const href of ["/next/knowledge/entry-1?tab=links#v2", "/next/search?type=all&sort=time", "/next/scheduled-tasks/t-1"]) {
      expect(toShellPath(parseShellRoute(href))).toBe(href);
    }
    expect(toShellPath({ kind: "learn" })).toBe("/next/learn");
  });

  it("falls back to the shell home for unknown routes", () => {
    expect(parseShellRoute("/next/dashboard")).toEqual({ kind: "home" });
    expect(parseShellRoute("/other/path")).toEqual({ kind: "home" });
  });

  it("builds canonical shell paths", () => {
    expect(toShellPath({ kind: "home" })).toBe("/next");
    expect(toShellPath({ kind: "narrator", sessionId: "session 1" })).toBe("/next/narrators/session%201");
    expect(toShellPath({ kind: "book", bookId: "book/part" })).toBe("/next/books/book%2Fpart");
    expect(toShellPath({ kind: "sessions" })).toBe("/next/sessions");
    expect(toShellPath({ kind: "sessions", create: true })).toBe("/next/sessions/new");
    expect(toShellPath({ kind: "search" })).toBe("/next/search");
    expect(toShellPath({ kind: "routines" })).toBe("/next/routines");
    expect(toShellPath({ kind: "knowledge" })).toBe("/next/knowledge");
    expect(toShellPath({ kind: "scheduled-tasks" })).toBe("/next/scheduled-tasks");
    expect(toShellPath({ kind: "settings" })).toBe("/next/settings");
    expect(toShellPath({ kind: "learn" })).toBe("/next/learn");
    expect(toShellPath({ kind: "market" })).toBe("/next/market");
  });

  it("marks sidebar nav items active from route kind and params", () => {
    const items = getShellNavItems({ books: [{ id: "b1", title: "第一本书" }], sessions: [{ id: "s1", title: "叙述者", status: "active" }] });

    expect(isShellNavItemActive(items.find((item) => item.id === "book:b1")!, { kind: "book", bookId: "b1" })).toBe(true);
    expect(isShellNavItemActive(items.find((item) => item.id === "narrator:s1")!, { kind: "narrator", sessionId: "s1" })).toBe(true);
    expect(isShellNavItemActive(items.find((item) => item.id === "search")!, { kind: "search" })).toBe(true);
    expect(isShellNavItemActive(items.find((item) => item.id === "routines")!, { kind: "settings" })).toBe(false);
    expect(items.find((item) => item.id === "market")?.label).toBe("市场");
    expect(isShellNavItemActive(items.find((item) => item.id === "market")!, { kind: "market" })).toBe(true);
  });
});
