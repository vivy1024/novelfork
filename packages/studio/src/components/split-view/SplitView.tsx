import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

export interface SplitViewPanel {
  id: string;
  content: ReactNode;
  defaultWidth: number;
  minWidth: number;
  collapsible?: boolean;
  collapsed?: boolean;
}

export interface PanelLayout {
  widths: Record<string, number>;
  collapsed: Record<string, boolean>;
}

export interface SplitViewHandle {
  toggleCollapse: (panelId: string) => void;
}

export interface SplitViewProps {
  panels: SplitViewPanel[];
  direction?: "horizontal" | "vertical";
  onLayoutChange?: (layout: PanelLayout) => void;
  className?: string;
}

const HANDLE_SIZE = 4;

export const SplitView = forwardRef<SplitViewHandle, SplitViewProps>(
  function SplitView({ panels, direction = "horizontal", onLayoutChange, className }, ref) {
    const isHorizontal = direction === "horizontal";

    // Internal state: widths and collapsed, seeded from panel props
    const [widths, setWidths] = useState<Record<string, number>>(() => {
      const w: Record<string, number> = {};
      for (const p of panels) w[p.id] = p.defaultWidth;
      return w;
    });

    const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
      const c: Record<string, boolean> = {};
      for (const p of panels) c[p.id] = p.collapsed ?? false;
      return c;
    });

    // Notify parent on layout changes
    const onLayoutChangeRef = useRef(onLayoutChange);
    onLayoutChangeRef.current = onLayoutChange;

    useEffect(() => {
      onLayoutChangeRef.current?.({ widths, collapsed });
    }, [widths, collapsed]);

    // Drag state
    const draggingRef = useRef<{
      handleIndex: number;
      startPos: number;
      startLeftWidth: number;
      startRightWidth: number;
    } | null>(null);
    const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

    const panelsRef = useRef(panels);
    panelsRef.current = panels;
    const widthsRef = useRef(widths);
    widthsRef.current = widths;

    const handlePointerDown = useCallback(
      (handleIndex: number, e: React.PointerEvent) => {
        e.preventDefault();
        const leftPanel = panelsRef.current[handleIndex];
        const rightPanel = panelsRef.current[handleIndex + 1];
        if (!leftPanel || !rightPanel) return;

        draggingRef.current = {
          handleIndex,
          startPos: isHorizontal ? e.clientX : e.clientY,
          startLeftWidth: widthsRef.current[leftPanel.id] ?? leftPanel.defaultWidth,
          startRightWidth: widthsRef.current[rightPanel.id] ?? rightPanel.defaultWidth,
        };
        setDraggingIndex(handleIndex);

        const el = e.target as HTMLElement;
        el.setPointerCapture?.(e.pointerId);
      },
      [isHorizontal],
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent) => {
        const drag = draggingRef.current;
        if (!drag) return;

        const currentPos = isHorizontal ? e.clientX : e.clientY;
        const delta = currentPos - drag.startPos;

        const leftPanel = panelsRef.current[drag.handleIndex];
        const rightPanel = panelsRef.current[drag.handleIndex + 1];
        if (!leftPanel || !rightPanel) return;

        let newLeft = drag.startLeftWidth + delta;
        let newRight = drag.startRightWidth - delta;

        // Enforce min widths
        if (newLeft < leftPanel.minWidth) {
          newLeft = leftPanel.minWidth;
          newRight = drag.startLeftWidth + drag.startRightWidth - newLeft;
        }
        if (newRight < rightPanel.minWidth) {
          newRight = rightPanel.minWidth;
          newLeft = drag.startLeftWidth + drag.startRightWidth - newRight;
        }

        setWidths((prev) => ({
          ...prev,
          [leftPanel.id]: newLeft,
          [rightPanel.id]: newRight,
        }));
      },
      [isHorizontal],
    );

    const handlePointerUp = useCallback(() => {
      draggingRef.current = null;
      setDraggingIndex(null);
    }, []);

    const handleDoubleClick = useCallback((handleIndex: number) => {
      const leftPanel = panelsRef.current[handleIndex];
      const rightPanel = panelsRef.current[handleIndex + 1];
      if (!leftPanel || !rightPanel) return;

      setWidths((prev) => ({
        ...prev,
        [leftPanel.id]: leftPanel.defaultWidth,
        [rightPanel.id]: rightPanel.defaultWidth,
      }));
    }, []);

    const toggleCollapse = useCallback((panelId: string) => {
      setCollapsed((prev) => ({ ...prev, [panelId]: !prev[panelId] }));
    }, []);

    useImperativeHandle(ref, () => ({ toggleCollapse }), [toggleCollapse]);

    return (
      <div
        className={cn(
          "flex",
          isHorizontal ? "flex-row" : "flex-col",
          className,
        )}
        data-testid="split-view"
      >
        {panels.map((panel, index) => {
          const isCollapsed = collapsed[panel.id] ?? false;
          const width = widths[panel.id] ?? panel.defaultWidth;

          return (
            <div key={panel.id} className="contents">
              {/* Panel */}
              <div
                data-testid={`split-panel-${panel.id}`}
                data-collapsed={isCollapsed || undefined}
                className="overflow-hidden"
                style={{
                  flexBasis: isCollapsed ? 0 : width,
                  flexShrink: 0,
                  flexGrow: 0,
                  [isHorizontal ? "minWidth" : "minHeight"]: isCollapsed
                    ? 0
                    : panel.minWidth,
                }}
              >
                {!isCollapsed && panel.content}
              </div>

              {/* Resize handle (between panels, not after the last one) */}
              {index < panels.length - 1 && (
                <div
                  data-testid={`split-handle-${index}`}
                  role="separator"
                  aria-orientation={isHorizontal ? "vertical" : "horizontal"}
                  className={cn(
                    "flex-shrink-0 transition-colors",
                    isHorizontal ? "cursor-col-resize" : "cursor-row-resize",
                    draggingIndex === index
                      ? "bg-primary/30"
                      : "bg-transparent hover:bg-border",
                  )}
                  style={{
                    [isHorizontal ? "width" : "height"]: HANDLE_SIZE,
                  }}
                  onPointerDown={(e) => handlePointerDown(index, e)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onDoubleClick={() => handleDoubleClick(index)}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  },
);

// Re-export for convenience
export { usePanelLayout } from "./usePanelLayout";
export type { PanelLayout as PanelLayoutState } from "./usePanelLayout";
