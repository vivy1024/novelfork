/**
 * OutlinePanel — Collapsible right sidebar showing intelligent outline
 * with AI-powered generation, consistency checking, and suggestion.
 */

import { useState, useEffect, useCallback } from "react";
import { X, Sparkles, ShieldCheck, Lightbulb, ChevronDown, ChevronRight, BookOpen } from "lucide-react";
import { fetchJson } from "../hooks/use-api";

interface OutlineNode {
  readonly chapter: number;
  readonly title: string;
  readonly summary: string;
  readonly status: "done" | "current" | "planned";
  readonly pov?: string;
  readonly notes?: string;
}

interface OutlineResponse {
  readonly nodes: ReadonlyArray<OutlineNode>;
  readonly message?: string;
}

interface OutlinePanelProps {
  readonly bookId: string;
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onNavigateToChapter?: (num: number) => void;
}

const STATUS_CONFIG: Record<string, { label: string; dotColor: string; bgColor: string; textColor: string }> = {
  done: { label: "已完成", dotColor: "bg-emerald-500", bgColor: "bg-emerald-500/10", textColor: "text-emerald-600" },
  current: { label: "进行中", dotColor: "bg-amber-500", bgColor: "bg-amber-500/10", textColor: "text-amber-600" },
  planned: { label: "计划中", dotColor: "bg-muted-foreground/40", bgColor: "bg-secondary", textColor: "text-muted-foreground" },
};

function ActionButton({ onClick, loading, icon, label }: {
  readonly onClick: () => void;
  readonly loading: boolean;
  readonly icon: React.ReactNode;
  readonly label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold bg-secondary text-muted-foreground rounded-lg hover:text-primary hover:bg-primary/10 transition-all border border-border/50 disabled:opacity-50"
    >
      {loading ? <div className="w-3 h-3 border-2 border-primary/20 border-t-primary rounded-full animate-spin" /> : icon}
      {label}
    </button>
  );
}

function OutlineNodeItem({ node, expanded, onToggle, onNavigate }: {
  readonly node: OutlineNode;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onNavigate?: () => void;
}) {
  const config = STATUS_CONFIG[node.status] ?? STATUS_CONFIG.planned;

  return (
    <div className="border-b border-border/30">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/30 transition-colors"
      >
        {/* Timeline dot */}
        <div className="flex flex-col items-center shrink-0">
          <div className={`w-2.5 h-2.5 rounded-full ${config.dotColor}`} />
        </div>

        {/* Chapter number */}
        <span className="text-xs font-mono font-bold text-muted-foreground shrink-0 w-6 text-right">
          {node.chapter}
        </span>

        {/* Expand chevron */}
        {expanded
          ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
          : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />}

        {/* Title */}
        <span className="text-xs text-foreground font-medium truncate flex-1">
          {node.title}
        </span>

        {/* Status badge */}
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${config.bgColor} ${config.textColor}`}>
          {config.label}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-3 pl-[4.5rem] space-y-2">
          {node.summary && (
            <p className="text-[11px] text-muted-foreground leading-relaxed bg-secondary/30 rounded-lg p-3">
              {node.summary}
            </p>
          )}
          {node.pov && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-muted-foreground/60">POV:</span>
              <span className="text-[10px] font-medium text-primary">{node.pov}</span>
            </div>
          )}
          {node.notes && (
            <p className="text-[10px] text-amber-600/80 bg-amber-500/5 rounded-lg p-2 border border-amber-500/10">
              {node.notes}
            </p>
          )}
          {onNavigate && (node.status === "done" || node.status === "current") && (
            <button
              onClick={onNavigate}
              className="text-[10px] font-bold text-primary hover:underline"
            >
              跳转到章节
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function OutlinePanel({ bookId, visible, onClose, onNavigateToChapter }: OutlinePanelProps) {
  const [nodes, setNodes] = useState<ReadonlyArray<OutlineNode>>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [expandedChapters, setExpandedChapters] = useState<ReadonlySet<number>>(new Set());

  const runAction = useCallback(async (action: "generate" | "check" | "suggest") => {
    setActionLoading(action);
    setError(null);
    setMessage(null);
    try {
      const data = await fetchJson<OutlineResponse>("/api/ai/outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, action }),
      });
      setNodes(data.nodes);
      if (data.message) {
        setMessage(data.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  }, [bookId]);

  // Load outline on first open
  const fetchOutline = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<OutlineResponse>("/api/ai/outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, action: "generate" }),
      });
      setNodes(data.nodes);
      if (data.message) {
        setMessage(data.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    if (visible && nodes.length === 0 && !loading) {
      fetchOutline();
    }
  }, [visible, nodes.length, loading, fetchOutline]);

  const toggleExpanded = (chapter: number) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chapter)) {
        next.delete(chapter);
      } else {
        next.add(chapter);
      }
      return next;
    });
  };

  if (!visible) return null;

  const isAnyLoading = loading || actionLoading !== null;

  return (
    <div className="fixed top-0 right-0 z-50 h-full w-[360px] flex flex-col border-l border-border bg-background shadow-2xl animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <h2 className="text-sm font-bold text-foreground">智能大纲</h2>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
        >
          <X size={16} />
        </button>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
        <ActionButton
          onClick={() => runAction("generate")}
          loading={actionLoading === "generate"}
          icon={<Sparkles size={12} />}
          label="生成大纲"
        />
        <ActionButton
          onClick={() => runAction("check")}
          loading={actionLoading === "check"}
          icon={<ShieldCheck size={12} />}
          label="一致性检查"
        />
        <ActionButton
          onClick={() => runAction("suggest")}
          loading={actionLoading === "suggest"}
          icon={<Lightbulb size={12} />}
          label="建议下章"
        />
      </div>

      {/* Message banner */}
      {message && (
        <div className="mx-4 mt-3 p-2.5 rounded-lg bg-primary/5 border border-primary/20 text-[11px] text-primary leading-relaxed">
          {message}
        </div>
      )}

      {/* Node List */}
      <div className="flex-1 overflow-y-auto">
        {isAnyLoading && (
          <div className="flex flex-col items-center justify-center py-16 space-y-3">
            <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            <span className="text-xs text-muted-foreground">
              {actionLoading === "check" ? "检查一致性..." : actionLoading === "suggest" ? "生成建议..." : "加载大纲..."}
            </span>
          </div>
        )}

        {error && (
          <div className="m-4 p-3 rounded-xl bg-destructive/5 border border-destructive/20 text-xs text-destructive">
            {error}
          </div>
        )}

        {!isAnyLoading && !error && nodes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <BookOpen size={24} className="mb-2 opacity-40" />
            <span className="text-xs">点击"生成大纲"开始</span>
          </div>
        )}

        {!isAnyLoading &&
          nodes.map((node) => (
            <OutlineNodeItem
              key={node.chapter}
              node={node}
              expanded={expandedChapters.has(node.chapter)}
              onToggle={() => toggleExpanded(node.chapter)}
              onNavigate={
                onNavigateToChapter && (node.status === "done" || node.status === "current")
                  ? () => onNavigateToChapter(node.chapter)
                  : undefined
              }
            />
          ))}
      </div>
    </div>
  );
}
