import { useEffect, useRef, useState } from "react";
import { fetchJson } from "../../hooks/use-api";
import { InlineError } from "../components/feedback";
import type { SearchResult as ApiSearchResult } from "../../shared/search-types";

interface SearchHit {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly chapterNumber: number;
  readonly snippet: string;
  readonly contentType?: ApiSearchResult["type"];
}

const TYPE_LABELS: Record<string, string> = { chapter: "章节", setting: "设定", message: "消息", file: "文件" };

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toSearchHit(result: ApiSearchResult): SearchHit {
  const metadata = result.metadata ?? {};
  const bookTitle = typeof metadata.bookTitle === "string" && metadata.bookTitle.trim() ? metadata.bookTitle : result.title;
  const snippet = result.highlights[0] ?? result.content.slice(0, 120);

  return {
    bookId: result.bookId,
    bookTitle,
    chapterNumber: toNumber(metadata.chapterNumber),
    snippet,
    contentType: result.type,
  };
}

function highlightSnippet(snippet: string, query: string) {
  if (!query.trim()) return snippet;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = snippet.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="rounded bg-primary/20 px-0.5 text-primary">{part}</mark>
    ) : (
      part
    ),
  );
}

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReadonlyArray<SearchHit>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearched(false);
      setError(null);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJson<{ results: ReadonlyArray<ApiSearchResult> }>("/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed }),
        });
        setResults(data.results.map(toSearchHit));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setResults([]);
      }
      setSearched(true);
      setLoading(false);
    }, 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">全局搜索</h2>
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索章节、真相文件、伏笔、世界观…"
          className="w-full rounded-lg border border-border bg-background py-2.5 pl-3 pr-10 text-sm"
          autoFocus
        />
        {loading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">搜索中…</span>}
      </div>

      {error && <InlineError message={error} />}

      {searched && results.length === 0 && !loading && !error && (
        <p className="text-sm text-muted-foreground">未找到匹配内容</p>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((hit, i) => (
            <div key={i} className="cursor-pointer rounded-lg border border-border p-3 text-sm hover:bg-muted" onClick={() => console.log("navigate to", hit)}>
              <div className="flex items-center gap-2">
                <span className="font-medium">{hit.bookTitle}</span>
                <span className="text-xs text-muted-foreground">第 {hit.chapterNumber} 章</span>
                {hit.contentType && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {TYPE_LABELS[hit.contentType] ?? hit.contentType}
                  </span>
                )}
              </div>
              <p className="mt-1 text-muted-foreground">{highlightSnippet(hit.snippet, query)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
