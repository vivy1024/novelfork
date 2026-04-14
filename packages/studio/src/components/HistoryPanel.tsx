/**
 * HistoryPanel — Collapsible right sidebar showing snapshot timeline
 * for chapter version history with restore capabilities.
 */

import { useState, useEffect, useCallback } from "react";
import { X, BookmarkIcon, Sparkles, CheckIcon, Clock } from "lucide-react";
import { fetchJson } from "../hooks/use-api";

interface Snapshot {
  readonly id: number;
  readonly chapterId: number;
  readonly triggerType: "manual" | "before_ai" | "after_ai";
  readonly description: string | null;
  readonly createdAt: string;
}

interface HistoryPanelProps {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSnapshotSelect: (snapshotId: number) => void;
}

const TRIGGER_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  manual: { label: "手动", icon: <BookmarkIcon size={14} />, color: "text-blue-600 bg-blue-500/10" },
  before_ai: { label: "AI前", icon: <Sparkles size={14} />, color: "text-amber-600 bg-amber-500/10" },
  after_ai: { label: "AI后", icon: <CheckIcon size={14} />, color: "text-emerald-600 bg-emerald-500/10" },
};

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "刚刚";
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;

  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function HistoryPanel({ bookId, chapterNumber, visible, onClose, onSnapshotSelect }: HistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<ReadonlyArray<Snapshot>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // First get chapter ID from bookId and chapterNumber
      const chapterData = await fetchJson<{ id: number }>(`/books/${bookId}/chapters/${chapterNumber}`);
      const chapterId = chapterData.id;

      // Then fetch snapshots for this chapter
      const data = await fetchJson<ReadonlyArray<Snapshot>>(`/api/snapshots/${chapterId}`);
      setSnapshots(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bookId, chapterNumber]);

  useEffect(() => {
    if (visible) {
      fetchSnapshots();
    }
  }, [visible, fetchSnapshots]);

  if (!visible) return null;

  return (
    <div className="fixed top-0 right-0 z-50 h-full w-[360px] flex flex-col border-l border-border bg-background shadow-2xl animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <h2 className="text-sm font-bold text-foreground">历史快照</h2>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
        >
          <X size={16} />
        </button>
      </div>

      {/* Snapshot List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 space-y-3">
            <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            <span className="text-xs text-muted-foreground">加载快照...</span>
          </div>
        )}

        {error && (
          <div className="m-4 p-3 rounded-xl bg-destructive/5 border border-destructive/20 text-xs text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && snapshots.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Clock size={24} className="mb-2 opacity-40" />
            <span className="text-xs">暂无历史快照</span>
          </div>
        )}

        {!loading &&
          snapshots.map((snapshot) => {
            const config = TRIGGER_CONFIG[snapshot.triggerType] ?? TRIGGER_CONFIG.manual;

            return (
              <button
                key={snapshot.id}
                onClick={() => onSnapshotSelect(snapshot.id)}
                className="w-full border-b border-border/30 px-4 py-3 hover:bg-secondary/50 transition-colors text-left"
              >
                <div className="flex items-start gap-3">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold shrink-0 ${config.color}`}>
                    {config.icon}
                    {config.label}
                  </span>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground font-medium truncate">
                      {snapshot.description || "未命名快照"}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {formatTimestamp(snapshot.createdAt)}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
      </div>
    </div>
  );
}
