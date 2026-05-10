import { useState, useEffect, useCallback } from "react";
import { BookOpen, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface BookCardData {
  id: string;
  title: string;
  genre?: string;
  chapterCount?: number;
  targetChapters?: number;
  wordCount?: number;
  status?: string;
}

export interface BookManagementPageProps {
  onNavigateToBook: (bookId: string) => void;
  onCreateBook: () => void;
}

export function BookManagementPage({ onNavigateToBook, onCreateBook }: BookManagementPageProps) {
  const [books, setBooks] = useState<BookCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBooks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/books");
      if (!res.ok) throw new Error(`加载失败: ${res.status}`);
      const data = await res.json();
      setBooks(Array.isArray(data.books) ? data.books : Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载书籍列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadBooks(); }, [loadBooks]);

  const handleDelete = useCallback(async (bookId: string, title: string) => {
    if (!confirm(`确认删除「${title}」？此操作不可撤销。`)) return;
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
      if (res.ok) {
        setBooks((prev) => prev.filter((b) => b.id !== bookId));
      } else {
        alert("删除失败");
      }
    } catch {
      alert("删除失败");
    }
  }, []);

  return (
    <div className="flex h-full flex-col p-6" data-testid="book-management-page">
      {/* Header */}
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen className="size-6 text-primary" />
          <h1 className="text-2xl font-bold">我的作品</h1>
        </div>
        <Button onClick={onCreateBook} className="gap-2">
          <Plus className="size-4" />
          新建作品
        </Button>
      </header>

      {/* Content */}
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {!loading && !error && books.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <BookOpen className="mx-auto size-12 text-muted-foreground/30" />
            <p className="mt-4 text-lg text-muted-foreground">还没有作品</p>
            <p className="mt-1 text-sm text-muted-foreground">点击"新建作品"开始你的创作之旅</p>
            <Button onClick={onCreateBook} className="mt-4 gap-2">
              <Plus className="size-4" />
              新建作品
            </Button>
          </div>
        </div>
      )}

      {!loading && books.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {books.map((book) => (
            <article
              key={book.id}
              className="group relative flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/30 hover:shadow-md cursor-pointer"
              onClick={() => onNavigateToBook(book.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onNavigateToBook(book.id); }}
            >
              <div className="flex items-start justify-between">
                <h2 className="text-base font-semibold truncate pr-2">{book.title || "未命名作品"}</h2>
                {book.genre && (
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {book.genre}
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                {book.chapterCount !== undefined && (
                  <span>{book.chapterCount}{book.targetChapters ? `/${book.targetChapters}` : ""} 章</span>
                )}
                {book.wordCount !== undefined && (
                  <span>{book.wordCount >= 10000 ? `${(book.wordCount / 10000).toFixed(1)} 万字` : `${book.wordCount} 字`}</span>
                )}
                {book.status && (
                  <span className={`rounded-full px-1.5 py-0.5 ${book.status === "completed" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"}`}>
                    {book.status === "completed" ? "已完成" : "活跃"}
                  </span>
                )}
              </div>
              {/* Delete button */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute bottom-2 right-2 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); void handleDelete(book.id, book.title); }}
                title="删除作品"
              >
                <Trash2 className="size-4" />
              </Button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
