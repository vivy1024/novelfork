/**
 * EditorMinimap — 编辑器右侧缩略图（类似 VS Code Minimap）
 *
 * 使用 canvas 绘制文档结构：每行一个小矩形，标题行加粗。
 * 高亮当前可视区域，点击可跳转。
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { Editor } from "@tiptap/core";

interface EditorMinimapProps {
  editor: Editor;
  /** 编辑器内容的滚动容器（即 chapter-editor-wrapper div） */
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /** minimap 宽度（px），默认 60 */
  width?: number;
}

const MIN_VIEWPORT_HEIGHT = 12;

export interface EditorMinimapViewport {
  top: number;
  height: number;
  maxTop: number;
  maxScrollTop: number;
}

/** 将正文的真实滚动范围映射到 minimap 轨道。 */
export function resolveEditorMinimapViewport({
  canvasHeight,
  scrollTop,
  clientHeight,
  scrollHeight,
}: {
  canvasHeight: number;
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): EditorMinimapViewport {
  const safeCanvasHeight = Math.max(0, canvasHeight);
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  if (safeCanvasHeight === 0 || maxScrollTop === 0 || scrollHeight <= 0) {
    return { top: 0, height: safeCanvasHeight, maxTop: 0, maxScrollTop };
  }

  const height = Math.min(
    safeCanvasHeight,
    Math.max(MIN_VIEWPORT_HEIGHT, safeCanvasHeight * (clientHeight / scrollHeight)),
  );
  const maxTop = Math.max(0, safeCanvasHeight - height);
  const clampedScrollTop = Math.min(maxScrollTop, Math.max(0, scrollTop));
  return {
    top: maxTop === 0 ? 0 : (clampedScrollTop / maxScrollTop) * maxTop,
    height,
    maxTop,
    maxScrollTop,
  };
}

/** 将 minimap viewport 的轨道位置映射回正文的 scrollTop，并保证不越界。 */
export function resolveEditorMinimapScrollTop(viewport: EditorMinimapViewport, top: number): number {
  if (viewport.maxTop <= 0 || viewport.maxScrollTop <= 0) return 0;
  const clampedTop = Math.min(viewport.maxTop, Math.max(0, top));
  return (clampedTop / viewport.maxTop) * viewport.maxScrollTop;
}

export function isEditorMinimapViewportHit(viewport: EditorMinimapViewport, y: number): boolean {
  return y >= viewport.top && y <= viewport.top + viewport.height;
}

export function EditorMinimap({
  editor,
  scrollContainerRef,
  width = 60,
}: EditorMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const drawTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dragRef = useRef<{ pointerId: number; grabOffset: number } | null>(null);

  // 绘制 minimap
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const scrollEl = scrollContainerRef.current;
    if (!canvas || !scrollEl) return;

    const editorEl = scrollEl.querySelector(".ProseMirror") as HTMLElement | null;
    if (!editorEl) return;

    const dpr = window.devicePixelRatio || 1;
    const canvasHeight = canvas.clientHeight;
    const canvasWidth = width;

    // 高清屏适配
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // 获取文档信息
    const contentHeight = editorEl.scrollHeight;
    if (contentHeight <= 0 || canvasHeight <= 0) return;

    const scale = canvasHeight / contentHeight;

    // 获取当前主题色
    const isDark = document.documentElement.classList.contains("dark");
    const lineColor = isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)";
    const headingColor = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.45)";
    const viewportColor = isDark ? "rgba(100,150,255,0.12)" : "rgba(0,100,255,0.08)";
    const viewportBorder = isDark ? "rgba(100,150,255,0.3)" : "rgba(0,100,255,0.2)";

    // 遍历 DOM blocks 绘制
    const blocks = editorEl.querySelectorAll<HTMLElement>(".ProseMirror > *");
    let y = 0;
    const lineHeight = 3;
    const gap = 1.5;
    const padX = 4;

    for (const block of blocks) {
      const blockHeight = block.offsetHeight;
      if (blockHeight <= 0) { y += blockHeight; continue; }

      const tag = block.tagName.toLowerCase();
      const isHeading = /^h[1-6]$/.test(tag);
      const textLen = (block.textContent ?? "").length;
      const numLines = Math.max(1, Math.ceil(blockHeight / 20));

      for (let i = 0; i < numLines; i++) {
        const lineY = (y + (i * blockHeight) / numLines) * scale;
        const w = Math.min(
          canvasWidth - padX * 2,
          Math.max(8, (isHeading && i === 0 ? 0.8 : Math.min(1, textLen / 80)) * (canvasWidth - padX * 2)),
        );

        ctx.fillStyle = isHeading && i === 0 ? headingColor : lineColor;
        // 标题行高度略大
        const h = isHeading && i === 0 ? lineHeight + 1 : lineHeight;
        ctx.fillRect(padX, lineY, w, h);
      }

      y += blockHeight;
    }

    // 绘制可视区域高亮。位置与拖拽逻辑共用同一映射，避免蓝色块看起来
    // 在一个位置、实际点击/拖动却按另一套比例计算。
    const viewport = resolveEditorMinimapViewport({
      canvasHeight,
      scrollTop: scrollEl.scrollTop,
      clientHeight: scrollEl.clientHeight,
      scrollHeight: scrollEl.scrollHeight,
    });

    ctx.fillStyle = viewportColor;
    ctx.fillRect(0, viewport.top, canvasWidth, viewport.height);
    ctx.strokeStyle = viewportBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, viewport.top + 0.5, canvasWidth - 1, Math.max(0, viewport.height - 1));
  }, [scrollContainerRef, width]);

  // Debounced redraw on content change
  const scheduleRedraw = useCallback(() => {
    clearTimeout(drawTimerRef.current);
    drawTimerRef.current = setTimeout(draw, 500);
  }, [draw]);

  // 监听编辑器更新
  useEffect(() => {
    if (!editor) return;
    editor.on("update", scheduleRedraw);
    return () => { editor.off("update", scheduleRedraw); };
  }, [editor, scheduleRedraw]);

  // 监听滚动更新可视区域高亮（直接重绘，不 debounce）
  useEffect(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;

    const onScroll = () => {
      cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(draw);
    };

    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(animRef.current);
    };
  }, [scrollContainerRef, draw]);

  // ResizeObserver 监听容器尺寸变化
  useEffect(() => {
    const scrollEl = scrollContainerRef.current;
    const canvas = canvasRef.current;
    if (!scrollEl || !canvas) return;

    const ro = new ResizeObserver(() => scheduleRedraw());
    ro.observe(scrollEl);
    ro.observe(canvas);

    return () => ro.disconnect();
  }, [scrollContainerRef, scheduleRedraw]);

  // 初始绘制
  useEffect(() => {
    const timer = setTimeout(draw, 100);
    return () => clearTimeout(timer);
  }, [draw]);

  const getPointerY = useCallback((event: React.PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    return event.clientY - rect.top;
  }, []);

  const getViewport = useCallback((canvas: HTMLCanvasElement, scrollEl: HTMLDivElement) => (
    resolveEditorMinimapViewport({
      canvasHeight: canvas.clientHeight,
      scrollTop: scrollEl.scrollTop,
      clientHeight: scrollEl.clientHeight,
      scrollHeight: scrollEl.scrollHeight,
    })
  ), []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const canvas = canvasRef.current;
    const scrollEl = scrollContainerRef.current;
    if (!canvas || !scrollEl) return;

    const viewport = getViewport(canvas, scrollEl);
    if (viewport.maxScrollTop <= 0) return;

    const pointerY = getPointerY(event, canvas);
    if (isEditorMinimapViewportHit(viewport, pointerY)) {
      dragRef.current = { pointerId: event.pointerId, grabOffset: pointerY - viewport.top };
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }

    // 点击轨道空白处：让蓝色 viewport 的中心落到点击位置。
    scrollEl.scrollTop = resolveEditorMinimapScrollTop(viewport, pointerY - viewport.height / 2);
    event.preventDefault();
  }, [getPointerY, getViewport, scrollContainerRef]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const canvas = canvasRef.current;
    const scrollEl = scrollContainerRef.current;
    if (!canvas || !scrollEl) return;

    const viewport = getViewport(canvas, scrollEl);
    const pointerY = getPointerY(event, canvas);
    scrollEl.scrollTop = resolveEditorMinimapScrollTop(viewport, pointerY - drag.grabOffset);
    event.preventDefault();
  }, [getPointerY, getViewport, scrollContainerRef]);

  const finishPointerDrag = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture?.(event.pointerId);
  }, []);

  useEffect(() => () => {
    dragRef.current = null;
  }, []);

  return (
    <div
      className="shrink-0 border-l border-border bg-card/50"
      style={{ width }}
      title="文档缩略图（点击跳转）"
    >
      <canvas
        ref={canvasRef}
        style={{
          width,
          height: "100%",
          display: "block",
          cursor: "pointer",
          touchAction: "none",
          userSelect: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerDrag}
        onPointerCancel={finishPointerDrag}
        onLostPointerCapture={finishPointerDrag}
      />
    </div>
  );
}
