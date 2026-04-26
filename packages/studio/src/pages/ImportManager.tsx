import { useState, type ReactNode } from "react";
import { BookCopy, Feather, FileInput, Globe2 } from "lucide-react";

import { PageScaffold } from "@/components/layout/PageScaffold";
import { fetchJson, postApi, useApi } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import { useI18n } from "../hooks/use-i18n";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";
import type { AuthorMaterialPersistenceInfo, AuthorWebCaptureResult } from "../shared/author-materials";

interface BookSummary {
  readonly id: string;
  readonly title: string;
}

interface Nav {
  toDashboard: () => void;
  toTruth?: (bookId: string) => void;
}

type Tab = "chapters" | "canon" | "fanfic" | "web";

export function ImportManager({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { lang } = useI18n();
  const { data: booksData } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const [tab, setTab] = useState<Tab>("chapters");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [persisted, setPersisted] = useState<AuthorMaterialPersistenceInfo | null>(null);
  const [captureResult, setCaptureResult] = useState<AuthorWebCaptureResult | null>(null);

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

  const [webBookId, setWebBookId] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [webLabel, setWebLabel] = useState("");
  const [webNotes, setWebNotes] = useState("");
  const [webPerspective, setWebPerspective] = useState<"market" | "genre" | "setting" | "character" | "reference">("genre");

  const resetResultState = () => {
    setPersisted(null);
    setCaptureResult(null);
  };

  const handleImportChapters = async () => {
    if (!chText.trim() || !chBookId) return;
    setLoading(true);
    setStatus("");
    resetResultState();
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
    resetResultState();
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
    resetResultState();
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

  const handleWebCapture = async () => {
    if (!webBookId || !webUrl.trim()) return;
    setLoading(true);
    setStatus("");
    resetResultState();
    try {
      const data = await fetchJson<{ capture: AuthorWebCaptureResult; persisted: AuthorMaterialPersistenceInfo }>(
        `/books/${webBookId}/materials/web-capture`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: webUrl,
            label: webLabel || undefined,
            notes: webNotes || undefined,
            perspective: webPerspective,
          }),
        },
      );
      setCaptureResult(data.capture);
      setPersisted(data.persisted);
      setStatus("网页素材已收口到作者审阅区");
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const tabs: ReadonlyArray<{ id: Tab; label: string; icon: ReactNode }> = [
    { id: "chapters", label: t("import.chapters"), icon: <FileInput size={14} /> },
    { id: "canon", label: t("import.canon"), icon: <BookCopy size={14} /> },
    { id: "fanfic", label: t("import.fanfic"), icon: <Feather size={14} /> },
    { id: "web", label: "网页素材", icon: <Globe2 size={14} /> },
  ];

  return (
    <PageScaffold
      title={t("import.title")}
      description="围绕素材导入、题材采风和母本整理，而不是提供独立 Browser 入口。"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-dashed border-border/70 bg-background/60 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          这里的网页采风会调用后台抓取 / 可读化能力，把结果收口到书籍的作者审阅区；
          不会直接污染故事经纬，也不会把 Browser 作为默认一等入口暴露出来。
        </div>

        <div className="flex w-fit gap-1 rounded-lg bg-secondary/30 p-1">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              onClick={() => {
                setTab(tb.id);
                setStatus("");
                resetResultState();
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

          {tab === "web" && (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={webBookId}
                  onChange={(e) => setWebBookId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm"
                >
                  <option value="">选择要收口的书籍</option>
                  {booksData?.books.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.title}
                    </option>
                  ))}
                </select>
                <select
                  value={webPerspective}
                  onChange={(e) => setWebPerspective(e.target.value as typeof webPerspective)}
                  className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm"
                >
                  <option value="market">市场观察</option>
                  <option value="genre">题材分析</option>
                  <option value="setting">世界设定</option>
                  <option value="character">角色资料</option>
                  <option value="reference">通用参考</option>
                </select>
              </div>
              <input
                type="url"
                value={webUrl}
                onChange={(e) => setWebUrl(e.target.value)}
                placeholder="https://example.com/article"
                className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={webLabel}
                onChange={(e) => setWebLabel(e.target.value)}
                placeholder="给这份素材起一个作者标签（可选）"
                className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm"
              />
              <textarea
                value={webNotes}
                onChange={(e) => setWebNotes(e.target.value)}
                rows={4}
                placeholder="记录为什么抓这篇、准备拿它分析什么（可选）"
                className="w-full resize-none rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm"
              />
              <div className="rounded-lg border border-dashed border-border/70 bg-background/60 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                抓取结果会追加保存到所选书籍的 <code>web_materials.md</code>，作为作者可审阅素材；
                你可以在审阅后再手动提炼为经纬、角色卡或题材判断。
              </div>
              <button
                onClick={handleWebCapture}
                disabled={loading || !webBookId || !webUrl.trim()}
                className={`rounded-lg px-4 py-2 text-sm ${c.btnPrimary} disabled:opacity-30`}
              >
                {loading ? "抓取中..." : "抓取并收口到素材区"}
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

          {persisted && captureResult && tab === "web" && (
            <div className="space-y-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm">
              <div className="font-medium text-emerald-700">素材已进入作者审阅区</div>
              <p className="leading-relaxed text-emerald-700/90">
                《{booksData?.books.find((book) => book.id === persisted.bookId)?.title ?? persisted.bookId}》已新增网页采风记录：
                <code className="ml-1 rounded bg-emerald-500/10 px-1 py-0.5">{persisted.path}</code>
              </p>
              <div className="rounded-lg bg-background/80 p-3 text-xs text-foreground/80">
                <div className="font-medium text-sm text-foreground">{captureResult.title}</div>
                <div className="mt-1 text-muted-foreground">{captureResult.excerpt || "（本次抓取未生成摘要）"}</div>
              </div>
              {nav.toTruth ? (
                <button
                  onClick={() => nav.toTruth?.(persisted.bookId)}
                  className="rounded-lg border border-emerald-500/30 px-3 py-2 text-sm text-emerald-700 transition-colors hover:bg-emerald-500/10"
                >
                  打开作者审阅区
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </PageScaffold>
  );
}
