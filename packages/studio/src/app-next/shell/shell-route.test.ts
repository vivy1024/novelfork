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

  it("套路页：只有 Runtime 原页子路径；老地址 /novelfork/… 一律收回套路页", () => {
    expect(parseShellRoute("/next/routines/tool-permissions")).toEqual({ kind: "routines", path: "/routines/tool-permissions" });
    // 已删的 NovelFork 面板：段名保留只为把老地址收回来，不产生任何面板路由
    expect(parseShellRoute("/next/routines/novelfork/book")).toEqual({ kind: "routines" });
    expect(parseShellRoute("/next/routines/novelfork/subagent-tools?x=1")).toEqual({ kind: "routines" });
    expect(parseShellRoute("/next/routines/novelfork/unknown")).toEqual({ kind: "routines" });
    expect(toShellPath({ kind: "routines", path: "/routines/tool-permissions" })).toBe("/next/routines/tool-permissions");
    for (const href of ["/next/routines", "/next/routines/tool-permissions"]) {
      expect(toShellPath(parseShellRoute(href))).toBe(href);
    }
  });

  it("设置页：所有地址都是 Runtime 设置页的子路径；旧的 embedding 地址映射进产品侧栏页", () => {
    expect(parseShellRoute("/next/settings")).toEqual({ kind: "settings" });
    expect(parseShellRoute("/next/settings/profile")).toEqual({ kind: "settings", path: "/settings/profile" });
    expect(parseShellRoute("/next/settings/providers?tab=custom")).toEqual({ kind: "settings", path: "/settings/providers?tab=custom" });
    expect(parseShellRoute("/next/settings/plugins/some.plugin")).toEqual({ kind: "settings", path: "/settings/plugins/some.plugin" });
    // 外观 / 用户 / 关于 是 Runtime 原页自己的子页，直通
    expect(parseShellRoute("/next/settings/appearance")).toEqual({ kind: "settings", path: "/settings/appearance" });
    expect(parseShellRoute("/next/settings/users")).toEqual({ kind: "settings", path: "/settings/users" });
    expect(parseShellRoute("/next/settings/about")).toEqual({ kind: "settings", path: "/settings/about" });
    // 旧的 NovelFork 面板段已取消，不再有特殊含义，按 Runtime 路径直通
    expect(parseShellRoute("/next/settings/novelfork/embedding")).toEqual({ kind: "settings", path: "/settings/novelfork/embedding" });
    // 旧的 embedding 地址映射到侧栏「小说」分组里的向量模型页
    expect(parseShellRoute("/next/settings/embedding")).toEqual({ kind: "settings", path: "/settings/host/embedding" });
    // 旧版 Studio 子页地址映射到 Runtime 原页路径
    expect(parseShellRoute("/next/settings/agents")).toEqual({ kind: "settings", path: "/settings/agent" });
    expect(parseShellRoute("/next/settings/data")).toEqual({ kind: "settings", path: "/settings/storage" });
    expect(parseShellRoute("/next/settings/resources")).toEqual({ kind: "settings", path: "/settings/runtime" });
    expect(toShellPath({ kind: "settings", path: "/settings/profile" })).toBe("/next/settings/profile");
    expect(toShellPath({ kind: "settings", path: "/settings/host/embedding" })).toBe("/next/settings/host/embedding");
    for (const href of ["/next/settings", "/next/settings/profile", "/next/settings/plugins/some.plugin", "/next/settings/host/embedding"]) {
      expect(toShellPath(parseShellRoute(href))).toBe(href);
    }
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
