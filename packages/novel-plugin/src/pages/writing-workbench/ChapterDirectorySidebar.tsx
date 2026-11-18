/**
 * 书房「写正文」左二栏：纯粹的正文章节目录 + 审稿红标筛选 + 新建章节（对齐 GenUI v6 蓝图）。
 *
 * 设计纪律：
 * 1. 首屏绝不向小说作者暴露 `.narrafork`、`.gitignore`、`book.json` 等工程目录；
 * 2. 默认展示按章号排序的章节卡片（章号标题、字数、审稿红标计数或「净」标），支持「全部 / 有红标」一键筛选；
 * 3. 顶部支持一键「+ 新章」直接落盘新章节并打开和纸信纸；
 * 4. 底部保留默认折叠的「写前筹备」与「分析与原始文件」抽屉，不丢任何深层功能。
 */

import { type ReactNode, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Compass, FilePlus2, FileText, Loader2, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";
import type { ChapterAuditBadgeInfo } from "./WorkbenchResourceTree";

export interface ChapterDirectorySidebarProps {
  readonly bookId?: string;
  readonly chapterNodes: readonly WorkbenchResourceNode[];
  readonly selectedNodeId?: string | null;
  readonly chapterWordTarget?: number;
  readonly chapterAuditSummary?: Readonly<Record<number, ChapterAuditBadgeInfo>>;
  readonly creatingChapter?: boolean;
  readonly onOpenChapter: (node: WorkbenchResourceNode) => void;
  readonly onCreateChapter?: () => void;
  /** 可选折叠抽屉：写前蓝图与就绪筹备（WriteViewPanel）。 */
  readonly writePrepSlot?: ReactNode;
  /** 可选折叠抽屉：分析工具列表（角色弧线、张力曲线、质量中心等）。 */
  readonly analysisToolsSlot?: ReactNode;
  /** 可选折叠抽屉：需要查看底层文件时的文件树。 */
  readonly rawFilesSlot?: ReactNode;
}

interface FlatChapterItem {
  readonly node: WorkbenchResourceNode;
  readonly chapterNumber: number | null;
  readonly wordCount: number | null;
  readonly audit: ChapterAuditBadgeInfo | undefined;
}

function parseChapterNumber(node: WorkbenchResourceNode): number | null {
  if (typeof node.metadata?.chapterNumber === "number" && Number.isInteger(node.metadata.chapterNumber) && node.metadata.chapterNumber > 0) {
    return node.metadata.chapterNumber;
  }
  const path = String(node.metadata?.filePath ?? node.path ?? "");
  const pathMatch = path.match(/(?:^|[\\/])(\d{1,6})[_-]/);
  if (pathMatch) return Number(pathMatch[1]);
  const titleMatch = node.title.match(/第\s*(\d{1,6})\s*章/);
  if (titleMatch) return Number(titleMatch[1]);
  return null;
}

function parseWordCount(node: WorkbenchResourceNode): number | null {
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
  selectedNodeId,
  chapterWordTarget = 0,
  chapterAuditSummary,
  creatingChapter = false,
  onOpenChapter,
  onCreateChapter,
  writePrepSlot,
  analysisToolsSlot,
  rawFilesSlot,
}: ChapterDirectorySidebarProps) {
  const [filter, setFilter] = useState<"all" | "issues">("all");
  const [openDrawer, setOpenDrawer] = useState<"prep" | "tools" | "files" | null>(null);

  const chapters = useMemo<FlatChapterItem[]>(() => {
    const flat = flattenChapterNodes(chapterNodes);
    // 按 id 去重并按章号升序排列
    const seen = new Set<string>();
    const unique: FlatChapterItem[] = [];
    for (const node of flat) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      const chapterNumber = parseChapterNumber(node);
      unique.push({
        node,
        chapterNumber,
        wordCount: parseWordCount(node),
        audit: chapterNumber != null ? chapterAuditSummary?.[chapterNumber] : undefined,
      });
    }
    return unique.sort((a, b) => {
      if (a.chapterNumber != null && b.chapterNumber != null && a.chapterNumber !== b.chapterNumber) {
        return a.chapterNumber - b.chapterNumber;
      }
      return a.node.title.localeCompare(b.node.title, "zh", { numeric: true });
    });
  }, [chapterNodes, chapterAuditSummary]);

  const issueChapterCount = useMemo(
    () => chapters.filter((c) => (c.audit?.issueCount ?? 0) > 0).length,
    [chapters],
  );

  const visibleChapters = useMemo(
    () => (filter === "issues" ? chapters.filter((c) => (c.audit?.issueCount ?? 0) > 0) : chapters),
    [chapters, filter],
  );

  const toggleDrawer = (id: "prep" | "tools" | "files") => {
    setOpenDrawer((prev) => (prev === id ? null : id));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card/60" data-testid="chapter-directory-sidebar">
      {/* 顶栏：正文资源管理器 + 目标字数 + 新章 */}
      <div className="shrink-0 space-y-2 border-b border-border px-2.5 py-2">
        <div className="flex items-center justify-between gap-1">
          <div className="min-w-0">
            <h2 className="truncate text-xs font-bold text-foreground">正文资源管理器</h2>
            <p className="text-2xs text-muted-foreground">
              {chapterWordTarget > 0 ? `目标 ${chapterWordTarget} 字/章` : `共 ${chapters.length} 章`}
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

      {/* 中部：章节卡片列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {visibleChapters.length > 0 ? (
          <div className="space-y-1.5">
            {visibleChapters.map(({ node, chapterNumber, wordCount, audit }) => {
              const active = selectedNodeId === node.id;
              const issueCount = audit?.issueCount ?? 0;
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
                    <span className={cn("min-w-0 flex-1 truncate text-xs", active ? "font-bold text-primary" : "font-medium text-foreground")}>
                      {formatChapterCardTitle(node, chapterNumber)}
                    </span>
                    {issueCount > 0 ? (
                      <Badge variant="destructive" className="h-4 shrink-0 px-1.5 text-2xs">
                        {issueCount}
                      </Badge>
                    ) : (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-2xs font-medium text-primary">
                        <span className="size-1.5 rounded-full bg-primary" />
                        净
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
                    <span>{wordCount != null ? `${wordCount} 字` : "点击打开正文"}</span>
                    {audit?.criticalCount ? (
                      <span className="rounded bg-destructive/12 px-1 py-0.2 text-destructive">
                        重度 {audit.criticalCount}
                      </span>
                    ) : null}
                    {audit?.stale ? (
                      <span className="rounded bg-warning/15 px-1 py-0.2 text-warning">
                        改后待复审
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        ) : chapters.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card/40 px-3 py-6 text-center">
            <FileText className="size-5 text-muted-foreground" strokeWidth={1.5} />
            <p className="text-xs font-medium text-foreground">还没有正文章节</p>
            <p className="text-2xs leading-relaxed text-muted-foreground">
              点右上角「新章」铺开稿纸直接写，或让右侧叙述者按大纲起草第 1 章。
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
        ) : (
          <p className="py-6 text-center text-xs text-muted-foreground">当前没有带审稿红标的章节。</p>
        )}
      </div>

      {/* 底部：轻量折叠抽屉（写前筹备 / 分析工具 / 原始文件），默认收起不干扰码字 */}
      {(writePrepSlot || analysisToolsSlot || rawFilesSlot) ? (
        <div className="shrink-0 border-t border-border bg-secondary/40">
          {writePrepSlot ? (
            <div className="border-b border-border/60">
              <button
                type="button"
                aria-expanded={openDrawer === "prep"}
                onClick={() => toggleDrawer("prep")}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-2xs font-semibold text-muted-foreground hover:bg-card/50 hover:text-foreground"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="size-3 text-primary" />
                  <span>AI 写章筹备 & 蓝图</span>
                </span>
                {openDrawer === "prep" ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </button>
              {openDrawer === "prep" ? (
                <div className="max-h-72 overflow-y-auto border-t border-border/50 bg-card">
                  {writePrepSlot}
                </div>
              ) : null}
            </div>
          ) : null}

          {analysisToolsSlot ? (
            <div className="border-b border-border/60">
              <button
                type="button"
                aria-expanded={openDrawer === "tools"}
                onClick={() => toggleDrawer("tools")}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-2xs font-semibold text-muted-foreground hover:bg-card/50 hover:text-foreground"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Compass className="size-3" />
                  <span>质检与分析工具</span>
                </span>
                {openDrawer === "tools" ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </button>
              {openDrawer === "tools" ? (
                <div className="max-h-64 overflow-y-auto border-t border-border/50 bg-card py-1">
                  {analysisToolsSlot}
                </div>
              ) : null}
            </div>
          ) : null}

          {rawFilesSlot ? (
            <div>
              <button
                type="button"
                aria-expanded={openDrawer === "files"}
                onClick={() => toggleDrawer("files")}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-2xs font-medium text-muted-foreground/80 hover:bg-card/50 hover:text-foreground"
              >
                <span>底层工程文件</span>
                {openDrawer === "files" ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </button>
              {openDrawer === "files" ? (
                <div className="max-h-60 overflow-y-auto border-t border-border/50 bg-card py-1">
                  {rawFilesSlot}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
