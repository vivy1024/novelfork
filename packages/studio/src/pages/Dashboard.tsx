import { useApi, postApi } from "../hooks/use-api";
import { useEffect, useMemo } from "react";
import type { SSEMessage } from "../hooks/use-sse";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { deriveActiveBookIds, shouldRefetchBookCollections } from "../hooks/use-book-activity";

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
  readonly language?: string;
  readonly fanficMode?: string;
}

interface Nav {
  toBook: (id: string) => void;
  toAnalytics: (id: string) => void;
  toBookCreate: () => void;
}

export function Dashboard({ nav, sse, theme, t }: { nav: Nav; sse: { messages: ReadonlyArray<SSEMessage> }; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");

  const logEvents = sse.messages.filter((m) => m.event === "log").slice(-8);
  const progressEvent = sse.messages.filter((m) => m.event === "llm:progress").slice(-1)[0];
  const activeBookIds = useMemo(() => deriveActiveBookIds(sse.messages), [sse.messages]);

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!shouldRefetchBookCollections(recent)) return;
    void refetch();
  }, [refetch, sse.messages]);

  if (loading) return <div className="text-muted-foreground py-20 text-center text-sm">{t("common.loading")}</div>;
  if (error) return <div className="text-destructive py-20 text-center">{t("common.error")}: {error}</div>;

  /* ── Empty state — vertically centered in the available viewport ── */
  if (!data?.books.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="text-5xl mb-8 opacity-15 select-none">✦</div>
        <h2 className="font-serif text-3xl italic text-foreground/70 mb-3">{t("dash.noBooks")}</h2>
        <p className="text-sm text-muted-foreground mb-10">{t("dash.createFirst")}</p>
        <button
          onClick={nav.toBookCreate}
          className="px-7 py-3 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          {t("nav.newBook")}
        </button>
      </div>
    );
  }

  /* ── Book list ── */
  return (
    <div className="space-y-10">
      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl">{t("dash.title")}</h1>
        <button
          onClick={nav.toBookCreate}
          className="px-4 py-2.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          {t("nav.newBook")}
        </button>
      </div>

      <div className="space-y-3">
        {data.books.map((book) => {
          const isWriting = activeBookIds.has(book.id);
          return (
            <div
              key={book.id}
              className={`group border ${c.card} rounded-lg overflow-hidden`}
            >
              <div className="px-6 py-5 flex items-start justify-between">
                <div className="min-w-0">
                  <button
                    onClick={() => nav.toBook(book.id)}
                    className="font-serif text-lg hover:text-primary transition-colors text-left truncate block"
                  >
                    {book.title}
                  </button>
                  <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                    <span className="uppercase tracking-wider">{book.genre}</span>
                    <span className="text-border">|</span>
                    <span>{book.chaptersWritten} {t("dash.chapters")}</span>
                    <span className="text-border">|</span>
                    <span className={
                      book.status === "active" ? "text-emerald-500" :
                      book.status === "paused" ? "text-amber-500" :
                      "text-muted-foreground"
                    }>
                      {book.status}
                    </span>
                    {book.language === "en" && <span className="text-primary/70">EN</span>}
                    {book.fanficMode && <span className="text-purple-400">{book.fanficMode}</span>}
                  </div>
                </div>

                <div className="flex gap-2 shrink-0 ml-4">
                  <button
                    onClick={() => postApi(`/books/${book.id}/write-next`)}
                    disabled={isWriting}
                    className={`px-4 py-2.5 text-sm rounded-md transition-all ${
                      isWriting
                        ? "bg-primary/20 text-primary cursor-wait"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    }`}
                  >
                    {isWriting ? t("dash.writing") : t("dash.writeNext")}
                  </button>
                  <button
                    onClick={() => nav.toAnalytics(book.id)}
                    className="px-4 py-2.5 text-sm rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                  >
                    {t("dash.stats")}
                  </button>
                </div>
              </div>

              {/* Writing progress bar for active writes */}
              {isWriting && (
                <div className="h-0.5 bg-gradient-to-r from-primary/0 via-primary to-primary/0 animate-pulse" />
              )}
            </div>
          );
        })}
      </div>

      {/* Live writing progress panel */}
      {activeBookIds.size > 0 && logEvents.length > 0 && (
        <div className="border border-primary/30 bg-primary/5 rounded-lg p-6">
          <h3 className="text-sm uppercase tracking-wide text-primary font-medium mb-4">{t("dash.writingProgress")}</h3>
          <div className="space-y-1.5 text-sm font-mono text-muted-foreground">
            {logEvents.map((msg, i) => {
              const d = msg.data as { tag?: string; message?: string };
              return (
                <div key={i} className="leading-relaxed">
                  <span className="text-primary/50">{d.tag}</span>
                  <span className="text-border mx-1.5">›</span>
                  <span>{d.message}</span>
                </div>
              );
            })}
            {progressEvent && (
              <div className="text-primary mt-3 pt-3 border-t border-primary/10">
                streaming {Math.round(((progressEvent.data as { elapsedMs?: number })?.elapsedMs ?? 0) / 1000)}s
                <span className="text-border mx-1.5">·</span>
                {((progressEvent.data as { totalChars?: number })?.totalChars ?? 0).toLocaleString()} chars
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
