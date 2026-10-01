/**
 * 新旧侧栏视图合并后的持久化迁移。
 *
 * 旧版本可能已经落盘了 `jingwei` 或 `narrative-memory` 视图的 tab。
 * 如果不迁移，这些 tab 会留在 localStorage 里但没有新视图承载 —— 点不开也关不掉。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadState, normalizePersistedTabView, saveState } from "./use-ide-tabs";

const BOOK = "book-migration";
const KEY = `nf:ide-tabs:${BOOK}`;

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

describe("normalizePersistedTabView", () => {
  it("把已废弃的 jingwei 迁移到 characters-lore", () => {
    expect(normalizePersistedTabView("jingwei")).toBe("characters-lore");
  });

  it("把已废弃的 narrative-memory 迁移到 storyline", () => {
    expect(normalizePersistedTabView("narrative-memory")).toBe("storyline");
  });

  it("保留现存视图", () => {
    for (const view of ["write", "explorer", "characters-lore", "storyline", "skills-style", "tools", "search"]) {
      expect(normalizePersistedTabView(view)).toBe(view);
    }
  });

  it("未知或非法值退回 explorer", () => {
    expect(normalizePersistedTabView("what-is-this")).toBe("explorer");
    expect(normalizePersistedTabView(undefined)).toBe("explorer");
    expect(normalizePersistedTabView(42)).toBe("explorer");
  });
});

describe("loadState 迁移", () => {
  it("旧版本存下的章节文件名标签标题换成「第 N 章 标题」，其它标签不动", () => {
    localStorage.setItem(KEY, JSON.stringify({
      tabs: [
        { id: "file:chapters/卷01/0001_雨夜.md", nodeId: "file:chapters/卷01/0001_雨夜.md", title: "0001_雨夜.md", kind: "chapter", view: "explorer" },
        { id: "file:story/notes.md", nodeId: "file:story/notes.md", title: "notes.md", kind: "file", view: "explorer" },
      ],
      activeByView: { explorer: "file:chapters/卷01/0001_雨夜.md" },
    }));

    const state = loadState(BOOK);
    expect(state.tabs.map((t) => t.title)).toEqual(["第 1 章 雨夜", "notes.md"]);
  });

  it("旧视图 tab 分别迁到新工作区且仍可激活", () => {
    localStorage.setItem(KEY, JSON.stringify({
      tabs: [
        { id: "memory-fact:1", nodeId: "memory-fact:1", title: "林舟 持有 青铜镜", kind: "file", view: "narrative-memory" },
        { id: "jingwei-entry:9", nodeId: "jingwei-entry:9", title: "林舟", kind: "jingwei-entry", view: "jingwei" },
      ],
      activeByView: { "narrative-memory": "memory-fact:1", jingwei: null, explorer: null, tools: null, search: null },
    }));

    const state = loadState(BOOK);

    expect(state.tabs.map((t) => t.view)).toEqual(["storyline", "characters-lore"]);
    // 不再残留已废弃的视图键
    expect(Object.keys(state.activeByView)).not.toContain("narrative-memory");
    expect(Object.keys(state.activeByView)).not.toContain("jingwei");
    // 激活项迁移过来，且指向仍然存在的 tab
    expect(state.activeByView.storyline).toBe("memory-fact:1");
    expect(state.activeByView["characters-lore"]).toBe("jingwei-entry:9");
  });

  it("两个旧视图都有激活项时不会产生悬空引用", () => {
    localStorage.setItem(KEY, JSON.stringify({
      tabs: [
        { id: "a", nodeId: "a", title: "设定", kind: "jingwei-entry", view: "jingwei" },
        { id: "b", nodeId: "b", title: "记忆", kind: "file", view: "narrative-memory" },
      ],
      activeByView: { jingwei: "a", "narrative-memory": "b" },
    }));

    const state = loadState(BOOK);
    expect(state.activeByView["characters-lore"]).toBe("a");
    expect(state.activeByView.storyline).toBe("b");
    expect(state.tabs.some((t) => t.id === state.activeByView["characters-lore"])).toBe(true);
    expect(state.tabs.some((t) => t.id === state.activeByView.storyline)).toBe(true);
  });

  it("激活项指向已消失的 tab 时回退到该视图第一个 tab", () => {
    localStorage.setItem(KEY, JSON.stringify({
      tabs: [{ id: "kept", nodeId: "kept", title: "留下的", kind: "file", view: "narrative-memory" }],
      activeByView: { "narrative-memory": "已删除的-tab" },
    }));

    const state = loadState(BOOK);
    expect(state.activeByView.storyline).toBe("kept");
  });

  it("没有落盘数据时返回空状态", () => {
    const state = loadState(BOOK);
    expect(state.tabs).toEqual([]);
    expect(state.activeByView["characters-lore"]).toBeNull();
  });

  it("旧格式（无 activeByView）不迁移，避免视图错乱", () => {
    localStorage.setItem(KEY, JSON.stringify({
      tabs: [{ id: "x", nodeId: "x", title: "旧", kind: "file" }],
    }));
    expect(loadState(BOOK).tabs).toEqual([]);
  });

  it("损坏的 JSON 不抛异常", () => {
    localStorage.setItem(KEY, "{ not json");
    expect(loadState(BOOK).tabs).toEqual([]);
  });

  it("迁移结果回写后磁盘上不再残留废弃视图名", () => {
    localStorage.setItem(KEY, JSON.stringify({
      tabs: [{ id: "m1", nodeId: "m1", title: "旧记忆", kind: "file", view: "narrative-memory" }],
      activeByView: { "narrative-memory": "m1" },
    }));

    // useIdeTabs 在检测到旧视图名时会立即 saveState(loaded)
    saveState(BOOK, loadState(BOOK));

    const persisted = JSON.parse(localStorage.getItem(KEY)!);
    expect(persisted.tabs.map((t: { view: string }) => t.view)).toEqual(["storyline"]);
    expect(Object.keys(persisted.activeByView)).not.toContain("narrative-memory");
    expect(persisted.activeByView.storyline).toBe("m1");
    // 再次加载已是稳定态
    expect(loadState(BOOK).tabs[0]?.view).toBe("storyline");
  });
});
