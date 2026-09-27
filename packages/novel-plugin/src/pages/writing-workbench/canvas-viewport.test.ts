import { afterEach, describe, expect, it, vi } from "vitest";

import { forgetViewport, readSavedViewport, saveViewport } from "./canvas-viewport";
import { initialTreeViewport, revealTarget, TIDY_NODE_HEIGHT, TIDY_NODE_WIDTH } from "./TidyTreeCanvas";

function memoryStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe("画布视口记忆", () => {
  it("按键存取，只存平移与缩放", () => {
    const store = memoryStorage();
    saveViewport("book-1:causal", { x: 12.6, y: -40.2, zoom: 0.71234 });
    expect(readSavedViewport("book-1:causal")).toEqual({ x: 13, y: -40, zoom: 0.712 });
    expect(readSavedViewport("book-2:causal")).toBeNull();
    forgetViewport("book-1:causal");
    expect(store.size).toBe(0);
  });

  it("存的东西坏了、没给键、存储不可用时都退回默认视图，不抛错", () => {
    const store = memoryStorage();
    store.set("novelfork:canvas-viewport:bad", "{not json");
    store.set("novelfork:canvas-viewport:zero", JSON.stringify({ x: 0, y: 0, zoom: 0 }));
    expect(readSavedViewport("bad")).toBeNull();
    expect(readSavedViewport("zero")).toBeNull();
    expect(readSavedViewport(undefined)).toBeNull();

    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    expect(readSavedViewport("any")).toBeNull();
    expect(() => saveViewport("any", { x: 0, y: 0, zoom: 1 })).not.toThrow();
  });
});

describe("故事树初始视口", () => {
  it("整棵树放得下：不放大，居中", () => {
    expect(initialTreeViewport({ width: 400, height: 200, rootCenterY: 100 }, { width: 800, height: 600 })).toEqual({ x: 200, y: 200, zoom: 1 });
  });

  it("放不下：缩放不低于 0.6，根节点贴左并在竖直方向居中", () => {
    const view = initialTreeViewport({ width: 3000, height: 4000, rootCenterY: 2000 }, { width: 800, height: 600 });
    expect(view.zoom).toBe(0.6);
    expect(view.x).toBe(0);
    expect(view.y + 2000 * view.zoom).toBe(300);
  });
});

describe("展开后把子节点平移进视口", () => {
  const pane = { width: 500, height: 400 };

  it("子节点都在视口内时不动", () => {
    expect(revealTarget([{ x: 10, y: 10 }, { x: 10, y: 60 }], { x: 0, y: 0, zoom: 1 }, pane)).toBeNull();
    expect(revealTarget([], { x: 0, y: 0, zoom: 1 }, pane)).toBeNull();
  });

  it("有子节点落在视口外时，以子节点整体的中心为新视口中心", () => {
    const target = revealTarget([{ x: 600, y: 40 }, { x: 600, y: 120 }], { x: 0, y: 0, zoom: 1 }, pane);
    expect(target).toEqual({ x: 600 + TIDY_NODE_WIDTH / 2, y: (40 + 120 + TIDY_NODE_HEIGHT) / 2 });
    // 缩放与平移会影响判断：同一组节点在缩小、左移后的视口里是可见的
    expect(revealTarget([{ x: 600, y: 40 }, { x: 600, y: 120 }], { x: -300, y: 0, zoom: 0.8 }, pane)).toBeNull();
  });
});
