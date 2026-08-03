import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Lightbulb,
  LoaderCircle,
  Search,
  Sparkles,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  filterLearningDocs,
  groupLearningDocs,
  LEARNING_LANG,
  learningClient,
  type LearningCategory,
  type LearningDoc,
  type LearningDocSummary,
  type LearningIndex,
  toStudioActionHref,
} from "./client";

export { filterLearningDocs, groupLearningDocs, toStudioActionHref } from "./client";

interface LearningLocationState {
  docId: string | null;
  query: string;
}

function readLearningLocation(): LearningLocationState {
  if (typeof window === "undefined") return { docId: null, query: "" };
  const search = new URLSearchParams(window.location.search);
  return { docId: search.get("doc"), query: search.get("q") ?? "" };
}

function writeLearningLocation(
  docId: string | null,
  query: string,
  mode: "replace" | "push" = "replace",
): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (docId) url.searchParams.set("doc", docId);
  else url.searchParams.delete("doc");
  if (query) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "push") window.history.pushState(window.history.state, "", nextUrl);
  else window.history.replaceState(window.history.state, "", nextUrl);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function LearnPage() {
  const initialLocation = useMemo(readLearningLocation, []);
  const [index, setIndex] = useState<LearningIndex | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(initialLocation.docId);
  const [searchQuery, setSearchQuery] = useState(initialLocation.query);
  const [indexLoading, setIndexLoading] = useState(true);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexRequestVersion, setIndexRequestVersion] = useState(0);
  const [docContent, setDocContent] = useState<LearningDoc | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [docRequestVersion, setDocRequestVersion] = useState(0);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<Set<string>>(() => new Set());
  const docCacheRef = useRef(new Map<string, LearningDoc>());

  useEffect(() => {
    const syncFromLocation = () => {
      const next = readLearningLocation();
      setSelectedDocId(next.docId);
      setSearchQuery(next.query);
    };
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setIndexLoading(true);
    setIndexError(null);
    learningClient.getIndex(LEARNING_LANG, controller.signal)
      .then((data) => setIndex({ categories: data.categories ?? [], docs: data.docs ?? [] }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setIndex(null);
        setIndexError(errorMessage(error, "学习目录加载失败"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIndexLoading(false);
      });
    return () => controller.abort();
  }, [indexRequestVersion]);

  const filteredDocs = useMemo(
    () => filterLearningDocs(index?.docs ?? [], searchQuery),
    [index?.docs, searchQuery],
  );
  const categoryGroups = useMemo(
    () => groupLearningDocs(index?.categories ?? [], filteredDocs),
    [filteredDocs, index?.categories],
  );
  const selectedSummary = filteredDocs.find((doc) => doc.id === selectedDocId) ?? filteredDocs[0];
  const effectiveDocId = selectedSummary?.id;

  useEffect(() => {
    if (!index || !selectedDocId || index.docs.some((doc) => doc.id === selectedDocId)) return;
    setSelectedDocId(null);
    writeLearningLocation(null, searchQuery);
  }, [index, searchQuery, selectedDocId]);

  useEffect(() => {
    if (!effectiveDocId) {
      setDocContent(null);
      setDocError(null);
      setDocLoading(false);
      return;
    }

    const cached = docCacheRef.current.get(effectiveDocId);
    if (cached && docRequestVersion === 0) {
      setDocContent(cached);
      setDocError(null);
      setDocLoading(false);
      return;
    }

    const controller = new AbortController();
    setDocContent(null);
    setDocError(null);
    setDocLoading(true);
    learningClient.getDoc(effectiveDocId, LEARNING_LANG, controller.signal)
      .then((doc) => {
        docCacheRef.current.set(effectiveDocId, doc);
        setDocContent(doc);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setDocError(errorMessage(error, "文档加载失败"));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDocLoading(false);
      });
    return () => controller.abort();
  }, [docRequestVersion, effectiveDocId]);

  const toggleCategory = useCallback((categoryId: string) => {
    setCollapsedCategoryIds((previous) => {
      const next = new Set(previous);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }, []);

  const selectDoc = useCallback((id: string) => {
    writeLearningLocation(id, searchQuery, "push");
    setSelectedDocId(id);
    setDocRequestVersion(0);
  }, [searchQuery]);

  const updateSearch = useCallback((value: string) => {
    setSearchQuery(value);
    setSelectedDocId(null);
    setDocRequestVersion(0);
    writeLearningLocation(null, value);
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden bg-background">
      <aside className="w-[min(400px,38vw)] min-w-[300px] shrink-0 overflow-y-auto border-r border-border bg-muted/30">
        <div className="sticky top-0 z-10 space-y-3 border-b border-border/60 bg-background/90 p-4 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <BookOpen className="size-4 text-primary" aria-hidden="true" />
            <h1 className="text-sm font-semibold">学习中心</h1>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {index?.docs.length ?? 0} 篇文档
            </span>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            这里汇总 NovelFork 的主要功能文档、使用流程与最佳实践。
          </p>
          <label className="relative block">
            <span className="sr-only">搜索学习文档</span>
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              placeholder="搜索功能、流程或最佳实践..."
              value={searchQuery}
              onChange={(event) => updateSearch(event.currentTarget.value)}
              className="h-8 pl-8 text-xs"
            />
          </label>
        </div>

        <nav className="space-y-2 p-3" aria-label="学习文档">
          {indexLoading ? (
            <StatusMessage icon={<LoaderCircle className="size-4 animate-spin" />} text="正在加载学习目录..." />
          ) : indexError ? (
            <ErrorState
              message={`学习目录加载失败：${indexError}`}
              onRetry={() => setIndexRequestVersion((version) => version + 1)}
            />
          ) : filteredDocs.length === 0 ? (
            <StatusMessage text={searchQuery.trim() ? "没有找到匹配的学习文档。" : "学习目录暂时为空。"} />
          ) : (
            categoryGroups.map(({ category, docs }) => {
              const hasActiveDoc = docs.some((doc) => doc.id === effectiveDocId);
              const opened = hasActiveDoc || !collapsedCategoryIds.has(category.id);
              return (
                <CategoryTree
                  key={category.id}
                  category={category}
                  docs={docs}
                  opened={opened}
                  activeDocId={effectiveDocId}
                  onToggle={() => toggleCategory(category.id)}
                  onSelectDoc={selectDoc}
                />
              );
            })
          )}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {indexLoading ? (
          <StatusMessage className="h-full" icon={<LoaderCircle className="size-5 animate-spin" />} text="加载学习目录..." />
        ) : indexError ? (
          <ErrorState
            className="h-full"
            message="无法加载 Runtime 学习目录。"
            onRetry={() => setIndexRequestVersion((version) => version + 1)}
          />
        ) : !effectiveDocId ? (
          <EmptyContent hasQuery={Boolean(searchQuery.trim())} />
        ) : docLoading ? (
          <StatusMessage className="h-full" icon={<LoaderCircle className="size-5 animate-spin" />} text="加载文档..." />
        ) : docError ? (
          <ErrorState
            className="h-full"
            message={`文档加载失败：${docError}`}
            onRetry={() => setDocRequestVersion((version) => version + 1)}
          />
        ) : docContent ? (
          <DocContentView doc={docContent} />
        ) : (
          <EmptyContent />
        )}
      </main>
    </div>
  );
}

function CategoryTree({
  category,
  docs,
  opened,
  activeDocId,
  onToggle,
  onSelectDoc,
}: {
  category: LearningCategory;
  docs: LearningDocSummary[];
  opened: boolean;
  activeDocId?: string;
  onToggle: () => void;
  onSelectDoc: (id: string) => void;
}) {
  return (
    <section>
      <button
        type="button"
        aria-expanded={opened}
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        {opened ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <FolderOpen className="size-3.5 text-primary/80" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-foreground">{category.label}</span>
          {category.description ? <span className="block truncate text-[10px] font-normal">{category.description}</span> : null}
        </span>
        <span className="text-[10px] opacity-70">{docs.length}</span>
      </button>
      {opened ? (
        <div className="ml-4 mt-1 space-y-0.5 border-l border-dashed border-border pl-2">
          {docs.map((doc) => (
            <DocCard
              key={doc.id}
              doc={doc}
              active={doc.id === activeDocId}
              onClick={() => onSelectDoc(doc.id)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DocCard({ doc, active, onClick }: { doc: LearningDocSummary; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`w-full rounded-md border-l-2 px-3 py-2.5 text-left transition-colors ${
        active ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted/60"
      }`}
    >
      <span className="block truncate text-xs font-semibold text-foreground">{doc.title}</span>
      {doc.summary ? <span className="mt-0.5 block line-clamp-2 text-[11px] text-muted-foreground">{doc.summary}</span> : null}
      {doc.tags.length ? (
        <span className="mt-1.5 flex flex-wrap gap-1">
          {doc.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground">{tag}</span>
          ))}
        </span>
      ) : null}
    </button>
  );
}

function DocContentView({ doc }: { doc: LearningDoc }) {
  return (
    <div className="mx-auto max-w-4xl space-y-7 p-8 lg:p-10">
      <header className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {doc.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">{tag}</span>
          ))}
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">{doc.title}</h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{doc.summary}</p>
      </header>

      {doc.actions.length ? (
        <section className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
          <h3 className="text-sm font-semibold">可直接跳转的功能入口</h3>
          <div className="flex flex-wrap gap-2">
            {doc.actions.map((action) => (
              <a
                key={`${action.href}:${action.label}`}
                href={toStudioActionHref(action.href)}
                title={action.description}
                className="rounded-md border border-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-muted"
              >
                {action.label} <span aria-hidden="true">→</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <div className="border-t border-border" />
      {doc.sections.map((section) => (
        <section key={section.title} className="space-y-2">
          <h3 className="text-lg font-semibold">{section.title}</h3>
          <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">{section.body}</p>
        </section>
      ))}

      <LearningList icon={<CheckCircle2 className="size-4" />} title="推荐使用流程" items={doc.workflow} ordered />
      <LearningList icon={<Lightbulb className="size-4" />} title="最佳实践" items={doc.bestPractices} />
      <LearningList icon={<AlertTriangle className="size-4" />} title="常见坑" items={doc.pitfalls} tone="warning" />
    </div>
  );
}

function LearningList({
  icon,
  title,
  items,
  ordered = false,
  tone = "default",
}: {
  icon: ReactNode;
  title: string;
  items: string[];
  ordered?: boolean;
  tone?: "default" | "warning";
}) {
  if (!items.length) return null;
  const List = ordered ? "ol" : "ul";
  return (
    <section className={`space-y-3 rounded-lg border p-4 ${tone === "warning" ? "border-amber-500/25 bg-amber-500/5" : "border-border bg-muted/20"}`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</h3>
      <List className={`space-y-2 pl-5 text-sm leading-6 ${ordered ? "list-decimal" : "list-disc"}`}>
        {items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
      </List>
    </section>
  );
}

function StatusMessage({ icon, text, className = "" }: { icon?: ReactNode; text: string; className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-2 px-4 py-10 text-center text-xs text-muted-foreground ${className}`} role="status">
      {icon}{text}
    </div>
  );
}

function ErrorState({ message, onRetry, className = "" }: { message: string; onRetry: () => void; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 px-6 py-10 text-center ${className}`} role="alert">
      <AlertTriangle className="size-5 text-destructive" aria-hidden="true" />
      <p className="text-xs text-destructive">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>重试</Button>
    </div>
  );
}

function EmptyContent({ hasQuery = false }: { hasQuery?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="rounded-full bg-muted p-3"><Sparkles className="size-5 text-muted-foreground" /></div>
      <h2 className="text-sm font-semibold">{hasQuery ? "没有匹配的学习文档" : "请选择一篇学习文档"}</h2>
      <p className="max-w-sm text-xs leading-5 text-muted-foreground">
        {hasQuery ? "尝试搜索其他功能、流程或最佳实践。" : "学习目录为空时，请确认 Runtime 已提供学习内容。"}
      </p>
    </div>
  );
}
