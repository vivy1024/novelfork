import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import type { RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EditorMinimap,
  isEditorMinimapViewportHit,
  resolveEditorMinimapScrollTop,
  resolveEditorMinimapViewport,
} from "./EditorMinimap";

function defineMetric(element: Element, key: "clientHeight" | "scrollHeight", value: number): void {
  Object.defineProperty(element, key, { configurable: true, value });
}

function renderInteractiveMinimap() {
  const scrollEl = document.createElement("div");
  defineMetric(scrollEl, "clientHeight", 100);
  defineMetric(scrollEl, "scrollHeight", 1_000);
  scrollEl.scrollTop = 450;
  const scrollContainerRef = { current: scrollEl } as RefObject<HTMLDivElement | null>;
  const editor = { on: vi.fn(), off: vi.fn() } as unknown as Editor;
  const rendered = render(<EditorMinimap editor={editor} scrollContainerRef={scrollContainerRef} />);
  const canvas = rendered.container.querySelector("canvas");
  if (!canvas) throw new Error("minimap canvas missing");
  defineMetric(canvas, "clientHeight", 200);
  Object.defineProperty(canvas, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top: 0, left: 0, right: 60, bottom: 200, width: 60, height: 200 }),
  });
  return { canvas, scrollEl };
}

afterEach(() => cleanup());

describe("EditorMinimap viewport mapping", () => {
  it("将正文滚动位置映射到可拖拽 viewport，并可逆映射回正文", () => {
    const viewport = resolveEditorMinimapViewport({
      canvasHeight: 200,
      scrollTop: 450,
      clientHeight: 100,
      scrollHeight: 1_000,
    });

    expect(viewport).toMatchObject({ height: 20, maxTop: 180, maxScrollTop: 900, top: 90 });
    expect(resolveEditorMinimapScrollTop(viewport, viewport.top)).toBeCloseTo(450);
  });

  it("保持 thumb 抓取偏移，并在顶部和底部 clamp", () => {
    const viewport = resolveEditorMinimapViewport({
      canvasHeight: 200,
      scrollTop: 450,
      clientHeight: 100,
      scrollHeight: 1_000,
    });
    const grabOffset = 7;

    expect(resolveEditorMinimapScrollTop(viewport, -50 - grabOffset)).toBe(0);
    expect(resolveEditorMinimapScrollTop(viewport, 999 - grabOffset)).toBe(900);
    expect(resolveEditorMinimapScrollTop(viewport, 120 - grabOffset)).toBeCloseTo(565);
  });

  it("为超长正文保留最小 viewport 高度，并按轨道范围映射", () => {
    const viewport = resolveEditorMinimapViewport({
      canvasHeight: 200,
      scrollTop: 99_900,
      clientHeight: 100,
      scrollHeight: 100_000,
    });

    expect(viewport.height).toBe(12);
    expect(viewport.top).toBe(188);
    expect(resolveEditorMinimapScrollTop(viewport, 188)).toBe(99_900);
  });

  it("区分 thumb 命中与轨道空白点击；没有滚动范围时占满轨道", () => {
    const viewport = resolveEditorMinimapViewport({
      canvasHeight: 200,
      scrollTop: 300,
      clientHeight: 100,
      scrollHeight: 1_000,
    });
    expect(isEditorMinimapViewportHit(viewport, viewport.top)).toBe(true);
    expect(isEditorMinimapViewportHit(viewport, viewport.top + viewport.height)).toBe(true);
    expect(isEditorMinimapViewportHit(viewport, viewport.top - 0.1)).toBe(false);
    expect(isEditorMinimapViewportHit(viewport, viewport.top + viewport.height + 0.1)).toBe(false);

    expect(resolveEditorMinimapViewport({
      canvasHeight: 200,
      scrollTop: 10,
      clientHeight: 300,
      scrollHeight: 300,
    })).toEqual({ top: 0, height: 200, maxTop: 0, maxScrollTop: 0 });
  });

  it("在蓝色 viewport 上用 pointer capture 拖动正文", () => {
    const { canvas, scrollEl } = renderInteractiveMinimap();
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperty(canvas, "setPointerCapture", { configurable: true, value: setPointerCapture });
    Object.defineProperty(canvas, "hasPointerCapture", { configurable: true, value: () => true });
    Object.defineProperty(canvas, "releasePointerCapture", { configurable: true, value: releasePointerCapture });

    // scrollTop=450 时 viewport 位于 [90, 110]，从 y=97 抓住它，偏移为 7px。
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 7, clientY: 97 });
    expect(setPointerCapture).toHaveBeenCalledWith(7);

    fireEvent.pointerMove(canvas, { pointerId: 7, clientY: 127 });
    // 127 - 7 = 120 → 120 / 180 * 900 = 600。
    expect(scrollEl.scrollTop).toBeCloseTo(600);

    fireEvent.pointerUp(canvas, { pointerId: 7 });
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it("点击轨道空白处时将 viewport 中心跳转到点击位置", () => {
    const { canvas, scrollEl } = renderInteractiveMinimap();

    // viewport 高度 20；点击 y=160 时 top=150 → 150 / 180 * 900 = 750。
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 3, clientY: 160 });
    expect(scrollEl.scrollTop).toBeCloseTo(750);
  });
});
