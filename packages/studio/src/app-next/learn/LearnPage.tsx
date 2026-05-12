import { useState, useEffect } from "react";
import { BookOpen, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
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

// ── Fallback catalog (used when API unavailable) ──

const FALLBACK_CATEGORIES: CategoryGroup[] = [
  {
    category: "从这里开始",
    docs: [
      { id: "00-overview", title: "一页理解 NovelFork", summary: "核心心智模型、三栏布局、推荐使用流程", tags: ["入门", "概览"] },
      { id: "01-book-management", title: "作品与章节管理", summary: "创建作品、资源树、章节 CRUD、驾驶舱、导入导出", tags: ["作品", "章节"] },
    ],
  },
  {
    category: "AI 写作",
    docs: [
      { id: "02-ai-writing", title: "AI 写作功能", summary: "写作模式、AI 动作、选区变换、候选稿流程", tags: ["AI", "写作"] },
      { id: "03-guided-generation", title: "引导式生成", summary: "PGI 追问、Guided Plan、问卷引导", tags: ["PGI", "引导"] },
      { id: "04-narrator-conversation", title: "叙述者对话", summary: "会话界面、模型切换、权限、Slash 命令", tags: ["对话", "叙述者"] },
      { id: "08-agent-pipeline", title: "Agent 写作管线", summary: "PipelineRunner、Agent 角色、工具链、编排", tags: ["Agent", "管线"] },
    ],
  },
  {
    category: "工具与分析",
    docs: [
      { id: "05-story-jingwei", title: "故事经纬", summary: "分区/条目、可见性规则、模板、AI 上下文参与", tags: ["经纬", "设定"] },
      { id: "07-writing-tools", title: "写作工具", summary: "钩子、节奏、对话比例、健康、矛盾、弧线、文风", tags: ["工具", "分析"] },
    ],
  },
  {
    category: "设置与配置",
    docs: [
      { id: "06-settings-and-routines", title: "设置与套路", summary: "供应商配置、套路系统、继承机制", tags: ["设置", "套路"] },
      { id: "09-agent-settings", title: "AI 代理配置", summary: "权限模式、上下文窗口管理、重试策略、白黑名单", tags: ["AI代理", "权限"] },
      { id: "10-proxy-settings", title: "代理管理与网络配置", summary: "HTTP/SOCKS 代理配置、按供应商独立代理", tags: ["代理", "网络"] },
      { id: "11-usage-history", title: "使用历史与成本监控", summary: "请求趋势图、筛选器、Token 用量分析", tags: ["使用历史", "Token"] },
      { id: "12-appearance", title: "外观与个性化", summary: "主题模式、OLED纯黑、终端配置、字体", tags: ["外观", "主题"] },
    ],
  },
];

// ── Main Component ──

export function LearnPage() {
  const [categories, setCategories] = useState<CategoryGroup[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [docContent, setDocContent] = useState<DocContent | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LearningDocEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [docLoading, setDocLoading] = useState(false);

  // Load catalog
  useEffect(() => {
    const timeout = setTimeout(() => {
      setCategories(FALLBACK_CATEGORIES);
      setLoading(false);
    }, 3000);

    fetchJson<{ categories: CategoryGroup[] }>("/learn/docs")
      .then((data) => {
        clearTimeout(timeout);
        setCategories(data.categories);
      })
      .catch(() => {
        clearTimeout(timeout);
        setCategories(FALLBACK_CATEGORIES);
      })
      .finally(() => setLoading(false));

    return () => clearTimeout(timeout);
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

  // Search
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    const timer = setTimeout(() => {
      fetchJson<{ results: LearningDocEntry[] }>(`/learn/search?q=${encodeURIComponent(searchQuery)}`)
        .then((data) => setSearchResults(data.results))
        .catch(() => setSearchResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  if (loading) {
    return <div className="flex items-center justify-center h-full text-sm text-muted-foreground">加载学习中心...</div>;
  }

  return (
    <div className="h-full flex min-h-0">
      {/* 左侧文档树 */}
      <aside className="w-64 shrink-0 border-r border-border overflow-y-auto p-3 space-y-4">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="size-4 text-primary" />
          <span className="text-sm font-semibold">学习中心</span>
        </div>

        {/* 搜索 */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="搜索文档..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-7 text-xs h-7"
          />
        </div>

        {/* 搜索结果 */}
        {searchResults !== null ? (
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground px-2">搜索结果 ({searchResults.length})</p>
            {searchResults.map((doc) => (
              <DocTreeItem
                key={doc.id}
                doc={doc}
                active={selectedDocId === doc.id}
                onClick={() => setSelectedDocId(doc.id)}
              />
            ))}
            {searchResults.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-4 text-center">没有匹配的文档</p>
            )}
          </div>
        ) : (
          /* 分类文档树 */
          <div className="space-y-3">
            {categories.map((group) => (
              <div key={group.category}>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">
                  {group.category}
                  <span className="ml-1 text-muted-foreground/60">{group.docs.length}</span>
                </p>
                <div className="space-y-0.5 ml-2 pl-2 border-l border-dashed border-border">
                  {group.docs.map((doc) => (
                    <DocTreeItem
                      key={doc.id}
                      doc={doc}
                      active={selectedDocId === doc.id}
                      onClick={() => setSelectedDocId(doc.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* 右侧内容区 */}
      <main className="flex-1 overflow-y-auto p-6">
        {!selectedDocId ? (
          <WelcomeView categories={categories} onSelect={setSelectedDocId} />
        ) : docLoading ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">加载文档...</div>
        ) : docContent ? (
          <DocContentView doc={docContent} onBack={() => setSelectedDocId(null)} />
        ) : (
          <div className="text-sm text-muted-foreground">文档加载失败</div>
        )}
      </main>
    </div>
  );
}

// ── Sub Components ──

function DocTreeItem({ doc, active, onClick }: { doc: LearningDocEntry; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors ${
        active
          ? "bg-primary/10 text-primary border-l-2 border-primary -ml-[2px]"
          : "text-foreground hover:bg-muted"
      }`}
    >
      <span className="line-clamp-1">{doc.title}</span>
    </button>
  );
}

function WelcomeView({ categories, onSelect }: { categories: CategoryGroup[]; onSelect: (id: string) => void }) {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-2">学习中心</h1>
        <p className="text-sm text-muted-foreground">了解 NovelFork 的功能和最佳实践。选择左侧文档开始阅读。</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {categories.map((group) => (
          <div key={group.category} className="rounded-lg border border-border p-4 space-y-2">
            <h3 className="text-sm font-semibold">{group.category}</h3>
            <div className="space-y-1">
              {group.docs.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => onSelect(doc.id)}
                  className="w-full flex items-center justify-between text-left px-2 py-1.5 rounded hover:bg-muted text-xs group"
                >
                  <span className="text-foreground">{doc.title}</span>
                  <ChevronRight className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DocContentView({ doc, onBack }: { doc: DocContent; onBack: () => void }) {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="xs" onClick={onBack}>← 返回</Button>
        <span className="text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{doc.category}</span>
      </div>

      {/* Title */}
      <div>
        <h1 className="text-xl font-semibold mb-2">{doc.title}</h1>
        <p className="text-sm text-muted-foreground">{doc.summary}</p>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1">
        {doc.tags.map((tag) => (
          <span key={tag} className="text-[10px] rounded-md border border-border px-2 py-0.5">{tag}</span>
        ))}
      </div>

      {/* Content */}
      <article className="prose prose-sm dark:prose-invert max-w-none">
        <MarkdownContent content={doc.content} />
      </article>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  // 简单的 Markdown 渲染（标题、段落、列表、代码块）
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (line.startsWith("```")) {
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

    // 标题
    if (line.startsWith("# ")) {
      elements.push(<h1 key={`h1-${i}`} className="text-2xl font-bold mt-6 mb-3">{line.slice(2)}</h1>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={`h2-${i}`} className="text-lg font-semibold mt-5 mb-2">{line.slice(3)}</h2>);
    } else if (line.startsWith("### ")) {
      elements.push(<h3 key={`h3-${i}`} className="text-base font-semibold mt-4 mb-2">{line.slice(4)}</h3>);
    }
    // 列表
    else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(<li key={`li-${i}`} className="text-sm text-foreground ml-4 list-disc">{line.slice(2)}</li>);
    }
    // 引用
    else if (line.startsWith("> ")) {
      elements.push(
        <blockquote key={`bq-${i}`} className="border-l-2 border-primary/30 pl-3 text-sm text-muted-foreground italic">
          {line.slice(2)}
        </blockquote>
      );
    }
    // 空行
    else if (line.trim() === "") {
      // skip
    }
    // 普通段落
    else {
      elements.push(<p key={`p-${i}`} className="text-sm text-foreground leading-relaxed">{line}</p>);
    }

    i++;
  }

  return <>{elements}</>;
}
