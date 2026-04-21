import { useEffect, useMemo, useState } from "react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  BookOpen,
  Boxes,
  ChevronDown,
  ChevronRight,
  FileInput,
  FolderGit2,
  LayoutDashboard,
  MessageSquare,
  ScrollText,
  Search,
  Settings,
  Shield,
  Sparkles,
  Stethoscope,
  TerminalSquare,
  TrendingUp,
  Workflow,
  Wrench,
  Zap,
} from "lucide-react";

import type { SSEMessage } from "../hooks/use-sse";
import { useApi } from "../hooks/use-api";
import { shouldRefetchBookCollections, shouldRefetchDaemonStatus } from "../hooks/use-book-activity";
import type { TFunction } from "../hooks/use-i18n";
import { useNovelFork } from "../providers/novelfork-context";
import { useProjectSort } from "../hooks/use-project-sort";
import { SortableProjectCard } from "./Project/SortableProjectCard";

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
}

interface Nav {
  toDashboard: () => void;
  toWorkflow: () => void;
  toSessions: () => void;
  toBook: (id: string) => void;
  toBookCreate: () => void;
  toChapter: (bookId: string, chapterNumber: number) => void;
  toTruth: (bookId: string) => void;
  toDaemon: () => void;
  toLogs: () => void;
  toGenres: () => void;
  toStyle: () => void;
  toImport: () => void;
  toRadar: () => void;
  toDoctor: () => void;
  toSearch: () => void;
  toBackup: () => void;
  toState: (bookId: string) => void;
  toPipeline: (runId?: string) => void;
  toAdmin: () => void;
  toSettings: () => void;
  toWorktree: () => void;
}

const SIDEBAR_STORAGE_KEYS = {
  workspace: "novelfork-sidebar-workspace-v2",
  workbench: "novelfork-sidebar-workbench-v2",
  system: "novelfork-sidebar-system-v2",
} as const;

function readSectionState(key: string, defaultValue = true) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? defaultValue : raw === "true";
  } catch {
    return defaultValue;
  }
}

function writeSectionState(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore storage failures
  }
}

export function Sidebar({ nav, activePage, sse, t }: {
  nav: Nav;
  activePage: string;
  sse: { messages: ReadonlyArray<SSEMessage> };
  t: TFunction;
}) {
  const { data, refetch: refetchBooks } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const { data: daemon, refetch: refetchDaemon } = useApi<{ running: boolean }>("/daemon");
  const { mode } = useNovelFork();
  const isStandalone = mode === "standalone";
  const isTauri = mode === "tauri";
  const [expandedBooks, setExpandedBooks] = useState<Set<string>>(new Set());
  const [workspaceOpen, setWorkspaceOpen] = useState(() => readSectionState(SIDEBAR_STORAGE_KEYS.workspace));
  const [workbenchOpen, setWorkbenchOpen] = useState(() => readSectionState(SIDEBAR_STORAGE_KEYS.workbench));
  const [systemOpen, setSystemOpen] = useState(() => readSectionState(SIDEBAR_STORAGE_KEYS.system));

  const { sortedItems: sortedBooks, handleDragEnd } = useProjectSort(data?.books ?? []);

  const primaryItems = useMemo(() => [
    {
      label: "项目总览",
      icon: <LayoutDashboard size={16} />,
      active: activePage === "dashboard",
      onClick: nav.toDashboard,
    },
    {
      label: "会话中心",
      icon: <MessageSquare size={16} />,
      active: activePage === "sessions",
      onClick: nav.toSessions,
    },
    {
      label: "工作流配置",
      icon: <Workflow size={16} />,
      active: activePage === "workflow" || activePage.startsWith("workflow:"),
      onClick: nav.toWorkflow,
      badge: "新",
      badgeColor: "bg-primary/10 text-primary",
    },
    {
      label: "管理中心",
      icon: <Shield size={16} />,
      active: activePage === "admin" || activePage.startsWith("admin:"),
      onClick: nav.toAdmin,
    },
    {
      label: "设置",
      icon: <Settings size={16} />,
      active: activePage === "settings" || activePage.startsWith("settings:"),
      onClick: nav.toSettings,
      testId: "settings-btn",
    },
  ], [activePage, nav]);

  const workbenchItems = useMemo(() => [
    {
      label: t("nav.search"),
      icon: <Search size={16} />,
      active: activePage === "search",
      onClick: nav.toSearch,
    },
    {
      label: t("nav.style"),
      icon: <Sparkles size={16} />,
      active: activePage === "style",
      onClick: nav.toStyle,
    },
    {
      label: t("nav.import"),
      icon: <FileInput size={16} />,
      active: activePage === "import",
      onClick: nav.toImport,
    },
    {
      label: t("create.genre"),
      icon: <Boxes size={16} />,
      active: activePage === "genres",
      onClick: nav.toGenres,
    },
    {
      label: t("nav.radar"),
      icon: <TrendingUp size={16} />,
      active: activePage === "radar",
      onClick: nav.toRadar,
    },
    ...(isStandalone || isTauri
      ? [{
          label: t("nav.doctor"),
          icon: <Stethoscope size={16} />,
          active: activePage === "doctor",
          onClick: nav.toDoctor,
        }]
      : []),
    {
      label: "Pipeline",
      icon: <Wrench size={16} />,
      active: activePage === "pipeline",
      onClick: () => nav.toPipeline(),
    },
  ], [activePage, isStandalone, isTauri, nav, t]);

  const systemItems = useMemo(() => [
    ...(isStandalone || isTauri
      ? [{
          label: "守护进程",
          icon: <Zap size={16} />,
          active: activePage === "admin:daemon",
          onClick: nav.toDaemon,
          badge: daemon?.running ? "运行中" : undefined,
          badgeColor: daemon?.running ? "bg-emerald-500/10 text-emerald-500" : undefined,
        }]
      : []),
    ...(isStandalone
      ? [{
          label: "日志",
          icon: <TerminalSquare size={16} />,
          active: activePage === "admin:logs",
          onClick: nav.toLogs,
        }]
      : []),
    ...(isTauri
      ? [{
          label: "备份",
          icon: <Shield size={16} />,
          active: activePage === "backup",
          onClick: nav.toBackup,
        }]
      : []),
    {
      label: "Worktree",
      icon: <FolderGit2 size={16} />,
      active: activePage === "admin:worktrees",
      onClick: nav.toWorktree,
    },
  ], [activePage, daemon?.running, isStandalone, isTauri, nav]);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over) {
      handleDragEnd(String(active.id), String(over.id));
    }
  };

  const toggleBook = (bookId: string) => {
    setExpandedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  };

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent) return;
    if (shouldRefetchBookCollections(recent)) {
      refetchBooks();
    }
    if (shouldRefetchDaemonStatus(recent)) {
      refetchDaemon();
    }
  }, [refetchBooks, refetchDaemon, sse.messages]);

  return (
    <aside className="flex h-full w-full select-none flex-col overflow-hidden border-r border-border/70 bg-background/90 backdrop-blur-md">
      <div className="border-b border-border/60 px-5 py-6">
        <button
          onClick={nav.toDashboard}
          className="group flex items-center gap-3 text-left transition-opacity hover:opacity-90"
        >
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 transition-transform group-hover:scale-105">
            <ScrollText size={18} />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-lg font-semibold tracking-tight text-foreground">NovelFork</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Studio</span>
          </div>
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <div className="space-y-1">
          {primaryItems.map((item) => (
            <SidebarItem key={item.label} {...item} />
          ))}
        </div>

        <SidebarSection
          title="项目 / 书籍"
          open={workspaceOpen}
          onToggle={() => {
            const next = !workspaceOpen;
            setWorkspaceOpen(next);
            writeSectionState(SIDEBAR_STORAGE_KEYS.workspace, next);
          }}
          action={
            <button
              onClick={(event) => {
                event.stopPropagation();
                nav.toBookCreate();
              }}
              className="rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t("nav.newBook")}
            >
              +
            </button>
          }
        >
          <div className="space-y-0.5">
            <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={sortedBooks.map((book) => book.id)} strategy={verticalListSortingStrategy}>
                {sortedBooks.map((book) => {
                  const isExpanded = expandedBooks.has(book.id);
                  const isActive = activePage === `book:${book.id}`;
                  return (
                    <div key={book.id}>
                      <SortableProjectCard
                        book={book}
                        isExpanded={isExpanded}
                        isActive={isActive}
                        onToggle={() => toggleBook(book.id)}
                        nav={nav}
                        t={t}
                      />
                      {isExpanded && (
                        <BookTreeChildren
                          bookId={book.id}
                          chaptersWritten={book.chaptersWritten}
                          nav={nav}
                          activePage={activePage}
                          t={t}
                        />
                      )}
                    </div>
                  );
                })}
              </SortableContext>
            </DndContext>

            {(!data?.books || data.books.length === 0) && (
              <div className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                {t("dash.noBooks")}
              </div>
            )}
          </div>
        </SidebarSection>

        <SidebarSection
          title="工作台"
          open={workbenchOpen}
          onToggle={() => {
            const next = !workbenchOpen;
            setWorkbenchOpen(next);
            writeSectionState(SIDEBAR_STORAGE_KEYS.workbench, next);
          }}
        >
          <div className="space-y-1">
            {workbenchItems.map((item) => (
              <SidebarItem key={item.label} {...item} />
            ))}
          </div>
        </SidebarSection>

        <SidebarSection
          title="系统台"
          open={systemOpen}
          onToggle={() => {
            const next = !systemOpen;
            setSystemOpen(next);
            writeSectionState(SIDEBAR_STORAGE_KEYS.system, next);
          }}
        >
          <div className="space-y-1">
            {systemItems.map((item) => (
              <SidebarItem key={item.label} {...item} />
            ))}
          </div>
        </SidebarSection>
      </div>

      <div className="border-t border-border/60 bg-muted/30 p-4">
        <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2 shadow-sm">
          {isTauri ? (
            <>
              <span className="size-2 rounded-full bg-blue-500" />
              <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                {t("nav.localMode")}
              </span>
            </>
          ) : (
            <>
              <span className={`size-2 rounded-full ${daemon?.running ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/40"}`} />
              <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                {daemon?.running ? t("nav.agentOnline") : t("nav.agentOffline")}
              </span>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function SidebarSection({
  title,
  open,
  onToggle,
  children,
  action,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {title}
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          {action}
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && children}
    </section>
  );
}

function SidebarItem({ label, icon, active, onClick, badge, badgeColor, testId }: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: string;
  badgeColor?: string;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200 ${
        active
          ? "border border-border bg-muted/80 font-semibold text-foreground shadow-sm"
          : "border border-transparent text-foreground/80 hover:bg-muted/60 hover:text-foreground"
      }`}
      data-testid={testId}
    >
      <span className={`${active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}>
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
      {badge && (
        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tight ${badgeColor ?? "bg-muted text-muted-foreground"}`}>
          {badge}
        </span>
      )}
    </button>
  );
}

interface ChapterMeta {
  readonly chapterNumber: number;
  readonly title?: string;
  readonly status?: string;
}

function BookTreeChildren({ bookId, chaptersWritten, nav, activePage, t }: {
  bookId: string;
  chaptersWritten: number;
  nav: Nav;
  activePage: string;
  t: TFunction;
}) {
  const { data } = useApi<{ chapters: ReadonlyArray<ChapterMeta> }>(`/books/${bookId}/chapters`);

  return (
    <div className="ml-5 space-y-0.5 border-l border-border/50 pl-3 py-1">
      {data?.chapters.map((chapter) => {
        const chapterId = `chapter:${bookId}:${chapter.chapterNumber}`;
        const isActive = activePage === chapterId;
        return (
          <button
            key={chapter.chapterNumber}
            onClick={() => nav.toChapter(bookId, chapter.chapterNumber)}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-all ${
              isActive
                ? "bg-primary/10 font-semibold text-primary"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
          >
            <ChapterStatusIcon status={chapter.status} />
            <span className="truncate">
              {chapter.title ?? t("chapter.label").replace("{n}", String(chapter.chapterNumber))}
            </span>
          </button>
        );
      })}

      <button
        onClick={() => nav.toTruth(bookId)}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-all ${
          activePage === `truth:${bookId}`
            ? "bg-primary/10 font-semibold text-primary"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        }`}
      >
        <BookOpen size={12} />
        <span>{t("book.truthFiles")}</span>
      </button>

      <button
        onClick={() => nav.toState(bookId)}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-all ${
          activePage === `state:${bookId}`
            ? "bg-primary/10 font-semibold text-primary"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        }`}
      >
        <Workflow size={12} />
        <span>状态投影</span>
      </button>

      {(!data?.chapters || data.chapters.length === 0) && chaptersWritten === 0 && (
        <div className="px-2 py-1 text-[10px] italic text-muted-foreground/60">
          {t("book.noChapters")}
        </div>
      )}
    </div>
  );
}

function ChapterStatusIcon({ status }: { status?: string }) {
  switch (status) {
    case "done":
    case "published":
      return <span className="w-3 shrink-0 text-center text-[10px] leading-3 text-emerald-500">✓</span>;
    case "writing":
    case "in-progress":
    case "revising":
      return <span className="inline-block size-3 shrink-0 scale-50 rounded-full bg-amber-400" />;
    default:
      return <span className="inline-block size-3 shrink-0 scale-50 rounded-full border border-muted-foreground/40" />;
  }
}
