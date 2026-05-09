import { useState } from "react";
import { BookOpen, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface LearningDocEntry {
  id: string;
  title: string;
  summary: string;
  tags: string[];
}

const LEARNING_DOCS: LearningDocEntry[] = [
  { id: "00-overview", title: "一页理解 NovelFork", summary: "核心心智模型、三栏布局、推荐使用流程", tags: ["入门", "概览"] },
  { id: "01-book-management", title: "作品与章节管理", summary: "创建作品、资源树、章节 CRUD、驾驶舱、导入导出", tags: ["作品", "章节", "管理"] },
  { id: "02-ai-writing", title: "AI 写作功能", summary: "写作模式、AI 动作、选区变换、候选稿流程", tags: ["AI", "写作", "候选稿"] },
  { id: "03-guided-generation", title: "引导式生成", summary: "PGI 追问、Guided Plan、问卷引导", tags: ["PGI", "引导", "生成"] },
  { id: "04-narrator-conversation", title: "叙述者对话", summary: "会话界面、模型切换、权限、Slash 命令、确认门", tags: ["对话", "叙述者", "会话"] },
  { id: "05-story-jingwei", title: "故事经纬", summary: "分区/条目、可见性规则、模板、AI 上下文参与", tags: ["经纬", "设定", "世界观"] },
  { id: "06-settings-and-routines", title: "设置与套路", summary: "供应商配置、套路系统、继承机制", tags: ["设置", "套路", "配置"] },
  { id: "07-writing-tools", title: "写作工具", summary: "钩子、节奏、对话比例、健康、矛盾、弧线、文风", tags: ["工具", "分析", "检测"] },
  { id: "08-agent-pipeline", title: "Agent 写作管线", summary: "PipelineRunner、Agent 角色、工具链、编排", tags: ["Agent", "管线", "编排"] },
];

export function LearnPage() {
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = searchQuery
    ? LEARNING_DOCS.filter((doc) =>
        doc.title.includes(searchQuery) ||
        doc.summary.includes(searchQuery) ||
        doc.tags.some((tag) => tag.includes(searchQuery))
      )
    : LEARNING_DOCS;

  if (selectedDoc) {
    const doc = LEARNING_DOCS.find((d) => d.id === selectedDoc);
    return (
      <div className="h-full flex flex-col min-h-0">
        <header className="shrink-0 border-b border-border px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="xs" onClick={() => setSelectedDoc(null)}>← 返回</Button>
          <h1 className="text-sm font-semibold">{doc?.title ?? selectedDoc}</h1>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <LearningDocContent docId={selectedDoc} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BookOpen className="size-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">学习中心</h1>
          <p className="text-sm text-muted-foreground">了解 NovelFork 的功能和最佳实践</p>
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="搜索文档..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full max-w-sm rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
      />

      {/* Doc list */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((doc) => (
          <button
            key={doc.id}
            type="button"
            onClick={() => setSelectedDoc(doc.id)}
            className="flex flex-col items-start gap-2 rounded-lg border border-border p-4 text-left hover:bg-muted/50 hover:border-primary/30 transition-colors"
          >
            <div className="flex items-center justify-between w-full">
              <h3 className="text-sm font-semibold">{doc.title}</h3>
              <ChevronRight className="size-4 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">{doc.summary}</p>
            <div className="flex flex-wrap gap-1">
              {doc.tags.map((tag) => (
                <span key={tag} className="text-[10px] rounded bg-muted px-1.5 py-0.5">{tag}</span>
              ))}
            </div>
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">没有匹配的文档</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LearningDocContent — 文档内容展示（从 API 加载或内联）
// ---------------------------------------------------------------------------

function LearningDocContent({ docId }: { docId: string }) {
  const doc = LEARNING_DOCS.find((d) => d.id === docId);
  if (!doc) return <p className="text-sm text-muted-foreground">文档不存在</p>;

  // 内联展示文档摘要和入口指引（完整 Markdown 渲染可后续接入）
  return (
    <article className="prose prose-sm dark:prose-invert max-w-none">
      <h1>{doc.title}</h1>
      <p className="lead">{doc.summary}</p>
      <div className="rounded-lg border border-border bg-muted/30 p-4 not-prose">
        <p className="text-sm text-muted-foreground">
          完整文档位于 <code className="text-xs bg-muted px-1 rounded">docs/learning/{docId}.md</code>
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          后续版本将支持在此直接渲染 Markdown 内容。当前可在编辑器中打开对应文件查看完整内容。
        </p>
      </div>
      <h2>相关标签</h2>
      <div className="flex flex-wrap gap-2 not-prose">
        {doc.tags.map((tag) => (
          <span key={tag} className="text-xs rounded-md border border-border px-2 py-1">{tag}</span>
        ))}
      </div>
    </article>
  );
}
