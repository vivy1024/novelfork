import { describe, expect, it, vi } from "vitest";
import { createAppStore, appStore } from "./app-store";

describe("app-store", () => {
  it("creates a store with initial state", () => {
    const store = createAppStore({ activeBookId: null, activeChapterNumber: null });
    expect(store.getState()).toEqual({ activeBookId: null, activeChapterNumber: null });
  });

  it("updates state via setState", () => {
    const store = createAppStore({ activeBookId: null, activeChapterNumber: null });
    store.setState(() => ({ activeBookId: "book-1", activeChapterNumber: 3 }));
    expect(store.getState().activeBookId).toBe("book-1");
    expect(store.getState().activeChapterNumber).toBe(3);
  });

  it("notifies subscribers on state change", () => {
    const store = createAppStore({ activeBookId: null, activeChapterNumber: null });
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState(() => ({ activeBookId: "book-2", activeChapterNumber: 1 }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("skips notification when state reference is unchanged", () => {
    const store = createAppStore({ activeBookId: null, activeChapterNumber: null });
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState((prev) => prev); // same reference
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribes correctly", () => {
    const store = createAppStore({ activeBookId: null, activeChapterNumber: null });
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    unsub();
    store.setState(() => ({ activeBookId: "book-3", activeChapterNumber: 5 }));
    expect(listener).not.toHaveBeenCalled();
  });

  it("default appStore singleton has null state", () => {
    expect(appStore.getState().activeBookId).toBeNull();
  });
});
