/**
 * RecoveryBanner — warning banner shown when crash recovery data is detected.
 * Renders at the top of the main content area in Tauri mode only.
 */
import { AlertTriangle } from "lucide-react";
import type { RecoveryEntry } from "../hooks/use-crash-recovery";
import type { TFunction } from "../hooks/use-i18n";

interface RecoveryBannerProps {
  readonly entries: ReadonlyArray<RecoveryEntry>;
  readonly onRecoverAll: () => void;
  readonly onDismiss: () => void;
  readonly t: TFunction;
}

export function RecoveryBanner({ entries, onRecoverAll, onDismiss, t }: RecoveryBannerProps) {
  if (entries.length === 0) return null;

  const affected = [...new Set(entries.map(e => `${e.bookId} Ch.${e.chapterNumber}`))];

  return (
    <div className="mx-6 mt-4 px-4 py-3 rounded-lg border bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 flex items-start gap-3">
      <AlertTriangle size={18} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{t("recovery.found")}</p>
        <p className="text-xs mt-1 opacity-80 truncate">
          {affected.join(", ")}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onRecoverAll}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-amber-500/20 hover:bg-amber-500/30 transition-colors"
        >
          {t("recovery.recoverAll")}
        </button>
        <button
          onClick={onDismiss}
          className="px-3 py-1.5 text-xs font-medium rounded-md hover:bg-amber-500/10 transition-colors"
        >
          {t("recovery.dismiss")}
        </button>
      </div>
    </div>
  );
}
