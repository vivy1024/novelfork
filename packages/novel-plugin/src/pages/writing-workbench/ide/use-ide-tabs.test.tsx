/**
 * useIdeTabs 核心语义：点击资源 → openTab → 该 tab 归属工作区的 tabs 出现并激活。
 *
 * 这是「侧栏点击任何资源都要在主区打开对应 Tab」的状态层保证：
 * EditorTabs/主区只渲染当前 ActivityBar 视图的 tab（tabs 按 activeView 过滤），
 * 所以 openTab 的归属视图由节点类型决定，与点击入口所在视图无关；
 * 入口视图 ≠ 归属视图时由 IdeWorkbench.handleOpen 负责切换 ActivityBar。
 */
import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useIdeTabs } from "./use-ide-tabs";

// 该环境的 jsdom localStorage 不完整（无 clear），用最小内存实现替身。
const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  });
});

describe("useIdeTabs 打开 tab", () => {
  it("openTab 后当前归属视图的 tabs 出现该 tab 并被激活", () => {
    const { result } = renderHook(() => useIdeTabs("book-open", "characters-lore"));

    act(() => {
      result.current.openTab("jingwei-entry:char-1", "薛行之", "jingwei-entry", "characters-lore");
    });

    expect(result.current.tabs.map((t) => t.id)).toContain("jingwei-entry:char-1");
    expect(result.current.activeTabId).toBe("jingwei-entry:char-1");
    expect(result.current.tabs.find((t) => t.id === "jingwei-entry:char-1")?.title).toBe("薛行之");
  });

  it("打开归属其他视图的 tab 时，当前视图看不到（EditorTabs 视图隔离的依据）", () => {
    // 复刻「故事推进视图里打开一个分析工具」：工具是 tool 节点，tab 归「资源」工作区。
    // 状态层如实落地到 resources；可见性由 handleOpen 切换 ActivityBar 保证。
    const { result } = renderHook(() => useIdeTabs("book-open2", "storyline"));

    act(() => {
      result.current.openTab("tool:quality", "质量中心", "tool", "resources");
    });

    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeTabId).toBeNull();
  });

  it("同一 nodeId 重复打开不新增 tab、保持激活，并同步最新标题（图谱单例 tab）", () => {
    const { result } = renderHook(() => useIdeTabs("book-open3", "storyline"));

    act(() => {
      result.current.openTab("narrative-memory-graph", "全景图谱 · 关系图", "memory-entry", "storyline");
    });
    act(() => {
      result.current.openTab("narrative-memory-graph", "全景图谱 · 时间线", "memory-entry", "storyline");
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe("narrative-memory-graph");
    expect(result.current.tabs[0].title).toBe("全景图谱 · 时间线");
  });

  it("打开多个视图各自的 tab 后，切换 activeView 各自可见且互不污染", () => {
    let view: "characters-lore" | "storyline" = "characters-lore";
    const { result, rerender } = renderHook(() => useIdeTabs("book-open4", view));

    act(() => {
      result.current.openTab("jingwei-entry:char-1", "薛行之", "jingwei-entry", "characters-lore");
      result.current.openTab("story-map:book-open4", "故事主支线", "story-map", "storyline");
    });

    expect(result.current.tabs.map((t) => t.id)).toEqual(["jingwei-entry:char-1"]);

    view = "storyline";
    rerender();
    expect(result.current.tabs.map((t) => t.id)).toEqual(["story-map:book-open4"]);
    expect(result.current.activeTabId).toBe("story-map:book-open4");

    view = "characters-lore";
    rerender();
    expect(result.current.tabs.map((t) => t.id)).toEqual(["jingwei-entry:char-1"]);
    expect(result.current.activeTabId).toBe("jingwei-entry:char-1");
  });
});

describe("useIdeTabs 视图归属修正与暂不激活", () => {
  it("落盘的旧 tab 归属错了视图，再次打开时搬到本次的归属视图（设定图谱曾落在资源管理器）", () => {
    store.set("nf:ide-tabs:book-move", JSON.stringify({
      tabs: [
        { id: "lore-trees:book-move", nodeId: "lore-trees:book-move", title: "设定图谱", kind: "other", view: "explorer" },
        { id: "file:story/a.md", nodeId: "file:story/a.md", title: "a.md", kind: "file", view: "explorer" },
      ],
      activeByView: { explorer: "lore-trees:book-move" },
    }));
    let view: "resources" | "characters-lore" = "characters-lore";
    const { result, rerender } = renderHook(() => useIdeTabs("book-move", view));

    act(() => {
      result.current.openTab("lore-trees:book-move", "设定图谱", "other", "characters-lore");
    });

    expect(result.current.tabs.map((t) => t.id)).toEqual(["lore-trees:book-move"]);
    expect(result.current.activeTabId).toBe("lore-trees:book-move");
    // 原视图（旧资源管理器已迁到「资源」）不再指向搬走的 tab
    view = "resources";
    rerender();
    expect(result.current.tabs.map((t) => t.id)).toEqual(["file:story/a.md"]);
    expect(result.current.activeTabId).toBe("file:story/a.md");
  });

  it("deactivateView 让视图暂时没有激活 tab，标签本身保留", () => {
    const { result } = renderHook(() => useIdeTabs("book-deactivate", "resources"));

    act(() => {
      result.current.openTab("file:story/a.md", "a.md", "file", "resources");
    });
    expect(result.current.activeTabId).toBe("file:story/a.md");

    act(() => {
      result.current.deactivateView("resources");
    });
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.tabs.map((t) => t.id)).toEqual(["file:story/a.md"]);

    act(() => {
      result.current.activateTab("file:story/a.md");
    });
    expect(result.current.activeTabId).toBe("file:story/a.md");
  });

  it("老用户落盘的资源管理器与分析工具标签合并进「资源」视图：标签都在、激活项保留，并立即回写磁盘", () => {
    store.set("nf:ide-tabs:book-legacy-merge", JSON.stringify({
      tabs: [
        { id: "file:story/a.md", nodeId: "file:story/a.md", title: "a.md", kind: "file", view: "explorer" },
        { id: "tool:quality", nodeId: "tool:quality", title: "质量中心", kind: "tool", view: "tools", pinned: true },
        { id: "jingwei-entry:1", nodeId: "jingwei-entry:1", title: "林舟", kind: "jingwei-entry", view: "characters-lore" },
      ],
      activeByView: { write: null, explorer: null, "characters-lore": "jingwei-entry:1", tools: "tool:quality", search: null },
    }));
    const { result } = renderHook(() => useIdeTabs("book-legacy-merge", "resources"));

    // 固定标签排在前面；两组旧标签都落在「资源」，分析工具的激活项接上
    expect(result.current.tabs.map((t) => t.id)).toEqual(["tool:quality", "file:story/a.md"]);
    expect(result.current.activeTabId).toBe("tool:quality");

    const persisted = JSON.parse(store.get("nf:ide-tabs:book-legacy-merge")!);
    expect(persisted.tabs.map((t: { view: string }) => t.view)).toEqual(["resources", "resources", "characters-lore"]);
    expect(Object.keys(persisted.activeByView)).not.toContain("explorer");
    expect(Object.keys(persisted.activeByView)).not.toContain("tools");
    expect(persisted.activeByView.resources).toBe("tool:quality");
    expect(persisted.activeByView["characters-lore"]).toBe("jingwei-entry:1");
  });
});

describe("useIdeTabs 落盘时机", () => {
  const legacy = {
    tabs: [
      { id: "file:book.json", nodeId: "file:book.json", title: "book.json", kind: "file", view: "explorer" },
      { id: "tool:quality", nodeId: "tool:quality", title: "质量中心", kind: "tool", view: "tools" },
    ],
    activeByView: { write: null, explorer: "file:book.json", tools: "tool:quality", search: null },
  };

  it("StrictMode 开发态双跑 effect 时，旧视图迁移不会把标签清空（首次提交的初始空状态不能落盘）", () => {
    store.set("nf:ide-tabs:book-strict", JSON.stringify(legacy));
    const { result } = renderHook(() => useIdeTabs("book-strict", "resources"), { wrapper: StrictMode });

    expect(result.current.tabs.map((t) => t.id)).toEqual(["file:book.json", "tool:quality"]);
    expect(result.current.activeTabId).toBe("file:book.json");
    const persisted = JSON.parse(store.get("nf:ide-tabs:book-strict")!);
    expect(persisted.tabs.map((t: { id: string; view: string }) => [t.id, t.view])).toEqual([
      ["file:book.json", "resources"],
      ["tool:quality", "resources"],
    ]);
  });

  it("换到带旧状态的书时，不会把上一本书的标签写进新书", () => {
    store.set("nf:ide-tabs:book-new", JSON.stringify(legacy));
    let bookId = "book-old";
    const { result, rerender } = renderHook(() => useIdeTabs(bookId, "resources"));
    act(() => {
      result.current.openTab("file:old.md", "old.md", "file", "resources");
    });

    const writes: string[] = [];
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation((key: string, value: string) => {
      if (key === "nf:ide-tabs:book-new") writes.push(value);
      store.set(key, value);
    });
    bookId = "book-new";
    rerender();
    setItem.mockRestore();

    // 过程中的每一次写入都不能带上一本书的标签
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.some((value) => value.includes("file:old.md"))).toBe(false);
    expect(result.current.tabs.map((t) => t.id)).toEqual(["file:book.json", "tool:quality"]);
    const persisted = JSON.parse(store.get("nf:ide-tabs:book-new")!);
    expect(persisted.tabs.map((t: { id: string }) => t.id)).toEqual(["file:book.json", "tool:quality"]);
  });
});
