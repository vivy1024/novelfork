import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  containsChapterNode,
  markNewBookGuideCompleted,
  newBookGuideStorageKey,
  readNewBookGuideCompleted,
  useNewBookGuideCompleted,
} from "./new-book-guide-state";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

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

const capabilities = { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false };

describe("建书十一问完成状态（作品总览与写作侧栏共用）", () => {
  it("沿用十一问上线时的本机记录键，老用户答过的不会被再问一次", () => {
    expect(newBookGuideStorageKey("book-1")).toBe("novelfork:guide-completed:book-1");
    store.set("novelfork:guide-completed:book-1", "true");
    expect(readNewBookGuideCompleted("book-1")).toBe(true);
    expect(readNewBookGuideCompleted("book-2")).toBe(false);
    expect(readNewBookGuideCompleted(undefined)).toBe(false);
  });

  it("标记完成后写入记录，并通知已挂载的订阅方", () => {
    const { result } = renderHook(() => useNewBookGuideCompleted("book-3"));
    expect(result.current).toBe(false);

    act(() => markNewBookGuideCompleted("book-3"));

    expect(store.get("novelfork:guide-completed:book-3")).toBe("true");
    expect(result.current).toBe(true);
  });

  it("别的书完成不影响当前书", () => {
    const { result } = renderHook(() => useNewBookGuideCompleted("book-4"));
    act(() => markNewBookGuideCompleted("book-5"));
    expect(result.current).toBe(false);
  });

  it("本机存储不可用时，完成事件仍在本次会话里生效", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    });
    const { result } = renderHook(() => useNewBookGuideCompleted("book-6"));
    act(() => markNewBookGuideCompleted("book-6"));
    expect(result.current).toBe(true);
  });

  it("资源树里有章节节点（含嵌套）即视为已开写", () => {
    const tree: WorkbenchResourceNode[] = [{
      id: "group:chapters",
      kind: "group",
      title: "章节",
      capabilities,
      children: [{ id: "chapter:1", kind: "chapter", title: "第 1 章", capabilities }],
    }];
    expect(containsChapterNode(tree)).toBe(true);
    expect(containsChapterNode([{ id: "book", kind: "book", title: "书", capabilities }])).toBe(false);
    expect(containsChapterNode(undefined)).toBe(false);
  });
});
