import { useState, useEffect, useCallback, useRef } from "react";
import { BookOpen, Search, ChevronDown, ChevronRight, Sparkles, Settings, Wrench, Rocket, GraduationCap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fetchJson } from "@/hooks/use-api";

// ── Types ──

interface LearningDocEntry {
  id: string;
  title: string;
  summary: string;
  tags: string[];
}

interface CategoryGroup {
  category: string;
  docs: LearningDocEntry[];
}

interface DocContent {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  category: string;
  content: string;
}

// ── Category Icons ──

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  "从这里开始": <Rocket className="size-3.5" />,
  "AI 写作": <Sparkles className="size-3.5" />,
  "工具与分析": <Wrench className="size-3.5" />,
  "设置与配置": <Settings className="size-3.5" />,
  "高级功能": <GraduationCap className="size-3.5" />,
};

// ── Main Component ──

export function LearnPage() {
  const [categories, setCategories] = useState<CategoryGroup[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [docContent, setDocContent] = useState<DocContent | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LearningDocEntry[] | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load catalog from API
  useEffect(() => {
    fetchJson<{ categories: CategoryGroup[] }>("/learn/docs")
      .then((data) => {
        if (data.categories?.length) setCategories(data.categories);
      })
      .catch(() => {});
  }, []);

  // Load doc content when selected
  useEffect(() => {
    if (!selectedDocId) { setDocContent(null); return; }
    setDocLoading(true);
    fetchJson<DocContent>(`/learn/doc/${selectedDocId}`)
      .then(setDocContent)
      .catch(() => setDocContent(null))
      .finally(() => setDocLoading(false));
  }, [selectedDocId]);

  // Search with debounce
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    searchTimerRef.current = setTimeout(() => {
      fetchJson<{ results: LearningDocEntry[] }>(`/learn/search?q=${encodeURIComponent(searchQuery)}`)
        .then((data) => setSearchResults(data.results))
        .catch(() => setSearchResults([]));
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  const toggleCategory = useCallback((cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-1 h-full w-full min-h-0 overflow-hidden bg-background">
      {/* 左侧文档列表 */}
      <aside className="w-[400px] shrink-0 border-r border-border overflow-y-auto bg-muted/30">
        {/* 头部 */}
        <div className="sticky top-0 z-10 bg-muted/30 backdrop-blur-sm border-b border-border/50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <BookOpen className="size-4 text-primary" />
            <span className="text-sm font-semibold">学习中心</span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {categories.reduce((sum, g) => sum + g.docs.length, 0)} 篇文档
            </span>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="搜索文档..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 text-xs h-8"
            />
          </div>
        </div>

        {/* 列表内容 */}
        <div className="p-3 space-y-1">
          {searchResults !== null ? (
            /* 搜索结果 */
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground px-2 py-1">
                搜索结果 ({searchResults.length})
              </p>
              {searchResults.map((doc) => (
                <DocCard
                  key={doc.id}
                  doc={doc}
                  active={selectedDocId === doc.id}
                  onClick={() => setSelectedDocId(doc.id)}
                />
              ))}
              {searchResults.length === 0 && (
                <p className="text-xs text-muted-foreground px-2 py-8 text-center">没有匹配的文档</p>
              )}
            </div>
          ) : (
            /* 分类列表 */
            <div className="space-y-2">
              {categories.map((group) => {
                const collapsed = collapsedCategories.has(group.category);
                return (
                  <div key={group.category}>
                    <button
                      type="button"
                      onClick={() => toggleCategory(group.category)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    >
                      {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                      {CATEGORY_ICONS[group.category]}
                      <span>{group.category}</span>
                      <span className="ml-auto text-[10px] opacity-60">{group.docs.length}</span>
                    </button>
                    {!collapsed && (
                      <div className="mt-1 space-y-0.5 ml-2">
                        {group.docs.map((doc) => (
                          <DocCard
                            key={doc.id}
                            doc={doc}
                            active={selectedDocId === doc.id}
                            onClick={() => setSelectedDocId(doc.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* 右侧内容区 */}
      <main className="flex-1 overflow-y-auto">
        {!selectedDocId ? (
          <WelcomeView categories={categories} onSelect={setSelectedDocId} />
        ) : docLoading ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">加载文档...</div>
        ) : docContent ? (
          <DocContentView doc={docContent} />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">文档加载失败</div>
        )}
      </main>
    </div>
  );
}

// ── Sub Components ──

function DocCard({ doc, active, onClick }: { doc: LearningDocEntry; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-md transition-colors ${
        active
          ? "border-l-2 border-primary bg-primary/5"
          : "hover:bg-muted/50"
      }`}
    >
      <div className="text-xs font-medium text-foreground line-clamp-1">{doc.title}</div>
      {doc.summary && (
        <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{doc.summary}</div>
      )}
      {doc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {doc.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="text-[10px] rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
              {tag}
            </span>
          ))}
          {doc.tags.length > 4 && (
            <span className="text-[10px] text-muted-foreground">+{doc.tags.length - 4}</span>
          )}
        </div>
      )}
    </button>
  );
}

function WelcomeView({ categories, onSelect }: { categories: CategoryGroup[]; onSelect: (id: string) => void }) {
  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">学习中心</h1>
        <p className="text-sm text-muted-foreground">
          了解 NovelFork 的功能和最佳实践。从左侧选择文档开始阅读，或点击下方分类快速浏览。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((group) => (
          <div key={group.category} className="rounded-lg border border-border p-4 space-y-3 hover:border-primary/30 transition-colors">
            <div className="flex items-center gap-2">
              {CATEGORY_ICONS[group.category]}
              <h3 className="text-sm font-semibold">{group.category}</h3>
            </div>
            <div className="space-y-1">
              {group.docs.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => onSelect(doc.id)}
                  className="w-full flex items-center justify-between text-left px-2 py-1.5 rounded hover:bg-muted text-xs group"
                >
                  <span className="text-foreground line-clamp-1">{doc.title}</span>
                  <ChevronRight className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DocContentView({ doc }: { doc: DocContent }) {
  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      {/* Tags */}
      {doc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {doc.tags.map((tag) => (
            <span key={tag} className="text-[10px] rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Content */}
      <article className="prose prose-sm dark:prose-invert max-w-none">
        <MarkdownContent content={doc.content} />
      </article>
    </div>
  );
}

// ── Markdown Renderer ──

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre key={`code-${i}`} className="rounded-lg bg-muted p-3 text-xs font-mono overflow-x-auto">
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // 表格（| 开头的行）
    if (line.trimStart().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(<MarkdownTable key={`table-${i}`} lines={tableLines} />);
      continue;
    }

    // 标题
    if (line.startsWith("# ")) {
      elements.push(<h1 key={`h1-${i}`} className="text-2xl font-bold mt-6 mb-3">{line.slice(2)}</h1>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={`h2-${i}`} className="text-lg font-semibold mt-5 mb-2">{line.slice(3)}</h2>);
    } else if (line.startsWith("### ")) {
      elements.push(<h3 key={`h3-${i}`} className="text-base font-semibold mt-4 mb-2">{line.slice(4)}</h3>);
    } else if (line.startsWith("#### ")) {
      elements.push(<h4 key={`h4-${i}`} className="text-sm font-semibold mt-3 mb-1">{line.slice(5)}</h4>);
    }
    // 列表
    else if (line.match(/^[-*]\s/)) {
      elements.push(<li key={`li-${i}`} className="text-sm text-foreground ml-4 list-disc">{renderInline(line.slice(2))}</li>);
    }
    // 有序列表
    else if (line.match(/^\d+\.\s/)) {
      const text = line.replace(/^\d+\.\s/, "");
      elements.push(<li key={`oli-${i}`} className="text-sm text-foreground ml-4 list-decimal">{renderInline(text)}</li>);
    }
    // 引用
    else if (line.startsWith("> ")) {
      elements.push(
        <blockquote key={`bq-${i}`} className="border-l-2 border-primary/30 pl-3 text-sm text-muted-foreground italic my-2">
          {renderInline(line.slice(2))}
        </blockquote>
      );
    }
    // 分隔线
    else if (line.match(/^---+$/)) {
      elements.push(<hr key={`hr-${i}`} className="my-4 border-border" />);
    }
    // 空行
    else if (line.trim() === "") {
      // skip
    }
    // 普通段落
    else {
      elements.push(<p key={`p-${i}`} className="text-sm text-foreground leading-relaxed my-1">{renderInline(line)}</p>);
    }

    i++;
  }

  return <>{elements}</>;
}

// ── Inline formatting ──

function renderInline(text: string): React.ReactNode {
  // 简单处理 **bold**、`code`、*italic*
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Code
    const codeMatch = remaining.match(/`([^`]+)`/);

    type MatchEntry = { index: number; length: number; node: React.ReactNode };
    const candidates: MatchEntry[] = [];

    if (boldMatch && boldMatch.index !== undefined) {
      candidates.push({ index: boldMatch.index, length: boldMatch[0].length, node: <strong key={`b-${key++}`}>{boldMatch[1]}</strong> });
    }
    if (codeMatch && codeMatch.index !== undefined) {
      candidates.push({ index: codeMatch.index, length: codeMatch[0].length, node: <code key={`c-${key++}`} className="text-[11px] bg-muted px-1 py-0.5 rounded">{codeMatch[1]}</code> });
    }

    const firstMatch = candidates.sort((a, b) => a.index - b.index)[0] ?? null;

    if (firstMatch) {
      if (firstMatch.index > 0) {
        parts.push(remaining.slice(0, firstMatch.index));
      }
      parts.push(firstMatch.node);
      remaining = remaining.slice(firstMatch.index + firstMatch.length);
    } else {
      parts.push(remaining);
      break;
    }
  }

  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <>{parts}</>;
}

// ── Table renderer ──

function MarkdownTable({ lines }: { lines: string[] }) {
  if (lines.length < 2) return null;

  const parseRow = (line: string) =>
    line.split("|").slice(1, -1).map(cell => cell.trim());

  const headers = parseRow(lines[0]);
  // Skip separator line (line[1] is usually |---|---|)
  const startIdx = lines[1]?.match(/^[\s|:-]+$/) ? 2 : 1;
  const rows = lines.slice(startIdx).map(parseRow);

  return (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-border">
            {headers.map((h, i) => (
              <th key={i} className="text-left px-3 py-2 font-semibold text-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border/50 hover:bg-muted/30">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-1.5 text-muted-foreground">{renderInline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
