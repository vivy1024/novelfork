/**
 * useIdeTabs 核心语义：点击资源 → openTab → 该 tab 归属工作区的 tabs 出现并激活。
 *
 * 这是「侧栏点击任何资源都要在主区打开对应 Tab」的状态层保证：
 * EditorTabs/主区只渲染当前 ActivityBar 视图的 tab（tabs 按 activeView 过滤），
 * 所以 openTab 的归属视图由节点类型决定，与点击入口所在视图无关；
 * 入口视图 ≠ 归属视图时由 IdeWorkbench.handleOpen 负责切换 ActivityBar。
 */
import { act, renderHook } from "@testing-library/react";
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
    // 复刻「故事推进视图点击伏笔账本」：伏笔是 tool 节点，tab 归 tools 工作区。
    // 状态层如实落地到 tools；可见性由 handleOpen 切换 ActivityBar 保证。
    const { result } = renderHook(() => useIdeTabs("book-open2", "storyline"));

    act(() => {
      result.current.openTab("tool:foreshadowing", "伏笔账本", "tool", "tools");
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
