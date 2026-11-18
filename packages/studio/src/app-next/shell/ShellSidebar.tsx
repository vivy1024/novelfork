import { type ReactNode, useState } from "react";
import {
  BookMarked,
  BookOpen,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Compass,
  Feather,
  GripVertical,
  LogOut,
  MessageSquareText,
  PackageMinus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  PenLine,
  Pin,
  Plus,
  Route,
  Search,
  Settings,
  Sparkles,
  Trash2,
  TrendingUp,
  Workflow,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  getShellNavItems,
  isShellNavItemActive,
  recentTabKey,
  type BookWorkbenchZone,
  type ShellBookItem,
  type ShellNavItem,
  type ShellRecentTabItem,
  type ShellRoute,
  type ShellSessionItem,
} from "./shell-route";
import { resolveRecentNarrators } from "./NarratorWorkspaceDrawer";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BookCover } from "@/components/BookCover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ShellSidebarProps {
  readonly route: ShellRoute;
  readonly books: readonly ShellBookItem[];
  readonly sessions: readonly ShellSessionItem[];
  readonly onNavigate: (route: ShellRoute) => void;
  readonly onDeleteBook?: (bookId: string) => void;
  readonly recentTabs?: readonly ShellRecentTabItem[];
  readonly onRemoveRecentTab?: (tab: ShellRecentTabItem) => void;
  readonly onPinRecentTab?: (tab: ShellRecentTabItem, pinned: boolean) => void;
  readonly onMoveRecentTab?: (tab: ShellRecentTabItem, target: ShellRecentTabItem) => void;
  readonly onClearInactiveRecentTabs?: () => void;
  readonly onLogout?: () => void;
  readonly onOpenSessionDrawer?: () => void;
  readonly collapsed?: boolean;
  readonly onToggleCollapse?: () => void;
  readonly mode?: "desktop" | "mobile";
  readonly onCloseMobile?: () => void;
}

const PLATFORM_SHORT_LABELS: Readonly<Record<string, string>> = {
  tomato: "番茄小说",
  fanqie: "番茄小说",
  qidian: "起点中文网",
  feilu: "飞卢小说",
  zhihu: "知乎盐选",
  jinjiang: "晋江文学城",
  qimao: "七猫小说",
  hongguo: "红果短剧",
  other: "通用网文",
};

const BOOK_ZONE_ITEMS: readonly {
  readonly id: BookWorkbenchZone;
  readonly label: string;
  readonly shortLabel: string;
  readonly icon: LucideIcon;
}[] = [
  { id: "write", label: "写正文 & 伴随大纲", shortLabel: "写正文", icon: PenLine },
  { id: "outline", label: "大纲总览 & 故事推进", shortLabel: "大纲推进", icon: Route },
  { id: "workflow", label: "工作流无限画布 & 日志", shortLabel: "工作流", icon: Workflow },
  { id: "lore", label: "作品基础（设定/知识卡）", shortLabel: "作品基础", icon: BookOpen },
  { id: "dissect", label: "拆书库 & 双轨文风", shortLabel: "拆书文风", icon: Feather },
  { id: "settings", label: "本书独立写作设置", shortLabel: "本书设置", icon: Settings },
];

function railIcon(Icon: LucideIcon) {
  return <Icon aria-hidden="true" className="size-5" strokeWidth={1.65} />;
}

function formatBookSubline(book: ShellBookItem): string {
  const parts: string[] = [];
  if (book.platform) {
    parts.push(PLATFORM_SHORT_LABELS[book.platform] ?? book.platform);
  }
  if (typeof book.chapterWordCount === "number" && book.chapterWordCount > 0) {
    parts.push(`${book.chapterWordCount}字/章`);
  }
  return parts.length > 0 ? parts.join(" · ") : "书房创作案头";
}

function resolveEffectiveBookZone(route: ShellRoute): BookWorkbenchZone {
  if (route.kind !== "book") return "write";
  if (route.panel === "settings" || route.zone === "settings") return "settings";
  return route.zone ?? "write";
}

function ShellRailItem({
  icon,
  label,
  active = false,
  onClick,
  truncate = false,
  indicator,
  className,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly active?: boolean;
  readonly onClick?: () => void;
  readonly truncate?: boolean;
  readonly indicator?: ReactNode;
  readonly className?: string;
}) {
  const item = (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "relative flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-md transition-colors focus-visible:outline-offset-0",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        className,
      )}
    >
      {active && <span aria-hidden="true" className="absolute bottom-2 left-0 top-2 w-[2px] rounded-r bg-primary" />}
      {icon}
      <span
        className={cn(
          "max-w-full text-2xs",
          truncate ? "truncate px-1 leading-tight" : "whitespace-nowrap leading-none",
          active ? "font-semibold" : "font-medium",
        )}
      >
        {label}
      </span>
      {indicator}
    </button>
  );
  if (!truncate) return item;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{item}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function NarratorNavButton({
  item,
  active,
  onClick,
  onClose,
  onPin,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
  isDropTarget,
}: {
  readonly item: ShellNavItem & { group: "narrators" };
  readonly active: boolean;
  readonly onClick: () => void;
  readonly onClose?: () => void;
  readonly onPin?: () => void;
  readonly onDragStart?: () => void;
  readonly onDragOver?: () => void;
  readonly onDrop?: () => void;
  readonly onDragEnd?: () => void;
  readonly isDragging?: boolean;
  readonly isDropTarget?: boolean;
}) {
  const { label, unread, working, pinned } = item;
  return (
    <div
      className={cn(
        "group flex items-center rounded-md transition",
        active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        isDragging && "opacity-50",
        isDropTarget && "ring-1 ring-primary/60",
      )}
      draggable={Boolean(onDragStart)}
      onDragStart={(event) => {
        if (!onDragStart) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", label);
        onDragStart();
      }}
      onDragOver={(event) => {
        if (!onDragOver) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDrop={(event) => {
        if (!onDrop) return;
        event.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
    >
      {onDragStart ? <GripVertical className="ml-1 size-3 shrink-0 cursor-grab text-muted-foreground/70" aria-hidden="true" /> : null}
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-2xs"
        onClick={onClick}
      >
        {pinned && <Pin className="size-3 shrink-0 text-primary" />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {working && <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" aria-label="工作中" />}
        {!working && unread && <span className="size-2 shrink-0 rounded-full bg-muted-foreground" aria-label="未读" />}
      </button>
      {onPin ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-5 shrink-0 text-muted-foreground hover:text-primary"
          aria-label={`${pinned ? "取消置顶" : "置顶"}最近项 ${label}`}
          title={pinned ? "取消置顶" : "置顶"}
          onClick={onPin}
        >
          <Pin className={cn("size-3", pinned && "fill-current")} />
        </Button>
      ) : null}
      {onClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="mr-0.5 size-5 shrink-0 text-muted-foreground"
          aria-label={`关闭最近项 ${label}`}
          onClick={onClose}
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}

function globalNavIcon(kind: ShellRoute["kind"]) {
  switch (kind) {
    case "search": return Search;
    case "routines": return Wrench;
    case "knowledge": return BookMarked;
    case "scheduled-tasks": return CalendarClock;
    case "learn": return BookOpen;
    case "market": return TrendingUp;
    default: return Settings;
  }
}

export function ShellSidebar({
  route,
  books,
  sessions,
  onNavigate,
  recentTabs = [],
  onRemoveRecentTab,
  onPinRecentTab,
  onMoveRecentTab,
  onClearInactiveRecentTabs,
  onLogout,
  onOpenSessionDrawer,
  collapsed = false,
  onToggleCollapse,
  mode = "desktop",
  onCloseMobile,
}: ShellSidebarProps) {
  const isMobile = mode === "mobile";
  const isCollapsed = !isMobile && collapsed;
  const [systemFoldOpen, setSystemFoldOpen] = useState(() =>
    route.kind === "narrator"
    || route.kind === "sessions"
    || route.kind === "search"
    || route.kind === "routines"
    || route.kind === "knowledge"
    || route.kind === "scheduled-tasks"
    || route.kind === "learn",
  );
  const [draggedRecentTabKey, setDraggedRecentTabKey] = useState<string | null>(null);
  const [dropTargetRecentTabKey, setDropTargetRecentTabKey] = useState<string | null>(null);

  const items = getShellNavItems({ books, sessions });
  const narratorItems = items.filter((item) => item.group === "narrators");
  const resolvedRecentNarrators = resolveRecentNarrators(recentTabs, sessions)
    .filter((entry) => entry.session?.status === "active");
  const recentNarratorItems = resolvedRecentNarrators.map(({ tab, narratorId, session }) => ({
    id: `recent:${tab.type}:${tab.id}`,
    label: tab.title || session?.title || "未命名叙述者",
    group: "narrators" as const,
    route: { kind: "narrator" as const, sessionId: narratorId },
    unread: session?.unread,
    working: session?.working ?? tab.status === "working",
    pinned: tab.pinned,
  }));
  const effectiveNarratorItems = recentTabs.length > 0 ? recentNarratorItems : narratorItems;
  const visibleNarratorItems = effectiveNarratorItems.slice(0, 5);
  const hiddenNarratorCount = Math.max(0, effectiveNarratorItems.length - visibleNarratorItems.length);
  const recentTabByNarratorId = new Map(
    resolvedRecentNarrators.map((entry) => [entry.narratorId, entry.tab]),
  );
  const recentTabsByKey = new Map(recentTabs.map((tab) => [recentTabKey(tab), tab]));
  const clearRecentDrag = () => {
    setDraggedRecentTabKey(null);
    setDropTargetRecentTabKey(null);
  };

  // 全局折叠抽屉收纳的系统级入口（市场扫榜已提升为书房一级入口，设置常驻底栏）。
  const systemGlobalItems = items.filter(
    (item) => item.group === "global" && item.route.kind !== "market" && item.route.kind !== "settings",
  );

  // 当前上下文焦点书籍：处于某本书路由时取该书，否则默认取书架第一本书以展开 6 大创作区快捷入口。
  const focusedBook = (route.kind === "book"
    ? books.find((b) => b.id === route.bookId)
    : undefined) ?? books[0] ?? null;
  const activeBookZone = resolveEffectiveBookZone(route);

  const navigateBookZone = (bookId: string, zone: BookWorkbenchZone) => {
    if (zone === "settings") {
      onNavigate({ kind: "book", bookId, zone: "settings" });
      return;
    }
    if (zone === "write") {
      onNavigate({ kind: "book", bookId });
      return;
    }
    onNavigate({ kind: "book", bookId, zone });
  };

  return (
    <TooltipProvider>
      <aside
        aria-label="NovelFork 主导航"
        className={cn(
          "flex h-full shrink-0 flex-col bg-secondary/75 transition-[width] duration-200 motion-reduce:transition-none",
          isMobile ? "w-full" : "border-r border-border",
          !isMobile && (isCollapsed ? "w-16" : "w-[212px]"),
        )}
        data-slot="shell-sidebar"
        data-nf-surface="rail"
        data-collapsed={isCollapsed ? "true" : "false"}
        data-testid="shell-sidebar"
      >
        {/* 顶栏：NovelFork 书房台 */}
        {isCollapsed ? (
          <div className="flex items-center justify-center border-b border-border py-1" role="banner">
            <ShellRailItem icon={railIcon(PanelLeftOpen)} label="展开侧栏" onClick={onToggleCollapse} />
          </div>
        ) : (
          <div className="flex items-center justify-between border-b border-border px-2.5 py-2" role="banner">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="nf-display truncate text-sm font-bold tracking-wide text-foreground">NovelFork</span>
              <Badge variant="outline" className="h-4 px-1.5 text-2xs font-medium text-muted-foreground">
                书房台
              </Badge>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={isMobile ? onCloseMobile : onToggleCollapse}
              aria-label={isMobile ? "关闭主导航" : "折叠侧栏"}
              title={isMobile ? "关闭主导航" : "折叠侧栏"}
            >
              <PanelLeftClose className="size-3.5" />
            </Button>
          </div>
        )}

        {/* 主体滚动区 */}
        <div
          className={cn(
            "flex flex-1 flex-col overflow-y-auto",
            isCollapsed ? "items-center gap-1.5 overflow-x-hidden py-2" : "gap-3 px-2 py-2.5",
          )}
        >
          {/* 1. 作品书架置顶（v6 书架卡片 + 右侧「+ 扫榜开书」） */}
          <section className={cn("flex flex-col", isCollapsed ? "items-center gap-1" : "gap-1.5")} aria-label="作品书架">
            {isCollapsed ? (
              <>
                <ShellRailItem
                  icon={railIcon(BookOpen)}
                  label="作品书架"
                  active={route.kind === "books"}
                  onClick={() => onNavigate({ kind: "books" })}
                />
                {books.map((book) => {
                  const isBookActive = route.kind === "book" && route.bookId === book.id;
                  return (
                    <ShellRailItem
                      key={book.id}
                      icon={<BookCover title={book.title} size="xs" />}
                      label={book.title}
                      active={isBookActive}
                      onClick={() => onNavigate({ kind: "book", bookId: book.id })}
                      truncate
                    />
                  );
                })}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between px-1">
                  <button
                    type="button"
                    onClick={() => onNavigate({ kind: "books" })}
                    className="text-2xs font-bold tracking-wide text-muted-foreground transition-colors hover:text-primary"
                  >
                    作品书架
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate({ kind: "market" })}
                    className="inline-flex items-center gap-0.5 text-2xs font-semibold text-primary hover:underline"
                    data-testid="sidebar-market-newbook"
                  >
                    <span>+ 扫榜开书</span>
                  </button>
                </div>

                {books.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {books.map((book) => {
                      const isBookActive = route.kind === "book" && route.bookId === book.id;
                      const isSettingsActive = isBookActive && activeBookZone === "settings";
                      return (
                        <div
                          key={book.id}
                          data-testid={`shelf-book-card-${book.id}`}
                          className={cn(
                            "rounded-md border p-1.5 transition-colors",
                            isBookActive
                              ? "border-primary bg-card shadow-xs"
                              : "border-border/80 bg-card/40 hover:border-primary/40 hover:bg-card/80",
                          )}
                        >
                          <button
                            type="button"
                            aria-label={book.title}
                            aria-current={isBookActive ? "page" : undefined}
                            onClick={() => onNavigate({ kind: "book", bookId: book.id })}
                            className="flex w-full items-center gap-2 text-left"
                          >
                            <BookCover title={book.title} size="xs" />
                            <div className="min-w-0 flex-1">
                              <div className={cn("truncate text-xs", isBookActive ? "font-bold text-foreground" : "font-medium text-foreground/90")}>
                                {book.title}
                              </div>
                              <div className="truncate text-2xs text-muted-foreground">
                                {formatBookSubline(book)}
                              </div>
                            </div>
                          </button>
                          <div className="mt-1.5 flex items-center justify-between gap-1">
                            <span
                              className={cn(
                                "inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-medium",
                                book.manuscriptImportJobId
                                  ? "bg-warning/15 text-warning"
                                  : "bg-primary/12 text-primary",
                              )}
                            >
                              {book.manuscriptImportJobId ? "导入待确认" : "就绪"}
                            </span>
                            <button
                              type="button"
                              aria-label={`设置 ${book.title}`}
                              onClick={() => navigateBookZone(book.id, "settings")}
                              className={cn(
                                "rounded px-1 py-0.5 text-2xs font-semibold transition-colors",
                                isSettingsActive
                                  ? "bg-primary/15 text-primary"
                                  : "text-muted-foreground hover:text-primary",
                              )}
                            >
                              本书设置
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-border bg-card/40 px-2.5 py-2 text-2xs text-muted-foreground">
                    暂无书籍，点击下方新建作品开书。
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => onNavigate({ kind: "home" })}
                  className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-primary/40 bg-primary/5 px-2 py-1 text-2xs font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  <Plus className="size-3" />
                  <span>新建作品</span>
                </button>
              </>
            )}
          </section>

          {/* 2. 当前作品 6 大平铺创作分区（消灭第二列 IDE ActivityBar） */}
          {focusedBook ? (
            <>
              <div className="border-t border-border/80" />
              <section
                className={cn("flex flex-col", isCollapsed ? "items-center gap-0.5" : "gap-0.5")}
                aria-label="当前作品创作分区"
                data-testid="book-workbench-zones"
              >
                {!isCollapsed && (
                  <div className="truncate px-1 pb-0.5 text-2xs font-bold text-muted-foreground">
                    《{focusedBook.title}》
                  </div>
                )}
                {BOOK_ZONE_ITEMS.map((zoneItem) => {
                  const Icon = zoneItem.icon;
                  const active =
                    route.kind === "book"
                    && route.bookId === focusedBook.id
                    && activeBookZone === zoneItem.id;

                  if (isCollapsed) {
                    return (
                      <ShellRailItem
                        key={zoneItem.id}
                        icon={railIcon(Icon)}
                        label={zoneItem.shortLabel}
                        active={active}
                        onClick={() => navigateBookZone(focusedBook.id, zoneItem.id)}
                      />
                    );
                  }

                  return (
                    <button
                      key={zoneItem.id}
                      type="button"
                      data-testid={`book-zone-${zoneItem.id}`}
                      aria-current={active ? "page" : undefined}
                      onClick={() => navigateBookZone(focusedBook.id, zoneItem.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md border-l-[3px] px-2 py-1.5 text-left text-xs transition-colors",
                        active
                          ? "border-primary bg-card font-semibold text-primary shadow-2xs"
                          : "border-transparent text-foreground/85 hover:bg-card/60 hover:text-foreground",
                      )}
                    >
                      <Icon className={cn("size-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground")} strokeWidth={1.75} />
                      <span className="truncate">{zoneItem.label}</span>
                    </button>
                  );
                })}
              </section>
            </>
          ) : null}

          <div className="border-t border-border/80" />

          {/* 3. 一级常驻入口：AI 扫榜 & 创意起书工具 */}
          <section className={cn("flex flex-col", isCollapsed ? "items-center" : "")} aria-label="扫榜与起书">
            {isCollapsed ? (
              <ShellRailItem
                icon={railIcon(Sparkles)}
                label="扫榜起书"
                active={route.kind === "market"}
                onClick={() => onNavigate({ kind: "market" })}
              />
            ) : (
              <button
                type="button"
                data-testid="sidebar-ideation-market"
                aria-current={route.kind === "market" ? "page" : undefined}
                onClick={() => onNavigate({ kind: "market" })}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md border-l-[3px] px-2 py-1.5 text-left text-xs transition-colors",
                  route.kind === "market"
                    ? "border-primary bg-card font-semibold text-primary shadow-2xs"
                    : "border-transparent text-foreground/85 hover:bg-card/60 hover:text-foreground",
                )}
              >
                <Compass className={cn("size-3.5 shrink-0", route.kind === "market" ? "text-primary" : "text-muted-foreground")} strokeWidth={1.75} />
                <span className="truncate">AI 扫榜 & 创意起书工具</span>
              </button>
            )}
          </section>
        </div>

        {/* 4. 底部：NarraFork 全局区折叠收纳 + 全局设置 / 退出登录 */}
        <nav
          className={cn(
            "flex flex-col gap-1 border-t border-border bg-secondary/90 py-2",
            isCollapsed ? "items-center px-1" : "px-2",
          )}
          aria-label="全局入口"
        >
          {isCollapsed ? (
            <>
              {onOpenSessionDrawer ? (
                <ShellRailItem icon={railIcon(MessageSquareText)} label="对话" onClick={onOpenSessionDrawer} />
              ) : null}
              <ShellRailItem
                icon={railIcon(PackageMinus)}
                label="全局区"
                active={systemFoldOpen}
                onClick={() => setSystemFoldOpen((v) => !v)}
              />
              {systemFoldOpen &&
                systemGlobalItems.map((item) => {
                  const Icon = globalNavIcon(item.route.kind);
                  const isActive = isShellNavItemActive(item, route);
                  return (
                    <ShellRailItem
                      key={item.id}
                      icon={railIcon(Icon)}
                      label={item.label}
                      active={isActive}
                      onClick={() => onNavigate(item.route)}
                    />
                  );
                })}
              <ShellRailItem
                icon={railIcon(Settings)}
                label="设置"
                active={route.kind === "settings"}
                onClick={() => onNavigate({ kind: "settings" })}
              />
              {onLogout ? (
                <ShellRailItem icon={railIcon(LogOut)} label="退出登录" onClick={onLogout} className="hover:text-destructive" />
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                aria-expanded={systemFoldOpen}
                data-testid="narrafork-global-fold-toggle"
                onClick={() => setSystemFoldOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1 text-2xs font-semibold text-muted-foreground transition-colors hover:bg-card/60 hover:text-foreground"
              >
                <span className="inline-flex items-center gap-1.5">
                  <PackageMinus className="size-3.5" />
                  <span>NarraFork 全局区</span>
                </span>
                {systemFoldOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </button>

              {systemFoldOpen && (
                <div className="space-y-1.5 rounded-md border border-border/60 bg-card/50 p-1.5" data-testid="narrafork-global-fold-body">
                  {/* 独立叙述者会话收纳于此 */}
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-between px-1.5 py-0.5">
                      <span className="text-2xs font-semibold text-muted-foreground">独立叙述者会话</span>
                      <div className="flex items-center gap-0.5">
                        {recentNarratorItems.length > 0 && onClearInactiveRecentTabs ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="size-4 text-muted-foreground hover:text-primary"
                            onClick={onClearInactiveRecentTabs}
                            title="清理不活跃最近标签"
                            aria-label="清理不活跃最近标签"
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        ) : null}
                        {onOpenSessionDrawer ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="size-4 text-muted-foreground hover:text-primary"
                            onClick={onOpenSessionDrawer}
                            title="打开对话列表"
                            aria-label="打开对话列表"
                          >
                            <PanelRightOpen className="size-3" />
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="size-4 text-muted-foreground hover:text-primary"
                          onClick={() => onNavigate({ kind: "sessions", create: true })}
                          title="新建叙述者"
                          aria-label="新建叙述者"
                        >
                          <Plus className="size-3" />
                        </Button>
                      </div>
                    </div>
                    {visibleNarratorItems.map((item) => {
                      const tab = recentTabByNarratorId.get(item.route.sessionId);
                      return (
                        <NarratorNavButton
                          key={item.id}
                          item={item as ShellNavItem & { group: "narrators" }}
                          active={isShellNavItemActive(item, route)}
                          onClick={() => onNavigate(item.route)}
                          onClose={tab && onRemoveRecentTab ? () => onRemoveRecentTab(tab) : undefined}
                          onPin={tab && onPinRecentTab ? () => onPinRecentTab(tab, !tab.pinned) : undefined}
                          onDragStart={tab && onMoveRecentTab ? () => setDraggedRecentTabKey(recentTabKey(tab)) : undefined}
                          onDragOver={tab && onMoveRecentTab ? () => {
                            const source = draggedRecentTabKey ? recentTabsByKey.get(draggedRecentTabKey) : undefined;
                            if (source && source.pinned === tab.pinned) setDropTargetRecentTabKey(recentTabKey(tab));
                            else setDropTargetRecentTabKey(null);
                          } : undefined}
                          onDrop={tab && onMoveRecentTab ? () => {
                            const source = draggedRecentTabKey ? recentTabsByKey.get(draggedRecentTabKey) : undefined;
                            if (source && source.pinned === tab.pinned && recentTabKey(source) !== recentTabKey(tab)) {
                              onMoveRecentTab(source, tab);
                            }
                            clearRecentDrag();
                          } : undefined}
                          onDragEnd={clearRecentDrag}
                          isDragging={Boolean(tab && draggedRecentTabKey === recentTabKey(tab))}
                          isDropTarget={Boolean(tab && dropTargetRecentTabKey === recentTabKey(tab))}
                        />
                      );
                    })}
                    {hiddenNarratorCount > 0 ? (
                      <p className="px-2 text-2xs text-muted-foreground">还有 {hiddenNarratorCount} 个对话</p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onNavigate({ kind: "sessions" })}
                      className="w-full rounded px-2 py-1 text-left text-2xs font-medium text-primary hover:bg-primary/10"
                    >
                      查看全部叙述者
                    </button>
                  </div>

                  <div className="border-t border-border/60 pt-1">
                    {systemGlobalItems.map((item) => {
                      const Icon = globalNavIcon(item.route.kind);
                      const isActive = isShellNavItemActive(item, route);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          aria-current={isActive ? "page" : undefined}
                          onClick={() => onNavigate(item.route)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-2xs transition-colors",
                            isActive
                              ? "bg-primary/10 font-medium text-primary"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          <Icon className="size-3.5 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-1 pt-0.5">
                <button
                  type="button"
                  aria-current={route.kind === "settings" ? "page" : undefined}
                  onClick={() => onNavigate({ kind: "settings" })}
                  className={cn(
                    "inline-flex flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-2xs transition-colors",
                    route.kind === "settings"
                      ? "bg-primary/10 font-semibold text-primary"
                      : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                  )}
                >
                  <Settings className="size-3.5 shrink-0" />
                  <span>全局设置</span>
                </button>
                {onLogout ? (
                  <button
                    type="button"
                    aria-label="退出登录"
                    title="退出登录"
                    onClick={onLogout}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <LogOut className="size-3.5 shrink-0" />
                    <span>退出</span>
                  </button>
                ) : null}
              </div>
            </>
          )}
        </nav>
      </aside>
    </TooltipProvider>
  );
}
