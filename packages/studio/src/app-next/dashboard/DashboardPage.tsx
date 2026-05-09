import { useState } from "react";
import { useApi, postApi, fetchJson } from "../../hooks/use-api";
import { EmptyState, InlineError } from "../components/feedback";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { SimpleSelect } from "../../components/ui/simple-select";
import { QuestionnaireWizard, type QuestionnaireTemplateView } from "../../components/Bible/QuestionnaireWizard";

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

interface CreateBookForm {
  title: string;
  genre: string;
  platform: string;
  chapterWordCount: number;
  targetChapters: number;
  language: string;
  repositorySource: "new" | "existing" | "none";
  repositoryPath: string;
  workflowMode: "outline-first" | "draft-first" | "serial-ops";
}

interface CreateBookResponse {
  readonly status: string;
  readonly bookId: string;
}

/** Tier 1 建书问卷模板（内置） */
const TIER1_QUESTIONNAIRE_TEMPLATE: QuestionnaireTemplateView = {
  id: "tier1-book-setup",
  tier: 1,
  targetObject: "book",
  questions: [
    { id: "premise", prompt: "这本书的核心前提是什么？（一句话概括故事）", type: "text", mapping: { fieldPath: "premise" }, defaultSkippable: true },
    { id: "conflict", prompt: "主要矛盾是什么？", type: "text", mapping: { fieldPath: "conflict" }, defaultSkippable: true },
    { id: "protagonist", prompt: "主角是谁？有什么核心特质？", type: "text", mapping: { fieldPath: "protagonist" }, defaultSkippable: true },
    { id: "world", prompt: "故事发生在什么样的世界？", type: "text", mapping: { fieldPath: "worldModel" }, defaultSkippable: true },
    { id: "tone", prompt: "整体基调是什么？", type: "single", options: ["热血爽文", "轻松日常", "沉重黑暗", "悬疑烧脑", "温馨治愈", "其他"], mapping: { fieldPath: "tone" }, defaultSkippable: true },
  ],
};

const INITIAL_FORM: CreateBookForm = {
  title: "",
  genre: "xuanhuan",
  platform: "qidian",
  chapterWordCount: 3000,
  targetChapters: 200,
  language: "zh",
  repositorySource: "none",
  repositoryPath: "",
  workflowMode: "outline-first",
};

interface DashboardPageProps {
  readonly onOpenBook?: (bookId: string) => void;
  readonly onCreateBook?: () => void;
}

const STATUS_DOT: Record<string, string> = {
  active: "bg-green-500",
  paused: "bg-yellow-500",
  outlining: "bg-blue-500",
  completed: "bg-gray-400",
};

const STATUS_LABEL: Record<string, string> = {
  active: "连载中",
  paused: "已暂停",
  outlining: "大纲中",
  completed: "已完结",
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

export function DashboardPage({ onOpenBook }: DashboardPageProps) {
  const { data: booksData, loading: booksLoading, error: booksError, refetch: refetchBooks } = useApi<{ books: BookItem[] }>("/books");
  const { data: statsData } = useApi<DailyStats>("/daily-stats");

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState<CreateBookForm>(INITIAL_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [questionnaireBookId, setQuestionnaireBookId] = useState<string | null>(null);

  const books = booksData?.books ?? [];

  const handleToggle = () => {
    setShowCreateForm((v) => !v);
    setCreateError(null);
  };

  const handleChange = (field: keyof CreateBookForm, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const projectInit = form.repositorySource !== "none" ? {
        repositorySource: form.repositorySource,
        workflowMode: form.workflowMode,
        ...(form.repositorySource === "existing" && form.repositoryPath.trim() ? { repositoryPath: form.repositoryPath.trim() } : {}),
      } : undefined;

      const result = await postApi<CreateBookResponse>("/books/create", {
        title: form.title.trim(),
        genre: form.genre,
        platform: form.platform,
        chapterWordCount: form.chapterWordCount,
        targetChapters: form.targetChapters,
        language: form.language,
        ...(projectInit ? { projectInit } : {}),
      });
      setShowCreateForm(false);
      setForm(INITIAL_FORM);
      setQuestionnaireBookId(result.bookId);
      void refetchBooks();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">仪表盘</h2>
        <div className="flex gap-2">
          <Button
            variant={showImport ? "default" : "outline"}
            onClick={() => { setShowImport(!showImport); setShowCreateForm(false); }}
            type="button"
          >
            {showImport ? "取消导入" : "导入"}
          </Button>
          <Button
            variant={showCreateForm ? "secondary" : "default"}
            onClick={handleToggle}
            type="button"
          >
            {showCreateForm ? "取消" : "+ 创建新书"}
          </Button>
        </div>
      </div>

      {showCreateForm && (
        <form onSubmit={handleSubmit} className="rounded-lg border border-border p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 space-y-1">
              <span className="text-xs text-muted-foreground">书名</span>
              <Input
                value={form.title}
                onChange={(e) => handleChange("title", e.target.value)}
                placeholder="输入书名"
                required
                autoFocus
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">题材</span>
              <SimpleSelect
                value={form.genre}
                onValueChange={(v) => handleChange("genre", v)}
                options={[
                  { value: "xuanhuan", label: "玄幻" },
                  { value: "xianxia", label: "仙侠" },
                  { value: "dushi", label: "都市" },
                  { value: "scifi", label: "科幻" },
                  { value: "other", label: "其他" },
                ]}
                className="w-full"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">平台</span>
              <SimpleSelect
                value={form.platform}
                onValueChange={(v) => handleChange("platform", v)}
                options={[
                  { value: "qidian", label: "起点" },
                  { value: "tomato", label: "番茄" },
                  { value: "feilu", label: "飞卢" },
                  { value: "other", label: "其他" },
                ]}
                className="w-full"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">每章字数</span>
              <Input
                type="number"
                value={form.chapterWordCount}
                onChange={(e) => handleChange("chapterWordCount", Number(e.target.value))}
                min={500}
                max={10000}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">目标章节数</span>
              <Input
                type="number"
                value={form.targetChapters}
                onChange={(e) => handleChange("targetChapters", Number(e.target.value))}
                min={1}
                max={5000}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">语言</span>
              <SimpleSelect
                value={form.language}
                onValueChange={(v) => handleChange("language", v)}
                options={[
                  { value: "zh", label: "中文" },
                  { value: "en", label: "English" },
                ]}
                className="w-full"
              />
            </label>
          </div>

          {/* Git 仓库绑定 */}
          <div className="space-y-2 rounded-md border border-border/50 p-3">
            <span className="text-xs font-medium text-muted-foreground">项目仓库（可选）</span>
            <div className="flex gap-2">
              {(["none", "new", "existing"] as const).map((source) => (
                <button
                  key={source}
                  type="button"
                  className={`rounded-md px-3 py-1.5 text-xs transition ${form.repositorySource === source ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                  onClick={() => setForm((prev) => ({ ...prev, repositorySource: source }))}
                >
                  {source === "none" ? "不绑定" : source === "new" ? "新建仓库" : "已有仓库"}
                </button>
              ))}
            </div>
            {form.repositorySource === "existing" && (
              <Input
                value={form.repositoryPath}
                onChange={(e) => setForm((prev) => ({ ...prev, repositoryPath: e.target.value }))}
                placeholder="本地仓库路径，如 D:\novels\my-book"
                className="text-xs"
              />
            )}
            {form.repositorySource !== "none" && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>写作模式：</span>
                <SimpleSelect
                  value={form.workflowMode}
                  onValueChange={(v) => setForm((prev) => ({ ...prev, workflowMode: v as CreateBookForm["workflowMode"] }))}
                  options={[
                    { value: "outline-first", label: "先大纲后写作" },
                    { value: "draft-first", label: "先写作后整理" },
                    { value: "serial-ops", label: "连载运营" },
                  ]}
                  className="flex-1"
                />
              </label>
            )}
          </div>

          {createError && <InlineError message={createError} />}
          <Button
            type="submit"
            disabled={creating || !form.title.trim()}
          >
            {creating ? "创建中…" : "创建"}
          </Button>
        </form>
      )}

      {showImport && <ImportPanel books={books} onDone={() => { setShowImport(false); void refetchBooks(); }} />}

      {/* Tier 1 问卷（建书成功后可选） */}
      {questionnaireBookId && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">快速设定你的故事（可选）</h3>
            <Button variant="ghost" size="xs" onClick={() => setQuestionnaireBookId(null)}>跳过</Button>
          </div>
          <p className="text-xs text-muted-foreground">回答几个简单问题，帮助 AI 更好地理解你的创作意图。答案会写入故事经纬。</p>
          <QuestionnaireWizard
            bookId={questionnaireBookId}
            template={TIER1_QUESTIONNAIRE_TEMPLATE}
            onDone={() => { setQuestionnaireBookId(null); void refetchBooks(); }}
          />
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">作品总数</div>
          <div className="mt-1 text-xl font-semibold">{books.length}</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">今日字数</div>
          <div className="mt-1 text-xl font-semibold">{statsData?.todayWords ?? 0}</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">今日章节</div>
          <div className="mt-1 text-xl font-semibold">{statsData?.todayChapters ?? 0}</div>
        </div>
      </div>

      {booksError && <InlineError message={booksError} onRetry={refetchBooks} />}

      {booksLoading && <p className="text-sm text-muted-foreground">加载中…</p>}

      {!booksLoading && !booksError && books.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-6 space-y-4">
          <EmptyState
            title="还没有作品，创建第一本书开始写作"
            actionLabel="创建新书"
            onAction={handleToggle}
          />
          <div className="grid gap-3 sm:grid-cols-3 pt-2">
            <div className="rounded-lg bg-muted/30 p-3 space-y-1">
              <p className="text-xs font-medium">1. 创建作品</p>
              <p className="text-[10px] text-muted-foreground">选择题材、平台和目标字数，AI 会根据这些信息辅助创作</p>
            </div>
            <div className="rounded-lg bg-muted/30 p-3 space-y-1">
              <p className="text-xs font-medium">2. 回答问卷（可选）</p>
              <p className="text-[10px] text-muted-foreground">简单描述前提、矛盾和主角，帮助 AI 理解你的故事</p>
            </div>
            <div className="rounded-lg bg-muted/30 p-3 space-y-1">
              <p className="text-xs font-medium">3. 开始写作</p>
              <p className="text-[10px] text-muted-foreground">手动写作或让 AI 生成候选稿，你来审阅和决定</p>
            </div>
          </div>
        </div>
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
    <div className="rounded-lg border border-border p-3 space-y-2 hover:border-primary/40 hover:bg-muted/30 transition">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          className="min-w-0 truncate text-sm font-medium hover:underline text-left"
          onClick={() => onOpen?.(book.id)}
        >
          {book.title}
        </Button>
        <span className="flex shrink-0 items-center gap-1">
          <span className={`h-2 w-2 rounded-full ${statusDot}`} />
          <span className="text-[10px] text-muted-foreground">{STATUS_LABEL[book.status ?? ""] ?? "未知"}</span>
        </span>
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

function ImportPanel({ books, onDone }: { readonly books: ReadonlyArray<BookItem>; readonly onDone: () => void }) {
  const [bookId, setBookId] = useState(books[0]?.id ?? "");
  const [text, setText] = useState("");
  const [splitRegex, setSplitRegex] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleImportChapters = async () => {
    if (!text.trim() || !bookId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson<{ importedCount?: number }>(`/books/${bookId}/import/chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, splitRegex: splitRegex || undefined }),
      });
      setStatus(`已导入 ${res.importedCount ?? 0} 章`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">导入到</span>
        <SimpleSelect
          value={bookId}
          onValueChange={(v) => setBookId(v)}
          options={books.length > 0 ? books.map((b) => ({ value: b.id, label: b.title })) : [{ value: "", label: "无可用书籍" }]}
        />
        <div className="flex gap-1">
          <span data-visual-audit="activeTab" className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground">章节文本</span>
        </div>
      </div>

      <>
        <Textarea className="w-full" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="粘贴章节文本，系统会自动按章节标题分割…" />
        <Input value={splitRegex} onChange={(e) => setSplitRegex(e.target.value)} placeholder="自定义分割正则（可选）" />
        <Button data-visual-audit="disabledAction" disabled={loading || !text.trim() || !bookId} onClick={() => void handleImportChapters()} type="button">
          {loading ? "导入中…" : "导入章节"}
        </Button>
      </>

      {error && <InlineError message={error} />}
      {status && <p className="text-sm text-green-600">{status}</p>}
    </div>
  );
}
