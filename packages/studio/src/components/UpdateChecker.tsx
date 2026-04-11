import { useState, useEffect } from "react";
import { useInkOS } from "../providers/inkos-context";
import { useI18n } from "../hooks/use-i18n";

type UpdateState =
  | { phase: "checking" }
  | { phase: "available"; version: string; notes: string }
  | { phase: "downloading"; progress: number }
  | { phase: "upToDate" }
  | { phase: "error"; message: string };

export function UpdateChecker() {
  const { mode } = useInkOS();
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

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-border bg-background/95 backdrop-blur-md shadow-lg px-4 py-3 flex items-center gap-3 fade-in">
      {state.phase === "available" && (
        <>
          <span className="text-sm text-foreground">
            {t("update.available").replace("{v}", state.version)}
          </span>
          <button
            onClick={handleUpdate}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            {t("update.download")}
          </button>
        </>
      )}
      {state.phase === "downloading" && (
        <span className="text-sm text-muted-foreground">
          {t("update.downloading")}
        </span>
      )}
    </div>
  );
}
