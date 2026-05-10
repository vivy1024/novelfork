import { useState } from "react";
import { useApi, postApi, fetchJson } from "../../hooks/use-api";
import { EmptyState, InlineError } from "../components/feedback";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { SimpleSelect } from "../../components/ui/simple-select";

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
  repositorySource: "new" | "existing" | "none";
  repositoryPath: string;
}

interface CreateBookResponse {
  readonly status: string;
  readonly bookId: string;
}

const INITIAL_FORM: CreateBookForm = {
  title: "",
  repositorySource: "none",
  repositoryPath: "",
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const projectInit = form.repositorySource !== "none" ? {
        repositorySource: form.repositorySource,
        ...(form.repositorySource === "existing" && form.repositoryPath.trim() ? { repositoryPath: form.repositoryPath.trim() } : {}),
      } : undefined;

      const title = form.title.trim() || "未命名作品";
      const result = await postApi<CreateBookResponse>("/books/create", {
        title,
        language: "zh",
        ...(projectInit ? { projectInit } : {}),
      });
      setShowCreateForm(false);
      setForm(INITIAL_FORM);
      void refetchBooks();
      if (onOpenBook) onOpenBook(result.bookId);
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
          <Button
            variant={showImport ? "default" : "outline"}
            onClick={() => { setShowImport(!showImport); setShowCreateForm(false); }}
            type="button"
          >
            {showImport ? "取消导入" : "导入"}
          </Button>
          <Button
            variant={showCreateForm ? "secondary" : "default"}
            onClick={handleToggle}
            type="button"
          >
            {showCreateForm ? "取消" : "+ 创建新书"}
          </Button>
        </div>
      </div>

      {showCreateForm && (
        <form onSubmit={handleSubmit} className="rounded-lg border border-border p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">新建作品</h3>
            <p className="text-xs text-muted-foreground">创建后进入工作台，AI 会引导你完成题材、设定和大纲。</p>
          </div>

          {/* 仓库绑定（优先） */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">项目仓库</span>
            <div className="flex gap-2">
              {(["none", "new", "existing"] as const).map((source) => (
                <button
                  key={source}
                  type="button"
                  className={`rounded-md px-3 py-1.5 text-xs transition ${form.repositorySource === source ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                  onClick={() => setForm((prev) => ({ ...prev, repositorySource: source }))}
                >
                  {source === "none" ? "不绑定" : source === "new" ? "新建仓库" : "已有仓库"}
                </button>
              ))}
            </div>
            {form.repositorySource === "existing" && (
              <Input
                value={form.repositoryPath}
                onChange={(e) => setForm((prev) => ({ ...prev, repositoryPath: e.target.value }))}
                placeholder="本地仓库路径，如 D:\novels\my-book"
                className="text-xs"
              />
            )}
          </div>

          {/* 书名（可选） */}
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">作品名称 <span className="font-normal">（可选，AI 可帮你生成）</span></span>
            <Input
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="留空则由 AI 引导生成"
            />
          </label>

          {createError && <InlineError message={createError} />}
          <Button type="submit" disabled={creating}>
            {creating ? "创建中…" : "开始创作"}
          </Button>
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
        <div className="rounded-lg border border-dashed border-border p-6 space-y-4">
          <EmptyState
            title="还没有作品，创建第一本书开始写作"
            actionLabel="创建新书"
            onAction={handleToggle}
          />
          <div className="grid gap-3 sm:grid-cols-3 pt-2">
            <div className="rounded-lg bg-muted/30 p-3 space-y-1">
              <p className="text-xs font-medium">1. 创建作品</p>
              <p className="text-[10px] text-muted-foreground">绑定仓库（可选），输入书名或留空让 AI 帮你起名</p>
            </div>
            <div className="rounded-lg bg-muted/30 p-3 space-y-1">
              <p className="text-xs font-medium">2. AI 引导设定</p>
              <p className="text-[10px] text-muted-foreground">进入工作台后，AI 会询问你想写什么、选什么题材，生成经纬大纲</p>
            </div>
            <div className="rounded-lg bg-muted/30 p-3 space-y-1">
              <p className="text-xs font-medium">3. 开始写作</p>
              <p className="text-[10px] text-muted-foreground">手动写作或让 AI 生成候选稿，你来审阅和决定</p>
            </div>
          </div>
        </div>
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
        <Button
          variant="ghost"
          className="min-w-0 truncate text-sm font-medium hover:underline text-left"
          onClick={() => onOpen?.(book.id)}
        >
          {book.title}
        </Button>
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
  const [bookId, setBookId] = useState(books[0]?.id ?? "");
  const [text, setText] = useState("");
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

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">导入到</span>
        <SimpleSelect
          value={bookId}
          onValueChange={(v) => setBookId(v)}
          options={books.length > 0 ? books.map((b) => ({ value: b.id, label: b.title })) : [{ value: "", label: "无可用书籍" }]}
        />
        <div className="flex gap-1">
          <span data-visual-audit="activeTab" className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground">章节文本</span>
        </div>
      </div>

      <>
        <Textarea className="w-full" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="粘贴章节文本，系统会自动按章节标题分割…" />
        <Input value={splitRegex} onChange={(e) => setSplitRegex(e.target.value)} placeholder="自定义分割正则（可选）" />
        <Button data-visual-audit="disabledAction" disabled={loading || !text.trim() || !bookId} onClick={() => void handleImportChapters()} type="button">
          {loading ? "导入中…" : "导入章节"}
        </Button>
      </>

      {error && <InlineError message={error} />}
      {status && <p className="text-sm text-green-600">{status}</p>}
    </div>
  );
}
