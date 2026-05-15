/**
 * ExpandablePanel — 可展开面板容器
 *
 * 从底部向上展开，支持关闭/最大化/拖拽调整高度。面板互斥。
 */
import { useRef, useCallback } from "react";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PresetPanel } from "./panels/PresetPanel";
import { BeatPanel } from "./panels/BeatPanel";
import { QualityPanel } from "./panels/QualityPanel";
import { AlertPanel } from "./panels/AlertPanel";

export type PanelType = "preset" | "beat" | "quality" | "alert" | null;

export interface ExpandablePanelProps {
  activePanel: NonNullable<PanelType>;
  height?: number;
  maximized: boolean;
  bookId: string;
  onClose: () => void;
  onMaximize: () => void;
  onHeightChange: (h: number) => void;
}

const PANEL_TITLES: Record<NonNullable<PanelType>, string> = {
  preset: "⚙ 预设配置",
  beat: "♪ 节拍进度",
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
}: ExpandablePanelProps) {
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

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
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [height, maximized, onHeightChange]
  );

  const panelStyle = maximized ? { flex: 1 } : { height: height ?? 250 };

  return (
    <div
      data-panel-container
      className="flex flex-col border-t border-border bg-background"
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
    case "preset":
      return <PresetPanel bookId={bookId} />;
    case "beat":
      return <BeatPanel bookId={bookId} />;
    case "quality":
      return <QualityPanel bookId={bookId} />;
    case "alert":
      return <AlertPanel bookId={bookId} />;
  }
}
