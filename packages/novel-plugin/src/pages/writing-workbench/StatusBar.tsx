/**
 * StatusBar — 底部状态条（精简版）
 *
 * 固定 36px 高度，仅展示关键指标：章数 + AI味 + 警告数 + 设置齿轮。
 * 面板切换已迁移到左侧资源树"工具"分区。
 */
import { useState, useEffect } from "react";
import { BookOpen, Droplets, AlertTriangle, Cog } from "lucide-react";

export interface StatusBarProps {
  bookId: string;
  onSettingsClick?: () => void;
}

interface HealthData {
  chapterCount: number;
  aiTasteAvg: number | null;
  alertCount: number;
}

export function StatusBar({ bookId, onSettingsClick }: StatusBarProps) {
  const [health, setHealth] = useState<HealthData | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchHealth() {
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/health`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            const chapters = Array.isArray(data.health?.chapters) ? data.health.chapters : [];
            const warnings = Array.isArray(data.health?.warnings) ? data.health.warnings : [];
            const auditFails = chapters.filter((c: { auditStatus?: string }) => c.auditStatus === "warn").length;
            const alertCount = auditFails + warnings.length;

            setHealth({
              chapterCount: typeof data.chapterCount === "number" ? data.chapterCount
                : typeof data.health?.totalChapters?.value === "number" ? data.health.totalChapters.value : 0,
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

  const chapterLabel = health ? `${health.chapterCount} 章` : "— 章";
  const aiTasteLabel = health?.aiTasteAvg != null ? `AI味 ${health.aiTasteAvg.toFixed(0)}%` : "AI味 —";
  const alertLabel = health ? `⚠ ${health.alertCount}` : "⚠ 0";

  return (
    <div className="flex h-9 shrink-0 items-center border-t border-border bg-muted/30 px-3 text-xs text-muted-foreground">
      {/* 章数 */}
      <span className="flex items-center gap-1.5 px-3 py-1">
        <BookOpen className="size-3.5" />
        <span>{chapterLabel}</span>
      </span>

      {/* AI味 */}
      <span className="flex items-center gap-1.5 px-3 py-1">
        <Droplets className="size-3.5" />
        <span>{aiTasteLabel}</span>
      </span>

      {/* 警告数 */}
      <span className="flex items-center gap-1.5 px-3 py-1">
        <AlertTriangle className="size-3.5" />
        <span>{alertLabel}</span>
      </span>

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
