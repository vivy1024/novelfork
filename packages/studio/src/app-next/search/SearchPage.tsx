import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangleIcon, BotIcon, ClockIcon, FileTextIcon, MessageSquareIcon, SearchIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildSearchResultHref,
  compactSnippet,
  countSearchResultTypes,
  createRuntimeSearchClient,
  filterAndSortSearchResults,
  getSearchResultDisplayTitle,
  normalizeResultType,
  normalizeSearchSort,
  normalizeSearchType,
  summarizeSearchRuntimeState,
  type RuntimeSearchResponse,
  type RuntimeSearchResult,
  type SearchResultType,
  type SearchSort,
} from "./runtime-search";

const client = createRuntimeSearchClient();
const MAX_VISIBLE_RESULTS = 200;
const resultTypeLabels: Record<SearchResultType, string> = {
  all: "全部",
  chapter: "章节",
  narrator: "叙述者",
  message: "消息",
};

function initialSearchParams(): { query: string; type: SearchResultType; sort: SearchSort } {
  if (typeof window === "undefined") return { query: "", type: "all", sort: "relevance" };
  const params = new URLSearchParams(window.location.search);
  return {
    query: params.get("q") ?? "",
    type: normalizeSearchType(params.get("type")),
    sort: normalizeSearchSort(params.get("sort")),
  };
}

function updateSearchUrl(query: string, type: SearchResultType, sort: SearchSort): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (query) url.searchParams.set("q", query); else url.searchParams.delete("q");
  if (type !== "all") url.searchParams.set("type", type); else url.searchParams.delete("type");
  if (sort !== "relevance") url.searchParams.set("sort", sort); else url.searchParams.delete("sort");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function highlightSearchText(text: string, query: string): ReactNode {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return text;
  const escaped = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  if (parts.length === 1) return text;
  return parts.map((part, index) => part.toLocaleLowerCase("zh-CN") === normalizedQuery.toLocaleLowerCase("zh-CN")
    ? <mark className="rounded bg-muted px-0.5 text-foreground" key={`${part}-${index}`}>{part}</mark>
    : part);
}

function resultIcon(result: RuntimeSearchResult) {
  switch (normalizeResultType(result.type)) {
    case "chapter":
      return FileTextIcon;
    case "narrator":
      return BotIcon;
    case "message":
      return MessageSquareIcon;
    default:
      return SearchIcon;
  }
}

function resultDescription(result: RuntimeSearchResult, query: string): string {
  const content = String(result.snippet ?? result.content ?? result.summary ?? "").slice(0, 2_000);
  return content ? compactSnippet(content, query) : "没有可显示的匹配摘要";
}

function resultMetadata(result: RuntimeSearchResult): string[] {
  return [result.projectTitle, result.projectName, result.chapterTitle, result.narratorTitle]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function resultDate(result: RuntimeSearchResult): string | null {
  const raw = result.updatedAt ?? result.createdAt ?? result.lastMessageAt ?? result.timestamp;
  if (raw === null || raw === undefined) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function SearchPage() {
  const initial = useMemo(initialSearchParams, []);
  const [query, setQuery] = useState(initial.query);
  const [debouncedQuery, setDebouncedQuery] = useState(initial.query);
  const [type, setType] = useState<SearchResultType>(initial.type);
  const [sort, setSort] = useState<SearchSort>(initial.sort);
  const [forceSearch, setForceSearch] = useState(false);
  const [response, setResponse] = useState<RuntimeSearchResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    updateSearchUrl(query, type, sort);
  }, [query, type, sort]);

  const isShortQuery = debouncedQuery.length > 0 && debouncedQuery.length < 3;
  useEffect(() => {
    if (!debouncedQuery || (isShortQuery && !forceSearch)) {
      setResponse(undefined);
      setError(null);
      setLoading(false);
      return;
    }
    let stale = false;
    setLoading(true);
    setError(null);
    void client.search(debouncedQuery).then((next) => {
      if (!stale) setResponse(next);
    }).catch((cause) => {
      if (!stale) {
        setResponse(undefined);
        setError(cause instanceof Error ? cause.message : "搜索请求失败");
      }
    }).finally(() => {
      if (!stale) setLoading(false);
    });
    return () => { stale = true; };
  }, [debouncedQuery, forceSearch, isShortQuery]);

  const allResults = response?.results ?? [];
  const counts = useMemo(() => countSearchResultTypes(allResults), [allResults]);
  const filteredResults = useMemo(() => filterAndSortSearchResults(allResults, type, sort), [allResults, sort, type]);
  const results = useMemo(() => filteredResults.slice(0, MAX_VISIBLE_RESULTS), [filteredResults]);
  const hiddenResultCount = filteredResults.length - results.length;
  const runtimeStatus = useMemo(() => summarizeSearchRuntimeState(response), [response]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">全局搜索</h1>
        <p className="text-sm text-muted-foreground">搜索 Runtime 中的章节、叙述者和消息。</p>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="搜索章节、叙述者和消息"
            autoFocus
            className="pl-9"
            onChange={(event) => {
              setQuery(event.target.value);
              setForceSearch(false);
            }}
            placeholder="输入至少 3 个字符"
            value={query}
          />
        </div>
        <Select value={sort} onValueChange={(value) => setSort(normalizeSearchSort(value))}>
          <SelectTrigger aria-label="搜索结果排序" className="w-full sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="relevance">相关度</SelectItem>
              <SelectItem value="time">最近更新</SelectItem>
              <SelectItem value="type">结果类型</SelectItem>
              <SelectItem value="title">标题</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={type} onValueChange={(value) => setType(normalizeSearchType(value))}>
        <TabsList className="max-w-full justify-start overflow-x-auto">
          {(Object.keys(resultTypeLabels) as SearchResultType[]).map((resultType) => (
            <TabsTrigger key={resultType} value={resultType}>
              {resultTypeLabels[resultType]}
              <Badge variant="secondary">{counts[resultType]}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isShortQuery && !forceSearch ? (
        <Alert>
          <AlertTitle>搜索词较短</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>默认要求至少 3 个字符，以避免昂贵的全局扫描。</span>
            <Button size="sm" variant="outline" onClick={() => setForceSearch(true)}>仍然搜索</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {runtimeStatus.degraded ? (
        <Alert>
          <AlertTriangleIcon className="mb-2 size-4 text-muted-foreground" />
          <AlertTitle>搜索服务正在降级运行{runtimeStatus.mode ? `（${runtimeStatus.mode}）` : ""}</AlertTitle>
          <AlertDescription>{runtimeStatus.fallbackMessages.join("；") || "部分索引不可用，结果可能不完整。"}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert>
          <AlertTitle>搜索失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">正在搜索…</p> : null}
      {!loading && debouncedQuery && (!isShortQuery || forceSearch) && !error ? (
        <p className="text-sm text-muted-foreground">找到 {filteredResults.length} 条结果</p>
      ) : null}

      {hiddenResultCount > 0 ? (
        <Alert>
          <AlertTitle>结果过多</AlertTitle>
          <AlertDescription>当前仅显示前 {MAX_VISIBLE_RESULTS} 条，共 {filteredResults.length} 条；请缩小搜索范围。</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3">
        {results.map((result) => {
          const Icon = resultIcon(result);
          const date = resultDate(result);
          const metadata = resultMetadata(result);
          const href = buildSearchResultHref(result);
          const key = `${result.type}-${result.id}`;
          const card = (
            <Card className={href ? "transition-colors hover:bg-muted/40" : undefined} size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="truncate">{highlightSearchText(getSearchResultDisplayTitle(result).slice(0, 500), debouncedQuery)}</span>
                </CardTitle>
                <CardDescription>{highlightSearchText(resultDescription(result, debouncedQuery), debouncedQuery)}</CardDescription>
                <CardAction className="flex items-center gap-2">
                  <Badge variant="outline">{resultTypeLabels[normalizeSearchType(result.type)]}</Badge>
                  <Badge variant="secondary">相关度 {Number(result.matchScore ?? 0)}</Badge>
                </CardAction>
              </CardHeader>
              {(metadata.length > 0 || date || result.status || result.messageRole || result.matchField) ? (
                <CardContent className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {metadata.map((item) => <Badge key={item} variant="outline">{item.slice(0, 500)}</Badge>)}
                  {result.status ? <Badge variant="secondary">状态 {result.status}</Badge> : null}
                  {result.messageRole ? <Badge variant="secondary">角色 {result.messageRole}</Badge> : null}
                  {result.matchField ? <Badge variant="outline">匹配字段 {result.matchField}</Badge> : null}
                  {date ? <span className="inline-flex items-center gap-1"><ClockIcon className="size-3" />{date}</span> : null}
                </CardContent>
              ) : null}
            </Card>
          );
          return href ? (
            <a className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href={href} key={key}>{card}</a>
          ) : <div key={key}>{card}</div>;
        })}
      </div>

      {!loading && debouncedQuery && (!isShortQuery || forceSearch) && !error && results.length === 0 ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>没有匹配结果</CardTitle>
            <CardDescription>尝试更换关键词或切回“全部”结果类型。</CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}
