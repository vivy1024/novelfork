import { useState, useEffect } from "react";
import { useApi, fetchJson } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { ChevronLeft, GitCompare, Plus, Minus } from "lucide-react";

interface Version {
  readonly version: number;
  readonly timestamp: string;
  readonly wordCount: number;
}

interface Hunk {
  readonly type: "add" | "remove" | "context";
  readonly lines: ReadonlyArray<string>;
}

interface DiffResponse {
  readonly hunks: ReadonlyArray<Hunk>;
}

interface Nav {
  toChapter: (bookId: string, chapterNumber: number) => void;
  toBook: (id: string) => void;
  toDashboard: () => void;
}

export function DiffView({ bookId, chapterNumber, nav, theme, t }: {
  bookId: string;
  chapterNumber: number;
  nav: Nav;
  theme: Theme;
  t: TFunction;
}) {
  const c = useColors(theme);
  const { data: versions, loading, error } = useApi<ReadonlyArray<Version>>(
    `/books/${bookId}/chapters/${chapterNumber}/versions`,
  );

  const [fromVersion, setFromVersion] = useState<number | null>(null);
  const [toVersion, setToVersion] = useState<number | null>(null);
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Set default versions when data loads
  useEffect(() => {
    if (!versions || versions.length < 2) return;
    const sorted = [...versions].sort((a, b) => a.version - b.version);
    setFromVersion(sorted[sorted.length - 2].version);
    setToVersion(sorted[sorted.length - 1].version);
  }, [versions]);

  // Fetch diff when both versions are selected
  useEffect(() => {
    if (fromVersion === null || toVersion === null) return;
    let cancelled = false;
    setDiffLoading(true);
    setDiffError(null);
    fetchJson<DiffResponse>(
      `/books/${bookId}/chapters/${chapterNumber}/diff?from=${fromVersion}&to=${toVersion}`,
    )
      .then((data) => { if (!cancelled) setDiff(data); })
      .catch((e) => { if (!cancelled) setDiffError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setDiffLoading(false); });
    return () => { cancelled = true; };
  }, [bookId, chapterNumber, fromVersion, toVersion]);

  // Compute word count change
  const fromWc = versions?.find((v) => v.version === fromVersion)?.wordCount ?? 0;
  const toWc = versions?.find((v) => v.version === toVersion)?.wordCount ?? 0;
  const wcDelta = toWc - fromWc;

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 space-y-4">
      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      <span className="text-sm text-muted-foreground">{t("common.loading")}</span>
    </div>
  );

  if (error) return (
    <div className="text-destructive p-8 bg-destructive/5 rounded-xl border border-destructive/20">
      {t("common.error")}: {error}
    </div>
  );

  if (!versions || versions.length === 0) return (
    <div className="space-y-6">
      <button
        onClick={() => nav.toChapter(bookId, chapterNumber)}
        className="flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-primary transition-all"
      >
        <ChevronLeft size={16} />
        {t("reader.backToList")}
      </button>
      <div className="text-center py-24 text-muted-foreground">{t("diff.noVersions")}</div>
    </div>
  );

  const sorted = [...versions].sort((a, b) => a.version - b.version);

  return (
    <div className="max-w-4xl mx-auto space-y-8 fade-in">
      {/* Breadcrumb & back */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <nav className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
          <button onClick={nav.toDashboard} className="hover:text-primary transition-colors">
            {t("bread.books")}
          </button>
          <span className="text-border">/</span>
          <button onClick={() => nav.toBook(bookId)} className="hover:text-primary transition-colors truncate max-w-[120px]">
            {bookId}
          </button>
          <span className="text-border">/</span>
          <button onClick={() => nav.toChapter(bookId, chapterNumber)} className="hover:text-primary transition-colors">
            {t("bread.chapter").replace("{n}", String(chapterNumber))}
          </button>
          <span className="text-border">/</span>
          <span className="text-foreground">{t("diff.title")}</span>
        </nav>

        <button
          onClick={() => nav.toChapter(bookId, chapterNumber)}
          className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-foreground hover:bg-secondary/80 transition-all border border-border/50"
        >
          <ChevronLeft size={14} />
          {t("reader.backToList")}
        </button>
      </div>

      {/* Title */}
      <div className="flex items-center gap-3">
        <GitCompare size={22} className="text-primary" />
        <h1 className="text-2xl font-serif font-medium text-foreground">
          {t("diff.title")} — {t("bread.chapter").replace("{n}", String(chapterNumber))}
        </h1>
      </div>

      {/* Version selectors & word count summary */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("diff.from")}
          <select
            value={fromVersion ?? ""}
            onChange={(e) => setFromVersion(Number(e.target.value))}
            className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
          >
            {sorted.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version} — {new Date(v.timestamp).toLocaleString()} ({v.wordCount.toLocaleString()} {t("book.words")})
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("diff.to")}
          <select
            value={toVersion ?? ""}
            onChange={(e) => setToVersion(Number(e.target.value))}
            className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
          >
            {sorted.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version} — {new Date(v.timestamp).toLocaleString()} ({v.wordCount.toLocaleString()} {t("book.words")})
              </option>
            ))}
          </select>
        </label>

        {fromVersion !== null && toVersion !== null && (
          <div className="flex items-center gap-3 ml-auto text-sm">
            <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
              <Plus size={14} />
              {t("diff.additions")}: {toWc > fromWc ? `+${wcDelta.toLocaleString()}` : "0"}
            </span>
            <span className="flex items-center gap-1 text-red-700 dark:text-red-300">
              <Minus size={14} />
              {t("diff.deletions")}: {toWc < fromWc ? wcDelta.toLocaleString() : "0"}
            </span>
          </div>
        )}
      </div>

      {/* Diff content */}
      {diffLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {diffError && (
        <div className="text-destructive p-6 bg-destructive/5 rounded-xl border border-destructive/20 text-sm">
          {t("common.error")}: {diffError}
        </div>
      )}

      {diff && !diffLoading && (
        <div className="rounded-2xl border border-border overflow-hidden font-mono text-sm">
          {diff.hunks.map((hunk, hi) => (
            <div key={hi}>
              {hunk.lines.map((line, li) => {
                const base =
                  hunk.type === "add"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : hunk.type === "remove"
                      ? "bg-red-500/10 text-red-700 dark:text-red-300"
                      : "text-foreground";
                const prefix =
                  hunk.type === "add" ? "+" : hunk.type === "remove" ? "-" : " ";
                return (
                  <div key={`${hi}-${li}`} className={`px-4 py-0.5 whitespace-pre-wrap ${base}`}>
                    <span className="select-none opacity-50 mr-3">{prefix}</span>
                    {line}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
