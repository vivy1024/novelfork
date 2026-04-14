/**
 * HistoryPanel -- Collapsible right sidebar showing snapshot timeline
 * for chapter version history with restore capabilities.
 * Supports two view modes: flat timeline and branch tree.
 */

import { useState, useEffect, useCallback } from "react";
import { X, BookmarkIcon, Sparkles, CheckIcon, Clock, GitBranch } from "lucide-react";
import { fetchJson, postApi } from "../hooks/use-api";
import { BranchTree } from "./BranchTree";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Snapshot {
  readonly id: number;
  readonly chapterId: number;
  readonly triggerType: "manual" | "before_ai" | "after_ai" | "branch";
  readonly description: string | null;
  readonly createdAt: string;
  readonly parentId: number | null;
}

interface TreeNode {
  readonly id: number;
  readonly parentId: number | null;
  readonly createdAt: number;
  readonly triggerType: string;
  readonly description: string | null;
}

interface HistoryPanelProps {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSnapshotSelect: (snapshotId: number) => void;
}

type ViewMode = "timeline" | "tree";

// ---------------------------------------------------------------------------
// Trigger config
// ---------------------------------------------------------------------------

const TRIGGER_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  manual:    { label: "手动", icon: <BookmarkIcon size={14} />, color: "text-blue-600 bg-blue-500/10" },
  before_ai: { label: "AI前", icon: <Sparkles size={14} />,    color: "text-amber-600 bg-amber-500/10" },
  after_ai:  { label: "AI后", icon: <CheckIcon size={14} />,   color: "text-emerald-600 bg-emerald-500/10" },
  branch:    { label: "分支", icon: <GitBranch size={14} />,   color: "text-purple-600 bg-purple-500/10" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ViewToggle
// ---------------------------------------------------------------------------

interface ViewToggleProps {
  readonly mode: ViewMode;
  readonly onChange: (mode: ViewMode) => void;
  readonly hasBranches: boolean;
}

function ViewToggle({ mode, onChange, hasBranches }: ViewToggleProps) {
  return (
    <div className="flex items-center gap-1 p-0.5 rounded-lg bg-secondary/50">
      <button
        onClick={() => onChange("timeline")}
        className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${
          mode === "timeline"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        时间线
      </button>
      <button
        onClick={() => onChange("tree")}
        className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 ${
          mode === "tree"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        分支树
        {hasBranches && (
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SnapshotItem (timeline mode)
// ---------------------------------------------------------------------------

interface SnapshotItemProps {
  readonly snapshot: Snapshot;
  readonly onSelect: () => void;
  readonly onBranch: () => void;
}

function SnapshotItem({ snapshot, onSelect, onBranch }: SnapshotItemProps) {
  const [hovered, setHovered] = useState(false);
  const config = TRIGGER_CONFIG[snapshot.triggerType] ?? TRIGGER_CONFIG.manual;

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={onSelect}
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

      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onBranch(); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md text-[10px] font-medium bg-purple-600 text-white shadow-lg hover:bg-purple-700 transition-colors whitespace-nowrap z-10"
        >
          创建分支
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main HistoryPanel
// ---------------------------------------------------------------------------

export function HistoryPanel({ bookId, chapterNumber, visible, onClose, onSnapshotSelect }: HistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<ReadonlyArray<Snapshot>>([]);
  const [treeNodes, setTreeNodes] = useState<ReadonlyArray<TreeNode>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [chapterId, setChapterId] = useState<string | null>(null);

  const hasBranches = snapshots.some((s) => s.parentId != null);

  const fetchSnapshots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const chapterData = await fetchJson<{ id: number }>(`/books/${bookId}/chapters/${chapterNumber}`);
      const cid = String(chapterData.id);
      setChapterId(cid);

      const data = await fetchJson<{ snapshots: ReadonlyArray<Snapshot> }>(`/api/snapshots/${cid}`);
      setSnapshots(data.snapshots);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bookId, chapterNumber]);

  const fetchTree = useCallback(async () => {
    if (!chapterId) return;
    try {
      const data = await fetchJson<{ nodes: ReadonlyArray<TreeNode> }>(`/api/snapshots/${chapterId}/tree`);
      setTreeNodes(data.nodes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [chapterId]);

  useEffect(() => {
    if (visible) {
      fetchSnapshots();
    }
  }, [visible, fetchSnapshots]);

  useEffect(() => {
    if (visible && viewMode === "tree" && chapterId) {
      fetchTree();
    }
  }, [visible, viewMode, chapterId, fetchTree]);

  const handleBranch = useCallback(async (snapshotId: number) => {
    if (!chapterId) return;
    const [bId] = chapterId.split(":");
    try {
      // Get the source snapshot content first
      const sourceData = await fetchJson<{ snapshot: { content: string } }>(
        `/api/snapshots/${snapshotId}/content?bookId=${bId}`,
      );
      // Create branch with same content
      await postApi(`/api/snapshots/${snapshotId}/branch?bookId=${bId}`, {
        content: sourceData.snapshot.content,
        description: `从 #${snapshotId} 创建的分支`,
      });
      // Refresh both views
      await fetchSnapshots();
      if (viewMode === "tree") {
        await fetchTree();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [chapterId, fetchSnapshots, fetchTree, viewMode]);

  if (!visible) return null;

  return (
    <div className="fixed top-0 right-0 z-50 h-full w-[360px] flex flex-col border-l border-border bg-background shadow-2xl animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <h2 className="text-sm font-bold text-foreground">历史快照</h2>
        <div className="flex items-center gap-2">
          <ViewToggle mode={viewMode} onChange={setViewMode} hasBranches={hasBranches} />
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
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

        {!loading && !error && snapshots.length > 0 && viewMode === "timeline" && (
          snapshots.map((snapshot) => (
            <SnapshotItem
              key={snapshot.id}
              snapshot={snapshot}
              onSelect={() => onSnapshotSelect(snapshot.id)}
              onBranch={() => handleBranch(snapshot.id)}
            />
          ))
        )}

        {!loading && !error && viewMode === "tree" && (
          <div className="p-2">
            <BranchTree
              nodes={treeNodes}
              onNodeSelect={onSnapshotSelect}
              onBranch={handleBranch}
            />
          </div>
        )}
      </div>
    </div>
  );
}
