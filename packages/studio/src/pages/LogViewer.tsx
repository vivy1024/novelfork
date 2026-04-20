import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { useApi } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

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
    <PageScaffold
      title={t("logs.title")}
      description={t("logs.showingRecent")}
      actions={
        <Button variant="outline" onClick={() => refetch()}>
          {t("common.refresh")}
        </Button>
      }
    >
      <div className={`overflow-hidden rounded-lg border ${c.cardStatic}`}>
        <div className="max-h-[600px] overflow-y-auto p-4">
          {data?.entries && data.entries.length > 0 ? (
            <div className="space-y-1 font-mono text-sm leading-relaxed">
              {data.entries.map((entry, index) => (
                <div key={index} className="flex gap-2">
                  {entry.timestamp && (
                    <span className="w-20 shrink-0 tabular-nums text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                  {entry.level && (
                    <span
                      className={`w-12 shrink-0 uppercase ${LEVEL_COLORS[entry.level] ?? "text-muted-foreground"}`}
                    >
                      {entry.level}
                    </span>
                  )}
                  {entry.tag && <span className="shrink-0 text-primary/70">[{entry.tag}]</span>}
                  <span className="text-foreground/80">{entry.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <PageEmptyState
              title={t("logs.empty")}
              description="当前还没有可显示的 Studio 日志，等守护进程或页面动作产生日志后会在这里滚动展示。"
            />
          )}
        </div>
      </div>
    </PageScaffold>
  );
}
