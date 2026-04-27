import { useState } from "react";
import { useApi, postApi, fetchJson } from "../../hooks/use-api";
import { EmptyState, InlineError } from "../components/feedback";

interface BookItem {
  readonly id: string;
  readonly title: string;
  readonly status?: string;
  readonly genre?: string;
  readonly totalChapters?: number;
  readonly totalWords?: number;
  readonly progress?: number;
}

interface DailyStats {
  readonly todayWords: number;
  readonly todayChapters: number;
  readonly trend: ReadonlyArray<{ date: string; words: number }>;
}

interface CreateBookForm {
  title: string;
  genre: string;
  platform: string;
  chapterWordCount: number;
  targetChapters: number;
  language: string;
}

interface CreateBookResponse {
  readonly status: string;
  readonly bookId: string;
}

const INITIAL_FORM: CreateBookForm = {
  title: "",
  genre: "xuanhuan",
  platform: "qidian",
  chapterWordCount: 3000,
  targetChapters: 200,
  language: "zh",
};

interface DashboardPageProps {
  readonly onOpenBook?: (bookId: string) => void;
  readonly onCreateBook?: () => void;
}

const STATUS_DOT: Record<string, string> = {
  active: "bg-green-500",
  paused: "bg-yellow-500",
  outlining: "bg-blue-500",
  completed: "bg-gray-400",
};

const STATUS_LABEL: Record<string, string> = {
  active: "连载中",
  paused: "已暂停",
  outlining: "大纲中",
  completed: "已完结",
};

const GENRE_LABELS: Record<string, string> = {
  xuanhuan: "玄幻",
  xianxia: "仙侠",
  dushi: "都市",
  scifi: "科幻",
  kehuan: "科幻",
  lishi: "历史",
  yanqing: "言情",
};

export function DashboardPage({ onOpenBook }: DashboardPageProps) {
  const { data: booksData, loading: booksLoading, error: booksError, refetch: refetchBooks } = useApi<{ books: BookItem[] }>("/books");
  const { data: statsData } = useApi<DailyStats>("/daily-stats");

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState<CreateBookForm>(INITIAL_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const books = booksData?.books ?? [];

  const handleToggle = () => {
    setShowCreateForm((v) => !v);
    setCreateError(null);
  };

  const handleChange = (field: keyof CreateBookForm, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await postApi<CreateBookResponse>("/books/create", {
        title: form.title.trim(),
        genre: form.genre,
        platform: form.platform,
        chapterWordCount: form.chapterWordCount,
        targetChapters: form.targetChapters,
        language: form.language,
      });
      setShowCreateForm(false);
      setForm(INITIAL_FORM);
      void refetchBooks();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">仪表盘</h2>
        <div className="flex gap-2">
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
            onClick={() => { setShowImport(!showImport); setShowCreateForm(false); }}
            type="button"
          >
            {showImport ? "取消导入" : "导入"}
          </button>
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
            onClick={handleToggle}
            type="button"
          >
            {showCreateForm ? "取消" : "+ 创建新书"}
          </button>
        </div>
      </div>

      {showCreateForm && (
        <form onSubmit={handleSubmit} className="rounded-lg border border-border p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 space-y-1">
              <span className="text-xs text-muted-foreground">书名</span>
              <input
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                value={form.title}
                onChange={(e) => handleChange("title", e.target.value)}
                placeholder="输入书名"
                required
                autoFocus
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">题材</span>
              <select
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                value={form.genre}
                onChange={(e) => handleChange("genre", e.target.value)}
              >
                <option value="xuanhuan">玄幻</option>
                <option value="xianxia">仙侠</option>
                <option value="dushi">都市</option>
                <option value="scifi">科幻</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">平台</span>
              <select
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                value={form.platform}
                onChange={(e) => handleChange("platform", e.target.value)}
              >
                <option value="qidian">起点</option>
                <option value="tomato">番茄</option>
                <option value="feilu">飞卢</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">每章字数</span>
              <input
                type="number"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                value={form.chapterWordCount}
                onChange={(e) => handleChange("chapterWordCount", Number(e.target.value))}
                min={500}
                max={10000}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">目标章节数</span>
              <input
                type="number"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                value={form.targetChapters}
                onChange={(e) => handleChange("targetChapters", Number(e.target.value))}
                min={1}
                max={5000}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">语言</span>
              <select
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                value={form.language}
                onChange={(e) => handleChange("language", e.target.value)}
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
          {createError && <InlineError message={createError} />}
          <button
            type="submit"
            disabled={creating || !form.title.trim()}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {creating ? "创建中…" : "创建"}
          </button>
        </form>
      )}

      {showImport && <ImportPanel books={books} onDone={() => { setShowImport(false); void refetchBooks(); }} />}

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">作品总数</div>
          <div className="mt-1 text-xl font-semibold">{books.length}</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">今日字数</div>
          <div className="mt-1 text-xl font-semibold">{statsData?.todayWords ?? 0}</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">今日章节</div>
          <div className="mt-1 text-xl font-semibold">{statsData?.todayChapters ?? 0}</div>
        </div>
      </div>

      {booksError && <InlineError message={booksError} onRetry={refetchBooks} />}

      {booksLoading && <p className="text-sm text-muted-foreground">加载中…</p>}

      {!booksLoading && !booksError && books.length === 0 && (
        <EmptyState
          title="还没有作品，创建第一本书开始写作"
          actionLabel="创建新书"
          onAction={handleToggle}
        />
      )}

      {books.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {books.map((book) => (
            <BookCard key={book.id} book={book} onOpen={onOpenBook} />
          ))}
        </div>
      )}
    </section>
  );
}

function BookCard({ book, onOpen }: { readonly book: BookItem; readonly onOpen?: (id: string) => void }) {
  const statusDot = STATUS_DOT[book.status ?? ""] ?? "bg-gray-400";
  const genreLabel = GENRE_LABELS[book.genre ?? ""] ?? book.genre;
  const totalWords = book.totalWords ?? 0;
  const wordsDisplay = totalWords >= 10000 ? `${(totalWords / 10000).toFixed(1)} 万字` : `${totalWords} 字`;
  const progress = typeof book.progress === "number" ? Math.min(book.progress, 100) : null;

  return (
    <div className="rounded-lg border border-border p-3 space-y-2 hover:border-primary/40 hover:bg-muted/30 transition">
      <div className="flex items-center justify-between gap-2">
        <button
          className="min-w-0 truncate text-sm font-medium hover:underline text-left"
          onClick={() => onOpen?.(book.id)}
          type="button"
        >
          {book.title}
        </button>
        <span className="flex shrink-0 items-center gap-1">
          <span className={`h-2 w-2 rounded-full ${statusDot}`} />
          <span className="text-[10px] text-muted-foreground">{STATUS_LABEL[book.status ?? ""] ?? "未知"}</span>
        </span>
      </div>

      {genreLabel && (
        <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {genreLabel}
        </span>
      )}

      <p className="text-xs text-muted-foreground">
        {book.totalChapters ?? 0} 章 · {wordsDisplay}
      </p>

      {progress !== null && (
        <div className="h-1 w-full rounded-full bg-muted">
          <div
            className="h-1 rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

function ImportPanel({ books, onDone }: { readonly books: ReadonlyArray<BookItem>; readonly onDone: () => void }) {
  const [mode, setMode] = useState<"chapters" | "url">("chapters");
  const [bookId, setBookId] = useState(books[0]?.id ?? "");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [splitRegex, setSplitRegex] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleImportChapters = async () => {
    if (!text.trim() || !bookId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson<{ importedCount?: number }>(`/books/${bookId}/import/chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, splitRegex: splitRegex || undefined }),
      });
      setStatus(`已导入 ${res.importedCount ?? 0} 章`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleImportUrl = async () => {
    if (!url.trim() || !bookId) return;
    setLoading(true);
    setError(null);
    try {
      await fetchJson(`/books/${bookId}/materials/web-capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      setStatus("URL 素材已导入");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">导入到</span>
        <select className="rounded-md border border-border bg-background px-2 py-1 text-sm" value={bookId} onChange={(e) => setBookId(e.target.value)}>
          {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
          {books.length === 0 && <option value="">无可用书籍</option>}
        </select>
        <div className="flex gap-1">
          <button className={`rounded-md px-2 py-1 text-xs ${mode === "chapters" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`} onClick={() => setMode("chapters")} type="button">章节文本</button>
          <button className={`rounded-md px-2 py-1 text-xs ${mode === "url" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`} onClick={() => setMode("url")} type="button">URL 导入</button>
        </div>
      </div>

      {mode === "chapters" && (
        <>
          <textarea className="w-full rounded-md border border-border bg-background p-2 text-sm" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="粘贴章节文本，系统会自动按章节标题分割…" />
          <input className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" value={splitRegex} onChange={(e) => setSplitRegex(e.target.value)} placeholder="自定义分割正则（可选）" />
          <button className="rounded-lg bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={loading || !text.trim() || !bookId} onClick={() => void handleImportChapters()} type="button">
            {loading ? "导入中…" : "导入章节"}
          </button>
        </>
      )}

      {mode === "url" && (
        <>
          <input className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="输入 URL 地址" />
          <button className="rounded-lg bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={loading || !url.trim() || !bookId} onClick={() => void handleImportUrl()} type="button">
            {loading ? "导入中…" : "导入 URL"}
          </button>
        </>
      )}

      {error && <InlineError message={error} />}
      {status && <p className="text-sm text-green-600">{status}</p>}
    </div>
  );
}
