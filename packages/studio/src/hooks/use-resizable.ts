import { useState, useEffect, useCallback, useRef } from "react";

interface UseResizableOptions {
  readonly initialWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly side: "left" | "right";
}

interface UseResizableResult {
  readonly width: number;
  readonly isDragging: boolean;
  readonly handleProps: {
    readonly onMouseDown: (e: React.MouseEvent) => void;
    readonly style: React.CSSProperties;
    readonly className: string;
  };
}

function storageKey(side: string): string {
  return `novelfork-panel-${side}`;
}

function readStored(side: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(storageKey(side));
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
  } catch {
    // localStorage unavailable
  }
  return fallback;
}

export function useResizable({
  initialWidth,
  minWidth,
  maxWidth,
  side,
}: UseResizableOptions): UseResizableResult {
  const [width, setWidth] = useState(() => {
    const stored = readStored(side, initialWidth);
    return Math.max(minWidth, Math.min(maxWidth, stored));
  });
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      const delta = side === "left"
        ? e.clientX - startXRef.current
        : startXRef.current - e.clientX;
      const next = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + delta));
      setWidth(next);
    },
    [side, minWidth, maxWidth],
  );

  const onMouseUp = useCallback(() => {
    setIsDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  // Persist to localStorage when drag ends
  useEffect(() => {
    if (!isDragging) {
      try {
        localStorage.setItem(storageKey(side), String(Math.round(width)));
      } catch {
        // ignore
      }
    }
  }, [isDragging, width, side]);

  // Attach / detach global listeners
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
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      setIsDragging(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width],
  );

  const handleProps = {
    onMouseDown,
    style: { cursor: "col-resize" as const },
    className: "w-1 shrink-0 hover:bg-primary/20 transition-colors",
  };

  return { width, isDragging, handleProps };
}
