import { useApi } from "../../hooks/use-api";
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

interface DashboardPageProps {
  readonly onOpenBook?: (bookId: string) => void;
  readonly onCreateBook?: () => void;
}

const STATUS_DOT: Record<string, string> = {
  active: "bg-green-500",
  paused: "bg-yellow-500",
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

export function DashboardPage({ onOpenBook, onCreateBook }: DashboardPageProps) {
  const { data: booksData, loading: booksLoading, error: booksError, refetch: refetchBooks } = useApi<{ books: BookItem[] }>("/books");
  const { data: statsData } = useApi<DailyStats>("/daily-stats");

  const books = booksData?.books ?? [];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">仪表盘</h2>
        <button
          className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
          onClick={onCreateBook}
          type="button"
        >
          + 创建新书
        </button>
      </div>

      {statsData && (
        <p className="text-sm text-muted-foreground">
          今日 {statsData.todayWords} 字 · {statsData.todayChapters} 章
        </p>
      )}

      {booksError && <InlineError message={booksError} onRetry={refetchBooks} />}

      {booksLoading && <p className="text-sm text-muted-foreground">加载中…</p>}

      {!booksLoading && !booksError && books.length === 0 && (
        <EmptyState
          title="还没有作品，创建第一本书开始写作"
          actionLabel="创建新书"
          onAction={onCreateBook}
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
    <div className="rounded-lg border border-border p-3 space-y-2 hover:bg-muted/30 transition">
      <div className="flex items-center justify-between gap-2">
        <button
          className="min-w-0 truncate text-sm font-medium hover:underline text-left"
          onClick={() => onOpen?.(book.id)}
          type="button"
        >
          {book.title}
        </button>
        <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot}`} title={book.status ?? "unknown"} />
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
