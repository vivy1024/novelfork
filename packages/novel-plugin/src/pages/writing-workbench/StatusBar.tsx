/**
 * StatusBar — 底部状态条
 *
 * 固定 36px 高度。
 * 左侧：光标位置 · 章节字数
 * 右侧：保存状态 · 章数 · 警告数 · 设置齿轮
 */
import { useMemo } from "react";
import { BookOpen, AlertTriangle, Cog } from "lucide-react";
import { useApi } from "@/hooks/use-api";

export interface StatusBarProps {
  bookId: string;
  cursorLine?: number;
  cursorColumn?: number;
  wordCount?: number;
  saveStatus?: "saved" | "saving" | "dirty";
  onSettingsClick?: () => void;
}

/** 保存状态指示器 */
function SaveIndicator({ status }: { status: "saved" | "saving" | "dirty" }) {
  const colorMap = {
    saved: "bg-green-500",
    saving: "bg-yellow-400 animate-spin",
    dirty: "bg-orange-400",
  } as const;

  const labelMap = {
    saved: "已保存",
    saving: "保存中…",
    dirty: "未保存",
  } as const;

  return (
    <span className="flex items-center gap-1.5" title={labelMap[status]}>
      {status === "saving" ? (
        // 旋转圆环
        <span className="inline-block size-2 border border-yellow-400 border-t-transparent rounded-full animate-spin" />
      ) : (
        <span className={`inline-block size-2 rounded-full ${colorMap[status]}`} />
      )}
      <span>{labelMap[status]}</span>
    </span>
  );
}

export function StatusBar({
  bookId,
  cursorLine,
  cursorColumn,
  wordCount,
  saveStatus,
  onSettingsClick,
}: StatusBarProps) {
  const { data } = useApi<Record<string, unknown>>(`/api/books/${encodeURIComponent(bookId)}/health`);

  const health = useMemo(() => {
    if (!data) return null;
    const healthObj = (data.health ?? {}) as {
      chapters?: Array<{ auditStatus?: string }>;
      warnings?: unknown[];
      totalChapters?: { value?: number };
    };
    const chapters = Array.isArray(healthObj.chapters) ? healthObj.chapters : [];
    const warnings = Array.isArray(healthObj.warnings) ? healthObj.warnings : [];
    const auditFails = chapters.filter((c) => c.auditStatus === "warn").length;

    return {
      chapterCount:
        typeof data.chapterCount === "number"
          ? data.chapterCount
          : typeof healthObj.totalChapters?.value === "number"
            ? healthObj.totalChapters.value
            : 0,
      alertCount: auditFails + warnings.length,
    };
  }, [data]);

  const chapterLabel = health ? `${health.chapterCount} 章` : "— 章";
  const alertLabel = health?.alertCount ? `⚠ ${health.alertCount}` : "";
  const cursorLabel =
    cursorLine != null && cursorColumn != null ? `${cursorLine}:${cursorColumn}` : null;

  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-t border-border bg-muted/30 px-3 text-[11px] text-muted-foreground">
      {/* ── 左侧 ── */}
      <div className="flex items-center gap-3">
        {cursorLabel && <span>行:列 {cursorLabel}</span>}
        {wordCount != null && <span>{wordCount.toLocaleString()} 字</span>}
      </div>

      {/* ── 右侧 ── */}
      <div className="flex items-center gap-3">
        {saveStatus && <SaveIndicator status={saveStatus} />}

        <span className="flex items-center gap-1.5">
          <BookOpen className="size-3.5" />
          <span>{chapterLabel}</span>
        </span>

        {alertLabel && (
          <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3.5" />
            <span>{alertLabel}</span>
          </span>
        )}

        {onSettingsClick && (
          <button
            onClick={onSettingsClick}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-muted hover:text-foreground"
            title="书籍设置"
          >
            <Cog className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
