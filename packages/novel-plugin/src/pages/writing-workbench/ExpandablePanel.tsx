/**
 * ExpandablePanel — 可展开面板容器
 *
 * 从底部向上展开，支持关闭/最大化/拖拽调整高度。面板互斥。
 */
import { useRef, useCallback, useEffect } from "react";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QualityPanel } from "./panels/QualityPanel";
import { AlertPanel } from "./panels/AlertPanel";

export type PanelType = "quality" | "alert" | null;

export interface ExpandablePanelProps {
  activePanel: NonNullable<PanelType>;
  height?: number;
  maximized: boolean;
  bookId: string;
  onClose: () => void;
  onMaximize: () => void;
  onHeightChange: (h: number) => void;
  onSwitchPanel?: (panel: NonNullable<PanelType>) => void;
}

const PANEL_TITLES: Record<NonNullable<PanelType>, string> = {
  quality: "📊 质量监控",
  alert: "⚠ 警告",
};

const MIN_HEIGHT = 150;
const MAX_RATIO = 0.5; // 最大占画布 50%

export function ExpandablePanel({
  activePanel,
  height,
  maximized,
  bookId,
  onClose,
  onMaximize,
  onHeightChange,
  onSwitchPanel,
}: ExpandablePanelProps) {
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const listenersRef = useRef<{ move: (ev: MouseEvent) => void; up: () => void } | null>(null);

  // Cleanup drag listeners on unmount
  useEffect(() => {
    return () => {
      if (listenersRef.current) {
        document.removeEventListener("mousemove", listenersRef.current.move);
        document.removeEventListener("mouseup", listenersRef.current.up);
        listenersRef.current = null;
      }
    };
  }, []);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (maximized) return;
      const startY = e.clientY;
      const startH = height ?? 250;
      dragRef.current = { startY, startH };

      const handleMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = dragRef.current.startY - ev.clientY;
        const parentH = (e.target as HTMLElement).closest("[data-panel-container]")?.parentElement?.clientHeight ?? 800;
        const maxH = parentH * MAX_RATIO;
        const newH = Math.max(MIN_HEIGHT, Math.min(maxH, dragRef.current.startH + delta));
        onHeightChange(newH);
      };

      const handleUp = () => {
        dragRef.current = null;
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
        listenersRef.current = null;
      };

      // Store refs for cleanup on unmount
      listenersRef.current = { move: handleMove, up: handleUp };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [height, maximized, onHeightChange]
  );

  const panelStyle = maximized ? { flex: 1 } : { height: height ?? 250 };

  return (
    <div
      data-panel-container
      className="flex flex-col border-t border-border bg-background overflow-hidden"
      style={panelStyle}
    >
      {/* 拖拽条 + 标题栏 */}
      <div
        className="flex h-8 shrink-0 cursor-ns-resize items-center justify-between border-b border-border bg-muted/50 px-3"
        onMouseDown={handleDragStart}
      >
        <span className="text-xs font-medium">{PANEL_TITLES[activePanel]}</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-6" onClick={onMaximize}>
            {maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="size-6" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* 面板内容 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <PanelContent panel={activePanel} bookId={bookId} />
      </div>
    </div>
  );
}

function PanelContent({ panel, bookId }: { panel: NonNullable<PanelType>; bookId: string }) {
  switch (panel) {
    case "quality":
      return <QualityPanel bookId={bookId} />;
    case "alert":
      return <AlertPanel bookId={bookId} />;
  }
}
