import { useEffect, useState } from "react";
import { ChevronLeft, GitCompare, Loader2, Minus, Plus } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchJson, useApi } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

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

  useEffect(() => {
    if (!versions || versions.length < 2) return;
    const sorted = [...versions].sort((a, b) => a.version - b.version);
    setFromVersion(sorted[sorted.length - 2].version);
    setToVersion(sorted[sorted.length - 1].version);
  }, [versions]);

  useEffect(() => {
    if (fromVersion === null || toVersion === null) return;
    let cancelled = false;
    setDiffLoading(true);
    setDiffError(null);
    fetchJson<DiffResponse>(
      `/books/${bookId}/chapters/${chapterNumber}/diff?from=${fromVersion}&to=${toVersion}`,
    )
      .then((data) => {
        if (!cancelled) setDiff(data);
      })
      .catch((e) => {
        if (!cancelled) setDiffError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, chapterNumber, fromVersion, toVersion]);

  const fromWc = versions?.find((v) => v.version === fromVersion)?.wordCount ?? 0;
  const toWc = versions?.find((v) => v.version === toVersion)?.wordCount ?? 0;
  const wcDelta = toWc - fromWc;

  if (loading) {
    return (
      <PageScaffold
        title={t("diff.title")}
        description={`章节 ${chapterNumber} 的版本对比。`}
        actions={<Button variant="outline" onClick={() => nav.toChapter(bookId, chapterNumber)}>返回章节</Button>}
      >
        <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          {t("common.loading")}
        </div>
      </PageScaffold>
    );
  }

  if (error) {
    return (
      <PageScaffold
        title={t("diff.title")}
        description={`章节 ${chapterNumber} 的版本对比。`}
        actions={<Button variant="outline" onClick={() => nav.toChapter(bookId, chapterNumber)}>返回章节</Button>}
      >
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            {t("common.error")}: {error}
          </CardContent>
        </Card>
      </PageScaffold>
    );
  }

  if (!versions || versions.length === 0) {
    return (
      <PageScaffold
        title={t("diff.title")}
        description={`章节 ${chapterNumber} 的版本对比。`}
        actions={<Button variant="outline" onClick={() => nav.toChapter(bookId, chapterNumber)}>返回章节</Button>}
      >
        <PageEmptyState
          title={t("diff.noVersions")}
          description="当前章节还没有可对比的版本，先保存几次内容后再回来查看。"
          icon={GitCompare}
        />
      </PageScaffold>
    );
  }

  const sorted = [...versions].sort((a, b) => a.version - b.version);

  return (
    <PageScaffold
      title={t("diff.title")}
      description={`章节 ${chapterNumber} · ${versions.length} 个版本可供对比。`}
      actions={
        <>
          <Button variant="outline" onClick={() => nav.toDashboard()}>返回书单</Button>
          <Button variant="outline" onClick={() => nav.toChapter(bookId, chapterNumber)}>
            <ChevronLeft className="mr-2 size-4" />
            返回章节
          </Button>
        </>
      }
    >
      <Card className={c.cardStatic}>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              {t("diff.from")}
              <select
                value={fromVersion ?? ""}
                onChange={(e) => setFromVersion(Number(e.target.value))}
                className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm text-foreground"
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
                className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm text-foreground"
              >
                {sorted.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version} — {new Date(v.timestamp).toLocaleString()} ({v.wordCount.toLocaleString()} {t("book.words")})
                  </option>
                ))}
              </select>
            </label>

            {fromVersion !== null && toVersion !== null && (
              <div className="ml-auto flex items-center gap-3 text-sm">
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
        </CardContent>
      </Card>

      {diffLoading && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          {t("common.loading")}
        </div>
      )}

      {diffError && (
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            {t("common.error")}: {diffError}
          </CardContent>
        </Card>
      )}

      {diff && !diffLoading && (
        <Card className={c.cardStatic}>
          <CardContent className="overflow-hidden p-0 font-mono text-sm">
            {diff.hunks.map((hunk, hi) => (
              <div key={hi}>
                {hunk.lines.map((line, li) => {
                  const base =
                    hunk.type === "add"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : hunk.type === "remove"
                        ? "bg-red-500/10 text-red-700 dark:text-red-300"
                        : "text-foreground";
                  const prefix = hunk.type === "add" ? "+" : hunk.type === "remove" ? "-" : " ";
                  return (
                    <div key={`${hi}-${li}`} className={`whitespace-pre-wrap px-4 py-0.5 ${base}`}>
                      <span className="mr-3 select-none opacity-50">{prefix}</span>
                      {line}
                    </div>
                  );
                })}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </PageScaffold>
  );
}
