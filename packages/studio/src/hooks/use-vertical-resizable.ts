/**
 * useVerticalResizable — resizable bottom panel height control.
 * Mirrors use-resizable.ts but for vertical (top-bottom) dragging.
 */

import { useState, useEffect, useCallback, useRef } from "react";

interface UseVerticalResizableOptions {
  readonly initialHeight: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly storageKey?: string;
}

interface UseVerticalResizableResult {
  readonly height: number;
  readonly isDragging: boolean;
  readonly handleProps: {
    readonly onMouseDown: (e: React.MouseEvent) => void;
    readonly style: React.CSSProperties;
    readonly className: string;
  };
}

function readStored(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
  } catch {
    // localStorage unavailable
  }
  return fallback;
}

export function useVerticalResizable({
  initialHeight,
  minHeight,
  maxHeight,
  storageKey = "novelfork-panel-bottom",
}: UseVerticalResizableOptions): UseVerticalResizableResult {
  const [height, setHeight] = useState(() => {
    const stored = readStored(storageKey, initialHeight);
    return Math.max(minHeight, Math.min(maxHeight, stored));
  });
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      // Dragging up increases height
      const delta = startYRef.current - e.clientY;
      const next = Math.max(minHeight, Math.min(maxHeight, startHeightRef.current + delta));
      setHeight(next);
    },
    [minHeight, maxHeight],
  );

  const onMouseUp = useCallback(() => {
    setIsDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    if (!isDragging) {
      try {
        localStorage.setItem(storageKey, String(Math.round(height)));
      } catch {
        // ignore
      }
    }
  }, [isDragging, height, storageKey]);

  useEffect(() => {
    if (!isDragging) return;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging, onMouseMove, onMouseUp]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startYRef.current = e.clientY;
      startHeightRef.current = height;
      setIsDragging(true);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [height],
  );

  const handleProps = {
    onMouseDown,
    style: { cursor: "row-resize" as const },
    className: "h-1 shrink-0 hover:bg-primary/20 transition-colors",
  };

  return { height, isDragging, handleProps };
}
