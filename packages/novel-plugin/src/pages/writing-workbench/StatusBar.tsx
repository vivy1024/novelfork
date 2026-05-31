/**
 * StatusBar — 底部状态条
 *
 * 固定 36px 高度，显示关键指标，每个区段可点击展开对应面板。
 */
import { useState, useEffect, useCallback } from "react";
import { BookOpen, Activity, Droplets, AlertTriangle, Cog } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PanelType } from "./ExpandablePanel";

export interface StatusBarProps {
  bookId: string;
  activePanel: PanelType;
  onPanelClick: (panel: NonNullable<PanelType>) => void;
  onSettingsClick?: () => void;
}

interface StatusSegment {
  id: string;
  panel: NonNullable<PanelType>;
  icon: React.ReactNode;
  label: string;
}

interface HealthData {
  chapterCount: number;
  totalChapters: number;
  aiTasteAvg: number | null;
  alertCount: number;
}

export function StatusBar({ bookId, activePanel, onPanelClick, onSettingsClick }: StatusBarProps) {
  const [health, setHealth] = useState<HealthData | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchHealth() {
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/health`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            // Count alerts from chapters with audit warnings
            const chapters = Array.isArray(data.health?.chapters) ? data.health.chapters : [];
            const warnings = Array.isArray(data.health?.warnings) ? data.health.warnings : [];
            const auditFails = chapters.filter((c: { auditStatus?: string }) => c.auditStatus === "warn").length;
            const alertCount = auditFails + warnings.length;

            setHealth({
              chapterCount: typeof data.chapterCount === "number" ? data.chapterCount
                : typeof data.health?.totalChapters?.value === "number" ? data.health.totalChapters.value : 0,
              totalChapters: typeof data.totalChapters === "number" ? data.totalChapters : 0,
              aiTasteAvg: typeof data.aiTasteAvg === "number" ? data.aiTasteAvg
                : typeof data.health?.aiTasteMean?.value === "number" ? data.health.aiTasteMean.value : null,
              alertCount,
            });
          }
        }
      } catch { /* keep placeholder */ }
    }
    void fetchHealth();
    return () => { cancelled = true; };
  }, [bookId]);

  const handleSegmentClick = useCallback((seg: StatusSegment) => {
    onPanelClick(seg.panel);
  }, [onPanelClick]);

  const chapterLabel = health ? `${health.chapterCount} 章` : "— 章";
  const qualityLabel = "质量 —";
  const aiTasteLabel = health?.aiTasteAvg != null ? `AI味 ${health.aiTasteAvg.toFixed(0)}%` : "AI味 —";
  const alertLabel = health ? `⚠ ${health.alertCount ?? 0}` : "⚠ 0";

  const segments: StatusSegment[] = [
    { id: "quality", panel: "quality", icon: <Activity className="size-3.5" />, label: qualityLabel },
    { id: "ai-taste", panel: "quality", icon: <Droplets className="size-3.5" />, label: aiTasteLabel },
    { id: "alert", panel: "alert", icon: <AlertTriangle className="size-3.5" />, label: alertLabel },
  ];

  return (
    <div className="flex h-9 shrink-0 items-center border-t border-border bg-muted/30 px-3 text-xs text-muted-foreground">
      {/* 章数：纯展示，不可点击 */}
      <span className="flex items-center gap-1.5 px-3 py-1">
        <BookOpen className="size-3.5" />
        <span>{chapterLabel}</span>
      </span>

      {segments.map((seg) => (
        <button
          key={seg.id}
          onClick={() => handleSegmentClick(seg)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors hover:bg-muted hover:text-foreground",
            activePanel === seg.panel && "bg-muted text-foreground font-medium"
          )}
        >
          {seg.icon}
          <span>{seg.label}</span>
        </button>
      ))}

      {/* 设置按钮 — 右侧固定 */}
      <div className="ml-auto">
        <button
          onClick={onSettingsClick}
          className="flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors hover:bg-muted hover:text-foreground"
          title="书籍设置"
        >
          <Cog className="size-3.5" />
          <span>设置</span>
        </button>
      </div>
    </div>
  );
}
