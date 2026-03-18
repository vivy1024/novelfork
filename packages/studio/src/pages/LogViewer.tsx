import { useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface LogEntry {
  readonly level?: string;
  readonly tag?: string;
  readonly message: string;
  readonly timestamp?: string;
}

interface Nav {
  toDashboard: () => void;
}

const LEVEL_COLORS: Record<string, string> = {
  error: "text-destructive",
  warn: "text-amber-500",
  info: "text-primary/70",
  debug: "text-muted-foreground/50",
};

export function LogViewer({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, refetch } = useApi<{ entries: ReadonlyArray<LogEntry> }>("/logs");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span className="text-foreground">Logs</span>
      </div>

      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl">Logs</h1>
        <button
          onClick={() => refetch()}
          className={`px-3 py-2 text-xs rounded-md ${c.btnSecondary}`}
        >
          Refresh
        </button>
      </div>

      <div className={`border ${c.cardStatic} rounded-lg overflow-hidden`}>
        <div className="p-4 max-h-[600px] overflow-y-auto">
          {data?.entries && data.entries.length > 0 ? (
            <div className="space-y-0.5 font-mono text-[12px] leading-relaxed">
              {data.entries.map((entry, i) => (
                <div key={i} className="flex gap-2">
                  {entry.timestamp && (
                    <span className="text-muted-foreground/40 shrink-0 w-20 tabular-nums">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                  {entry.level && (
                    <span className={`shrink-0 w-12 uppercase ${LEVEL_COLORS[entry.level] ?? "text-muted-foreground"}`}>
                      {entry.level}
                    </span>
                  )}
                  {entry.tag && (
                    <span className="text-primary/40 shrink-0">[{entry.tag}]</span>
                  )}
                  <span className="text-foreground/80">{entry.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground/40 text-sm italic py-12 text-center">
              No log entries. Logs appear after running write/draft/daemon operations.
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground/50">
        Showing last 100 entries from <code className="font-mono bg-muted/50 px-1 rounded">inkos.log</code>
      </p>
    </div>
  );
}
