import { useEffect, useState } from "react";
import { useApi } from "../hooks/use-api";
import type { SSEMessage } from "../hooks/use-sse";
import { shouldRefetchBookCollections, shouldRefetchDaemonStatus } from "../hooks/use-book-activity";
import type { TFunction } from "../hooks/use-i18n";
import { useInkOS } from "../providers/inkos-context";
import { useProjectSort } from "../hooks/use-project-sort";
import { DndContext, closestCenter, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableProjectCard } from "./Project/SortableProjectCard";
import {
  Book,
  Settings,
  Terminal,
  Plus,
  ScrollText,
  Boxes,
  Zap,
  Wand2,
  FileInput,
  TrendingUp,
  Stethoscope,
  ChevronRight,
  ChevronDown,
  FileText,
  FolderOpen,
  Search,
  Shield,
  Bot,
  Bell,
  Anchor,
  ShieldCheck,
  Sliders,
  Clock,
  Layers,
  Server,
  GitBranch,
  Puzzle,
  FolderGit2,
  MessageSquare,
} from "lucide-react";

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
}

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
  toBookCreate: () => void;
  toChapter: (bookId: string, chapterNumber: number) => void;
  toTruth: (bookId: string) => void;
  toConfig: () => void;
  toDaemon: () => void;
  toLogs: () => void;
  toGenres: () => void;
  toStyle: () => void;
  toImport: () => void;
  toRadar: () => void;
  toDoctor: () => void;
  toSearch: () => void;
  toBackup: () => void;
  toDetect: (bookId: string) => void;
  toNotify: () => void;
  toIntent: (bookId: string) => void;
  toAgents: () => void;
  toChatWindows: () => void;
  toSchedulerConfig: () => void;
  toDetectionConfig: () => void;
  toHooks: () => void;
  toLLMAdvanced: () => void;
  toState: (bookId: string) => void;
  toMCP: () => void;
  toPipeline: (runId?: string) => void;
  toPlugins: () => void;
  toSettings: () => void;
  toWorktree: () => void;
}

export function Sidebar({ nav, activePage, sse, t }: {
  nav: Nav;
  activePage: string;
  sse: { messages: ReadonlyArray<SSEMessage> };
  t: TFunction;
}) {
  const { data, refetch: refetchBooks } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const { data: daemon, refetch: refetchDaemon } = useApi<{ running: boolean }>("/daemon");
  const { mode } = useInkOS();
  const isStandalone = mode === "standalone";
  const isTauri = mode === "tauri";
  const [expandedBooks, setExpandedBooks] = useState<Set<string>>(new Set());
  const [systemOpen, setSystemOpen] = useState(() => {
    try {
      return localStorage.getItem("inkos-sidebar-system") !== "false";
    } catch { return false; }
  });
  const [toolsOpen, setToolsOpen] = useState(() => {
    try {
      return localStorage.getItem("inkos-sidebar-tools") !== "false";
    } catch { return false; }
  });

  // 项目拖拽排序
  const { sortedItems: sortedBooks, handleDragEnd } = useProjectSort(data?.books ?? []);

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

  const toggleSection = (section: "system" | "tools") => {
    if (section === "system") {
      setSystemOpen((prev) => {
        const next = !prev;
        try { localStorage.setItem("inkos-sidebar-system", String(next)); } catch {}
        return next;
      });
    } else {
      setToolsOpen((prev) => {
        const next = !prev;
        try { localStorage.setItem("inkos-sidebar-tools", String(next)); } catch {}
        return next;
      });
    }
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
    <aside className="w-full border-r border-border bg-background/80 backdrop-blur-md flex flex-col h-full overflow-hidden select-none">
      {/* Logo Area */}
      <div className="px-6 py-8">
        <button
          onClick={nav.toDashboard}
          className="group flex items-center gap-2 hover:opacity-80 transition-all duration-300"
        >
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20 group-hover:scale-105 transition-transform">
            <ScrollText size={18} />
          </div>
          <div className="flex flex-col">
            <span className="font-serif text-xl leading-none italic font-medium">InkOS</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold mt-1">Studio</span>
          </div>
        </button>
      </div>

      {/* Main Navigation */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-6">
        {/* Books Section */}
        <div>
          <div className="px-3 mb-3 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">
              {t("nav.books")}
            </span>
            <button
              onClick={nav.toBookCreate}
              className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all group"
              title={t("nav.newBook")}
            >
              <Plus size={14} className="group-hover:rotate-90 transition-transform duration-300" />
            </button>
          </div>

          <div className="space-y-0.5">
            <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={sortedBooks.map(b => b.id)} strategy={verticalListSortingStrategy}>
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
                        <BookTreeChildren bookId={book.id} chaptersWritten={book.chaptersWritten} nav={nav} activePage={activePage} t={t} />
                      )}
                    </div>
                  );
                })}
              </SortableContext>
            </DndContext>

            {(!data?.books || data.books.length === 0) && (
              <div className="px-3 py-6 text-xs text-muted-foreground/70 italic text-center border border-dashed border-border rounded-lg">
                {t("dash.noBooks")}
              </div>
            )}
          </div>
        </div>

        {/* System Section — collapsible */}
        <div>
          <button
            onClick={() => toggleSection("system")}
            className="w-full px-3 mb-3 flex items-center justify-between group cursor-pointer"
          >
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">
              {t("nav.system")}
            </span>
            <span className="text-muted-foreground group-hover:text-foreground transition-colors">
              {systemOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          </button>
          {systemOpen && (
          <div className="space-y-1">
            <SidebarItem
              label={t("create.genre")}
              icon={<Boxes size={16} />}
              active={activePage === "genres"}
              onClick={nav.toGenres}
            />
            {(isStandalone || isTauri) && (
              <SidebarItem
                label={t("nav.config")}
                icon={<Settings size={16} />}
                active={activePage === "config"}
                onClick={nav.toConfig}
              />
            )}
            {(isStandalone || isTauri) && (
              <SidebarItem
                label={t("nav.daemon")}
                icon={<Zap size={16} />}
                active={activePage === "daemon"}
                onClick={nav.toDaemon}
                badge={daemon?.running ? t("nav.running") : undefined}
                badgeColor={daemon?.running ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"}
              />
            )}
            {isStandalone && (
              <SidebarItem
                label={t("nav.logs")}
                icon={<Terminal size={16} />}
                active={activePage === "logs"}
                onClick={nav.toLogs}
              />
            )}
            {isTauri && (
              <SidebarItem
                label={t("nav.backup")}
                icon={<Shield size={16} />}
                active={activePage === "backup"}
                onClick={nav.toBackup}
              />
            )}
            <SidebarItem
              label="Agent 管理"
              icon={<Bot size={16} />}
              active={activePage === "agents"}
              onClick={nav.toAgents}
            />
            <SidebarItem
              label="多窗口对话"
              icon={<MessageSquare size={16} />}
              active={activePage === "chat-windows"}
              onClick={nav.toChatWindows}
            />
            <SidebarItem
              label="通知配置"
              icon={<Bell size={16} />}
              active={activePage === "notify"}
              onClick={nav.toNotify}
            />
            {(isStandalone || isTauri) && (
              <SidebarItem
                label="调度配置"
                icon={<Clock size={16} />}
                active={activePage === "scheduler-config"}
                onClick={nav.toSchedulerConfig}
              />
            )}
            <SidebarItem
              label="LLM 高级"
              icon={<Sliders size={16} />}
              active={activePage === "llm-advanced"}
              onClick={nav.toLLMAdvanced}
            />
            <SidebarItem
              label="设置"
              icon={<Settings size={16} />}
              active={activePage === "settings"}
              onClick={nav.toSettings}
            />
          </div>
          )}
        </div>

        {/* Tools Section — collapsible */}
        <div>
          <button
            onClick={() => toggleSection("tools")}
            className="w-full px-3 mb-3 flex items-center justify-between group cursor-pointer"
          >
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">
              {t("nav.tools")}
            </span>
            <span className="text-muted-foreground group-hover:text-foreground transition-colors">
              {toolsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          </button>
          {toolsOpen && (
          <div className="space-y-1">
            <SidebarItem
              label={t("nav.search")}
              icon={<Search size={16} />}
              active={activePage === "search"}
              onClick={nav.toSearch}
            />
            <SidebarItem
              label={t("nav.style")}
              icon={<Wand2 size={16} />}
              active={activePage === "style"}
              onClick={nav.toStyle}
            />
            <SidebarItem
              label={t("nav.import")}
              icon={<FileInput size={16} />}
              active={activePage === "import"}
              onClick={nav.toImport}
            />
            <SidebarItem
              label={t("nav.radar")}
              icon={<TrendingUp size={16} />}
              active={activePage === "radar"}
              onClick={nav.toRadar}
            />
            {(isStandalone || isTauri) && (
              <SidebarItem
                label={t("nav.doctor")}
                icon={<Stethoscope size={16} />}
                active={activePage === "doctor"}
                onClick={nav.toDoctor}
              />
            )}
            <SidebarItem
              label="伏笔健康"
              icon={<Anchor size={16} />}
              active={activePage === "hooks"}
              onClick={nav.toHooks}
            />
            <SidebarItem
              label="AIGC 检测"
              icon={<ShieldCheck size={16} />}
              active={activePage === "detection-config"}
              onClick={nav.toDetectionConfig}
            />
            <SidebarItem
              label="MCP Server"
              icon={<Server size={16} />}
              active={activePage === "mcp"}
              onClick={nav.toMCP}
            />
            <SidebarItem
              label="Pipeline 可视化"
              icon={<GitBranch size={16} />}
              active={activePage === "pipeline"}
              onClick={() => nav.toPipeline()}
            />
            <SidebarItem
              label="Plugin 管理"
              icon={<Puzzle size={16} />}
              active={activePage === "plugins"}
              onClick={nav.toPlugins}
            />
            <SidebarItem
              label="Worktree 管理"
              icon={<FolderGit2 size={16} />}
              active={activePage === "worktree"}
              onClick={nav.toWorktree}
            />
          </div>
          )}
        </div>
      </div>

      {/* Footer / Status Area */}
      <div className="p-4 border-t border-border bg-secondary/40">
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border shadow-sm">
          {isTauri ? (
            <>
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-[11px] font-semibold text-foreground/80 uppercase tracking-wider">
                {t("nav.localMode")}
              </span>
            </>
          ) : (
            <>
              <div className={`w-2 h-2 rounded-full ${daemon?.running ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/40"}`} />
              <span className="text-[11px] font-semibold text-foreground/80 uppercase tracking-wider">
                {daemon?.running ? t("nav.agentOnline") : t("nav.agentOffline")}
              </span>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function SidebarItem({ label, icon, active, onClick, badge, badgeColor }: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
        active
          ? "bg-secondary text-foreground font-semibold shadow-sm border border-border"
          : "text-foreground font-medium hover:text-foreground hover:bg-secondary/50"
      }`}
    >
      <span className={`transition-colors ${active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}>
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
      {badge && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tight ${badgeColor}`}>
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
    <div className="ml-5 pl-3 border-l border-border/40 space-y-0.5 py-0.5">
      {data?.chapters.map((ch) => {
        const chId = `chapter:${bookId}:${ch.chapterNumber}`;
        const isActive = activePage === chId;
        return (
          <button
            key={ch.chapterNumber}
            onClick={() => nav.toChapter(bookId, ch.chapterNumber)}
            className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-all ${
              isActive
                ? "bg-primary/10 text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            }`}
          >
            <ChapterStatusIcon status={ch.status} />
            <span className="truncate">{ch.title ?? t("chapter.label").replace("{n}", String(ch.chapterNumber))}</span>
          </button>
        );
      })}

      <button
        onClick={() => nav.toTruth(bookId)}
        className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-all ${
          activePage === `truth:${bookId}`
            ? "bg-primary/10 text-primary font-semibold"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
        }`}
      >
        <FolderOpen size={12} />
        <span>{t("book.truthFiles")}</span>
      </button>

      <button
        onClick={() => nav.toState(bookId)}
        className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-all ${
          activePage === `state:${bookId}`
            ? "bg-primary/10 text-primary font-semibold"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
        }`}
      >
        <Layers size={12} />
        <span>状态投影</span>
      </button>

      {(!data?.chapters || data.chapters.length === 0) && chaptersWritten === 0 && (
        <div className="px-2 py-1 text-[10px] text-muted-foreground/50 italic">
          {t("book.noChapters")}
        </div>
      )}
    </div>
  );
}

/**
 * Chapter status icon: ✓ done (green), ● in-progress (amber), ○ pending (gray)
 */
function ChapterStatusIcon({ status }: { status?: string }) {
  switch (status) {
    case "done":
    case "published":
      return <span className="w-3 h-3 shrink-0 text-emerald-500 text-[10px] leading-3 text-center">✓</span>;
    case "writing":
    case "in-progress":
    case "revising":
      return <span className="w-3 h-3 shrink-0 rounded-full bg-amber-400 inline-block scale-50" />;
    default:
      return <span className="w-3 h-3 shrink-0 rounded-full border border-muted-foreground/40 inline-block scale-50" />;
  }
}
