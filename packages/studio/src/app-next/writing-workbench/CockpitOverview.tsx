import { BookOpen, FileText, AlertTriangle, CheckCircle, Target, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

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
  nodes: readonly WorkbenchResourceNode[];
  onOpenChapter?: (chapterNumber: number) => void;
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

export function CockpitOverview({ book: bookProp, nodes, onOpenChapter }: CockpitOverviewProps) {
  const book = bookProp ?? extractBookData(nodes);

  if (!book) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">暂无作品数据</p>
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
    </div>
  );
}
