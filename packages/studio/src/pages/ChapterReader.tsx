import { useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface ChapterData {
  readonly chapterNumber: number;
  readonly filename: string;
  readonly content: string;
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
}

export function ChapterReader({ bookId, chapterNumber, nav, theme, t }: {
  bookId: string;
  chapterNumber: number;
  nav: Nav;
  theme: Theme;
  t: TFunction;
}) {
  const c = useColors(theme);
  const { data, loading, error } = useApi<ChapterData>(
    `/books/${bookId}/chapters/${chapterNumber}`,
  );

  if (loading) return <div className={c.muted}>Loading...</div>;
  if (error) return <div className="text-red-400">Error: {error}</div>;
  if (!data) return null;

  // Split markdown content into title and body
  const lines = data.content.split("\n");
  const titleLine = lines.find((l) => l.startsWith("# "));
  const title = titleLine?.replace(/^#\s*/, "") ?? `Chapter ${chapterNumber}`;
  const body = lines
    .filter((l) => l !== titleLine)
    .join("\n")
    .trim();

  const handleApprove = async () => {
    await postApi(`/books/${bookId}/chapters/${chapterNumber}/approve`);
    nav.toBook(bookId);
  };

  const handleReject = async () => {
    await postApi(`/books/${bookId}/chapters/${chapterNumber}/reject`);
    nav.toBook(bookId);
  };

  // Simple paragraph rendering
  const paragraphs = body.split(/\n\n+/).filter(Boolean);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className={`flex items-center gap-2 text-sm ${c.muted}`}>
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span>/</span>
        <button onClick={() => nav.toBook(bookId)} className={c.link}>{bookId}</button>
        <span>/</span>
        <span className={c.subtle}>{t("bread.chapter").replace("{n}", String(chapterNumber))}</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <div className="flex gap-2">
          {chapterNumber > 1 && (
            <button
              onClick={() => nav.toBook(bookId)}
              className={`px-3 py-1.5 text-sm ${c.btnSecondary} rounded-md`}
            >
              {t("reader.backToList")}
            </button>
          )}
          <button
            onClick={handleApprove}
            className={`px-3 py-1.5 text-sm ${c.btnSuccess} rounded-md`}
          >
            {t("reader.approve")}
          </button>
          <button
            onClick={handleReject}
            className={`px-3 py-1.5 text-sm ${c.btnDanger} rounded-md`}
          >
            {t("reader.reject")}
          </button>
        </div>
      </div>

      <article className="prose prose-invert prose-zinc max-w-none">
        {paragraphs.map((para, i) => (
          <p key={i} className={`${c.subtle} leading-relaxed text-base mb-4`}>
            {para}
          </p>
        ))}
      </article>

      <div className={`flex justify-between pt-8 border-t ${c.cardStatic} text-sm`}>
        {chapterNumber > 1 ? (
          <button
            onClick={() => nav.toBook(bookId)}
            className={`${c.subtle} ${c.link}`}
          >
            {t("reader.chapterList")}
          </button>
        ) : (
          <div />
        )}
        <div className={c.muted}>
          {body.length.toLocaleString()} {t("reader.characters")}
        </div>
      </div>
    </div>
  );
}
