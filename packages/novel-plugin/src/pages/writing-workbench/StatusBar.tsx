/**
 * StatusBar — 底部状态条
 *
 * 固定 36px 高度，显示关键指标，每个区段可点击展开对应面板。
 */
import { BookOpen, Music, Activity, Droplets, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PanelType } from "./ExpandablePanel";

export interface StatusBarProps {
  bookId: string;
  activePanel: PanelType;
  onPanelClick: (panel: NonNullable<PanelType>) => void;
}

interface StatusSegment {
  panel: NonNullable<PanelType>;
  icon: React.ReactNode;
  label: string;
}

export function StatusBar({ bookId, activePanel, onPanelClick }: StatusBarProps) {
  // TODO: 从 API 读取真实数据，当前用占位
  const segments: StatusSegment[] = [
    { panel: "quality", icon: <BookOpen className="size-3.5" />, label: "0/200 章" },
    { panel: "beat", icon: <Music className="size-3.5" />, label: "节拍 —" },
    { panel: "quality", icon: <Activity className="size-3.5" />, label: "质量 —" },
    { panel: "quality", icon: <Droplets className="size-3.5" />, label: "AI味 —" },
    { panel: "alert", icon: <AlertTriangle className="size-3.5" />, label: "⚠ 0" },
  ];

  return (
    <div className="flex h-9 shrink-0 items-center border-t border-border bg-muted/30 px-3 text-xs text-muted-foreground">
      {segments.map((seg, i) => (
        <button
          key={`${seg.panel}-${i}`}
          onClick={() => onPanelClick(seg.panel)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors hover:bg-muted hover:text-foreground",
            activePanel === seg.panel && "bg-muted text-foreground font-medium"
          )}
        >
          {seg.icon}
          <span>{seg.label}</span>
        </button>
      ))}

      {/* 预设快捷入口 */}
      <button
        onClick={() => onPanelClick("preset")}
        className={cn(
          "ml-auto flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors hover:bg-muted hover:text-foreground",
          activePanel === "preset" && "bg-muted text-foreground font-medium"
        )}
      >
        <span>⚙ 预设</span>
      </button>
    </div>
  );
}
