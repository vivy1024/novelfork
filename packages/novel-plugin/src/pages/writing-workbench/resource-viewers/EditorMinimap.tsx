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

export function EditorMinimap({
  editor,
  scrollContainerRef,
  width = 60,
}: EditorMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const drawTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isDragging = useRef(false);

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
    if (contentHeight <= 0) return;

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

    // 绘制可视区域高亮
    const scrollTop = scrollEl.scrollTop;
    const viewportHeight = scrollEl.clientHeight;
    const viewY = scrollTop * scale;
    const viewH = Math.max(12, viewportHeight * scale);

    ctx.fillStyle = viewportColor;
    ctx.fillRect(0, viewY, canvasWidth, viewH);
    ctx.strokeStyle = viewportBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, viewY + 0.5, canvasWidth - 1, viewH - 1);
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

  // 点击 minimap 跳转到对应位置
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const scrollEl = scrollContainerRef.current;
      const canvas = canvasRef.current;
      if (!scrollEl || !canvas) return;

      const rect = canvas.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const scale = scrollEl.scrollHeight / canvas.clientHeight;
      const targetScroll = clickY * scale - scrollEl.clientHeight / 2;

      scrollEl.scrollTo({ top: Math.max(0, targetScroll), behavior: "smooth" });
    },
    [scrollContainerRef],
  );

  // 拖拽滚动
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      isDragging.current = true;
      handleClick(e);

      const onMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const scrollEl = scrollContainerRef.current;
        const canvas = canvasRef.current;
        if (!scrollEl || !canvas) return;
        const rect = canvas.getBoundingClientRect();
        const y = ev.clientY - rect.top;
        const scale = scrollEl.scrollHeight / canvas.clientHeight;
        scrollEl.scrollTop = y * scale - scrollEl.clientHeight / 2;
      };

      const onUp = () => {
        isDragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [scrollContainerRef, handleClick],
  );

  return (
    <div
      className="shrink-0 border-l border-border bg-card/50"
      style={{ width }}
      title="文档缩略图（点击跳转）"
    >
      <canvas
        ref={canvasRef}
        style={{ width, height: "100%", display: "block", cursor: "pointer" }}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}
