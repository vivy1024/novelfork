import { useState, useEffect, useRef } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { fetchJson } from "../hooks/use-api";
import { Search, Loader2 } from "lucide-react";

interface SearchHit {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly chapterNumber: number;
  readonly snippet: string;
}

interface SearchResult {
  readonly hits: ReadonlyArray<SearchHit>;
}

interface Nav {
  toDashboard: () => void;
  toChapter: (bookId: string, chapterNumber: number) => void;
}

function highlightSnippet(snippet: string, query: string) {
  if (!query.trim()) return snippet;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = snippet.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-primary/20 text-primary rounded px-0.5">{part}</mark>
      : part
  );
}

export function SearchView({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReadonlyArray<SearchHit>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearched(false);
      setError("");
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const data = await fetchJson<SearchResult>(`/search?q=${encodeURIComponent(trimmed)}`);
        setResults(data.hits);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setResults([]);
      }
      setSearched(true);
      setLoading(false);
    }, 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  const grouped = groupByBook(results);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("nav.search")}</span>
      </div>

      <h1 className="font-serif text-3xl flex items-center gap-3">
        <Search size={28} className="text-primary" />
        {t("search.results")}
      </h1>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search.placeholder")}
          className={`w-full pl-10 pr-4 py-2.5 rounded-lg text-sm ${c.input}`}
          autoFocus
        />
        {loading && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {grouped.length > 0 && (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.bookId} className={`border ${c.cardStatic} rounded-lg overflow-hidden`}>
              <div className="px-5 py-3 bg-muted/40 border-b border-border">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{group.bookTitle}</span>
              </div>
              <div className={`divide-y ${c.tableDivide}`}>
                {group.hits.map((hit, i) => (
                  <button
                    key={i}
                    onClick={() => nav.toChapter(hit.bookId, hit.chapterNumber)}
                    className={`w-full text-left px-5 py-3 ${c.tableHover} flex flex-col gap-1`}
                  >
                    <span className="text-xs font-semibold text-primary">
                      {t("chapter.label").replace("{n}", String(hit.chapterNumber))}
                    </span>
                    <span className="text-sm text-foreground/80 leading-relaxed">
                      {highlightSnippet(hit.snippet, query.trim())}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {searched && !loading && results.length === 0 && !error && (
        <div className={`border border-dashed ${c.cardStatic} rounded-lg p-12 text-center text-muted-foreground text-sm italic`}>
          {t("search.noResults")}
        </div>
      )}

      {!searched && !loading && (
        <div className={`border border-dashed ${c.cardStatic} rounded-lg p-12 text-center text-muted-foreground text-sm italic`}>
          {t("search.placeholder")}
        </div>
      )}
    </div>
  );
}

interface BookGroup {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly hits: ReadonlyArray<SearchHit>;
}

function groupByBook(hits: ReadonlyArray<SearchHit>): ReadonlyArray<BookGroup> {
  const map = new Map<string, { bookTitle: string; hits: SearchHit[] }>();
  for (const hit of hits) {
    const existing = map.get(hit.bookId);
    if (existing) {
      existing.hits.push(hit);
    } else {
      map.set(hit.bookId, { bookTitle: hit.bookTitle, hits: [hit] });
    }
  }
  return Array.from(map.entries()).map(([bookId, { bookTitle, hits: h }]) => ({
    bookId,
    bookTitle,
    hits: h,
  }));
}