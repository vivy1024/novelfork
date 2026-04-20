import { useEffect, useRef, useState } from "react";
import { Anchor, BookOpen, FileText, Globe, Loader2, Search } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { fetchJson } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

interface SearchHit {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly chapterNumber: number;
  readonly snippet: string;
  readonly contentType?: "chapter" | "truth" | "hook" | "lorebook";
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
  return parts.map((part, index) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={index} className="rounded bg-primary/20 px-0.5 text-primary">
        {part}
      </mark>
    ) : (
      part
    ),
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

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  const grouped = groupByBook(results);

  return (
    <PageScaffold
      title={t("search.results")}
      description="跨章节、设定、伏笔与世界观内容做统一检索。"
    >
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search.placeholder")}
          className={`w-full rounded-lg py-2.5 pl-10 pr-4 text-sm ${c.input}`}
          autoFocus
        />
        {loading && (
          <Loader2
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground"
          />
        )}
      </div>

      {error && <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      {grouped.length > 0 && (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.bookId} className={`overflow-hidden rounded-lg border ${c.cardStatic}`}>
              <div className="border-b border-border bg-muted/40 px-5 py-3">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {group.bookTitle}
                </span>
              </div>
              <div className={`divide-y ${c.tableDivide}`}>
                {group.hits.map((hit, index) => (
                  <button
                    key={index}
                    onClick={() => nav.toChapter(hit.bookId, hit.chapterNumber)}
                    className={`flex w-full flex-col gap-1 px-5 py-3 text-left ${c.tableHover}`}
                  >
                    <div className="flex items-center gap-2">
                      <ContentTypeIcon type={hit.contentType} />
                      <span className="text-xs font-semibold text-primary">
                        {t("chapter.label").replace("{n}", String(hit.chapterNumber))}
                      </span>
                      {hit.contentType && hit.contentType !== "chapter" && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                          {contentTypeLabel(hit.contentType)}
                        </span>
                      )}
                    </div>
                    <span className="text-sm leading-relaxed text-foreground/80">
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
        <PageEmptyState
          title={t("search.noResults")}
          description="当前关键词没有命中章节或设定内容，试试换一个角色名、地点名或关键词组合。"
          icon={Search}
        />
      )}

      {!searched && !loading && (
        <PageEmptyState title="开始搜索" description={t("search.placeholder")} icon={Search} />
      )}
    </PageScaffold>
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

  return Array.from(map.entries()).map(([bookId, { bookTitle, hits: groupHits }]) => ({
    bookId,
    bookTitle,
    hits: groupHits,
  }));
}

function ContentTypeIcon({ type }: { type?: string }) {
  switch (type) {
    case "truth":
      return <BookOpen size={12} className="shrink-0 text-amber-500" />;
    case "hook":
      return <Anchor size={12} className="shrink-0 text-purple-500" />;
    case "lorebook":
      return <Globe size={12} className="shrink-0 text-emerald-500" />;
    default:
      return <FileText size={12} className="shrink-0 text-muted-foreground" />;
  }
}

function contentTypeLabel(type: string): string {
  switch (type) {
    case "truth":
      return "设定";
    case "hook":
      return "伏笔";
    case "lorebook":
      return "世界观";
    default:
      return "章节";
  }
}
