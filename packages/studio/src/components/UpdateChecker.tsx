import { useState, useEffect } from "react";
import { useNovelFork } from "../providers/novelfork-context";
import { useI18n } from "../hooks/use-i18n";
import { STUDIO_CHANGELOG_URL } from "../shared/release-manifest";

type UpdateState =
  | { phase: "checking" }
  | { phase: "available"; version: string; notes: string }
  | { phase: "downloading"; progress: number }
  | { phase: "upToDate" }
  | { phase: "error"; message: string };

export function UpdateChecker() {
  const { mode } = useNovelFork();
  const { t } = useI18n();
  const [state, setState] = useState<UpdateState>({ phase: "checking" });

  useEffect(() => {
    if (mode !== "tauri") return;

    let cancelled = false;

    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod = await import("@tauri-apps/plugin-updater") as any;
        const update = await mod.check();

        if (cancelled) return;

        if (!update) {
          setState({ phase: "upToDate" });
          return;
        }

        setState({
          phase: "available",
          version: update.version,
          notes: update.body ?? "",
        });
      } catch (err) {
        if (!cancelled) {
          setState({
            phase: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [mode]);

  if (mode !== "tauri") return null;
  if (state.phase === "checking" || state.phase === "upToDate" || state.phase === "error") {
    return null;
  }

  const handleUpdate = async () => {
    setState({ phase: "downloading", progress: 0 });
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = await (Function('return import("@tauri-apps/plugin-updater")')() as Promise<any>);
      const update = await mod.check();
      if (!update) return;

      await update.downloadAndInstall((event: any) => {
        if (event.event === "Progress" && event.data.contentLength) {
          const pct = Math.round((event.data.chunkLength / event.data.contentLength) * 100);
          setState((prev) =>
            prev.phase === "downloading"
              ? { phase: "downloading", progress: Math.min(100, prev.progress + pct) }
              : prev,
          );
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const processMod = await import("@tauri-apps/plugin-process") as any;
      await processMod.relaunch();
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const authorNote = state.phase === "available"
    ? state.notes.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "这次更新会优先改善作者工作台体验。"
    : "";

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md rounded-xl border border-border bg-background/95 backdrop-blur-md shadow-lg px-4 py-3 fade-in">
      {state.phase === "available" && (
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {t("update.available").replace("{v}", state.version)}
            </p>
            <p className="text-xs text-muted-foreground">{t("update.channelHint")}</p>
            <p className="text-xs text-muted-foreground">{authorNote}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleUpdate}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
            >
              {t("update.download")}
            </button>
            <a
              href={STUDIO_CHANGELOG_URL}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("update.changelog")}
            </a>
          </div>
        </div>
      )}
      {state.phase === "downloading" && (
        <span className="text-sm text-muted-foreground">
          {t("update.downloading")}
        </span>
      )}
    </div>
  );
}
