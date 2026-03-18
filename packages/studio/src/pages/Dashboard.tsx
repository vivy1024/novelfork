import { useApi, postApi } from "../hooks/use-api";
import { useState, useMemo } from "react";
import type { SSEMessage } from "../hooks/use-sse";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

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
  const [writingBooks, setWritingBooks] = useState<Set<string>>(new Set());

  const recentEvents = sse.messages.filter((m) => m.event !== "ping" && m.event !== "llm:progress");
  const logEvents = sse.messages.filter((m) => m.event === "log").slice(-8);
  const progressEvent = sse.messages.filter((m) => m.event === "llm:progress").slice(-1)[0];

  useMemo(() => {
    for (const msg of sse.messages) {
      const bookId = (msg.data as { bookId?: string })?.bookId;
      if (!bookId) continue;
      if (msg.event === "write:start" || msg.event === "draft:start") {
        setWritingBooks((prev) => new Set([...prev, bookId]));
      }
      if (msg.event === "write:complete" || msg.event === "write:error" ||
          msg.event === "draft:complete" || msg.event === "draft:error") {
        setWritingBooks((prev) => { const next = new Set(prev); next.delete(bookId); return next; });
        refetch();
      }
    }
  }, [sse.messages.length]);

  if (loading) return <div className={c.muted}>Loading...</div>;
  if (error) return <div className="text-red-400">Error: {error}</div>;
  if (!data?.books.length) {
    return (
      <div className={`text-center py-20 ${c.muted}`}>
        <p className="text-xl mb-2">{t("dash.noBooks")}</p>
        <p className="text-sm mb-4">{t("dash.createFirst")}</p>
        <button onClick={nav.toBookCreate} className={`px-4 py-2 rounded-md text-sm ${c.btnPrimary}`}>
          {t("nav.newBook")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("dash.title")}</h1>
        <button onClick={nav.toBookCreate} className={`px-3 py-1.5 text-sm rounded-md ${c.btnPrimary}`}>
          {t("nav.newBook")}
        </button>
      </div>

      <div className="grid gap-4">
        {data.books.map((book) => {
          const isWriting = writingBooks.has(book.id);
          return (
            <div key={book.id} className={`border rounded-lg p-5 transition-colors ${c.card}`}>
              <div className="flex items-start justify-between">
                <div>
                  <button onClick={() => nav.toBook(book.id)} className={`text-lg font-medium ${c.link} transition-colors text-left`}>
                    {book.title}
                  </button>
                  <div className={`flex gap-3 mt-1 text-sm ${c.muted}`}>
                    <span>{book.genre}</span>
                    <span>{book.chaptersWritten} {t("dash.chapters")}</span>
                    <span className={book.status === "active" ? c.active : book.status === "paused" ? c.paused : c.subtle}>
                      {book.status}
                    </span>
                    {book.language === "en" && <span className="text-blue-400">EN</span>}
                    {book.fanficMode && <span className="text-purple-400">fanfic:{book.fanficMode}</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => postApi(`/books/${book.id}/write-next`)}
                    disabled={isWriting}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors disabled:opacity-50 disabled:cursor-wait ${c.btnSecondary}`}
                  >
                    {isWriting ? t("dash.writing") : t("dash.writeNext")}
                  </button>
                  <button onClick={() => nav.toAnalytics(book.id)} className={`px-3 py-1.5 text-sm rounded-md transition-colors ${c.btnSecondary}`}>
                    {t("dash.stats")}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {writingBooks.size > 0 && logEvents.length > 0 && (
        <div className={`border rounded-lg p-4 ${c.info}`}>
          <h2 className="text-sm font-medium mb-3">{t("dash.writingProgress")}</h2>
          <div className={`space-y-1 text-sm ${c.mono} ${c.subtle}`}>
            {logEvents.map((msg, i) => {
              const d = msg.data as { tag?: string; message?: string };
              return <div key={i}><span className={c.muted}>[{d.tag}]</span> {d.message}</div>;
            })}
            {progressEvent && (
              <div className="text-blue-400 mt-2">
                LLM streaming: {Math.round(((progressEvent.data as { elapsedMs?: number })?.elapsedMs ?? 0) / 1000)}s,{" "}
                {((progressEvent.data as { totalChars?: number })?.totalChars ?? 0).toLocaleString()} chars
              </div>
            )}
          </div>
        </div>
      )}

      {writingBooks.size === 0 && recentEvents.length > 0 && (
        <div className={`border rounded-lg p-4 ${c.cardStatic}`}>
          <h2 className={`text-sm font-medium ${c.subtle} mb-3`}>{t("dash.recentEvents")}</h2>
          <div className={`space-y-1 text-sm ${c.mono} ${c.muted}`}>
            {recentEvents.slice(-5).map((msg, i) => (
              <div key={i}>
                <span className={c.muted}>{new Date(msg.timestamp).toLocaleTimeString()}</span>{" "}
                <span>{msg.event}</span> {JSON.stringify(msg.data)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
