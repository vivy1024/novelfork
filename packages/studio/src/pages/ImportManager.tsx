import { useState, type ReactNode } from "react";
import { BookCopy, Feather, FileInput } from "lucide-react";

import { PageScaffold } from "@/components/layout/PageScaffold";
import { fetchJson, postApi, useApi } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import { useI18n } from "../hooks/use-i18n";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

interface BookSummary {
  readonly id: string;
  readonly title: string;
}

interface Nav {
  toDashboard: () => void;
}

type Tab = "chapters" | "canon" | "fanfic";

export function ImportManager({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { lang } = useI18n();
  const { data: booksData } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const [tab, setTab] = useState<Tab>("chapters");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [chText, setChText] = useState("");
  const [chBookId, setChBookId] = useState("");
  const [chSplitRegex, setChSplitRegex] = useState("");

  const [canonTarget, setCanonTarget] = useState("");
  const [canonFrom, setCanonFrom] = useState("");

  const [ffTitle, setFfTitle] = useState("");
  const [ffText, setFfText] = useState("");
  const [ffMode, setFfMode] = useState("canon");
  const [ffGenre, setFfGenre] = useState("other");
  const [ffLang, setFfLang] = useState(lang);

  const handleImportChapters = async () => {
    if (!chText.trim() || !chBookId) return;
    setLoading(true);
    setStatus("");
    try {
      const data = await fetchJson<{ importedCount?: number }>(`/books/${chBookId}/import/chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: chText, splitRegex: chSplitRegex || undefined }),
      });
      setStatus(`Imported ${data.importedCount} chapters`);
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleImportCanon = async () => {
    if (!canonTarget || !canonFrom) return;
    setLoading(true);
    setStatus("");
    try {
      await postApi(`/books/${canonTarget}/import/canon`, { fromBookId: canonFrom });
      setStatus("Canon imported successfully!");
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleFanficInit = async () => {
    if (!ffTitle.trim() || !ffText.trim()) return;
    setLoading(true);
    setStatus("");
    try {
      const data = await fetchJson<{ bookId?: string }>("/fanfic/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: ffTitle,
          sourceText: ffText,
          mode: ffMode,
          genre: ffGenre,
          language: ffLang,
        }),
      });
      setStatus(`Fanfic created: ${data.bookId}`);
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const tabs: ReadonlyArray<{ id: Tab; label: string; icon: ReactNode }> = [
    { id: "chapters", label: t("import.chapters"), icon: <FileInput size={14} /> },
    { id: "canon", label: t("import.canon"), icon: <BookCopy size={14} /> },
    { id: "fanfic", label: t("import.fanfic"), icon: <Feather size={14} /> },
  ];

  return (
    <PageScaffold
      title={t("import.title")}
      description="批量导入章节、衍生 canon 或同人初始化素材。"
    >
      <div className="flex w-fit gap-1 rounded-lg bg-secondary/30 p-1">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => {
              setTab(tb.id);
              setStatus("");
            }}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all ${
              tab === tb.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tb.icon}
            {tb.label}
          </button>
        ))}
      </div>

      <div className={`space-y-4 rounded-lg border ${c.cardStatic} p-6`}>
        {tab === "chapters" && (
          <>
            <select
              value={chBookId}
              onChange={(e) => setChBookId(e.target.value)}
              className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm"
            >
              <option value="">{t("import.selectTarget")}</option>
              {booksData?.books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.title}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={chSplitRegex}
              onChange={(e) => setChSplitRegex(e.target.value)}
              placeholder={t("import.splitRegex")}
              className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 font-mono text-sm"
            />
            <textarea
              value={chText}
              onChange={(e) => setChText(e.target.value)}
              rows={10}
              placeholder={t("import.pasteChapters")}
              className="w-full resize-none rounded-lg border border-border bg-secondary/30 px-3 py-2 font-mono text-sm"
            />
            <button
              onClick={handleImportChapters}
              disabled={loading || !chBookId || !chText.trim()}
              className={`rounded-lg px-4 py-2 text-sm ${c.btnPrimary} disabled:opacity-30`}
            >
              {loading ? t("import.importing") : t("import.chapters")}
            </button>
          </>
        )}

        {tab === "canon" && (
          <>
            <select
              value={canonFrom}
              onChange={(e) => setCanonFrom(e.target.value)}
              className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm"
            >
              <option value="">{t("import.selectSource")}</option>
              {booksData?.books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.title}
                </option>
              ))}
            </select>
            <select
              value={canonTarget}
              onChange={(e) => setCanonTarget(e.target.value)}
              className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm"
            >
              <option value="">{t("import.selectDerivative")}</option>
              {booksData?.books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.title}
                </option>
              ))}
            </select>
            <button
              onClick={handleImportCanon}
              disabled={loading || !canonTarget || !canonFrom}
              className={`rounded-lg px-4 py-2 text-sm ${c.btnPrimary} disabled:opacity-30`}
            >
              {loading ? t("import.importing") : t("import.canon")}
            </button>
          </>
        )}

        {tab === "fanfic" && (
          <>
            <input
              type="text"
              value={ffTitle}
              onChange={(e) => setFfTitle(e.target.value)}
              placeholder={t("import.fanficTitle")}
              className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm"
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <select
                value={ffMode}
                onChange={(e) => setFfMode(e.target.value)}
                className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm"
              >
                <option value="canon">Canon</option>
                <option value="au">AU</option>
                <option value="ooc">OOC</option>
                <option value="cp">CP</option>
              </select>
              <select
                value={ffGenre}
                onChange={(e) => setFfGenre(e.target.value)}
                className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm"
              >
                <option value="other">Other</option>
                <option value="xuanhuan">玄幻</option>
                <option value="urban">都市</option>
                <option value="xianxia">仙侠</option>
              </select>
              <select
                value={ffLang}
                onChange={(e) => setFfLang(e.target.value as "zh" | "en")}
                className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm"
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <textarea
              value={ffText}
              onChange={(e) => setFfText(e.target.value)}
              rows={10}
              placeholder={t("import.pasteMaterial")}
              className="w-full resize-none rounded-lg border border-border bg-secondary/30 px-3 py-2 font-mono text-sm"
            />
            <button
              onClick={handleFanficInit}
              disabled={loading || !ffTitle.trim() || !ffText.trim()}
              className={`rounded-lg px-4 py-2 text-sm ${c.btnPrimary} disabled:opacity-30`}
            >
              {loading ? t("import.creating") : t("import.fanfic")}
            </button>
          </>
        )}

        {status && (
          <div
            className={`rounded-lg px-3 py-2 text-sm ${
              status.startsWith("Error")
                ? "bg-destructive/10 text-destructive"
                : "bg-emerald-500/10 text-emerald-600"
            }`}
          >
            {status}
          </div>
        )}
      </div>
    </PageScaffold>
  );
}
