import { BookOpen, FileText, AlertTriangle, CheckCircle, Target, TrendingUp, Bookmark, PenLine, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useApi } from "@/hooks/use-api";
import { AiTasteScoreBadge } from "./AiTasteReport";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";
import { NewBookGuide } from "./NewBookGuide";
import { BookHealthSummary } from "./BookHealthSummary";
import { DailyProgressCard } from "./DailyProgressCard";

export interface CockpitBookData {
  id: string;
  title: string;
  status: string;
  genre: string;
  totalWords: number;
  chapterCount: number;
  targetChapters: number;
  lastChapterNumber: number;
  approvedChapters: number;
  pendingReview: number;
  failedReview: number;
  nextChapter: number;
}

export interface CockpitOverviewProps {
  book: CockpitBookData | null;
  bookId?: string;
  nodes: readonly WorkbenchResourceNode[];
  onOpenChapter?: (chapterNumber: number) => void;
  onGuideComplete?: () => void;
}

function extractBookData(nodes: readonly WorkbenchResourceNode[]): CockpitBookData | null {
  const bookNode = nodes.find((n) => n.kind === "book");
  if (!bookNode?.metadata) return null;
  const book = bookNode.metadata.book as Record<string, unknown> | undefined;
  if (!book) return null;
  return {
    id: String(book.id ?? ""),
    title: String(book.title ?? ""),
    status: String(book.status ?? "unknown"),
    genre: String(book.genre ?? ""),
    totalWords: Number(book.totalWords ?? 0),
    chapterCount: Number(book.chapterCount ?? book.chapters ?? 0),
    targetChapters: Number(book.targetChapters ?? 0),
    lastChapterNumber: Number(book.lastChapterNumber ?? 0),
    approvedChapters: Number(book.approvedChapters ?? 0),
    pendingReview: Number(book.pendingReview ?? book.pendingReviewChapters ?? 0),
    failedReview: Number(book.failedReview ?? book.failedChapters ?? 0),
    nextChapter: Number(bookNode.metadata.nextChapter ?? 0),
  };
}

function formatWordCount(count: number): string {
  if (count >= 10000) return `${(count / 10000).toFixed(1)} 万字`;
  return `${count} 字`;
}

function progressPercent(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

const statusLabels: Record<string, string> = {
  outlining: "大纲阶段",
  writing: "写作中",
  revising: "修订中",
  completed: "已完成",
  paused: "已暂停",
};

const genreLabels: Record<string, string> = {
  xuanhuan: "玄幻",
  xianxia: "仙侠",
  dushi: "都市",
  scifi: "科幻",
  other: "其他",
};

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-3">
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export function CockpitOverview({ book: bookProp, bookId, nodes, onOpenChapter, onGuideComplete }: CockpitOverviewProps) {
  const book = bookProp ?? extractBookData(nodes);

  // 检测是否为新书（无章节、无字数）→ 显示引导式创作向导
  // 注意：建书时会自动创建空经纬栏目，所以不能用 hasJingwei 判断
  // 引导完成后记录到 localStorage，下次不再显示
  const guideCompletedKey = bookId ? `novelfork:guide-completed:${bookId}` : null;
  const guideAlreadyDone = guideCompletedKey ? localStorage.getItem(guideCompletedKey) === "true" : false;
  const isNewBook = !guideAlreadyDone && (!book || (book.chapterCount === 0 && book.totalWords === 0));

  if (isNewBook && bookId) {
    const title = book?.title ?? "未命名作品";
    return (
      <NewBookGuide
        bookId={bookId}
        bookTitle={title}
        onComplete={() => {
          if (guideCompletedKey) localStorage.setItem(guideCompletedKey, "true");
          onGuideComplete?.();
        }}
      />
    );
  }

  if (!book) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">暂无作品数据</p>
      </div>
    );
  }

// ---------------------------------------------------------------------------
// JingweiSummary — 经纬资料摘要
// ---------------------------------------------------------------------------

function JingweiSummary({ nodes }: { nodes: readonly WorkbenchResourceNode[] }) {
  const bookNode = nodes.find((n) => n.kind === "book");
  const jingweiGroup = bookNode?.children?.find((c) => c.id === "group:jingwei");
  const entries = jingweiGroup?.children ?? [];

  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <Bookmark className="size-3.5" />
        经纬资料 · {entries.length} 条
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {entries.slice(0, 12).map((entry) => (
          <span key={entry.id} className="text-[11px] rounded-md bg-muted px-2 py-0.5">{entry.title}</span>
        ))}
        {entries.length > 12 && <span className="text-[11px] text-muted-foreground">+{entries.length - 12} 更多</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AiTasteOverview — AI 味均值摘要
// ---------------------------------------------------------------------------

function AiTasteOverview({ bookId }: { bookId: string }) {
  const { data } = useApi<{ overall: { avgScore: number; totalChapters: number } }>(
    `/api/books/${bookId}/filter/report`
  );

  if (!data || data.overall.totalChapters === 0) return null;

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <ShieldAlert className="size-3.5" />
        AI 味检测
      </h3>
      <div className="flex items-center gap-3">
        <AiTasteScoreBadge score={data.overall.avgScore} />
        <span className="text-xs text-muted-foreground">
          {data.overall.totalChapters} 章已扫描
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CandidateSummary — 候选稿摘要
// ---------------------------------------------------------------------------

function CandidateSummary({ nodes }: { nodes: readonly WorkbenchResourceNode[] }) {
  const bookNode = nodes.find((n) => n.kind === "book");
  const candidateGroup = bookNode?.children?.find((c) => c.id === "group:candidates");
  const candidates = candidateGroup?.children ?? [];

  if (candidates.length === 0) return null;

  const pending = candidates.filter((c) => c.metadata?.status === "candidate");
  const accepted = candidates.filter((c) => c.metadata?.status === "accepted");

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <PenLine className="size-3.5" />
        候选稿 · {candidates.length} 篇
      </h3>
      <div className="flex items-center gap-3 text-xs">
        {pending.length > 0 && <span className="text-blue-600">{pending.length} 待处理</span>}
        {accepted.length > 0 && <span className="text-green-600">{accepted.length} 已接受</span>}
        {candidates.length - pending.length - accepted.length > 0 && (
          <span className="text-muted-foreground">{candidates.length - pending.length - accepted.length} 其他</span>
        )}
      </div>
    </div>
  );
}


  const progress = progressPercent(book.chapterCount, book.targetChapters);
  const hasRisk = book.failedReview > 0 || book.pendingReview > 2;

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full" data-testid="cockpit-overview">
      {/* 标题区 */}
      <div className="flex items-center gap-3">
        <BookOpen className="size-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold">{book.title}</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="secondary" className="text-[10px]">{statusLabels[book.status] ?? book.status}</Badge>
            <Badge variant="outline" className="text-[10px]">{genreLabels[book.genre] ?? book.genre}</Badge>
          </div>
        </div>
      </div>

      {/* 进度条 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>章节进度</span>
          <span>{book.chapterCount} / {book.targetChapters} 章 ({progress}%)</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={<TrendingUp className="size-4 text-blue-500" />}
          label="总字数"
          value={formatWordCount(book.totalWords)}
          sub={book.chapterCount > 0 ? `均 ${formatWordCount(Math.round(book.totalWords / book.chapterCount))}/章` : undefined}
        />
        <StatCard
          icon={<Target className="size-4 text-green-500" />}
          label="下一章"
          value={`第 ${book.nextChapter} 章`}
          sub={onOpenChapter ? "点击开始写作" : undefined}
        />
        <StatCard
          icon={<CheckCircle className="size-4 text-emerald-500" />}
          label="已通过审校"
          value={`${book.approvedChapters} 章`}
          sub={book.pendingReview > 0 ? `${book.pendingReview} 章待审` : "全部通过"}
        />
        <StatCard
          icon={<AlertTriangle className={`size-4 ${hasRisk ? "text-red-500" : "text-muted-foreground"}`} />}
          label="风险"
          value={hasRisk ? `${book.failedReview} 章未通过` : "无风险"}
          sub={hasRisk ? "建议尽快修复" : "状态良好"}
        />
      </div>

      {/* 日更进度 */}
      <DailyProgressCard />

      {/* 书籍健康度 */}
      {book.id && <BookHealthSummary bookId={book.id} />}

      {/* 焦点建议 */}
      <div className="rounded-lg border border-border p-3 space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <FileText className="size-3.5" />
          下一步建议
        </h3>
        <ul className="text-sm space-y-1.5">
          {book.failedReview > 0 && (
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-red-500 shrink-0" />
              <span>有 {book.failedReview} 章审校未通过，建议优先修复</span>
            </li>
          )}
          {book.pendingReview > 0 && (
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-yellow-500 shrink-0" />
              <span>{book.pendingReview} 章等待审校</span>
            </li>
          )}
          {book.chapterCount < book.targetChapters && (
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-blue-500 shrink-0" />
              <span>继续写作第 {book.nextChapter} 章</span>
            </li>
          )}
          {book.chapterCount >= book.targetChapters && book.failedReview === 0 && (
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-green-500 shrink-0" />
              <span>所有章节已完成，可以进入最终审校</span>
            </li>
          )}
        </ul>
      </div>

      {/* 经纬资料摘要 */}
      <JingweiSummary nodes={nodes} />

      {/* 候选稿摘要 */}
      <CandidateSummary nodes={nodes} />

      {/* AI 味检测摘要 */}
      {book.id && <AiTasteOverview bookId={book.id} />}
    </div>
  );
}
