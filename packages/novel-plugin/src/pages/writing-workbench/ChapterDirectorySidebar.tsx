/**
 * 书房「写正文」左二栏：纯净的书稿与章纲导航目录（方案 A+B 结合）。
 *
 * 设计纪律：
 * 1. 左栏只做纯目录与自由滑动导航，不再挂载功能抽屉（AI 写章筹备、质检与分析工具全部升格到中间全宽画布）；
 * 2. 正文章节按卷分组展示，显示真实字数与进度条；只有真正审过的章才贴「已审 / 红标」，未审过不乱贴「净」标；
 * 3. 大纲联动待写章节：把细纲/章纲里有、正文尚未建的章挂在目录中段，点击直接进中间全宽「AI 写章筹备台」；
 * 4. 附注（作者说 / 章节说 / 备忘）独立一栏，不混入正文计数与审稿状态，支持一键新建；
 * 5. 底部仅保留单行可折叠「底层工程文件」，需要时展开查看真实仓库文件，不挤占上方导航视野。
 */

import { type ReactNode, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FilePlus2,
  FileText,
  Loader2,
  NotebookPen,
  Search,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";
import type { ChapterAuditBadgeInfo } from "./WorkbenchResourceTree";

export interface PlannedOutlineChapterItem {
  readonly chapterNumber: number;
  readonly title: string;
  readonly summary?: string;
  readonly volumeTitle?: string;
  readonly targetWords?: number;
  readonly sourceNode?: WorkbenchResourceNode;
}

export interface VolumeGroupMeta {
  readonly id: string;
  readonly title: string;
  readonly from: number;
  readonly to: number;
  readonly goal?: string;
}

export interface ChapterDirectorySidebarProps {
  readonly bookId?: string;
  readonly chapterNodes: readonly WorkbenchResourceNode[];
  /** 来自 fileTree 的附注/作者说/章节说文件节点，独立分栏，不混入正文。 */
  readonly noteNodes?: readonly WorkbenchResourceNode[];
  /** 来自叙事结构/经纬的卷分组。 */
  readonly volumes?: readonly VolumeGroupMeta[];
  /** 来自叙事结构/章纲的待写章节（尚未建正文）。 */
  readonly plannedChapters?: readonly PlannedOutlineChapterItem[];
  /** 按章号索引的真实字数（由叙事结构 / 章节文件统计合并提供）。 */
  readonly chapterWordCounts?: Readonly<Record<number, number>>;
  readonly selectedNodeId?: string | null;
  /** 当前中间画布正在筹备的待写章号（用于在待写清单里高亮）。 */
  readonly activePrepChapterNumber?: number | null;
  readonly chapterWordTarget?: number;
  readonly chapterAuditSummary?: Readonly<Record<number, ChapterAuditBadgeInfo>>;
  readonly creatingChapter?: boolean;
  readonly creatingNote?: boolean;
  readonly onOpenChapter: (node: WorkbenchResourceNode) => void;
  readonly onOpenNote?: (node: WorkbenchResourceNode) => void;
  readonly onOpenPlannedChapter?: (item: PlannedOutlineChapterItem) => void;
  readonly onCreateChapter?: () => void;
  readonly onCreateNote?: () => void;
  /** 仅保留单行折叠的底层工程文件树（不放功能抽屉）。 */
  readonly rawFilesSlot?: ReactNode;
}

interface FlatChapterItem {
  readonly node: WorkbenchResourceNode;
  readonly chapterNumber: number | null;
  readonly wordCount: number | null;
  readonly audit: ChapterAuditBadgeInfo | undefined;
}

function parseChapterNumber(node: WorkbenchResourceNode): number | null {
  if (
    typeof node.metadata?.chapterNumber === "number"
    && Number.isInteger(node.metadata.chapterNumber)
    && node.metadata.chapterNumber > 0
  ) {
    return node.metadata.chapterNumber;
  }
  const path = String(node.metadata?.filePath ?? node.path ?? "");
  const pathMatch = path.match(/(?:^|[\\/])(\d{1,6})(?:[_-]|(?=\.md$))/iu);
  if (pathMatch) return Number(pathMatch[1]);
  const titleMatch = node.title.match(/第\s*(\d{1,6})\s*章/);
  if (titleMatch) return Number(titleMatch[1]);
  return null;
}

function parseWordCount(
  node: WorkbenchResourceNode,
  chapterNumber: number | null,
  chapterWordCounts?: Readonly<Record<number, number>>,
): number | null {
  if (chapterNumber != null && typeof chapterWordCounts?.[chapterNumber] === "number") {
    return chapterWordCounts[chapterNumber]!;
  }
  const raw = node.metadata?.wordCount ?? node.metadata?.charCount ?? node.metadata?.length;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  if (typeof node.content === "string" && node.content.length > 0) {
    return node.content.replace(/\s+/g, "").length;
  }
  return null;
}

function formatChapterCardTitle(node: WorkbenchResourceNode, chapterNumber: number | null): string {
  const raw = node.title.trim();
  const mdMatch = raw.match(/^(\d{1,6})[_-](.+?)(?:\.md)?$/iu);
  if (mdMatch) {
    const num = Number(mdMatch[1]);
    const clean = mdMatch[2].replaceAll("_", " ").trim();
    return /^第\s*\d+\s*章/u.test(clean) ? clean : `第${num}章 ${clean}`;
  }
  const stripped = raw.replace(/\.md$/iu, "").trim();
  if (chapterNumber != null && !/^第\s*\d+\s*章/u.test(stripped)) {
    return `第${chapterNumber}章 ${stripped}`;
  }
  return stripped || raw;
}

function formatNoteTitle(node: WorkbenchResourceNode): string {
  return node.title.replace(/\.md$/iu, "").trim() || node.title;
}

function noteKindBadge(node: WorkbenchResourceNode): string {
  const text = `${node.title} ${String(node.metadata?.filePath ?? node.path ?? "")}`;
  if (/章节说|本章说/u.test(text)) return "章节说";
  if (/作者说/u.test(text)) return "作者说";
  return "附注";
}

function flattenChapterNodes(nodes: readonly WorkbenchResourceNode[]): WorkbenchResourceNode[] {
  const list: WorkbenchResourceNode[] = [];
  const visit = (items: readonly WorkbenchResourceNode[]) => {
    for (const item of items) {
      if (item.kind === "chapter") {
        list.push(item);
      }
      if (item.children?.length) {
        visit(item.children);
      }
    }
  };
  visit(nodes);
  return list;
}

export function ChapterDirectorySidebar({
  chapterNodes,
  noteNodes = [],
  volumes = [],
  plannedChapters = [],
  chapterWordCounts,
  selectedNodeId,
  activePrepChapterNumber = null,
  chapterWordTarget = 0,
  chapterAuditSummary,
  creatingChapter = false,
  creatingNote = false,
  onOpenChapter,
  onOpenNote,
  onOpenPlannedChapter,
  onCreateChapter,
  onCreateNote,
  rawFilesSlot,
}: ChapterDirectorySidebarProps) {
  const [filter, setFilter] = useState<"all" | "issues">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [notesExpanded, setNotesExpanded] = useState(true);
  const [rawOpen, setRawOpen] = useState(false);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const chapters = useMemo<FlatChapterItem[]>(() => {
    const flat = flattenChapterNodes(chapterNodes);
    const seen = new Set<string>();
    const unique: FlatChapterItem[] = [];
    for (const node of flat) {
      if (seen.has(node.id)) continue;
      const chapterNumber = parseChapterNumber(node);
      // 没有有效正整数章号的非正文文档不进正文目录，防把作者说清单当正文。
      if (chapterNumber === null) continue;
      seen.add(node.id);
      unique.push({
        node,
        chapterNumber,
        wordCount: parseWordCount(node, chapterNumber, chapterWordCounts),
        audit: chapterAuditSummary?.[chapterNumber],
      });
    }
    return unique.sort((a, b) => {
      if (a.chapterNumber != null && b.chapterNumber != null && a.chapterNumber !== b.chapterNumber) {
        return a.chapterNumber - b.chapterNumber;
      }
      return a.node.title.localeCompare(b.node.title, "zh", { numeric: true });
    });
  }, [chapterNodes, chapterWordCounts, chapterAuditSummary]);

  const draftedNumbers = useMemo(() => {
    const set = new Set<number>();
    for (const c of chapters) {
      if (c.chapterNumber != null) set.add(c.chapterNumber);
    }
    return set;
  }, [chapters]);

  const issueChapterCount = useMemo(
    () => chapters.filter((c) => (c.audit?.issueCount ?? 0) > 0).length,
    [chapters],
  );

  const visibleChapters = useMemo(() => {
    return chapters.filter((c) => {
      if (filter === "issues" && (c.audit?.issueCount ?? 0) <= 0) return false;
      if (!normalizedQuery) return true;
      const title = formatChapterCardTitle(c.node, c.chapterNumber).toLowerCase();
      return title.includes(normalizedQuery) || String(c.chapterNumber ?? "").includes(normalizedQuery);
    });
  }, [chapters, filter, normalizedQuery]);

  const visiblePlanned = useMemo(() => {
    if (filter === "issues") return [];
    return plannedChapters
      .filter((item) => !draftedNumbers.has(item.chapterNumber))
      .filter((item) => {
        if (!normalizedQuery) return true;
        const hay = `第${item.chapterNumber}章 ${item.title} ${item.summary ?? ""}`.toLowerCase();
        return hay.includes(normalizedQuery);
      })
      .sort((a, b) => a.chapterNumber - b.chapterNumber);
  }, [plannedChapters, draftedNumbers, filter, normalizedQuery]);

  const visibleNotes = useMemo(() => {
    if (filter === "issues") return [];
    return noteNodes.filter((n) => {
      if (!normalizedQuery) return true;
      return `${n.title} ${String(n.metadata?.filePath ?? n.path ?? "")}`.toLowerCase().includes(normalizedQuery);
    });
  }, [noteNodes, filter, normalizedQuery]);

  const volumeGroups = useMemo(() => {
    if (volumes.length === 0) {
      return [
        {
          id: "vol-all",
          title: "正文章节",
          goal: undefined,
          chapters: visibleChapters,
          planned: visiblePlanned,
          draftedTotal: chapters.length,
          plannedTotal: null as number | null,
        },
      ];
    }

    const assignedChapters = new Set<string>();
    const assignedPlanned = new Set<number>();
    const groups = volumes
      .slice()
      .sort((a, b) => a.from - b.from)
      .map((vol) => {
        const volChapters = visibleChapters.filter((c) => {
          const num = c.chapterNumber ?? -1;
          if (num >= vol.from && num <= vol.to) {
            assignedChapters.add(c.node.id);
            return true;
          }
          return false;
        });
        const volPlanned = visiblePlanned.filter((p) => {
          if (p.chapterNumber >= vol.from && p.chapterNumber <= vol.to) {
            assignedPlanned.add(p.chapterNumber);
            return true;
          }
          return false;
        });
        const draftedInRange = chapters.filter((c) => {
          const n = c.chapterNumber ?? -1;
          return n >= vol.from && n <= vol.to;
        }).length;
        return {
          id: vol.id,
          title: vol.title,
          goal: vol.goal,
          chapters: volChapters,
          planned: volPlanned,
          draftedTotal: draftedInRange,
          plannedTotal: Math.max(0, vol.to - vol.from + 1) as number | null,
        };
      });

    const extraChapters = visibleChapters.filter((c) => !assignedChapters.has(c.node.id));
    const extraPlanned = visiblePlanned.filter((p) => !assignedPlanned.has(p.chapterNumber));
    if (extraChapters.length > 0 || extraPlanned.length > 0) {
      groups.push({
        id: "vol-unassigned",
        title: "未分卷 / 后续规划",
        goal: undefined,
        chapters: extraChapters,
        planned: extraPlanned,
        draftedTotal: extraChapters.length,
        plannedTotal: null,
      });
    }

    return groups.filter((g) => g.chapters.length > 0 || g.planned.length > 0 || (!normalizedQuery && volumes.length > 0));
  }, [volumes, visibleChapters, visiblePlanned, chapters, normalizedQuery]);

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const renderChapterCard = ({ node, chapterNumber, wordCount, audit }: FlatChapterItem) => {
    const active = selectedNodeId === node.id;
    const issueCount = audit?.issueCount ?? 0;
    const isAudited = audit !== undefined;
    const pct = chapterWordTarget > 0 && wordCount != null
      ? Math.min(100, Math.round((wordCount / chapterWordTarget) * 100))
      : null;

    return (
      <button
        key={node.id}
        type="button"
        data-testid={`chapter-card-${node.id}`}
        onClick={() => onOpenChapter(node)}
        className={cn(
          "flex w-full flex-col gap-1 rounded-md border p-2 text-left transition-colors",
          active
            ? "border-primary bg-card shadow-2xs"
            : "border-transparent hover:border-border hover:bg-card/70",
        )}
      >
        <div className="flex items-center justify-between gap-1.5">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-xs",
              active ? "font-bold text-primary" : "font-medium text-foreground",
            )}
          >
            {formatChapterCardTitle(node, chapterNumber)}
          </span>
          {issueCount > 0 ? (
            <Badge variant="destructive" className="h-4 shrink-0 px-1.5 text-2xs">
              {issueCount}
            </Badge>
          ) : isAudited ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-2xs font-medium text-primary">
              <span className="size-1.5 rounded-full bg-primary" />
              已审
            </span>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
          <span className="tabular-nums">
            {wordCount != null
              ? chapterWordTarget > 0
                ? `${wordCount.toLocaleString()} / ${chapterWordTarget.toLocaleString()} 字`
                : `${wordCount.toLocaleString()} 字`
              : "点击打开正文"}
          </span>
          {pct != null ? (
            <span className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <span
                className={cn("block h-full rounded-full transition-all", pct >= 100 ? "bg-primary" : "bg-warning")}
                style={{ width: `${pct}%` }}
              />
            </span>
          ) : null}
        </div>
        {(audit?.criticalCount || audit?.stale) ? (
          <div className="flex flex-wrap items-center gap-1 text-2xs">
            {audit.criticalCount ? (
              <span className="rounded bg-destructive/12 px-1 py-0.2 text-destructive">
                重度 {audit.criticalCount}
              </span>
            ) : null}
            {audit.stale ? (
              <span className="rounded bg-warning/15 px-1 py-0.2 text-warning">
                改后待复审
              </span>
            ) : null}
          </div>
        ) : null}
      </button>
    );
  };

  const renderPlannedCard = (item: PlannedOutlineChapterItem) => {
    const active = activePrepChapterNumber === item.chapterNumber;
    return (
      <button
        key={`planned-${item.chapterNumber}`}
        type="button"
        data-testid={`planned-chapter-card-${item.chapterNumber}`}
        onClick={() => onOpenPlannedChapter?.(item)}
        className={cn(
          "flex w-full flex-col gap-1 rounded-md border border-dashed p-2 text-left transition-colors",
          active
            ? "border-primary bg-primary/8 shadow-2xs"
            : "border-border/80 bg-card/30 hover:border-primary/50 hover:bg-card/70",
        )}
      >
        <div className="flex items-center justify-between gap-1.5">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-xs",
              active ? "font-semibold text-primary" : "font-medium text-foreground",
            )}
          >
            第{item.chapterNumber}章 {item.title}
          </span>
          <Badge variant="outline" className="h-4 shrink-0 gap-0.5 px-1.5 text-2xs text-primary border-primary/40">
            <Sparkles className="size-2.5" />
            待写
          </Badge>
        </div>
        {item.summary ? (
          <p className="line-clamp-2 text-2xs leading-snug text-muted-foreground">
            细纲：{item.summary}
          </p>
        ) : (
          <p className="text-2xs text-muted-foreground">点击进入 AI 写章筹备台</p>
        )}
      </button>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card/60" data-testid="chapter-directory-sidebar">
      {/* 顶栏：书稿与章纲目录 + 新章 + 搜索 + 审稿筛选 */}
      <div className="shrink-0 space-y-2 border-b border-border px-2.5 py-2">
        <div className="flex items-center justify-between gap-1">
          <div className="min-w-0">
            <h2 className="truncate text-xs font-bold text-foreground">书稿与章纲目录</h2>
            <p className="text-2xs text-muted-foreground">
              {chapterWordTarget > 0
                ? `已写 ${chapters.length} 章 · 目标 ${chapterWordTarget} 字/章`
                : `已写 ${chapters.length} 章`}
            </p>
          </div>
          {onCreateChapter ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={creatingChapter}
              onClick={onCreateChapter}
              data-testid="sidebar-create-chapter-btn"
              className="h-6 gap-1 px-2 text-2xs border-primary/40 text-primary hover:bg-primary/10"
            >
              {creatingChapter ? <Loader2 className="size-3 animate-spin" /> : <FilePlus2 className="size-3" />}
              <span>新章</span>
            </Button>
          ) : null}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜章号 / 标题 / 细纲 / 附注…"
            aria-label="筛选书稿目录"
            className="h-7 pl-6 pr-2 text-2xs"
          />
        </div>

        {/* 全部 / 有红标 分段筛选器 */}
        <div
          className="grid grid-cols-2 rounded-md border border-border/80 bg-muted/40 p-0.5 text-2xs"
          role="tablist"
          aria-label="章节审稿筛选"
        >
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            data-testid="chapter-filter-all"
            onClick={() => setFilter("all")}
            className={cn(
              "rounded py-0.5 font-medium transition-colors",
              filter === "all" ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            全部 ({chapters.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "issues"}
            data-testid="chapter-filter-issues"
            onClick={() => setFilter("issues")}
            className={cn(
              "rounded py-0.5 font-medium transition-colors",
              filter === "issues"
                ? "bg-card text-destructive shadow-2xs"
                : issueChapterCount > 0
                  ? "text-destructive/85 hover:text-destructive"
                  : "text-muted-foreground hover:text-foreground",
            )}
          >
            有红标 ({issueChapterCount})
          </button>
        </div>
      </div>

      {/* 中部：自由滑动单流列表（卷/正文 + 大纲待写章节 + 独立附注区） */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-3">
        {visibleChapters.length === 0 && visiblePlanned.length === 0 && chapters.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card/40 px-3 py-6 text-center">
            <FileText className="size-5 text-muted-foreground" strokeWidth={1.5} />
            <p className="text-xs font-medium text-foreground">还没有正文章节</p>
            <p className="text-2xs leading-relaxed text-muted-foreground">
              点右上角「新章」铺开稿纸直接写，或在中间工作台切到「AI 写章筹备」起草第 1 章。
            </p>
            {onCreateChapter ? (
              <Button
                type="button"
                size="xs"
                disabled={creatingChapter}
                onClick={onCreateChapter}
                className="mt-1 gap-1"
              >
                <FilePlus2 className="size-3.5" />
                <span>新建第 1 章</span>
              </Button>
            ) : null}
          </div>
        ) : visibleChapters.length === 0 && visiblePlanned.length === 0 && filter === "issues" ? (
          <p className="py-6 text-center text-xs text-muted-foreground">当前没有带审稿红标的章节。</p>
        ) : (
          volumeGroups.map((group) => {
            const collapsed = collapsedGroups.has(group.id);
            const showGroupHeader = volumes.length > 0 || group.planned.length > 0;
            return (
              <section key={group.id} className="space-y-1.5" data-testid={`volume-group-${group.id}`}>
                {showGroupHeader ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className="flex w-full items-center justify-between gap-1 rounded px-1 py-0.5 text-left text-2xs font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  >
                    <span className="inline-flex min-w-0 flex-1 items-center gap-1 truncate">
                      {collapsed ? <ChevronRight className="size-3 shrink-0" /> : <ChevronDown className="size-3 shrink-0" />}
                      <span className="truncate">{group.title}</span>
                    </span>
                    <span className="shrink-0 tabular-nums font-normal">
                      {group.plannedTotal != null
                        ? `${group.draftedTotal}/${group.plannedTotal} 章`
                        : `${group.draftedTotal} 章`}
                    </span>
                  </button>
                ) : null}
                {!collapsed ? (
                  <div className="space-y-1.5">
                    {group.chapters.map(renderChapterCard)}
                    {group.planned.length > 0 ? (
                      <div className="space-y-1.5 pt-1">
                        <div className="px-1 text-2xs font-medium text-primary/85">
                          大纲联动 · 待写章节 ({group.planned.length})
                        </div>
                        {group.planned.map(renderPlannedCard)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            );
          })
        )}

        {/* 独立分栏：附注 / 作者说 / 章节说（不混入正文计数与审稿状态） */}
        {(visibleNotes.length > 0 || onCreateNote) && filter === "all" ? (
          <section className="border-t border-border/70 pt-2" data-testid="sidebar-notes-section">
            <div className="flex items-center justify-between gap-1 px-1 pb-1">
              <button
                type="button"
                onClick={() => setNotesExpanded((v) => !v)}
                className="inline-flex min-w-0 flex-1 items-center gap-1 text-left text-2xs font-semibold text-muted-foreground hover:text-foreground"
              >
                {notesExpanded ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
                <NotebookPen className="size-3 shrink-0 text-primary/80" />
                <span className="truncate">附注 · 作者说 / 章节说 ({visibleNotes.length})</span>
              </button>
              {onCreateNote ? (
                <button
                  type="button"
                  disabled={creatingNote}
                  onClick={onCreateNote}
                  className="shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                  data-testid="sidebar-create-note-btn"
                >
                  {creatingNote ? "创建中…" : "+ 新建"}
                </button>
              ) : null}
            </div>
            {notesExpanded ? (
              visibleNotes.length > 0 ? (
                <div className="space-y-1">
                  {visibleNotes.map((note) => {
                    const active = selectedNodeId === note.id;
                    return (
                      <button
                        key={note.id}
                        type="button"
                        data-testid={`note-card-${note.id}`}
                        onClick={() => (onOpenNote ? onOpenNote(note) : onOpenChapter(note))}
                        className={cn(
                          "flex w-full items-center justify-between gap-1.5 rounded-md border px-2 py-1.5 text-left transition-colors",
                          active
                            ? "border-primary bg-card shadow-2xs"
                            : "border-transparent hover:border-border hover:bg-card/70",
                        )}
                      >
                        <span className={cn("min-w-0 flex-1 truncate text-xs", active ? "font-bold text-primary" : "font-medium text-foreground")}>
                          {formatNoteTitle(note)}
                        </span>
                        <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-2xs">
                          {noteKindBadge(note)}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="px-2 py-2 text-2xs text-muted-foreground">
                  可用来记录上架感言、读者本章说彩蛋、物价设定备忘，独立存放不污染正文。
                </p>
              )
            ) : null}
          </section>
        ) : null}
      </div>

      {/* 底部：仅保留单行折叠「底层工程文件」，取消左栏功能抽屉避免挤压截断 */}
      {rawFilesSlot ? (
        <div className="shrink-0 border-t border-border bg-secondary/40" data-testid="sidebar-raw-files-drawer">
          <button
            type="button"
            aria-expanded={rawOpen}
            onClick={() => setRawOpen((v) => !v)}
            className="flex w-full items-center justify-between px-2.5 py-1.5 text-2xs font-medium text-muted-foreground hover:bg-card/50 hover:text-foreground"
            data-testid="sidebar-raw-files-toggle"
          >
            <span className="inline-flex items-center gap-1.5">
              <FileCode2 className="size-3" />
              <span>底层工程文件</span>
            </span>
            {rawOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          {rawOpen ? (
            <div className="max-h-72 overflow-y-auto border-t border-border/50 bg-card py-1">
              {rawFilesSlot}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
