/**
 * StatusBar — 底部状态条（精简版）
 *
 * 固定 36px 高度，仅展示：章数 + 警告数 + 设置齿轮。
 * AI味检测等功能在左侧资源树"工具"分区。
 */
import { useState, useEffect } from "react";
import { BookOpen, AlertTriangle, Cog } from "lucide-react";

export interface StatusBarProps {
  bookId: string;
  onSettingsClick?: () => void;
}

interface HealthData {
  chapterCount: number;
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

            setHealth({
              chapterCount: typeof data.chapterCount === "number" ? data.chapterCount
                : typeof data.health?.totalChapters?.value === "number" ? data.health.totalChapters.value : 0,
              alertCount: auditFails + warnings.length,
            });
          }
        }
      } catch { /* keep placeholder */ }
    }
    void fetchHealth();
    return () => { cancelled = true; };
  }, [bookId]);

  const chapterLabel = health ? `${health.chapterCount} 章` : "— 章";
  const alertLabel = health?.alertCount ? `⚠ ${health.alertCount}` : "";

  return (
    <div className="flex h-9 shrink-0 items-center border-t border-border bg-muted/30 px-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5 px-3 py-1">
        <BookOpen className="size-3.5" />
        <span>{chapterLabel}</span>
      </span>

      {alertLabel && (
        <span className="flex items-center gap-1.5 px-3 py-1 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-3.5" />
          <span>{alertLabel}</span>
        </span>
      )}

      <div className="ml-auto">
        <button
          onClick={onSettingsClick}
          className="flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors hover:bg-muted hover:text-foreground"
          title="书籍设置"
        >
          <Cog className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
