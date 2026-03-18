import { useState } from "react";
import { useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
}

interface GenreInfo {
  readonly id: string;
  readonly name: string;
  readonly source: "project" | "builtin";
}

export function BookCreate({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data: genreData } = useApi<{ genres: ReadonlyArray<GenreInfo> }>("/genres");

  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [chapterWords, setChapterWords] = useState("3000");
  const [targetChapters, setTargetChapters] = useState("200");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const genres = genreData?.genres ?? [];

  // Auto-select first genre when data loads
  if (genres.length > 0 && !genre) {
    setGenre(genres[0]!.id);
  }

  const handleCreate = async () => {
    if (!title.trim()) {
      setError(t("create.titleRequired"));
      return;
    }
    if (!genre) {
      setError(t("create.genreRequired"));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const result = await postApi<{ bookId: string }>("/books/create", {
        title: title.trim(),
        genre,
        language,
        chapterWordCount: parseInt(chapterWords, 10),
        targetChapters: parseInt(targetChapters, 10),
      });
      nav.toBook(result.bookId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create book");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className={`flex items-center gap-2 text-sm ${c.muted}`}>
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span>/</span>
        <span className={c.subtle}>{t("bread.newBook")}</span>
      </div>

      <h1 className="text-2xl font-semibold">{t("create.title")}</h1>

      {error && (
        <div className={`border ${c.error} rounded-lg px-4 py-3 text-sm`}>
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className={`block text-sm ${c.subtle} mb-1`}>{t("create.bookTitle")}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`w-full ${c.input} rounded-md px-3 py-2 focus:outline-none`}
            placeholder={t("create.placeholder")}
          />
        </div>

        <div>
          <label className={`block text-sm ${c.subtle} mb-1`}>{t("create.language")}</label>
          <div className="flex gap-2">
            <button
              onClick={() => setLanguage("zh")}
              className={`px-4 py-2 rounded-md text-sm ${language === "zh" ? c.btnPrimary : c.btnSecondary}`}
            >
              Chinese
            </button>
            <button
              onClick={() => setLanguage("en")}
              className={`px-4 py-2 rounded-md text-sm ${language === "en" ? c.btnPrimary : c.btnSecondary}`}
            >
              English
            </button>
          </div>
        </div>

        <div>
          <label className={`block text-sm ${c.subtle} mb-1`}>{t("create.genre")}</label>
          <select
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            className={`w-full ${c.input} rounded-md px-3 py-2 focus:outline-none`}
          >
            {genres.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.id}){g.source === "project" ? " [custom]" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={`block text-sm ${c.subtle} mb-1`}>{t("create.wordsPerChapter")}</label>
            <input
              type="number"
              value={chapterWords}
              onChange={(e) => setChapterWords(e.target.value)}
              className={`w-full ${c.input} rounded-md px-3 py-2 focus:outline-none`}
            />
          </div>
          <div>
            <label className={`block text-sm ${c.subtle} mb-1`}>{t("create.targetChapters")}</label>
            <input
              type="number"
              value={targetChapters}
              onChange={(e) => setTargetChapters(e.target.value)}
              className={`w-full ${c.input} rounded-md px-3 py-2 focus:outline-none`}
            />
          </div>
        </div>
      </div>

      <button
        onClick={handleCreate}
        disabled={creating || !title.trim()}
        className={`w-full px-4 py-2.5 ${c.btnPrimary} rounded-md transition-colors disabled:opacity-50 font-medium`}
      >
        {creating ? t("create.creating") : t("create.submit")}
      </button>
    </div>
  );
}
