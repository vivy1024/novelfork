/**
 * StatusBar — 底部状态条
 *
 * 固定 36px 高度，显示关键指标，每个区段可点击展开对应面板。
 */
import { useState, useEffect } from "react";
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

interface HealthData {
  chapterCount: number;
  totalChapters: number;
  aiTasteAvg: number | null;
}

function useBeatProgress(bookId: string): string {
  const [label, setLabel] = useState("节拍 —");
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`novelfork-beat-${bookId}`);
      if (raw) {
        const data = JSON.parse(raw);
        const done = typeof data.done === "number" ? data.done : 0;
        const total = typeof data.total === "number" ? data.total : 0;
        if (total > 0) {
          setLabel(`节拍 ${done}/${total}`);
          return;
        }
      }
    } catch { /* ignore */ }
    setLabel("节拍 —");
  }, [bookId]);
  return label;
}

export function StatusBar({ bookId, activePanel, onPanelClick }: StatusBarProps) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const beatLabel = useBeatProgress(bookId);

  useEffect(() => {
    let cancelled = false;
    async function fetchHealth() {
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/health`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setHealth({
              chapterCount: typeof data.chapterCount === "number" ? data.chapterCount : 0,
              totalChapters: typeof data.totalChapters === "number" ? data.totalChapters : 200,
              aiTasteAvg: typeof data.aiTasteAvg === "number" ? data.aiTasteAvg : null,
            });
          }
        }
      } catch { /* keep placeholder */ }
    }
    void fetchHealth();
    return () => { cancelled = true; };
  }, [bookId]);

  const chapterLabel = health ? `${health.chapterCount} 章` : "— 章";
  const qualityLabel = "质量 —";
  const aiTasteLabel = health?.aiTasteAvg != null ? `AI味 ${health.aiTasteAvg.toFixed(0)}%` : "AI味 —";

  const segments: StatusSegment[] = [
    { panel: "quality", icon: <BookOpen className="size-3.5" />, label: chapterLabel },
    { panel: "beat", icon: <Music className="size-3.5" />, label: beatLabel },
    { panel: "quality", icon: <Activity className="size-3.5" />, label: qualityLabel },
    { panel: "quality", icon: <Droplets className="size-3.5" />, label: aiTasteLabel },
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
