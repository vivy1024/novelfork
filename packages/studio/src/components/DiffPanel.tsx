/**
 * DiffPanel — Floating diff comparison panel for AI text transformations.
 * Shows original vs. modified text with Accept/Reject controls.
 */

import {
  CheckCircle2,
  XCircle,
  Sparkles,
  Eraser,
  Expand,
  ShieldCheck,
} from "lucide-react";

export interface DiffPanelProps {
  originalText: string;
  newText: string;
  mode: string;
  onAccept: () => void;
  onReject: () => void;
  position?: { top: number; left: number };
}

const MODE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  polish: { label: "润色", color: "text-amber-600 bg-amber-500/10", icon: <Sparkles size={14} /> },
  condense: { label: "精简", color: "text-blue-600 bg-blue-500/10", icon: <Eraser size={14} /> },
  expand: { label: "扩写", color: "text-purple-600 bg-purple-500/10", icon: <Expand size={14} /> },
  audit: { label: "审查", color: "text-emerald-600 bg-emerald-500/10", icon: <ShieldCheck size={14} /> },
  restore: { label: "恢复快照", color: "text-blue-600 bg-blue-500/10", icon: <Sparkles size={14} /> },
};

export function DiffPanel({ originalText, newText, mode, onAccept, onReject, position }: DiffPanelProps) {
  const config = MODE_CONFIG[mode] ?? MODE_CONFIG.polish;
  const isAudit = mode === "audit";
  const isRestore = mode === "restore";

  return (
    <div
      className="fixed z-[9999] w-[480px] max-h-[400px] flex flex-col rounded-2xl border border-border bg-background shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200"
      style={position ? { top: position.top, left: position.left } : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${config.color}`}>
            {config.icon}
            {config.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {!isAudit && (
            <button
              onClick={onAccept}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-600 bg-emerald-500/10 rounded-lg hover:bg-emerald-500 hover:text-white transition-all active:scale-95"
            >
              <CheckCircle2 size={14} />
              {isRestore ? "恢复" : "采纳"}
              <kbd className="ml-1 text-[10px] opacity-60">⌘↵</kbd>
            </button>
          )}
          <button
            onClick={onReject}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-muted-foreground bg-secondary rounded-lg hover:bg-destructive/10 hover:text-destructive transition-all active:scale-95"
          >
            <XCircle size={14} />
            {isAudit ? "关闭" : "拒绝"}
            <kbd className="ml-1 text-[10px] opacity-60">Esc</kbd>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isAudit ? (
          /* Audit mode: show findings only */
          <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4">
            <p className="text-xs font-bold text-emerald-600 mb-2">审查结果</p>
            <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">{newText}</pre>
          </div>
        ) : isRestore ? (
          <>
            {/* Restore mode: snapshot (green) vs current (red) */}
            <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 mb-2">快照内容</p>
              <p className="text-sm text-emerald-700 dark:text-emerald-300 leading-relaxed whitespace-pre-wrap">{originalText}</p>
            </div>

            <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-2">当前内容</p>
              <p className="text-sm text-red-700 dark:text-red-300 line-through leading-relaxed whitespace-pre-wrap">{newText}</p>
            </div>
          </>
        ) : (
          <>
            {/* Original text (red) */}
            <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-2">原文</p>
              <p className="text-sm text-red-700 dark:text-red-300 line-through leading-relaxed whitespace-pre-wrap">{originalText}</p>
            </div>

            {/* New text (green) */}
            <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 mb-2">修改</p>
              <p className="text-sm text-emerald-700 dark:text-emerald-300 leading-relaxed whitespace-pre-wrap">{newText}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
