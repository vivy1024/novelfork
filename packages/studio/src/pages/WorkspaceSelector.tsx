/**
 * WorkspaceSelector — shown on first Tauri launch when no workspace is set.
 * User picks a local folder to use as their InkOS workspace.
 */

import { useState } from "react";
import { FolderOpen, Plus, ArrowRight } from "lucide-react";
import type { TFunction } from "../hooks/use-i18n";

interface WorkspaceSelectorProps {
  onSelect: (path: string) => void;
  selectWorkspace: () => Promise<string | null>;
  t: TFunction;
}

export function WorkspaceSelector({ onSelect, selectWorkspace, t }: WorkspaceSelectorProps) {
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async () => {
    setSelecting(true);
    setError(null);
    try {
      const path = await selectWorkspace();
      if (path) {
        onSelect(path);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to select folder");
    } finally {
      setSelecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="max-w-md w-full mx-4 space-y-8 text-center">
        <div className="space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <FolderOpen size={32} className="text-primary" />
          </div>
          <h1 className="text-3xl font-serif font-medium text-foreground">
            NovelFork Studio
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("workspace.description")}
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleSelect}
            disabled={selecting}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 text-sm font-bold bg-primary text-primary-foreground rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
          >
            {selecting ? (
              <div className="w-5 h-5 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" />
            ) : (
              <Plus size={18} />
            )}
            {selecting
              ? "选择中..."
              : t("workspace.select")}
          </button>

          <p className="text-xs text-muted-foreground">
            {t("workspace.hint")}
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
