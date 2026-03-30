import { useApi, postApi } from "../hooks/use-api";
import { useEffect, useMemo, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import type { SSEMessage } from "../hooks/use-sse";
import { deriveBookActivity, shouldRefetchBookView } from "../hooks/use-book-activity";

interface ChapterMeta {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
}

interface BookData {
  readonly book: {
    readonly id: string;
    readonly title: string;
    readonly genre: string;
    readonly status: string;
    readonly chapterWordCount: number;
    readonly language?: string;
    readonly fanficMode?: string;
  };
  readonly chapters: ReadonlyArray<ChapterMeta>;
  readonly nextChapter: number;
}

interface Nav {
  toDashboard: () => void;
  toChapter: (bookId: string, num: number) => void;
  toAnalytics: (bookId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  "ready-for-review": "text-amber-400",
  approved: "text-emerald-400",
  drafted: "text-zinc-400",
  "needs-revision": "text-red-400",
  imported: "text-blue-400",
};

export function BookDetail({ bookId, nav, theme, t, sse }: { bookId: string; nav: Nav; theme: Theme; t: TFunction; sse: { messages: ReadonlyArray<SSEMessage> } }) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<BookData>(`/books/${bookId}`);
  const [writing, setWriting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const activity = useMemo(() => deriveBookActivity(sse.messages, bookId), [bookId, sse.messages]);
  const writePending = writing || activity.writing;
  const draftPending = drafting || activity.drafting;

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent || !shouldRefetchBookView(recent, bookId)) return;
    void refetch();
  }, [bookId, refetch, sse.messages]);

  const handleWriteNext = async () => {
    setWriting(true);
    try {
      await postApi(`/books/${bookId}/write-next`);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setWriting(false);
    }
  };

  const handleDraft = async () => {
    setDrafting(true);
    try {
      await postApi(`/books/${bookId}/draft`);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setDrafting(false);
    }
  };

  const handleApproveAll = async () => {
    if (!data) return;
    const reviewable = data.chapters.filter((ch) => ch.status === "ready-for-review");
    for (const ch of reviewable) {
      await postApi(`/books/${bookId}/chapters/${ch.number}/approve`);
    }
    refetch();
  };

  if (loading) return <div className={c.muted}>{t("common.loading")}</div>;
  if (error) return <div className="text-red-400">{t("common.error")}: {error}</div>;
  if (!data) return null;

  const { book, chapters } = data;
  const totalWords = chapters.reduce((sum, ch) => sum + (ch.wordCount ?? 0), 0);
  const reviewCount = chapters.filter((ch) => ch.status === "ready-for-review").length;

  return (
    <div className="space-y-6">
      <div className={`flex items-center gap-2 text-sm ${c.muted}`}>
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span>/</span>
        <span className={c.subtle}>{book.title}</span>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{book.title}</h1>
          <div className={`flex gap-3 mt-1 text-sm ${c.muted}`}>
            <span>{book.genre}</span>
            <span>{chapters.length} {t("dash.chapters")}</span>
            <span>{totalWords.toLocaleString()} {t("book.words")}</span>
            {book.language === "en" && <span className="text-blue-400">EN</span>}
            {book.fanficMode && <span className="text-purple-400">fanfic:{book.fanficMode}</span>}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleWriteNext}
            disabled={writePending || draftPending}
            className={`px-4 py-2 text-sm ${c.btnPrimary} rounded-md transition-colors disabled:opacity-50`}
          >
            {writePending ? "Writing..." : t("book.writeNext")}
          </button>
          <button
            onClick={handleDraft}
            disabled={writePending || draftPending}
            className={`px-4 py-2 text-sm ${c.btnSecondary} rounded-md transition-colors disabled:opacity-50`}
          >
            {draftPending ? "Drafting..." : t("book.draftOnly")}
          </button>
          {reviewCount > 0 && (
            <button
              onClick={handleApproveAll}
              className={`px-4 py-2 text-sm ${c.btnSuccess} rounded-md transition-colors`}
            >
              {t("book.approveAll")} ({reviewCount})
            </button>
          )}
          <button
            onClick={() => (nav as { toTruth?: (id: string) => void }).toTruth?.(bookId)}
            className={`px-4 py-2 text-sm ${c.btnSecondary} rounded-md transition-colors`}
          >
            {t("book.truthFiles")}
          </button>
          <button
            onClick={() => nav.toAnalytics(bookId)}
            className={`px-4 py-2 text-sm ${c.btnSecondary} rounded-md transition-colors`}
          >
            {t("book.analytics")}
          </button>
          <a
            href={`/api/books/${bookId}/export?format=txt`}
            download
            className={`px-4 py-2 text-sm ${c.btnSecondary} rounded-md transition-colors inline-flex items-center`}
          >
            {t("common.export")}
          </a>
        </div>
      </div>

      <div className={`border ${c.cardStatic} rounded-lg overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className={c.tableHeader}>
            <tr>
              <th className="text-left px-4 py-3 font-medium w-16">#</th>
              <th className="text-left px-4 py-3 font-medium">Title</th>
              <th className="text-left px-4 py-3 font-medium w-24">Words</th>
              <th className="text-left px-4 py-3 font-medium w-32">Status</th>
              <th className="text-right px-4 py-3 font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${c.tableDivide}`}>
            {chapters.map((ch) => (
              <tr key={ch.number} className={`${c.tableHover} transition-colors`}>
                <td className={`px-4 py-3 ${c.muted}`}>{ch.number}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => nav.toChapter(bookId, ch.number)}
                    className={`${c.link} transition-colors`}
                  >
                    {ch.title || `Chapter ${ch.number}`}
                  </button>
                </td>
                <td className={`px-4 py-3 ${c.subtle} tabular-nums`}>{(ch.wordCount ?? 0).toLocaleString()}</td>
                <td className={`px-4 py-3 ${STATUS_COLORS[ch.status] ?? c.subtle}`}>
                  {ch.status}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    {ch.status === "ready-for-review" && (
                      <>
                        <button
                          onClick={async () => { await postApi(`/books/${bookId}/chapters/${ch.number}/approve`); refetch(); }}
                          className={`px-2 py-1 text-xs ${c.btnSuccess} rounded`}
                        >
                          {t("book.approve")}
                        </button>
                        <button
                          onClick={async () => { await postApi(`/books/${bookId}/chapters/${ch.number}/reject`); refetch(); }}
                          className={`px-2 py-1 text-xs ${c.btnDanger} rounded`}
                        >
                          {t("book.reject")}
                        </button>
                      </>
                    )}
                    <button
                      onClick={async () => {
                        const r = await fetch(`/api/books/${bookId}/audit/${ch.number}`, { method: "POST" });
                        const data = await r.json();
                        alert(data.passed ? "Audit passed" : `Audit failed: ${data.issues?.length ?? 0} issues`);
                        refetch();
                      }}
                      className={`px-2 py-1 text-xs ${c.btnSecondary} rounded`}
                    >
                      Audit
                    </button>
                    <button
                      onClick={async () => {
                        await fetch(`/api/books/${bookId}/revise/${ch.number}`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ mode: "spot-fix" }),
                        });
                        alert("Revision started");
                        refetch();
                      }}
                      className={`px-2 py-1 text-xs ${c.btnSecondary} rounded`}
                    >
                      Revise
                    </button>
                    <button
                      onClick={async () => {
                        const r = await fetch(`/api/books/${bookId}/detect/${ch.number}`, { method: "POST" });
                        const data = await r.json();
                        alert(`AI-tell: ${data.issues?.length ?? 0} issues found`);
                      }}
                      className={`px-2 py-1 text-xs ${c.btnSecondary} rounded`}
                    >
                      Detect
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {chapters.length === 0 && (
          <div className={`text-center py-12 ${c.muted}`}>
            {t("book.noChapters")}
          </div>
        )}
      </div>
    </div>
  );
}
